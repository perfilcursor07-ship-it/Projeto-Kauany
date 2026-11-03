import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { isConnected, newMessageId, REJECTED_PREFIX, sendText } from './whatsapp.service.js';
import { sendNtfy } from '../notifications/ntfy.service.js';

// ===========================================================================
// Worker do robo (modo baileys). Envia as mensagens da fila notification_jobs
// com forte protecao anti-bloqueio:
//   - 1 mensagem por ciclo, com intervalo ALEATORIO entre elas
//   - janela de horario (nao envia de madrugada)
//   - limite diario por negocio (protege numeros novos / "aquecimento")
//   - so envia se o WhatsApp estiver conectado e o numero existir (no sender)
// Se o WhatsApp cair, os jobs ficam pendentes e sao retomados ao reconectar.
// ===========================================================================

let timer: NodeJS.Timeout | null = null;
let stopped = true;

// Quanto tempo a fila fica parada depois de uma recusa do servidor do WhatsApp.
//
// O erro 463 (NackCallerReachoutTimelocked) e um bloqueio temporario por
// "reachout": o WhatsApp limita quem manda mensagem para quem nunca falou com
// o numero. Insistir enquanto o bloqueio esta ativo aprofunda a restricao e,
// nos relatos do projeto Baileys, chega a derrubar a conta de vez. Entao, na
// primeira recusa, a fila para sozinha em vez de continuar martelando.
const BREAKER_COOLDOWN_MIN = 60;

