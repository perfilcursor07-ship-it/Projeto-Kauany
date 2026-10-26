import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import {
  createPublicAppointment,
  AppointmentError,
} from '../modules/appointments/appointments.service.js';
import { renderTemplate, firstName } from '../modules/whatsapp/templates.js';

function businessIdOf(req: FastifyRequest): bigint {
  return BigInt(req.user.businessId);
}

type AdminBioSettingRow = {
  enabled: number | boolean;
  title: string | null;
  subtitle: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  backgroundUrl: string | null;
  instagramUrl: string | null;
};

type AdminBioLinkRow = {
  id: bigint;
  label: string;
  url: string | null;
  type: string;
  fileName: string | null;
  sortOrder: number;
  active: number | boolean;
};

const MAX_BIO_DOCUMENT_BYTES = 5 * 1024 * 1024;
const MAX_BIO_DOCUMENT_BASE64_LENGTH = Math.ceil(MAX_BIO_DOCUMENT_BYTES / 3) * 4;
const BIO_DOCUMENT_BODY_LIMIT = 8 * 1024 * 1024;

function isValidBioDocument(data: string, fileName: string, fileMime: string): boolean {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) return false;
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_BIO_DOCUMENT_BYTES) return false;

  const extension = fileName.toLowerCase().split('.').pop();
  if (extension === 'pdf') {
    return fileMime === 'application/pdf' && bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  }
  if (extension === 'docx') {
    return (
      fileMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' &&
      bytes.subarray(0, 4).toString('ascii') === 'PK\u0003\u0004'
    );
  }
  return false;
}

function monthRange(month?: string) {
  const now = new Date();
  const year = month ? Number(month.slice(0, 4)) : now.getFullYear();
  const monthIndex = month ? Number(month.slice(5, 7)) : now.getMonth() + 1;

  const start = new Date(year, monthIndex - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, monthIndex, 1, 0, 0, 0, 0);
  return { start, end, month: `${year}-${String(monthIndex).padStart(2, '0')}` };
}

type CashTransactionRow = {
  id: bigint;
  appointment_id: bigint | null;
  payment_id: bigint | null;
  expense_id: bigint | null;
  type: 'in' | 'out';
  description: string;
  category: string | null;
  amount: Prisma.Decimal;
  occurred_at: Date;
};

type ExpenseRow = {
  id: bigint;
  description: string;
  category: string | null;
  amount: Prisma.Decimal;
  spent_at: Date;
};

type ServiceRow = {
  id: bigint;
  name: string;
  description: string | null;
  price: Prisma.Decimal;
  depositType: string;
  depositValue: Prisma.Decimal;
  durationMinutes: number;
  bufferMinutes: number;
  sortOrder: number;
  active: number | boolean;
};

type FinancialCategoryRow = {
  id: bigint;
  name: string;
  type: 'in' | 'out';
};

