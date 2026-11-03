import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  connectWhatsapp,
  disconnectWhatsapp,
  getWhatsappStatus,
  sendText,
} from '../modules/whatsapp/whatsapp.service.js';
import { prisma } from '../lib/prisma.js';
import { firstName, STUDIO_ADDRESS_URL } from '../modules/whatsapp/templates.js';

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

  // Envio de teste (para validar a conexao).
  app.post('/test', async (req, reply) => {
    const parsed = z
      .object({ to: z.string().min(8), message: z.string().min(1).max(1000) })
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
        select: { phone: true },
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

    return {
      mode: getWhatsappStatus(businessId).mode,
      studioPhone: business?.phone ?? null,
      notifications: notifications.map(({ id, appointmentId, ...item }) => ({
        ...item,
        id: id.toString(),
        appointment: appointmentId ? appointmentById.get(appointmentId.toString()) ?? null : null,
      })),
    };
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
        body:
          `Olá, ${firstName(appointment.client.name)}! ✨\n\n` +
          `Passando para corrigir o endereço do seu agendamento. O endereço correto é:\n${STUDIO_ADDRESS_URL}\n\n` +
          'Desculpe pelo transtorno. Te espero no horário combinado!',
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