// Recusa mais recente do servidor para este negocio, se ainda estiver na
// janela de bloqueio.
//
// Consulta crua de proposito: as colunas DATETIME guardam hora LOCAL, mas o
// Prisma devolve e envia Date como se fosse UTC. Comparar `updatedAt` com um
// `new Date()` do Node erra por 3 horas e o bloqueio nunca pegaria. Fazendo a
// conta de tempo dentro do MySQL (TIMESTAMPDIFF com NOW()), os dois lados
// usam o mesmo relogio.
export async function recentRejection(
  businessId: bigint,
): Promise<{ error: string; minutesAgo: number } | null> {
  const rows = await prisma.$queryRaw<Array<{ error: string; minutes_ago: unknown }>>`
    SELECT error, TIMESTAMPDIFF(MINUTE, updated_at, NOW()) AS minutes_ago
      FROM notification_jobs
     WHERE business_id = ${businessId}
       AND status = 'failed'
       AND error LIKE ${REJECTED_PREFIX + '%'}
       AND TIMESTAMPDIFF(MINUTE, updated_at, NOW()) BETWEEN 0 AND ${BREAKER_COOLDOWN_MIN}
     ORDER BY updated_at DESC
     LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;
  return { error: row.error, minutesAgo: Number(row.minutes_ago) };
}

const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

function withinSendWindow(now = new Date()): boolean {
  const h = now.getHours();
  const start = env.WHATSAPP_SEND_START_HOUR;
  const end = env.WHATSAPP_SEND_END_HOUR;
  return h >= start && h < end;
}

async function sentTodayCount(businessId: bigint): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return prisma.notificationJob.count({
    where: { businessId, status: 'sent', sentAt: { gte: startOfDay } },
  });
}

function scheduleNext(seconds: number) {
  if (stopped) return;
  timer = setTimeout(() => void runOnce(), seconds * 1000);
}

// Avisos internos por push. Sai na frente da fila do WhatsApp e sem as pausas
// dela: ntfy e um POST HTTP simples, nao tem risco de bloqueio, e um sinal
// recebido precisa chegar na hora -- nao daqui a um minuto.
async function drainNtfy(): Promise<boolean> {
  const job = await prisma.notificationJob.findFirst({
    where: { status: 'pending', channel: 'ntfy', scheduledFor: { lte: new Date() } },
    orderBy: { scheduledFor: 'asc' },
  });
  if (!job) return false;

  const business = await prisma.business.findUnique({
    where: { id: job.businessId },
    select: { ntfyServer: true, name: true },
  });

  const result = await sendNtfy(business?.ntfyServer, job.toPhone, {
    title: `${business?.name ?? 'Studio'}: sinal recebido`,
    body: job.body,
    priority: 4,
    tags: ['moneybag'],
  });

  await prisma.notificationJob.update({
    where: { id: job.id },
    data: result.ok
      ? { status: 'sent', sentAt: new Date(), error: null }
      : { status: 'failed', error: result.error ?? 'erro desconhecido no ntfy' },
  });

  if (!result.ok) console.error(`[ntfy] falha ao enviar aviso interno: ${result.error}`);
  return true;
}

async function runOnce() {
  if (stopped) return;
  try {
    // Push interno primeiro: nao depende do WhatsApp estar conectado, nem da
    // janela de horario -- um pagamento as 23h tem que avisar as 23h.
    if (await drainNtfy()) {
      scheduleNext(2);
      return;
    }

    // Daqui para baixo e so WhatsApp.
    if (env.WHATSAPP_MODE !== 'baileys') {
      scheduleNext(30);
      return;
    }

    // Fora da janela de horario: espera e checa de novo em 5 min.
    if (!withinSendWindow()) {
      scheduleNext(300);
      return;
    }

    const now = new Date();
    const job = await prisma.notificationJob.findFirst({
      where: { status: 'pending', channel: 'whatsapp', scheduledFor: { lte: now } },
      orderBy: { scheduledFor: 'asc' },
    });

    // Nada para enviar agora: checa novamente em breve.
    if (!job) {
      scheduleNext(20);
      return;
    }

    // WhatsApp desconectado: deixa pendente e tenta de novo em 30s.
    if (!isConnected(job.businessId)) {
      scheduleNext(30);
      return;
    }

    // Servidor recusou um envio ha pouco: segura a fila inteira. Os jobs ficam
    // pendentes e saem sozinhos quando o bloqueio passar.
    const rejection = await recentRejection(job.businessId);
    if (rejection) {
      console.warn(
        `[whatsapp] fila pausada: ${rejection.error} (ha ${rejection.minutesAgo} min)`,
      );
      scheduleNext(300);
      return;
    }

    // Lembrete ou correcao de endereco de agendamento nao confirmado: nao envia.
    if (job.appointmentId && (job.triggerKey.startsWith('reminder') || job.triggerKey === 'address_update')) {
      const appt = await prisma.appointment.findUnique({
        where: { id: job.appointmentId },
        select: { status: true },
      });
      if (!appt || appt.status !== 'confirmed') {
        await prisma.notificationJob.update({
          where: { id: job.id },
          data: { status: 'cancelled', error: 'agendamento nao esta mais confirmado' },
        });
        scheduleNext(3);
        return;
      }
    }

    // Limite diario atingido: segura os envios por 15 min.
    const count = await sentTodayCount(job.businessId);
    if (count >= env.WHATSAPP_DAILY_LIMIT) {
      scheduleNext(900);
      return;
    }

    // Grava o id ANTES de enviar. O ACK do servidor volta em milissegundos e,
    // se a linha ainda nao tivesse o id, o ACK nao casaria com nada.
    const messageId = newMessageId(job.businessId);
    await prisma.notificationJob.update({
      where: { id: job.id },
      data: { providerMessageId: messageId },
    });

    const result = await sendText(job.businessId, job.toPhone, job.body, messageId);

    // updateMany com filtro de status em vez de update: o ACK de recusa do
    // servidor pode chegar enquanto o sendText ainda nao retornou e ja marcar
    // a linha como 'failed'. Sem o filtro, o worker apagaria essa falha logo
    // em seguida escrevendo 'sent' por cima.
    await prisma.notificationJob.updateMany({
      where: { id: job.id, status: 'pending' },
      data: result.ok
        ? { status: 'sent', sentAt: new Date(), error: null }
        : { status: 'failed', error: result.error ?? 'erro desconhecido' },
    });

    // Intervalo ALEATORIO ate a proxima mensagem (essencial anti-bloqueio).
    scheduleNext(rand(env.WHATSAPP_MIN_GAP_SEC, env.WHATSAPP_MAX_GAP_SEC));
  } catch {
    // Um erro num ciclo nao derruba o worker.
    scheduleNext(30);
  }
}

export function startNotificationWorker() {
  // Roda nos dois modos: no manual as mensagens da cliente ficam para envio
  // wa.me, mas os avisos internos por ntfy continuam saindo sozinhos.
  if (!stopped) return;
  stopped = false;
  scheduleNext(10);
}

export function stopNotificationWorker() {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
}
