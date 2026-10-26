import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import {
  createPixOrder,
  getOrder,
  extractQrCode,
  isOrderPaid,
  getPaidCharge,
} from './pagbank.client.js';
import { expireAppointmentIfNeeded } from '../appointments/appointments.service.js';
import { renderTemplate } from '../whatsapp/templates.js';
import QRCode from 'qrcode';

// Modo de teste: sem PagBank real. Ativado por PAYMENTS_MODE=fake ou quando
// o token ainda e o placeholder.
export function isFakeMode(): boolean {
  return (
    env.PAYMENTS_MODE === 'fake' ||
    !env.PAGBANK_TOKEN ||
    env.PAGBANK_TOKEN.startsWith('seu-token')
  );
}

const brl = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const fmtDate = (d: Date) =>
  d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtTime = (d: Date) =>
  d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function greetingFor(date: Date, timezone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(date),
  );
  if (hour < 12) return 'Bom Dia';
  if (hour < 18) return 'Boa Tarde';
  return 'Boa Noite';
}

export class PaymentError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
  }
}

function toCents(value: Prisma.Decimal | number): number {
  return Math.round(Number(value) * 100);
}

// ---------------------------------------------------------------------------
// Cria (ou reaproveita) a cobranca Pix do sinal de um agendamento.
// ---------------------------------------------------------------------------
export async function createPixForAppointment(token: string) {
  await expireAppointmentIfNeeded(token);
  const appointment = await prisma.appointment.findUnique({
    where: { token },
    include: { service: true, client: true },
  });

  if (!appointment) throw new PaymentError(404, 'Agendamento nao encontrado');
  if (appointment.status === 'confirmed') {
    throw new PaymentError(409, 'Agendamento ja confirmado');
  }
  if (appointment.status === 'expired') {
    throw new PaymentError(410, 'Prazo de pagamento expirado. Escolha outro horario.');
  }
  if (appointment.status !== 'pending_payment') {
    throw new PaymentError(409, 'Agendamento nao esta aguardando pagamento');
  }
  if (appointment.expiresAt && appointment.expiresAt <= new Date()) {
    await expireAppointmentIfNeeded(token);
    throw new PaymentError(410, 'Prazo de pagamento expirado. Escolha outro horario.');
  }

  const depositCents = toCents(appointment.depositAmount);
  if (depositCents <= 0) {
    throw new PaymentError(400, 'Este agendamento nao exige sinal');
  }

  // Reaproveita um Pix pendente ainda valido (evita gerar QR duplicado).
  const existing = await prisma.payment.findFirst({
    where: { appointmentId: appointment.id, status: 'pending' },
    orderBy: { createdAt: 'desc' },
  });
  if (existing && existing.expiresAt && existing.expiresAt > new Date() && existing.qrCodeText) {
    return { payment: existing, appointment };
  }

  // ---- MODO DE TESTE: gera um Pix "fake" (nao chama o PagBank) -----------
  if (isFakeMode()) {
    const fakeText = `FAKE-PIX-${appointment.id}-${Date.now()}`;
    const image = await QRCode.toDataURL(fakeText);
    const payment = await prisma.payment.create({
      data: {
        businessId: appointment.businessId,
        appointmentId: appointment.id,
        provider: 'pagbank',
        method: 'pix',
        providerOrderId: `FAKE-${appointment.id}-${Date.now()}`,
        amount: appointment.depositAmount,
        status: 'pending',
        qrCodeText: fakeText,
        qrCodeImageUrl: image,
        expiresAt: appointment.expiresAt ?? null,
        rawResponse: { fake: true } as unknown as Prisma.InputJsonValue,
      },
    });
    return { payment, appointment };
  }

  let order;
  try {
    order = await createPixOrder({
      referenceId: `appt-${appointment.id}-${Date.now()}`,
      amountCents: depositCents,
      description: `Sinal - ${appointment.service.name}`,
      customer: {
        name: appointment.client.name,
        email: appointment.client.email,
        phone: appointment.client.phone,
      },
      expiresInMinutes: env.RESERVATION_MINUTES,
      notificationUrl: `${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/webhooks/pagbank`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao criar cobrança Pix';
    throw new PaymentError(502, `PagBank: ${message}`);
  }

  const qr = extractQrCode(order);
  const expiresAt = qr?.expirationDate ? new Date(qr.expirationDate) : appointment.expiresAt;

  const payment = await prisma.payment.create({
    data: {
      businessId: appointment.businessId,
      appointmentId: appointment.id,
      provider: 'pagbank',
      method: 'pix',
      providerOrderId: order.id,
      amount: appointment.depositAmount,
      status: 'pending',
      qrCodeText: qr?.text ?? null,
      qrCodeImageUrl: qr?.imageUrl ?? null,
      expiresAt: expiresAt ?? null,
      rawResponse: order as unknown as Prisma.InputJsonValue,
    },
  });

  return { payment, appointment };
}

// ---------------------------------------------------------------------------
// Confirma o pagamento consultando o pedido diretamente no PagBank.
// Nunca confiamos apenas no corpo do webhook (evita fraude).
// ---------------------------------------------------------------------------
export async function confirmPaymentByOrderId(orderId: string): Promise<{
  confirmed: boolean;
  reason?: string;
}> {
  const payment = await prisma.payment.findFirst({
    where: { providerOrderId: orderId },
    orderBy: { createdAt: 'desc' },
  });
  if (!payment) return { confirmed: false, reason: 'payment_not_found' };
  if (payment.status === 'paid') return { confirmed: true, reason: 'already_paid' };

  // Consulta a fonte da verdade: o proprio PagBank.
  const order = await getOrder(orderId);
  if (!isOrderPaid(order)) {
    return { confirmed: false, reason: 'not_paid_yet' };
  }

  const charge = getPaidCharge(order);
  await applyPaidPayment(payment.id, {
    chargeId: charge?.id ?? null,
    rawResponse: order as unknown as Prisma.InputJsonValue,
  });
  return { confirmed: true };
}

// ---------------------------------------------------------------------------
// MODO DE TESTE: simula que a cliente pagou o sinal (sem PagBank).
// ---------------------------------------------------------------------------
export async function simulatePaymentByToken(token: string): Promise<{ confirmed: boolean }> {
  if (!isFakeMode()) {
    throw new PaymentError(403, 'Simulacao disponivel apenas no modo de teste');
  }

  await expireAppointmentIfNeeded(token);
  const appointment = await prisma.appointment.findUnique({ where: { token } });
  if (!appointment) throw new PaymentError(404, 'Agendamento nao encontrado');
  if (appointment.status === 'confirmed') return { confirmed: true };
  if (appointment.status === 'expired') {
    throw new PaymentError(410, 'Prazo de pagamento expirado. Escolha outro horario.');
  }
  if (appointment.expiresAt && appointment.expiresAt <= new Date()) {
    await expireAppointmentIfNeeded(token);
    throw new PaymentError(410, 'Prazo de pagamento expirado. Escolha outro horario.');
  }

  const payment = await prisma.payment.findFirst({
    where: { appointmentId: appointment.id, status: 'pending' },
    orderBy: { createdAt: 'desc' },
  });
  if (!payment) throw new PaymentError(409, 'Gere o Pix antes de simular o pagamento');

  await applyPaidPayment(payment.id, { chargeId: 'FAKE-CHARGE' });
  return { confirmed: true };
}

// ---------------------------------------------------------------------------
// Nucleo compartilhado: marca o pagamento como pago, confirma o agendamento,
// registra no caixa e enfileira as mensagens de WhatsApp.
// ---------------------------------------------------------------------------
async function applyPaidPayment(
  paymentId: bigint,
  extra?: { chargeId?: string | null; rawResponse?: Prisma.InputJsonValue },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.status === 'paid') return;

    const currentAppointment = await tx.appointment.findUnique({
      where: { id: payment.appointmentId },
    });
    if (!currentAppointment || currentAppointment.status !== 'pending_payment') {
      return;
    }
    if (
      currentAppointment.expiresAt &&
      currentAppointment.expiresAt <= new Date()
    ) {
      await tx.appointment.update({
        where: { id: currentAppointment.id },
        data: { status: 'expired', paymentStatus: 'expired' },
      });
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'expired' },
      });
      return;
    }

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'paid',
        paidAt: new Date(),
        providerChargeId: extra?.chargeId ?? payment.providerChargeId ?? null,
        ...(extra?.rawResponse ? { rawResponse: extra.rawResponse } : {}),
      },
    });

    const appointment = await tx.appointment.update({
      where: { id: payment.appointmentId },
      data: { status: 'confirmed', paymentStatus: 'paid' },
      include: { client: true, service: true },
    });

    // Entrada no caixa.
    await tx.$executeRaw`
      INSERT INTO cash_transactions
        (business_id, appointment_id, payment_id, type, description, category, amount, occurred_at)
      VALUES
        (${appointment.businessId}, ${appointment.id}, ${payment.id}, 'in',
         ${'Sinal - ' + appointment.service.name}, 'Serviços', ${payment.amount}, NOW())
    `;

    // Monta as variaveis das mensagens.
    const total = Number(appointment.totalAmount);
    const deposit = Number(appointment.depositAmount);
    const business = await tx.business.findUnique({ where: { id: appointment.businessId } });
    const vars: Record<string, string> = {
      cliente: appointment.client.name.trim(),
      servico: appointment.service.name,
      data: fmtDate(appointment.startAt),
      hora: fmtTime(appointment.startAt),
      valor: brl(total),
      sinal: brl(deposit),
      restante: brl(total - deposit),
      studio: business?.name ?? '',
      endereco: 'https://maps.app.goo.gl/akCuRvFd1vHnUfsZ8?g_st=ic',
      localizacao: 'https://maps.app.goo.gl/kW2nQ23ksDJDFPBG8?g_st=ic',
    };

    // Mensagem para a CLIENTE (usa o template configuravel 'confirmed').
    const tpl = await tx.notificationTemplate.findFirst({
      where: { businessId: appointment.businessId, triggerKey: 'confirmed', channel: 'whatsapp', active: true },
    });
    const clientBody = tpl
      ? renderTemplate(tpl.body, vars)
      : `${vars.cliente}, seu horário foi agendado!\n\n${vars.data} às ${vars.hora}\n` +
        `Serviço: ${vars.servico}\nValor: ${vars.valor}\n\nEndereço: ${vars.endereco}\n\n` +
        'Te espero no horário combinado! ✨';

    await tx.notificationJob.create({
      data: {
        businessId: appointment.businessId,
        appointmentId: appointment.id,
        triggerKey: 'confirmed',
        channel: 'whatsapp',
        toPhone: appointment.client.phone,
        body: clientBody,
        scheduledFor: new Date(),
        status: 'pending',
      },
    });

    // Lembretes automaticos (24h e 2h antes). Ficam agendados na fila; o worker
    // envia na hora certa. Se o agendamento for cancelado, o worker os ignora.
    const reminders: Array<{ trigger: string; when: Date; fallback: string }> = [
      {
        trigger: 'reminder_24h',
        when: new Date(appointment.startAt.getTime() - 24 * 60 * 60 * 1000),
        fallback:
          '{saudacao}, {cliente}! ✨\n\n' +
          'Passando para te lembrar do seu horário agendado amanhã às {hora}.\n\n' +
          'Em caso de atraso, temos uma tolerância de 10 minutos e, se possível, venha sem acompanhante. ' +
          'Esse momento é todo seu, te aguardo!',
      },
      {
        trigger: 'reminder_2h',
        when: new Date(appointment.startAt.getTime() - 2 * 60 * 60 * 1000),
        fallback:
          '{saudacao}, {cliente}! ✨\n\n' +
          'Passando para te lembrar do seu horário agendado hoje às {hora}.\n\n' +
          'Não esqueça de sair com antecedência para evitar o cancelamento automático do seu horário. ✨\n\n' +
          'Localização: {localizacao}',
      },
    ];
    for (const r of reminders) {
      if (r.when <= new Date()) continue; // ja passou: nao agenda
      const rtpl = await tx.notificationTemplate.findFirst({
        where: { businessId: appointment.businessId, triggerKey: r.trigger, channel: 'whatsapp', active: true },
      });
      await tx.notificationJob.create({
        data: {
          businessId: appointment.businessId,
          appointmentId: appointment.id,
          triggerKey: r.trigger,
          channel: 'whatsapp',
          toPhone: appointment.client.phone,
          body: renderTemplate(rtpl?.body ?? r.fallback, {
            ...vars,
            saudacao: greetingFor(r.when, business?.timezone ?? 'America/Sao_Paulo'),
          }),
          scheduledFor: r.when,
          status: 'pending',
        },
      });
    }

    // Mensagem para a GESTORA (aviso de sinal recebido).
    // No modo manual isso seria "voce mandando para voce mesma" (o painel ja
    // te avisa), entao so enfileiramos quando o envio e automatico (baileys).
    if (business?.phone && env.WHATSAPP_MODE === 'baileys') {
      const managerBody =
        `💰 Sinal recebido!\n\n${appointment.client.name} pagou ${vars.sinal} de sinal.\n` +
        `Servico: ${vars.servico}\n📅 ${vars.data} às ${vars.hora}\n` +
        `Valor total: ${vars.valor} · Restante: ${vars.restante}`;
      await tx.notificationJob.create({
        data: {
          businessId: appointment.businessId,
          appointmentId: appointment.id,
          triggerKey: 'manager_paid',
          channel: 'whatsapp',
          toPhone: business.phone,
          body: managerBody,
          scheduledFor: new Date(),
          status: 'pending',
        },
      });
    }
  });
}
