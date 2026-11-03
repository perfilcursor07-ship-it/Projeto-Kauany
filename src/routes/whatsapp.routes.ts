import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  connectWhatsapp,
  disconnectWhatsapp,
  getConnectedPhone,
  getWhatsappStatus,
  isSamePhone,
  sendText,
} from '../modules/whatsapp/whatsapp.service.js';
import { prisma } from '../lib/prisma.js';
import {
  FALLBACK_BODIES,
  fallbackBody,
  firstName,
  INTERNAL_TRIGGERS,
  renderTemplate,
  sampleVars,
  STUDIO_ADDRESS_URL,
  TESTABLE_TRIGGERS,
  triggerLabel,
} from '../modules/whatsapp/templates.js';

function businessIdOf(req: FastifyRequest): bigint {
  return BigInt(req.user.businessId);
}

export async function whatsappRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // Inicia a conexao (gera o QR Code para leitura).
  app.post('/connect', async (req) => {
    const businessId = businessIdOf(req);
    await connectWhatsapp(businessId);
    return getWhatsappStatus(businessId);
  });

  // Status atual + QR (o painel faz polling deste endpoint).
  app.get('/status', async (req) => {
    return getWhatsappStatus(businessIdOf(req));
  });

  // Desconecta e limpa a sessao.
  app.post('/disconnect', async (req) => {
    await disconnectWhatsapp(businessIdOf(req));
    return { status: 'disconnected' };
  });

  // Mensagens disponiveis para teste, ja preenchidas com dados de exemplo.
  // Usa a mesma regra do envio real: template ativo do banco se existir,
  // senao o texto padrao do codigo. Assim o teste mostra o que a cliente ve.
  app.get('/test-messages', async (req) => {
    const businessId = businessIdOf(req);
    const [business, templates] = await Promise.all([
      prisma.business.findUnique({
        where: { id: businessId },
        select: { name: true, timezone: true },
      }),
      prisma.notificationTemplate.findMany({
        where: { businessId, channel: 'whatsapp', active: true },
        select: { triggerKey: true, body: true },
      }),
    ]);

    const byTrigger = new Map(templates.map((t) => [t.triggerKey, t.body]));
    const vars = sampleVars(business?.name ?? '', business?.timezone ?? 'America/Sao_Paulo');

    return {
      sample: vars,
      messages: TESTABLE_TRIGGERS.map((triggerKey) => {
        // address_update e manager_paid nao consultam a tabela no envio real,
        // entao o teste tambem nao consulta: o texto vem sempre do codigo.
        const usesTemplate = !['address_update', 'manager_paid'].includes(triggerKey);
        const custom = usesTemplate ? byTrigger.get(triggerKey) : undefined;
        const body = custom ?? fallbackBody(triggerKey) ?? '';

        return {
          triggerKey,
          label: triggerLabel(triggerKey),
          body: renderTemplate(body, vars),
          source: custom ? 'template' : 'padrao',
          internal: INTERNAL_TRIGGERS.includes(triggerKey),
        };
      }),
    };
  });

  // Envio de teste (para validar a conexao).
  app.post('/test', async (req, reply) => {
    const parsed = z
      .object({ to: z.string().min(8), message: z.string().min(1).max(4000) })
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados invalidos' });
    }
    const result = await sendText(businessIdOf(req), parsed.data.to, parsed.data.message);
    if (!result.ok) return reply.code(400).send({ message: result.error });
    return { sent: true, message: 'Mensagem aceita pelo WhatsApp' };
  });

  // Historico recente da fila. "sent" significa que o WhatsApp aceitou o
  // envio; a biblioteca nao garante confirmacao de entrega no aparelho.
  app.get('/notifications', async (req) => {
    const businessId = businessIdOf(req);
    const [business, notifications] = await Promise.all([
      prisma.business.findUnique({
        where: { id: businessId },
        select: { phone: true, notifyPhone: true },
      }),
      prisma.notificationJob.findMany({
        where: { businessId, channel: 'whatsapp' },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          appointmentId: true,
          triggerKey: true,
          toPhone: true,
          body: true,
          status: true,
          error: true,
          createdAt: true,
          sentAt: true,
          providerMessageId: true,
          serverAckAt: true,
          deliveredAt: true,
          readAt: true,
        },
      }),
    ]);

    const appointmentIds = [...new Set(notifications.flatMap((item) =>
      item.appointmentId ? [item.appointmentId] : [],
    ))];
    const appointments = appointmentIds.length
      ? await prisma.appointment.findMany({
          where: { businessId, id: { in: appointmentIds } },
          select: {
            id: true,
            startAt: true,
            status: true,
            client: { select: { name: true } },
          },
        })
      : [];
    const appointmentById = new Map(
      appointments.map((appointment) => [
        appointment.id.toString(),
        {
          clientName: appointment.client.name,
          startAt: appointment.startAt,
          status: appointment.status,
        },
      ] as const),
    );

    // O aviso interno nao chega quando o destino e a propria conta conectada:
    // o WhatsApp nao notifica mensagens que voce manda para voce mesmo. O
    // painel precisa dessa informacao para avisar antes de o envio falhar.
    const connectedPhone = getConnectedPhone(businessId);
    const notifyPhone = business?.notifyPhone ?? null;
    const notifyTarget = notifyPhone || business?.phone || null;

    return {
      mode: getWhatsappStatus(businessId).mode,
      studioPhone: business?.phone ?? null,
      notifyPhone,
      connectedPhone,
      notifySelfSend: isSamePhone(notifyTarget, connectedPhone),
      notifications: notifications.map(({ id, appointmentId, providerMessageId, ...item }) => ({
        ...item,
        id: id.toString(),
        // Mensagens enviadas antes do rastreamento nao tem id, entao nao da
        // para afirmar nada sobre a entrega delas.
        tracked: providerMessageId !== null,
        appointment: appointmentId ? appointmentById.get(appointmentId.toString()) ?? null : null,
      })),
    };
  });

  // Numero que recebe os avisos internos (ex: "sinal recebido").
  // Precisa ser diferente do numero conectado ao robo.
  app.put('/notify-phone', async (req, reply) => {
    const parsed = z
      .object({ notifyPhone: z.string().max(30).nullable() })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ message: 'Numero invalido' });

    const businessId = businessIdOf(req);
    const digits = parsed.data.notifyPhone?.replace(/\D/g, '') || null;
    if (digits && digits.length < 10) {
      return reply.code(400).send({ message: 'Informe o numero com DDD' });
    }

    const connectedPhone = getConnectedPhone(businessId);
    if (digits && isSamePhone(digits, connectedPhone)) {
      return reply.code(400).send({
        message:
          'Este e o proprio numero conectado ao robo. O WhatsApp nao notifica mensagens para voce mesmo: use outro numero (ex: seu WhatsApp pessoal).',
      });
    }

    const updated = await prisma.business.update({
      where: { id: businessId },
      data: { notifyPhone: digits },
      select: { notifyPhone: true },
    });
    return { notifyPhone: updated.notifyPhone };
  });

  // Enfileira uma mensagem individual com o endereco atualizado.
  app.post('/notifications/:id/resend-address', async (req, reply) => {
    const parsed = z.object({ id: z.coerce.bigint() }).safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ message: 'Notificacao invalida' });

    const businessId = businessIdOf(req);
    const original = await prisma.notificationJob.findFirst({
      where: {
        id: parsed.data.id,
        businessId,
        channel: 'whatsapp',
        triggerKey: 'confirmed',
        status: 'sent',
      },
      select: { appointmentId: true, toPhone: true },
    });
    if (!original) return reply.code(404).send({ message: 'Confirmacao enviada nao encontrada' });
    if (!original.appointmentId) return reply.code(400).send({ message: 'Agendamento nao encontrado' });

    const appointment = await prisma.appointment.findFirst({
      where: { id: original.appointmentId, businessId, status: 'confirmed' },
      select: { client: { select: { name: true } } },
    });
    if (!appointment) {
      return reply.code(409).send({ message: 'Este agendamento nao esta mais confirmado' });
    }

    const correction = await prisma.notificationJob.create({
      data: {
        businessId,
        appointmentId: original.appointmentId,
        triggerKey: 'address_update',
        channel: 'whatsapp',
        toPhone: original.toPhone,
        body: renderTemplate(FALLBACK_BODIES.address_update, {
          primeiro_nome: firstName(appointment.client.name),
          endereco: STUDIO_ADDRESS_URL,
        }),
        scheduledFor: new Date(),
        status: 'pending',
      },
      select: { id: true },
    });

    return { queued: true, id: correction.id.toString() };
  });

  // Marca uma mensagem como enviada (usado no modo manual, apos abrir o wa.me).
  app.post('/notifications/:id/sent', async (req, reply) => {
    const parsed = z.object({ id: z.coerce.bigint() }).safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ message: 'Notificacao invalida' });

    const notification = await prisma.notificationJob.findFirst({
      where: { id: parsed.data.id, businessId: businessIdOf(req), channel: 'whatsapp' },
      select: { id: true },
    });
    if (!notification) return reply.code(404).send({ message: 'Notificacao nao encontrada' });

    await prisma.notificationJob.update({
      where: { id: notification.id },
      data: { status: 'sent', sentAt: new Date(), error: null },
    });
    return { marked: true };
  });

  // O reenvio so recoloca na fila uma notificacao pertencente ao negocio.
  app.post('/notifications/:id/retry', async (req, reply) => {
    const parsed = z.object({ id: z.coerce.bigint() }).safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ message: 'Notificacao invalida' });

    const notification = await prisma.notificationJob.findFirst({
      where: { id: parsed.data.id, businessId: businessIdOf(req), channel: 'whatsapp' },
      select: { id: true },
    });
    if (!notification) return reply.code(404).send({ message: 'Notificacao nao encontrada' });

    await prisma.notificationJob.update({
      where: { id: notification.id },
      data: { status: 'pending', scheduledFor: new Date(), sentAt: null, error: null },
    });
    return { queued: true };
  });
}
