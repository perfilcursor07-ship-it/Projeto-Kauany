import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { isConnected, sendText } from './whatsapp.service.js';

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

async function runOnce() {
  if (stopped) return;
  try {
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

    const result = await sendText(job.businessId, job.toPhone, job.body);
    if (result.ok) {
      await prisma.notificationJob.update({
        where: { id: job.id },
        data: {
          status: 'sent',
          sentAt: new Date(),
          error: null,
          // Guarda o id para casar o ACK de entrega que chega depois.
          providerMessageId: result.messageId ?? null,
        },
      });
    } else {
      await prisma.notificationJob.update({
        where: { id: job.id },
        data: { status: 'failed', error: result.error ?? 'erro desconhecido' },
      });
    }

    // Intervalo ALEATORIO ate a proxima mensagem (essencial anti-bloqueio).
    scheduleNext(rand(env.WHATSAPP_MIN_GAP_SEC, env.WHATSAPP_MAX_GAP_SEC));
  } catch {
    // Um erro num ciclo nao derruba o worker.
    scheduleNext(30);
  }
}

export function startNotificationWorker() {
  // So roda no modo automatico. No manual as mensagens ficam para envio wa.me.
  if (env.WHATSAPP_MODE !== 'baileys') return;
  if (!stopped) return;
  stopped = false;
  scheduleNext(10);
}

export function stopNotificationWorker() {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
}
