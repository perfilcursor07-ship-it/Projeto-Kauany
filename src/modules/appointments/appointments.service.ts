import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import {
  appointmentLink,
  FALLBACK_BODIES,
  firstName,
  renderTemplate,
  STUDIO_ADDRESS_URL,
} from '../whatsapp/templates.js';

const brl = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export function computeDeposit(
  price: Prisma.Decimal,
  depositType: string,
  depositValue: Prisma.Decimal
): number {
  const priceNum = Number(price);
  const depNum = Number(depositValue);
  if (depositType === 'fixed') return Math.min(depNum, priceNum);
  if (depositType === 'percentage') return Math.round(priceNum * (depNum / 100) * 100) / 100;
  return 0;
}

export interface CreateAppointmentInput {
  businessId: bigint;
  serviceId?: bigint;
  serviceIds?: bigint[];
  professionalId?: bigint;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  client: { name: string; phone: string; email?: string | null };
  notes?: string | null;
  // Quando true (agendamento manual pelo painel), ja cria como confirmado
  // e sem exigir sinal/expiracao.
  confirm?: boolean;
}

type AppointmentWithServices = {
  service: { name: string };
  appointmentServices?: Array<{ sortOrder: number; service: { name: string } }>;
};

export function appointmentServiceLabel(appointment: AppointmentWithServices): string {
  const names = (appointment.appointmentServices ?? [])
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item) => item.service.name);
  return names.length > 0 ? names.join(' + ') : appointment.service.name;
}

function appointmentBufferMinutes(appointment: {
  service?: { bufferMinutes: number } | null;
  appointmentServices?: Array<{ service: { bufferMinutes: number } }>;
}): number {
  const serviceBuffers = appointment.appointmentServices?.map((item) => item.service.bufferMinutes);
  return serviceBuffers?.length
    ? serviceBuffers.reduce((sum, minutes) => sum + minutes, 0)
    : appointment.service?.bufferMinutes ?? 0;
}

export class AppointmentError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export async function expireAppointmentIfNeeded(token: string) {
  const appointment = await prisma.appointment.findUnique({ where: { token } });
  if (
    appointment?.status === 'pending_payment' &&
    appointment.expiresAt &&
    appointment.expiresAt <= new Date()
  ) {
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { status: 'expired', paymentStatus: 'expired' },
    });
    await prisma.payment.updateMany({
      where: { appointmentId: appointment.id, status: 'pending' },
      data: { status: 'expired' },
    });
  }
}