export async function adminRoutes(app: FastifyInstance) {
  // Todas as rotas admin exigem autenticacao.
  app.addHook('preHandler', app.authenticate);

  // ======================= DASHBOARD ====================================
  app.get('/dashboard', async (req) => {
    const businessId = businessIdOf(req);
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(now);
    dayEnd.setHours(23, 59, 59, 999);

    const weekStart = new Date(dayStart);
    const weekday = weekStart.getDay();
    const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
    weekStart.setDate(weekStart.getDate() - daysFromMonday);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const [todays, weekly] = await Promise.all([
      prisma.appointment.findMany({
        where: {
          businessId,
          startAt: { gte: dayStart, lte: dayEnd },
          status: { in: ['confirmed', 'completed', 'pending_payment'] },
        },
        include: { service: true, client: { select: { name: true, phone: true } } },
        orderBy: { startAt: 'asc' },
      }),
      prisma.appointment.findMany({
        where: {
          businessId,
          startAt: { gte: weekStart, lte: weekEnd },
          status: { not: 'removed' },
        },
        include: {
          service: { select: { name: true } },
          client: { select: { name: true, phone: true } },
        },
        orderBy: { startAt: 'asc' },
      }),
    ]);

    const expected = todays.reduce((sum, a) => sum + Number(a.totalAmount), 0);
    const received = todays.reduce((sum, a) => {
      if (a.status === 'completed') return sum + Number(a.totalAmount);
      if (a.paymentStatus === 'paid') return sum + Number(a.depositAmount);
      return sum;
    }, 0);

    const weeklyActive = weekly.filter((a) => a.status !== 'expired');
    const weeklyExpected = weeklyActive.reduce((sum, a) => sum + Number(a.totalAmount), 0);
    const weeklyReceived = weeklyActive.reduce((sum, a) => {
      if (a.status === 'completed') return sum + Number(a.totalAmount);
      if (a.paymentStatus === 'paid') return sum + Number(a.depositAmount);
      return sum;
    }, 0);
    const weeklyDepositPaid = weeklyActive.filter((a) => a.paymentStatus === 'paid').length;
    const weeklyPendingDeposit = weeklyActive.filter(
      (a) => a.status === 'pending_payment' && a.paymentStatus !== 'paid'
    ).length;

    const next = todays.find((a) => a.startAt > now) ?? null;
    const todayPendingDeposit = todays.filter(
      (a) => a.status === 'pending_payment' && a.paymentStatus !== 'paid'
    ).length;
    const todayNeedsStatus = todays.filter(
      (a) => a.startAt < now && ['confirmed', 'pending_payment'].includes(a.status)
    ).length;
    const todayCompleted = todays.filter((a) => a.status === 'completed').length;
    const todayRemaining = todays.filter(
      (a) => a.startAt >= now && a.status !== 'completed'
    ).length;

    return {
      today: {
        count: todays.length,
        completed: todayCompleted,
        remaining: todayRemaining,
        pendingDeposit: todayPendingDeposit,
        needsStatus: todayNeedsStatus,
        expectedRevenue: expected,
        receivedDeposits: received,
        toReceive: Math.max(expected - received, 0),
      },
      week: {
        start: weekStart,
        end: weekEnd,
        count: weeklyActive.length,
        depositPaid: weeklyDepositPaid,
        pendingDeposit: weeklyPendingDeposit,
        completed: weeklyActive.filter((a) => a.status === 'completed').length,
        expectedRevenue: weeklyExpected,
        received: weeklyReceived,
        toReceive: Math.max(weeklyExpected - weeklyReceived, 0),
        appointments: weeklyActive.map((a) => ({
          id: a.id,
          time: a.startAt,
          client: a.client.name,
          phone: a.client.phone,
          service: a.service.name,
          status: a.status,
          paymentStatus: a.paymentStatus,
          total: Number(a.totalAmount),
          deposit: Number(a.depositAmount),
        })),
      },
      next: next
        ? {
            id: next.id,
            time: next.startAt,
            client: next.client.name,
            phone: next.client.phone,
            service: next.service.name,
            total: Number(next.totalAmount),
            deposit: Number(next.depositAmount),
            depositPaid: next.paymentStatus === 'paid',
          }
        : null,
      appointments: todays.map((a) => ({
        id: a.id,
        time: a.startAt,
        client: a.client.name,
        phone: a.client.phone,
        service: a.service.name,
        status: a.status,
        paymentStatus: a.paymentStatus,
        total: Number(a.totalAmount),
        deposit: Number(a.depositAmount),
      })),
    };
  });

  // ======================= SERVICOS =====================================
  app.get('/services', async (req) => {
    const businessId = businessIdOf(req);
    const services = await prisma.$queryRaw<ServiceRow[]>`
      SELECT
        id,
        name,
        description,
        price,
        deposit_type AS depositType,
        deposit_value AS depositValue,
        duration_minutes AS durationMinutes,
        buffer_minutes AS bufferMinutes,
        sort_order AS sortOrder,
        active
      FROM services
      WHERE business_id = ${businessId}
      ORDER BY sort_order ASC, name ASC
    `;

    return services.map((s) => ({
      id: s.id.toString(),
      name: s.name,
      description: s.description,
      price: Number(s.price),
      depositType: s.depositType,
      depositValue: Number(s.depositValue),
      durationMinutes: s.durationMinutes,
      bufferMinutes: s.bufferMinutes,
      sortOrder: s.sortOrder,
      active: Boolean(s.active),
    }));
  });

  const serviceSchema = z.object({
    name: z.string().min(2),
    description: z.string().max(1000).optional().nullable(),
    price: z.number().positive(),
    depositType: z.enum(['none', 'fixed', 'percentage']).default('none'),
    depositValue: z.number().min(0).default(0),
    durationMinutes: z.number().int().positive(),
    bufferMinutes: z.number().int().min(0).default(0),
    sortOrder: z.number().int().min(0).optional(),
    active: z.boolean().default(true),
  });

  app.post('/services', async (req, reply) => {
    const businessId = businessIdOf(req);
    const parsed = serviceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados invalidos', issues: parsed.error.flatten() });
    }
    const s = parsed.data;
    const [last] = await prisma.$queryRaw<Array<{ sortOrder: number | null }>>`
      SELECT MAX(sort_order) AS sortOrder
      FROM services
      WHERE business_id = ${businessId}
    `;
    const created = await prisma.service.create({
      data: {
        businessId,
        name: s.name.trim(),
        description: s.description?.trim() || null,
        price: new Prisma.Decimal(s.price),
        depositType: s.depositType,
        depositValue: new Prisma.Decimal(s.depositValue),
        durationMinutes: s.durationMinutes,
        bufferMinutes: s.bufferMinutes,
        active: s.active,
      },
    });
    await prisma.$executeRaw`
      UPDATE services
      SET sort_order = ${s.sortOrder ?? (last?.sortOrder ?? 0) + 10}
      WHERE id = ${created.id}
        AND business_id = ${businessId}
    `;
    return reply.code(201).send(created);
  });

  app.patch('/services/:id', async (req, reply) => {
    const businessId = businessIdOf(req);
    const { id } = z.object({ id: z.coerce.bigint() }).parse(req.params);
    const parsed = serviceSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados invalidos', issues: parsed.error.flatten() });
    }
    const existing = await prisma.service.findFirst({ where: { id, businessId } });
    if (!existing) return reply.code(404).send({ message: 'Servico nao encontrado' });

    const s = parsed.data;
    const updated = await prisma.service.update({
      where: { id },
      data: {
        ...(s.name !== undefined ? { name: s.name.trim() } : {}),
        ...(s.description !== undefined ? { description: s.description?.trim() || null } : {}),
        ...(s.price !== undefined ? { price: new Prisma.Decimal(s.price) } : {}),
        ...(s.depositType !== undefined ? { depositType: s.depositType } : {}),
        ...(s.depositValue !== undefined ? { depositValue: new Prisma.Decimal(s.depositValue) } : {}),
        ...(s.durationMinutes !== undefined ? { durationMinutes: s.durationMinutes } : {}),
        ...(s.bufferMinutes !== undefined ? { bufferMinutes: s.bufferMinutes } : {}),
        ...(s.active !== undefined ? { active: s.active } : {}),
      },
    });
    if (s.sortOrder !== undefined) {
      await prisma.$executeRaw`
        UPDATE services
        SET sort_order = ${s.sortOrder}
        WHERE id = ${id}
          AND business_id = ${businessId}
      `;
    }
    return updated;
  });

  app.put('/services/order', async (req, reply) => {
    const businessId = businessIdOf(req);
    const parsed = z
      .object({
        ids: z.array(z.coerce.bigint()).min(1),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados invalidos', issues: parsed.error.flatten() });
    }

    const uniqueIds = [...new Set(parsed.data.ids.map((id) => id.toString()))].map((id) => BigInt(id));
    if (uniqueIds.length !== parsed.data.ids.length) {
      return reply.code(400).send({ message: 'A lista de servicos possui itens repetidos.' });
    }

    const count = await prisma.service.count({
      where: { businessId, id: { in: uniqueIds } },
    });
    if (count !== uniqueIds.length) {
      return reply.code(404).send({ message: 'Um ou mais servicos nao foram encontrados.' });
    }

    await prisma.$transaction(
      uniqueIds.map((id, index) =>
        prisma.$executeRaw`
          UPDATE services
          SET sort_order = ${(index + 1) * 10}
          WHERE id = ${id}
            AND business_id = ${businessId}
        `
      )
    );

    return { saved: true };
  });

  app.delete('/services/:id', async (req, reply) => {
    const businessId = businessIdOf(req);
    const { id } = z.object({ id: z.coerce.bigint() }).parse(req.params);
    const existing = await prisma.service.findFirst({ where: { id, businessId } });
    if (!existing) return reply.code(404).send({ message: 'Servico nao encontrado' });
    // Soft delete para nao quebrar historico de agendamentos.
    await prisma.service.update({ where: { id }, data: { active: false } });
    return { deactivated: true };
  });

  // ======================= CLIENTES =====================================
  app.get('/clients', async (req) => {
    const businessId = businessIdOf(req);
    const { q } = z.object({ q: z.string().optional() }).parse(req.query);
    const clients = await prisma.client.findMany({
      where: {
        businessId,
        deletedAt: null,
        ...(q ? { OR: [{ name: { contains: q } }, { phone: { contains: q } }] } : {}),
      },
      include: {
        appointments: {
          where: { status: { not: 'removed' } },
          select: { status: true, totalAmount: true, startAt: true },
          orderBy: { startAt: 'desc' },
        },
      },
      orderBy: { name: 'asc' },
      take: 200,
    });

    return clients.map((client) => {
      const completed = client.appointments.filter((a) => a.status === 'completed');
      const lastAppointment = client.appointments[0] ?? null;
      const { appointments, ...base } = client;
      return {
        ...base,
        appointmentCount: appointments.filter((a) => a.status !== 'expired').length,
        completedCount: completed.length,
        totalSpent: completed.reduce((sum, a) => sum + Number(a.totalAmount), 0),
        lastAppointmentAt: lastAppointment?.startAt ?? null,
      };
    });
  });

  app.get('/clients/:id', async (req, reply) => {
    const businessId = businessIdOf(req);
    const { id } = z.object({ id: z.coerce.bigint() }).parse(req.params);
    const client = await prisma.client.findFirst({ where: { id, businessId, deletedAt: null } });
    if (!client) return reply.code(404).send({ message: 'Cliente nao encontrado' });

    const history = await prisma.appointment.findMany({
      where: { clientId: id, status: { not: 'removed' } },
      include: { service: { select: { name: true } } },
      orderBy: { startAt: 'desc' },
      take: 50,
    });

    const totalSpent = history
      .filter((a) => a.status === 'completed')
      .reduce((s, a) => s + Number(a.totalAmount), 0);

    return {
      client,
      totalSpent,
      history: history.map((a) => ({
        id: a.id,
        date: a.startAt,
        service: a.service.name,
        amount: Number(a.totalAmount),
        status: a.status,
      })),
    };
  });

  app.delete('/clients/:id', async (req, reply) => {
    const businessId = businessIdOf(req);
    const { id } = z.object({ id: z.coerce.bigint() }).parse(req.params);
    const client = await prisma.client.findFirst({ where: { id, businessId, deletedAt: null } });
    if (!client) return reply.code(404).send({ message: 'Cliente nao encontrado' });

    await prisma.client.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return { deleted: true };
  });

  // ======================= AGENDAMENTOS =================================
  app.get('/appointments', async (req) => {
    const businessId = businessIdOf(req);
    const { from, to, status } = z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        status: z.string().optional(),
      })
      .parse(req.query);

    const where: Prisma.AppointmentWhereInput = { businessId, status: { notIn: ['removed', 'expired'] } };
    if (from || to) {
      where.startAt = {
        ...(from ? { gte: new Date(`${from}T00:00:00`) } : {}),
        ...(to ? { lte: new Date(`${to}T23:59:59`) } : {}),
      };
    }
    if (status) where.status = status;

    return prisma.appointment.findMany({
      where,
      include: {
        service: { select: { name: true } },
        client: { select: { name: true, phone: true } },
        professional: { select: { name: true } },
      },
      orderBy: { startAt: 'asc' },
    });
  });

  // Criacao manual (ja confirmada, sem exigir sinal).
  app.post('/appointments', async (req, reply) => {
    const businessId = businessIdOf(req);
    const schema = z.object({
      serviceId: z.coerce.bigint(),
      professionalId: z.coerce.bigint().optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      time: z.string().regex(/^\d{2}:\d{2}$/),
      client: z.object({
        name: z.string().min(2),
        phone: z.string().min(8),
        email: z.string().email().optional().nullable(),
      }),
      notes: z.string().max(500).optional().nullable(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados invalidos', issues: parsed.error.flatten() });
    }
    try {
      const { appointment } = await createPublicAppointment({
        businessId,
        ...parsed.data,
        confirm: true,
      });
      return reply.code(201).send(appointment);
    } catch (err) {
      if (err instanceof AppointmentError) {
        return reply.code(err.statusCode).send({ message: err.message });
      }
      throw err;
    }
  });

  // Atualiza status (confirmar, concluir, cancelar, no_show).
  app.patch('/appointments/:id', async (req, reply) => {
    const businessId = businessIdOf(req);
    const { id } = z.object({ id: z.coerce.bigint() }).parse(req.params);
    const parsed = z
      .object({
        status: z
          .enum(['pending_payment', 'confirmed', 'completed', 'cancelled', 'no_show', 'expired'])
          .optional(),
        notes: z.string().max(500).optional().nullable(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados invalidos', issues: parsed.error.flatten() });
    }

    const existing = await prisma.appointment.findFirst({ where: { id, businessId } });
    if (!existing) return reply.code(404).send({ message: 'Agendamento nao encontrado' });

    const updated = await prisma.appointment.update({
      where: { id },
      data: {
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
      },
    });

    // Atualiza contadores da cliente em faltas/cancelamentos.
    if (parsed.data.status === 'no_show') {
      await prisma.client.update({
        where: { id: existing.clientId },
        data: { noShowCount: { increment: 1 } },
      });
    } else if (parsed.data.status === 'cancelled') {
      await prisma.client.update({
        where: { id: existing.clientId },
        data: { cancelCount: { increment: 1 } },
      });

      // Mensagem automatica de cancelamento para a cliente (se ainda futura).
      if (existing.status !== 'cancelled' && existing.startAt > new Date()) {
        const [client, service, business] = await Promise.all([
          prisma.client.findUnique({ where: { id: existing.clientId } }),
          prisma.service.findUnique({ where: { id: existing.serviceId } }),
          prisma.business.findUnique({ where: { id: businessId } }),
        ]);
        if (client?.phone) {
          const vars: Record<string, string> = {
            cliente: firstName(client.name),
            servico: service?.name ?? '',
            data: existing.startAt.toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
            }),
            hora: existing.startAt.toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
            }),
            studio: business?.name ?? '',
          };
          const tpl = await prisma.notificationTemplate.findFirst({
            where: { businessId, triggerKey: 'cancelled', channel: 'whatsapp', active: true },
          });
          await prisma.notificationJob.create({
            data: {
              businessId,
              appointmentId: existing.id,
              triggerKey: 'cancelled',
              channel: 'whatsapp',
              toPhone: client.phone,
              body: tpl
                ? renderTemplate(tpl.body, vars)
                : `Ola, ${vars.cliente}. Seu agendamento de ${vars.data} as ${vars.hora} foi cancelado.`,
              scheduledFor: new Date(),
              status: 'pending',
            },
          });
        }
      }

      await prisma.payment.updateMany({
        where: { appointmentId: existing.id, status: 'pending' },
        data: { status: 'cancelled' },
      });
    }

    if (parsed.data.status === 'completed' && existing.status !== 'completed') {
      const paid = await prisma.$queryRaw<Array<{ total: Prisma.Decimal | null }>>`
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM cash_transactions
        WHERE business_id = ${businessId}
          AND appointment_id = ${existing.id}
          AND type = 'in'
      `;
      const alreadyReceived = Number(paid[0]?.total ?? 0);
      const remaining = Math.max(Number(existing.totalAmount) - alreadyReceived, 0);
      if (remaining > 0) {
        await prisma.$executeRaw`
          INSERT INTO cash_transactions
            (business_id, appointment_id, type, description, category, amount, occurred_at)
          VALUES
            (${businessId}, ${existing.id}, 'in', 'Atendimento concluido', 'Serviços',
             ${new Prisma.Decimal(remaining)}, NOW())
        `;
      }
    }

    return updated;
  });

  app.delete('/appointments/:id', async (req, reply) => {
    const businessId = businessIdOf(req);
    const { id } = z.object({ id: z.coerce.bigint() }).parse(req.params);

    const existing = await prisma.appointment.findFirst({ where: { id, businessId } });
    if (!existing) return reply.code(404).send({ message: 'Agendamento nao encontrado' });

    await prisma.appointment.update({
      where: { id },
      data: {
        status: 'removed',
        notes: existing.notes
          ? `${existing.notes}\n\nRemovido manualmente pelo painel.`
          : 'Removido manualmente pelo painel.',
      },
    });

    return { removed: true };
  });

  // ======================= HORARIOS DE FUNCIONAMENTO ====================
  app.get('/business-hours', async (req) => {
    const businessId = businessIdOf(req);
    return prisma.businessHour.findMany({ where: { businessId }, orderBy: { weekday: 'asc' } });
  });

  app.put('/business-hours', async (req, reply) => {
    const businessId = businessIdOf(req);
    const parsed = z
      .array(
        z.object({
          weekday: z.number().int().min(0).max(6),
          isOpen: z.boolean(),
          openTime: z.string().regex(/^\d{2}:\d{2}$/),
          closeTime: z.string().regex(/^\d{2}:\d{2}$/),
        })
      )
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados invalidos', issues: parsed.error.flatten() });
    }

    for (const h of parsed.data) {
      await prisma.businessHour.upsert({
        where: { businessId_weekday: { businessId, weekday: h.weekday } },
        create: { businessId, ...h },
        update: { isOpen: h.isOpen, openTime: h.openTime, closeTime: h.closeTime },
      });
    }
    return prisma.businessHour.findMany({ where: { businessId }, orderBy: { weekday: 'asc' } });
  });

  // ======================= BLOQUEIOS ====================================
  app.get('/blocked-times', async (req) => {
    const businessId = businessIdOf(req);
    return prisma.blockedTime.findMany({ where: { businessId }, orderBy: { startAt: 'asc' } });
  });

  app.post('/blocked-times', async (req, reply) => {
    const businessId = businessIdOf(req);
    const parsed = z
      .object({
        professionalId: z.coerce.bigint().optional().nullable(),
        startAt: z.string(),
        endAt: z.string(),
        reason: z.string().max(255).optional().nullable(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados invalidos', issues: parsed.error.flatten() });
    }
    const start = new Date(parsed.data.startAt);
    const end = new Date(parsed.data.endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return reply.code(400).send({ message: 'Periodo invalido' });
    }
    const created = await prisma.blockedTime.create({
      data: {
        businessId,
        professionalId: parsed.data.professionalId ?? null,
        startAt: start,
        endAt: end,
        reason: parsed.data.reason ?? null,
      },
    });
    return reply.code(201).send(created);
  });

  app.delete('/blocked-times/:id', async (req, reply) => {
    const businessId = businessIdOf(req);
    const { id } = z.object({ id: z.coerce.bigint() }).parse(req.params);
    const existing = await prisma.blockedTime.findFirst({ where: { id, businessId } });
    if (!existing) return reply.code(404).send({ message: 'Bloqueio nao encontrado' });
    await prisma.blockedTime.delete({ where: { id } });
    return { deleted: true };
  });

  // ======================= FINANCEIRO ===================================
  app.get('/financial', async (req) => {
    const businessId = businessIdOf(req);
    const { month } = z
      .object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() })
      .parse(req.query);
    const range = monthRange(month);

    const [transactions, expenses] = await Promise.all([
      prisma.$queryRaw<CashTransactionRow[]>`
        SELECT id, appointment_id, payment_id, expense_id, type, description, category, amount, occurred_at
        FROM cash_transactions
        WHERE business_id = ${businessId}
          AND occurred_at >= ${range.start}
          AND occurred_at < ${range.end}
        ORDER BY occurred_at DESC
        LIMIT 300
      `,
      prisma.$queryRaw<ExpenseRow[]>`
        SELECT id, description, category, amount, spent_at
        FROM expenses
        WHERE business_id = ${businessId}
          AND spent_at >= ${range.start}
          AND spent_at < ${range.end}
        ORDER BY spent_at DESC
        LIMIT 200
      `,
    ]);

    const income = transactions
      .filter((t) => t.type === 'in')
      .reduce((sum, t) => sum + Number(t.amount), 0);
    const outcome = transactions
      .filter((t) => t.type === 'out')
      .reduce((sum, t) => sum + Number(t.amount), 0);

    return {
      month: range.month,
      summary: {
        income,
        outcome,
        balance: income - outcome,
      },
      transactions: transactions.map((t) => ({
        id: t.id.toString(),
        type: t.type,
        description: t.description,
        category: t.category,
        amount: Number(t.amount),
        occurredAt: t.occurred_at,
        appointmentId: t.appointment_id?.toString() ?? null,
        paymentId: t.payment_id?.toString() ?? null,
        expenseId: t.expense_id?.toString() ?? null,
      })),
      expenses: expenses.map((e) => ({
        id: e.id.toString(),
        description: e.description,
        category: e.category,
        amount: Number(e.amount),
        spentAt: e.spent_at,
      })),
    };
  });

  app.get('/financial/categories', async (req) => {
    const businessId = businessIdOf(req);
    const rows = await prisma.$queryRaw<FinancialCategoryRow[]>`
      SELECT id, name, type
      FROM financial_categories
      WHERE business_id = ${businessId}
        AND active = TRUE
      ORDER BY type ASC, name ASC
    `;
    return rows.map((r) => ({
      id: r.id.toString(),
      name: r.name,
      type: r.type,
    }));
  });

  app.post('/financial/categories', async (req, reply) => {
    const businessId = businessIdOf(req);
    const parsed = z
      .object({
        name: z.string().min(2).max(80),
        type: z.enum(['in', 'out']),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados invalidos', issues: parsed.error.flatten() });
    }

    const name = parsed.data.name.trim();
    try {
      await prisma.$executeRaw`
        INSERT INTO financial_categories (business_id, name, type)
        VALUES (${businessId}, ${name}, ${parsed.data.type})
      `;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2010') {
        return reply.code(409).send({ message: 'Categoria ja existe.' });
      }
      throw err;
    }

    return reply.code(201).send({ created: true, name, type: parsed.data.type });
  });

  const transactionSchema = z.object({
    type: z.enum(['in', 'out']),
    description: z.string().min(2).max(200),
    category: z.string().max(80).nullable().optional(),
    amount: z.number().positive(),
    occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  });

  app.post('/financial/transactions', async (req, reply) => {
    const businessId = businessIdOf(req);
    const parsed = transactionSchema.safeParse(req.body);

    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados invalidos', issues: parsed.error.flatten() });
    }

    const occurredAt = new Date(`${parsed.data.occurredAt}T12:00:00`);
    const amount = new Prisma.Decimal(parsed.data.amount);
    const description = parsed.data.description.trim();
    const category = parsed.data.category?.trim() || null;

    await prisma.$transaction(async (tx) => {
      let expenseId: bigint | null = null;
      if (parsed.data.type === 'out') {
        await tx.$executeRaw`
          INSERT INTO expenses (business_id, description, category, amount, spent_at)
          VALUES (${businessId}, ${description}, ${category}, ${amount}, ${occurredAt})
        `;
        const inserted = await tx.$queryRaw<Array<{ id: bigint }>>`SELECT LAST_INSERT_ID() AS id`;
        expenseId = inserted[0]?.id ?? null;
      }

      await tx.$executeRaw`
        INSERT INTO cash_transactions
          (business_id, expense_id, type, description, category, amount, occurred_at)
        VALUES
          (${businessId}, ${expenseId}, ${parsed.data.type}, ${description}, ${category}, ${amount}, ${occurredAt})
      `;
    });

    return reply.code(201).send({ created: true });
  });

  app.patch('/financial/transactions/:id', async (req, reply) => {
    const businessId = businessIdOf(req);
    const { id } = z.object({ id: z.coerce.bigint() }).parse(req.params);
    const parsed = transactionSchema.safeParse(req.body);

    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados invalidos', issues: parsed.error.flatten() });
    }

    const rows = await prisma.$queryRaw<CashTransactionRow[]>`
      SELECT id, appointment_id, payment_id, expense_id, type, description, category, amount, occurred_at
      FROM cash_transactions
      WHERE id = ${id}
        AND business_id = ${businessId}
      LIMIT 1
    `;
    const existing = rows[0];
    if (!existing) return reply.code(404).send({ message: 'Movimentacao nao encontrada' });

    const occurredAt = new Date(`${parsed.data.occurredAt}T12:00:00`);
    const amount = new Prisma.Decimal(parsed.data.amount);
    const description = parsed.data.description.trim();
    const category = parsed.data.category?.trim() || null;

    await prisma.$transaction(async (tx) => {
      let expenseId = existing.expense_id;

      if (parsed.data.type === 'out') {
        if (expenseId) {
          await tx.$executeRaw`
            UPDATE expenses
            SET description = ${description},
                category = ${category},
                amount = ${amount},
                spent_at = ${occurredAt}
            WHERE id = ${expenseId}
              AND business_id = ${businessId}
          `;
        } else {
          await tx.$executeRaw`
            INSERT INTO expenses (business_id, description, category, amount, spent_at)
            VALUES (${businessId}, ${description}, ${category}, ${amount}, ${occurredAt})
          `;
          const inserted = await tx.$queryRaw<Array<{ id: bigint }>>`SELECT LAST_INSERT_ID() AS id`;
          expenseId = inserted[0]?.id ?? null;
        }
      } else if (expenseId) {
        await tx.$executeRaw`
          DELETE FROM expenses
          WHERE id = ${expenseId}
            AND business_id = ${businessId}
        `;
        expenseId = null;
      }

      await tx.$executeRaw`
        UPDATE cash_transactions
        SET type = ${parsed.data.type},
            description = ${description},
            category = ${category},
            amount = ${amount},
            occurred_at = ${occurredAt},
            expense_id = ${expenseId}
        WHERE id = ${id}
          AND business_id = ${businessId}
      `;
    });

    return { updated: true };
  });

  app.delete('/financial/transactions/:id', async (req, reply) => {
    const businessId = businessIdOf(req);
    const { id } = z.object({ id: z.coerce.bigint() }).parse(req.params);
    const rows = await prisma.$queryRaw<CashTransactionRow[]>`
      SELECT id, appointment_id, payment_id, expense_id, type, description, category, amount, occurred_at
      FROM cash_transactions
      WHERE id = ${id}
        AND business_id = ${businessId}
      LIMIT 1
    `;
    const existing = rows[0];
    if (!existing) return reply.code(404).send({ message: 'Movimentacao nao encontrada' });

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        DELETE FROM cash_transactions
        WHERE id = ${id}
          AND business_id = ${businessId}
      `;
      if (existing.expense_id) {
        await tx.$executeRaw`
          DELETE FROM expenses
          WHERE id = ${existing.expense_id}
            AND business_id = ${businessId}
        `;
      }
    });

    return { deleted: true };
  });

  app.post('/financial/expenses', async (req, reply) => {
    const businessId = businessIdOf(req);
    const parsed = z
      .object({
        description: z.string().min(2).max(200),
        category: z.string().max(80).nullable().optional(),
        amount: z.number().positive(),
        spentAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados invalidos', issues: parsed.error.flatten() });
    }

    const spentAt = new Date(`${parsed.data.spentAt}T12:00:00`);
    const amount = new Prisma.Decimal(parsed.data.amount);
    const description = parsed.data.description.trim();
    const category = parsed.data.category?.trim() || null;
    const cashDescription = category ? `${category} - ${description}` : description;

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO expenses (business_id, description, category, amount, spent_at)
        VALUES (${businessId}, ${description}, ${category}, ${amount}, ${spentAt})
      `;
      const inserted = await tx.$queryRaw<Array<{ id: bigint }>>`SELECT LAST_INSERT_ID() AS id`;
      const expenseId = inserted[0]?.id ?? null;
      await tx.$executeRaw`
        INSERT INTO cash_transactions (business_id, expense_id, type, description, category, amount, occurred_at)
        VALUES (${businessId}, ${expenseId}, 'out', ${cashDescription}, ${category}, ${amount}, ${spentAt})
      `;
    });

    return reply.code(201).send({
      created: true,
      description,
      category,
      amount: Number(amount),
      spentAt,
    });
  });

  // ======================= BIO PUBLICA ==================================
  app.get('/bio', async (req) => {
    const businessId = businessIdOf(req);
    const business = await prisma.business.findUnique({ where: { id: businessId } });

    await prisma.$executeRaw`
      INSERT INTO bio_settings (business_id, enabled, title, subtitle)
      VALUES (${businessId}, FALSE, ${business?.name ?? ''}, 'Agendamento online')
      ON DUPLICATE KEY UPDATE business_id = business_id
    `;

    const [setting] = await prisma.$queryRaw<AdminBioSettingRow[]>`
      SELECT
        enabled,
        title,
        subtitle,
        avatar_url AS avatarUrl,
        cover_url AS coverUrl,
        background_url AS backgroundUrl,
        instagram_url AS instagramUrl
      FROM bio_settings
      WHERE business_id = ${businessId}
      LIMIT 1
    `;

    const links = await prisma.$queryRaw<AdminBioLinkRow[]>`
      SELECT id, label, url, type, file_name AS fileName, sort_order AS sortOrder, active
      FROM bio_links
      WHERE business_id = ${businessId}
      ORDER BY sort_order ASC, id ASC
    `;

    return {
      setting: {
        enabled: Boolean(setting?.enabled),
        title: setting?.title || business?.name || '',
        subtitle: setting?.subtitle ?? '',
        avatarUrl: setting?.avatarUrl ?? null,
        coverUrl: setting?.coverUrl ?? null,
        backgroundUrl: setting?.backgroundUrl ?? null,
        instagramUrl: setting?.instagramUrl ?? '',
      },
      links: links.map((link) => ({
        id: link.id.toString(),
        label: link.label,
        url: link.url,
        type: link.type,
        fileName: link.fileName,
        sortOrder: link.sortOrder,
        active: Boolean(link.active),
      })),
    };
  });

  app.put('/bio/settings', async (req, reply) => {
    const businessId = businessIdOf(req);
    const parsed = z
      .object({
        enabled: z.boolean(),
        title: z.string().min(2).max(150),
        subtitle: z.string().max(255).nullable().optional(),
        avatarUrl: z.string().max(2_000_000).nullable().optional(),
        coverUrl: z.string().max(2_000_000).nullable().optional(),
        backgroundUrl: z.string().max(2_000_000).nullable().optional(),
        instagramUrl: z.string().url().max(500).nullable().optional(),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados invalidos', issues: parsed.error.flatten() });
    }

    const subtitle = parsed.data.subtitle?.trim() || null;
    const instagramUrl = parsed.data.instagramUrl?.trim() || null;

    await prisma.$executeRaw`
      INSERT INTO bio_settings
        (business_id, enabled, title, subtitle, avatar_url, cover_url, background_url, instagram_url)
      VALUES
        (
          ${businessId},
          ${parsed.data.enabled},
          ${parsed.data.title.trim()},
          ${subtitle},
          ${parsed.data.avatarUrl ?? null},
          ${parsed.data.coverUrl ?? null},
          ${parsed.data.backgroundUrl ?? null},
          ${instagramUrl}
        )
      ON DUPLICATE KEY UPDATE
        enabled = VALUES(enabled),
        title = VALUES(title),
        subtitle = VALUES(subtitle),
        avatar_url = VALUES(avatar_url),
        cover_url = VALUES(cover_url),
        background_url = VALUES(background_url),
        instagram_url = VALUES(instagram_url)
    `;

    return { saved: true };
  });

  const bioLinkSchema = z.object({
    label: z.string().min(2).max(120),
    url: z.string().url().max(800).nullable().optional(),
    type: z.enum(['external', 'booking', 'document']).default('external'),
    documentData: z.string().max(MAX_BIO_DOCUMENT_BASE64_LENGTH).optional(),
    fileName: z.string().min(1).max(255).optional(),
    fileMime: z
      .enum(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
      .optional(),
    sortOrder: z.coerce.number().int().min(0).max(999).default(0),
    active: z.boolean().default(true),
  });

  app.post('/bio/links', { bodyLimit: BIO_DOCUMENT_BODY_LIMIT }, async (req, reply) => {
    const businessId = businessIdOf(req);
    const parsed = bioLinkSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados invalidos', issues: parsed.error.flatten() });
    }
    if (parsed.data.type === 'external' && !parsed.data.url) {
      return reply.code(400).send({ message: 'Informe uma URL para link externo.' });
    }
    if (
      parsed.data.type === 'document' &&
      (!parsed.data.documentData || !parsed.data.fileName || !parsed.data.fileMime)
    ) {
      return reply.code(400).send({ message: 'Envie um arquivo PDF ou DOCX.' });
    }
    if (
      parsed.data.type === 'document' &&
      !isValidBioDocument(parsed.data.documentData!, parsed.data.fileName!, parsed.data.fileMime!)
    ) {
      return reply.code(400).send({ message: 'O arquivo deve ser um PDF ou DOCX válido de até 5 MB.' });
    }

    const fileName = parsed.data.fileName?.replace(/[\\/\r\n]/g, '_') ?? null;

    await prisma.$executeRaw`
      INSERT INTO bio_links (business_id, label, url, type, file_data, file_name, file_mime, sort_order, active)
      VALUES (
        ${businessId},
        ${parsed.data.label.trim()},
        ${parsed.data.type === 'external' ? parsed.data.url : null},
        ${parsed.data.type},
        ${parsed.data.type === 'document' ? parsed.data.documentData! : null},
        ${parsed.data.type === 'document' ? fileName : null},
        ${parsed.data.type === 'document' ? parsed.data.fileMime! : null},
        ${parsed.data.sortOrder},
        ${parsed.data.active}
      )
    `;

    return reply.code(201).send({ created: true });
  });

  app.patch('/bio/links/:id', { bodyLimit: BIO_DOCUMENT_BODY_LIMIT }, async (req, reply) => {
    const businessId = businessIdOf(req);
    const { id } = z.object({ id: z.coerce.bigint() }).parse(req.params);
    const parsed = bioLinkSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados invalidos', issues: parsed.error.flatten() });
    }

    const [existing] = await prisma.$queryRaw<AdminBioLinkRow[]>`
      SELECT id, label, url, type, file_name AS fileName, sort_order AS sortOrder, active
      FROM bio_links
      WHERE id = ${id}
        AND business_id = ${businessId}
      LIMIT 1
    `;
    if (!existing) return reply.code(404).send({ message: 'Link nao encontrado' });

    const type = parsed.data.type ?? existing.type;
    const url = type === 'external' ? parsed.data.url !== undefined ? parsed.data.url : existing.url : null;
    if (type === 'external' && !url) {
      return reply.code(400).send({ message: 'Informe uma URL para link externo.' });
    }

    if (type === 'document') {
      const hasNewDocument = Boolean(parsed.data.documentData && parsed.data.fileName && parsed.data.fileMime);
      if (!hasNewDocument && (existing.type !== 'document' || !existing.fileName)) {
        return reply.code(400).send({ message: 'Envie um arquivo PDF ou DOCX.' });
      }
      if (
        hasNewDocument &&
        !isValidBioDocument(parsed.data.documentData!, parsed.data.fileName!, parsed.data.fileMime!)
      ) {
        return reply.code(400).send({ message: 'O arquivo deve ser um PDF ou DOCX válido de até 5 MB.' });
      }
    }

    const hasNewDocument = Boolean(parsed.data.documentData && parsed.data.fileName && parsed.data.fileMime);
    const fileName = hasNewDocument ? parsed.data.fileName!.replace(/[\\/\r\n]/g, '_') : existing.fileName;

    await prisma.$executeRaw`
      UPDATE bio_links
      SET
        label = ${parsed.data.label?.trim() ?? existing.label},
        url = ${url},
        type = ${type},
        file_data = IF(
          ${type === 'document'},
          IF(${hasNewDocument}, ${hasNewDocument ? parsed.data.documentData! : null}, file_data),
          NULL
        ),
        file_name = IF(
          ${type === 'document'},
          IF(${hasNewDocument}, ${fileName}, file_name),
          NULL
        ),
        file_mime = IF(
          ${type === 'document'},
          IF(${hasNewDocument}, ${hasNewDocument ? parsed.data.fileMime! : null}, file_mime),
          NULL
        ),
        sort_order = ${parsed.data.sortOrder ?? existing.sortOrder},
        active = ${parsed.data.active ?? Boolean(existing.active)}
      WHERE id = ${id}
        AND business_id = ${businessId}
    `;

    return { saved: true };
  });

  app.delete('/bio/links/:id', async (req, reply) => {
    const businessId = businessIdOf(req);
    const { id } = z.object({ id: z.coerce.bigint() }).parse(req.params);
    const result = await prisma.$executeRaw`
      DELETE FROM bio_links
      WHERE id = ${id}
        AND business_id = ${businessId}
    `;
    if (result === 0) return reply.code(404).send({ message: 'Link nao encontrado' });
    return { deleted: true };
  });

  // ======================= CONFIGURACOES / IDENTIDADE ===================
  app.get('/settings', async (req) => {
    const businessId = businessIdOf(req);
    const business = await prisma.business.findUnique({ where: { id: businessId } });
    return {
      name: business?.name ?? '',
      logoUrl: business?.logoUrl ?? null,
      phone: business?.phone ?? null,
      slug: business?.slug ?? null,
    };
  });

  app.put('/settings', async (req, reply) => {
    const businessId = businessIdOf(req);
    const parsed = z
      .object({
        name: z.string().min(2).max(150).optional(),
        slug: z
          .string()
          .min(2)
          .max(120)
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use apenas letras minusculas, numeros e hifens')
          .optional(),
        // Aceita URL http(s) ou data URL de imagem (base64). Null remove a logo.
        logoUrl: z.string().max(2_000_000).nullable().optional(),
        phone: z.string().max(30).nullable().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados invalidos', issues: parsed.error.flatten() });
    }
    try {
      const updated = await prisma.business.update({
        where: { id: businessId },
        data: {
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(parsed.data.slug !== undefined ? { slug: parsed.data.slug } : {}),
          ...(parsed.data.logoUrl !== undefined ? { logoUrl: parsed.data.logoUrl } : {}),
          ...(parsed.data.phone !== undefined
            ? { phone: parsed.data.phone === null ? null : parsed.data.phone.replace(/\D/g, '') || null }
            : {}),
        },
      });
      return { name: updated.name, logoUrl: updated.logoUrl, phone: updated.phone, slug: updated.slug };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ message: 'Este link publico ja esta em uso.' });
      }
      throw err;
    }
  });

  // ======================= FINANCEIRO (resumo) ==========================
  app.get('/payments', async (req) => {
    const businessId = businessIdOf(req);
    return prisma.payment.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  });
}
