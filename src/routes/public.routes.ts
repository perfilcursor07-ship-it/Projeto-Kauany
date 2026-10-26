import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { resolvePublicBusiness } from '../lib/business.js';
import { getAvailableSlots } from '../modules/availability/availability.service.js';
import {
  createPublicAppointment,
  getAppointmentByToken,
  getPublicAppointmentsByPhone,
  computeDeposit,
  AppointmentError,
} from '../modules/appointments/appointments.service.js';
import {
  createPixForAppointment,
  simulatePaymentByToken,
  isFakeMode,
  PaymentError,
} from '../modules/payments/payments.service.js';

type PublicBioSettingRow = {
  enabled: number | boolean;
  title: string | null;
  subtitle: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  backgroundUrl: string | null;
  instagramUrl: string | null;
};

type PublicBioLinkRow = {
  id: bigint;
  label: string;
  url: string | null;
  type: string;
  sortOrder: number;
};

type PublicBioDocumentRow = {
  fileData: string | null;
  fileName: string | null;
  fileMime: string | null;
};

type PublicServiceRow = {
  id: bigint;
  name: string;
  description: string | null;
  price: Prisma.Decimal;
  depositType: string;
  depositValue: Prisma.Decimal;
  durationMinutes: number;
};

export async function publicRoutes(app: FastifyInstance) {
  // --- Bio publica opcional ----------------------------------------------
  app.get('/bio', async (req, reply) => {
    const { slug } = z.object({ slug: z.string().optional() }).parse(req.query);
    const business = await resolvePublicBusiness(slug);
    if (!business) return reply.code(404).send({ message: 'Negocio nao encontrado' });

    const [setting] = await prisma.$queryRaw<PublicBioSettingRow[]>`
      SELECT
        enabled,
        title,
        subtitle,
        avatar_url AS avatarUrl,
        cover_url AS coverUrl,
        background_url AS backgroundUrl,
        instagram_url AS instagramUrl
      FROM bio_settings
      WHERE business_id = ${business.id}
      LIMIT 1
    `;

    const links = await prisma.$queryRaw<PublicBioLinkRow[]>`
      SELECT id, label, url, type, sort_order AS sortOrder
      FROM bio_links
      WHERE business_id = ${business.id}
        AND active = TRUE
      ORDER BY sort_order ASC, id ASC
    `;

    return {
      business: {
        id: business.id.toString(),
        name: business.name,
        slug: business.slug,
        logoUrl: business.logoUrl,
      },
      bio: {
        enabled: Boolean(setting?.enabled),
        title: setting?.title || business.name,
        subtitle: setting?.subtitle || null,
        avatarUrl: setting?.avatarUrl || business.logoUrl,
        coverUrl: setting?.coverUrl || null,
        backgroundUrl: setting?.backgroundUrl || null,
        instagramUrl: setting?.instagramUrl || null,
      },
      links: links.map((link) => ({
        id: link.id.toString(),
        label: link.label,
        url: link.url,
        type: link.type,
        sortOrder: link.sortOrder,
      })),
    };
  });

  app.get('/bio/links/:id/file', async (req, reply) => {
    const parsed = z.object({ id: z.coerce.bigint() }).safeParse(req.params);
    if (!parsed.success) return reply.code(404).send({ message: 'Arquivo nao encontrado' });

    const [document] = await prisma.$queryRaw<PublicBioDocumentRow[]>`
      SELECT file_data AS fileData, file_name AS fileName, file_mime AS fileMime
      FROM bio_links
      WHERE id = ${parsed.data.id}
        AND type = 'document'
        AND active = TRUE
      LIMIT 1
    `;
    if (!document?.fileData || !document.fileName || !document.fileMime) {
      return reply.code(404).send({ message: 'Arquivo nao encontrado' });
    }

    const encodedFileName = encodeURIComponent(document.fileName).replace(/[!'()*]/g, (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return reply
      .type(document.fileMime)
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodedFileName}`)
      .header('X-Content-Type-Options', 'nosniff')
      .send(Buffer.from(document.fileData, 'base64'));
  });

  // --- Lista de servicos ativos ------------------------------------------
  app.get('/services', async (req, reply) => {
    const { slug } = z.object({ slug: z.string().optional() }).parse(req.query);
    const business = await resolvePublicBusiness(slug);
    if (!business) return reply.code(404).send({ message: 'Negocio nao encontrado' });

    const services = await prisma.$queryRaw<PublicServiceRow[]>`
      SELECT
        id,
        name,
        description,
        price,
        deposit_type AS depositType,
        deposit_value AS depositValue,
        duration_minutes AS durationMinutes
      FROM services
      WHERE business_id = ${business.id}
        AND active = TRUE
      ORDER BY sort_order ASC, price ASC, name ASC
    `;

    return {
      business: {
        id: business.id.toString(),
        name: business.name,
        slug: business.slug,
        logoUrl: business.logoUrl,
      },
      services: services.map((s) => ({
        id: s.id.toString(),
        name: s.name,
        description: s.description,
        price: Number(s.price),
        durationMinutes: s.durationMinutes,
        depositType: s.depositType,
        depositAmount: computeDeposit(s.price, s.depositType, s.depositValue),
      })),
    };
  });

  // --- Dias e horarios de atendimento publicos ---------------------------
  app.get('/business-hours', async (req, reply) => {
    const { slug } = z.object({ slug: z.string().optional() }).parse(req.query);
    const business = await resolvePublicBusiness(slug);
    if (!business) return reply.code(404).send({ message: 'Negocio nao encontrado' });

    const hours = await prisma.businessHour.findMany({
      where: { businessId: business.id },
      orderBy: { weekday: 'asc' },
    });

    return {
      business: {
        id: business.id.toString(),
        name: business.name,
        slug: business.slug,
      },
      hours: hours.map((h) => ({
        weekday: h.weekday,
        isOpen: h.isOpen,
        openTime: h.openTime,
        closeTime: h.closeTime,
      })),
    };
  });

  // --- Horarios disponiveis ----------------------------------------------
  app.get('/availability', async (req, reply) => {
    const schema = z.object({
      slug: z.string().optional(),
      serviceId: z.coerce.bigint(),
      professionalId: z.coerce.bigint().optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato YYYY-MM-DD'),
    });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Parametros invalidos', issues: parsed.error.flatten() });
    }

    const business = await resolvePublicBusiness(parsed.data.slug);
    if (!business) return reply.code(404).send({ message: 'Negocio nao encontrado' });

    let professionalId = parsed.data.professionalId;
    if (!professionalId) {
      const prof = await prisma.professional.findFirst({
        where: { businessId: business.id, active: true },
        orderBy: { id: 'asc' },
      });
      if (!prof) return { date: parsed.data.date, slots: [] };
      professionalId = prof.id;
    }

    const slots = await getAvailableSlots({
      businessId: business.id,
      professionalId,
      serviceId: parsed.data.serviceId,
      date: parsed.data.date,
    });

    return { date: parsed.data.date, slots };
  });

  // --- Busca cliente pelo WhatsApp para preencher nome no agendamento ----
  app.post('/clients/lookup', async (req, reply) => {
    const schema = z.object({
      slug: z.string().optional(),
      phone: z.string().min(8),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados invalidos', issues: parsed.error.flatten() });
    }

    const business = await resolvePublicBusiness(parsed.data.slug);
    if (!business) return reply.code(404).send({ message: 'Negocio nao encontrado' });

    const phone = parsed.data.phone.replace(/\D/g, '');
    const client = await prisma.client.findFirst({
      where: { businessId: business.id, phone, deletedAt: null },
      select: { name: true },
    });

    return { client: client ? { name: client.name } : null };
  });

  // --- Criacao do agendamento (reserva pendente de pagamento) ------------
  app.post('/appointments', async (req, reply) => {
    const schema = z.object({
      slug: z.string().optional(),
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

    const business = await resolvePublicBusiness(parsed.data.slug);
    if (!business) return reply.code(404).send({ message: 'Negocio nao encontrado' });

    try {
      const { appointment, requiresDeposit } = await createPublicAppointment({
        businessId: business.id,
        serviceId: parsed.data.serviceId,
        professionalId: parsed.data.professionalId,
        date: parsed.data.date,
        time: parsed.data.time,
        client: parsed.data.client,
        notes: parsed.data.notes,
      });

      return reply.code(201).send({
        token: appointment.token,
        status: appointment.status,
        requiresDeposit,
        appointment: {
          service: appointment.service.name,
          startAt: appointment.startAt,
          endAt: appointment.endAt,
          totalAmount: Number(appointment.totalAmount),
          depositAmount: Number(appointment.depositAmount),
        },
        // Proximo passo do fluxo, se precisar de sinal.
        next: requiresDeposit ? { action: 'pay_pix', endpoint: '/api/public/payments/pix' } : null,
      });
    } catch (err) {
      if (err instanceof AppointmentError) {
        return reply.code(err.statusCode).send({ message: err.message });
      }
      throw err;
    }
  });

  // --- Consulta de agendamentos pelo WhatsApp da cliente (sem login) -----
  app.post('/appointments/lookup', async (req, reply) => {
    const schema = z.object({
      slug: z.string().optional(),
      phone: z.string().min(8),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados invalidos', issues: parsed.error.flatten() });
    }

    const business = await resolvePublicBusiness(parsed.data.slug);
    if (!business) return reply.code(404).send({ message: 'Negocio nao encontrado' });

    const appointments = await getPublicAppointmentsByPhone(business.id, parsed.data.phone);

    return {
      business: {
        id: business.id.toString(),
        name: business.name,
        logoUrl: business.logoUrl,
      },
      appointments: appointments.map((appointment) => {
        const lastPayment = appointment.payments[0];
        return {
          token: appointment.token,
          status: appointment.status,
          paymentStatus: appointment.paymentStatus,
          client: appointment.client.name,
          service: appointment.service.name,
          professional: appointment.professional.name,
          startAt: appointment.startAt,
          endAt: appointment.endAt,
          totalAmount: Number(appointment.totalAmount),
          depositAmount: Number(appointment.depositAmount),
          expiresAt: appointment.expiresAt,
          payment: lastPayment
            ? {
                status: lastPayment.status,
                qrCodeText: lastPayment.qrCodeText,
                qrCodeImageUrl: lastPayment.qrCodeImageUrl,
                expiresAt: lastPayment.expiresAt,
              }
            : null,
        };
      }),
    };
  });

  // --- Consulta do agendamento pela cliente (sem login) ------------------
  app.get('/appointments/:token', async (req, reply) => {
    const { token } = z.object({ token: z.string().uuid() }).parse(req.params);
    const appointment = await getAppointmentByToken(token);
    if (!appointment) return reply.code(404).send({ message: 'Agendamento nao encontrado' });

    const lastPayment = appointment.payments[0];
    return {
      token: appointment.token,
      status: appointment.status,
      paymentStatus: appointment.paymentStatus,
      service: appointment.service.name,
      professional: appointment.professional.name,
      startAt: appointment.startAt,
      endAt: appointment.endAt,
      totalAmount: Number(appointment.totalAmount),
      depositAmount: Number(appointment.depositAmount),
      expiresAt: appointment.expiresAt,
      payment: lastPayment
        ? {
            status: lastPayment.status,
            qrCodeText: lastPayment.qrCodeText,
            qrCodeImageUrl: lastPayment.qrCodeImageUrl,
            expiresAt: lastPayment.expiresAt,
          }
        : null,
    };
  });

  // --- Gera o Pix do sinal -----------------------------------------------
  app.post('/payments/pix', async (req, reply) => {
    const { token } = z.object({ token: z.string().uuid() }).parse(req.body);

    try {
      const { payment, appointment } = await createPixForAppointment(token);
      return {
        appointmentToken: token,
        amount: Number(payment.amount),
        expiresAt: payment.expiresAt,
        pix: {
          qrCodeText: payment.qrCodeText, // copia e cola
          qrCodeImageUrl: payment.qrCodeImageUrl,
        },
        service: appointment.service.name,
        test: isFakeMode(), // frontend mostra "Simular pagamento" quando true
      };
    } catch (err) {
      if (err instanceof PaymentError) {
        return reply.code(err.statusCode).send({ message: err.message });
      }
      throw err;
    }
  });

  // --- Simula o pagamento (apenas modo de teste) -------------------------
  app.post('/payments/simulate', async (req, reply) => {
    const { token } = z.object({ token: z.string().uuid() }).parse(req.body);
    try {
      const result = await simulatePaymentByToken(token);
      return result;
    } catch (err) {
      if (err instanceof PaymentError) {
        return reply.code(err.statusCode).send({ message: err.message });
      }
      throw err;
    }
  });
}