export async function createPublicAppointment(input: CreateAppointmentInput) {
  const { businessId, date, time, client, notes } = input;

  const requestedServiceIds = [...new Set(input.serviceIds ?? (input.serviceId ? [input.serviceId] : []))];
  if (requestedServiceIds.length === 0 || requestedServiceIds.length > 10) {
    throw new AppointmentError(400, 'Selecione entre 1 e 10 servicos');
  }

  const servicesById = await prisma.service.findMany({
    where: { id: { in: requestedServiceIds }, businessId, active: true },
  });
  if (servicesById.length !== requestedServiceIds.length) {
    throw new AppointmentError(404, 'Um ou mais servicos nao foram encontrados');
  }
  const services = requestedServiceIds.map((id) => servicesById.find((service) => service.id === id)!);
  const primaryService = services[0]!;
  const totalDurationMinutes = services.reduce((sum, service) => sum + service.durationMinutes, 0);
  const totalBufferMinutes = services.reduce((sum, service) => sum + service.bufferMinutes, 0);
  const totalAmount = services.reduce(
    (sum, service) => sum.add(service.price),
    new Prisma.Decimal(0),
  );
  const depositCents = Math.min(
    services.reduce(
      (sum, service) => sum + Math.round(computeDeposit(service.price, service.depositType, service.depositValue) * 100),
      0,
    ),
    Math.round(Number(totalAmount) * 100),
  );

  // Resolve profissional (usa o informado ou o primeiro ativo do negocio).
  let professionalId = input.professionalId;
  if (!professionalId) {
    const prof = await prisma.professional.findFirst({
      where: { businessId, active: true },
      orderBy: { id: 'asc' },
    });
    if (!prof) throw new AppointmentError(400, 'Nenhum profissional disponivel');
    professionalId = prof.id;
  }

  const startAt = new Date(`${date}T${time}:00`);
  if (Number.isNaN(startAt.getTime())) {
    throw new AppointmentError(400, 'Data/hora invalida');
  }
  if (startAt <= new Date()) {
    throw new AppointmentError(400, 'Nao e possivel agendar no passado');
  }
  const endAt = addMinutes(startAt, totalDurationMinutes);
  const busyEnd = addMinutes(endAt, totalBufferMinutes);

  const deposit = depositCents / 100;
  const requiresDeposit = !input.confirm && deposit > 0;

  const token = randomUUID();
  const expiresAt = requiresDeposit
    ? addMinutes(new Date(), env.RESERVATION_MINUTES)
    : null;

  // Transacao: confirma que o horario ainda esta livre e cria tudo junto.
  return prisma.$transaction(async (tx) => {
    const now = new Date();

    // Reagrupa conflitos com margem para pegar sobreposicoes parciais.
    const sameDay = await tx.appointment.findMany({
      where: {
        businessId,
        professionalId,
        startAt: {
          gte: new Date(`${date}T00:00:00`),
          lte: new Date(`${date}T23:59:59`),
        },
        OR: [
          { status: { in: ['confirmed', 'completed'] } },
          {
            status: 'pending_payment',
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        ],
      },
      include: {
        service: { select: { bufferMinutes: true } },
        appointmentServices: { include: { service: { select: { bufferMinutes: true } } } },
      },
    });

    const conflict = sameDay.some((a) =>
      overlaps(startAt, busyEnd, a.startAt, addMinutes(a.endAt, appointmentBufferMinutes(a)))
    );
    if (conflict) {
      throw new AppointmentError(409, 'Este horario acabou de ser reservado. Escolha outro.');
    }

    const blocks = await tx.blockedTime.findMany({
      where: {
        businessId,
        OR: [{ professionalId }, { professionalId: null }],
        startAt: { lt: busyEnd },
        endAt: { gt: startAt },
      },
    });
    if (blocks.length > 0) {
      throw new AppointmentError(409, 'Horario indisponivel');
    }

    // Cliente: reaproveita por telefone dentro do negocio.
    let dbClient = await tx.client.findFirst({
      where: { businessId, phone: client.phone, deletedAt: null },
    });
    if (!dbClient) {
      dbClient = await tx.client.create({
        data: {
          businessId,
          name: client.name,
          phone: client.phone,
          email: client.email ?? null,
        },
      });
    }

    const appointment = await tx.appointment.create({
      data: {
        businessId,
        clientId: dbClient.id,
        professionalId: professionalId!,
        serviceId: primaryService.id,
        appointmentServices: {
          create: services.map((service, sortOrder) => ({ serviceId: service.id, sortOrder })),
        },
        token,
        startAt,
        endAt,
        totalAmount,
        depositAmount: new Prisma.Decimal(deposit),
        status: requiresDeposit ? 'pending_payment' : 'confirmed',
        paymentStatus: 'pending',
        expiresAt,
        notes: notes ?? null,
      },
      include: {
        service: true,
        appointmentServices: { include: { service: true } },
        client: true,
        professional: true,
      },
    });

    // Cobranca automatica de quem agenda e nao paga o sinal.
    //
    // Enfileirada junto com o agendamento, para sair PAYMENT_REMINDER_MINUTES
    // depois. O worker so envia se o agendamento ainda estiver esperando
    // pagamento -- se a cliente pagar antes, o job e cancelado sozinho.
    //
    // O link so funciona enquanto a reserva estiver de pe, por isso o aviso
    // em env.ts de manter RESERVATION_MINUTES maior que este prazo.
    if (requiresDeposit) {
      const business = await tx.business.findUnique({
        where: { id: businessId },
        select: { name: true },
      });
      const vars: Record<string, string> = {
        cliente: client.name.trim(),
        primeiro_nome: firstName(client.name),
        servico: appointmentServiceLabel(appointment),
        data: startAt.toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        }),
        hora: startAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        valor: brl(Number(totalAmount)),
        sinal: brl(deposit),
        restante: brl(Number(totalAmount) - deposit),
        studio: business?.name ?? '',
        link: appointmentLink(env.PUBLIC_WEB_URL, token),
        endereco: STUDIO_ADDRESS_URL,
      };

      const tpl = await tx.notificationTemplate.findFirst({
        where: { businessId, triggerKey: 'payment_pending', channel: 'whatsapp', active: true },
      });

      await tx.notificationJob.create({
        data: {
          businessId,
          appointmentId: appointment.id,
          triggerKey: 'payment_pending',
          channel: 'whatsapp',
          toPhone: client.phone,
          body: renderTemplate(tpl?.body ?? FALLBACK_BODIES.payment_pending, vars),
          scheduledFor: addMinutes(new Date(), env.PAYMENT_REMINDER_MINUTES),
          status: 'pending',
        },
      });
    }

    return { appointment, requiresDeposit };
  });
}

export async function getAppointmentByToken(token: string) {
  await expireAppointmentIfNeeded(token);
  return prisma.appointment.findUnique({
    where: { token },
    include: {
      service: true,
      appointmentServices: { include: { service: true } },
      professional: { select: { id: true, name: true } },
      client: { select: { name: true, phone: true } },
      payments: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });
}

// Mesmo formato do lookup por telefone, mas de um agendamento so -- e o que o
// link da cobranca abre. Filtra por businessId para um token de outro negocio
// nao vazar nada.
export async function getPublicAppointmentByToken(businessId: bigint, token: string) {
  await expireAppointmentIfNeeded(token);
  const appointment = await prisma.appointment.findFirst({
    where: { token, businessId, status: { not: 'removed' } },
    include: {
      service: true,
      appointmentServices: { include: { service: true } },
      professional: { select: { id: true, name: true } },
      client: { select: { name: true, phone: true } },
      payments: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  return appointment ? [appointment] : [];
}

export async function getPublicAppointmentsByPhone(businessId: bigint, phone: string) {
  const digits = phone.replace(/\D/g, '');
  const client = await prisma.client.findFirst({
    where: { businessId, phone: digits, deletedAt: null },
  });
  if (!client) return [];

  const since = new Date();
  since.setDate(since.getDate() - 30);
  since.setHours(0, 0, 0, 0);

  const appointments = await prisma.appointment.findMany({
    where: {
      businessId,
      clientId: client.id,
      startAt: { gte: since },
      status: { not: 'removed' },
    },
    include: {
      service: true,
      appointmentServices: { include: { service: true } },
      professional: { select: { id: true, name: true } },
      client: { select: { name: true, phone: true } },
      payments: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { startAt: 'asc' },
    take: 10,
  });

  for (const appointment of appointments) {
    if (appointment.status === 'pending_payment') {
      await expireAppointmentIfNeeded(appointment.token);
    }
  }

  return prisma.appointment.findMany({
    where: {
      businessId,
      clientId: client.id,
      startAt: { gte: since },
      status: { not: 'removed' },
    },
    include: {
      service: true,
      appointmentServices: { include: { service: true } },
      professional: { select: { id: true, name: true } },
      client: { select: { name: true, phone: true } },
      payments: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { startAt: 'asc' },
    take: 10,
  });
}
