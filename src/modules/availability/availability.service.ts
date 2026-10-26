import { prisma } from '../../lib/prisma.js';

function parseHm(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(':').map(Number);
  return { h: h ?? 0, m: m ?? 0 };
}

function atTime(dateISO: string, hm: string): Date {
  const { h, m } = parseHm(hm);
  const d = new Date(`${dateISO}T00:00:00`);
  d.setHours(h, m, 0, 0);
  return d;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function toHm(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  // Regra classica: A comeca antes de B terminar E A termina depois de B comecar.
  return aStart < bEnd && aEnd > bStart;
}

export interface AvailabilityParams {
  businessId: bigint;
  professionalId: bigint;
  serviceId?: bigint;
  serviceIds?: bigint[];
  date: string; // YYYY-MM-DD
}

export async function getAvailableSlots(params: AvailabilityParams): Promise<string[]> {
  const { businessId, professionalId, date } = params;

  const serviceIds = [...new Set(params.serviceIds ?? (params.serviceId ? [params.serviceId] : []))];
  if (serviceIds.length === 0 || serviceIds.length > 10) return [];

  const services = await prisma.service.findMany({
    where: { id: { in: serviceIds }, businessId, active: true },
  });
  if (services.length !== serviceIds.length) return [];
  const duration = services.reduce((sum, service) => sum + service.durationMinutes, 0);
  const buffer = services.reduce((sum, service) => sum + service.bufferMinutes, 0);

  const weekday = new Date(`${date}T00:00:00`).getDay();

  const hours = await prisma.businessHour.findFirst({
    where: { businessId, weekday },
  });
  if (!hours || !hours.isOpen) return [];

  const dayStart = atTime(date, hours.openTime);
  const dayEnd = atTime(date, hours.closeTime);

  // Janela do dia para buscar agendamentos e bloqueios.
  const rangeStart = new Date(`${date}T00:00:00`);
  const rangeEnd = new Date(`${date}T23:59:59`);

  const now = new Date();

  // Agendamentos que ocupam a agenda (confirmados, concluidos, ou pendentes
  // ainda dentro do prazo de pagamento). Reservas expiradas/canceladas liberam.
  const appointments = await prisma.appointment.findMany({
    where: {
      businessId,
      professionalId,
      startAt: { gte: rangeStart, lte: rangeEnd },
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

  const blocks = await prisma.blockedTime.findMany({
    where: {
      businessId,
      OR: [{ professionalId }, { professionalId: null }],
      startAt: { lt: rangeEnd },
      endAt: { gt: rangeStart },
    },
  });

  // Intervalos ocupados (com buffer do servico existente somado ao fim).
  const busy: Array<{ start: Date; end: Date }> = [
    ...appointments.map((a) => {
      const serviceBuffers = a.appointmentServices.map((item) => item.service.bufferMinutes);
      const bufferMinutes = serviceBuffers.length
        ? serviceBuffers.reduce((sum, minutes) => sum + minutes, 0)
        : a.service?.bufferMinutes ?? 0;
      return { start: a.startAt, end: addMinutes(a.endAt, bufferMinutes) };
    }),
    ...blocks.map((b) => ({ start: b.startAt, end: b.endAt })),
  ];

  const slots: string[] = [];

  // Passo = tempo cheio do procedimento (duracao + intervalo). Assim os
  // horarios ficam encaixados um apos o outro, e nao de 15 em 15 minutos.
  const stepMinutes = Math.max(duration + buffer, 1);

  for (
    let start = new Date(dayStart);
    addMinutes(start, duration) <= dayEnd;
    start = addMinutes(start, stepMinutes)
  ) {
    const slotStart = new Date(start);
    const slotEnd = addMinutes(slotStart, duration + buffer);

    // Nao oferecer horarios no passado.
    if (slotStart <= now) continue;

    const conflict = busy.some((b) => overlaps(slotStart, slotEnd, b.start, b.end));
    if (!conflict) {
      slots.push(toHm(slotStart));
    }
  }

  return slots;
}
