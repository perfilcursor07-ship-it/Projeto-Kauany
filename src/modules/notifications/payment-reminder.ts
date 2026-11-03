import type { Prisma } from '@prisma/client';
import { env } from '../../config/env.js';
import {
  appointmentLink,
  FALLBACK_BODIES,
  firstName,
  renderTemplate,
  STUDIO_ADDRESS_URL,
} from '../whatsapp/templates.js';

// ===========================================================================
// Cobranca do sinal ("payment_pending").
//
// Um lugar so para montar e enfileirar essa mensagem, usado pelos dois
// caminhos: o automatico (ao agendar, sai PAYMENT_REMINDER_MINUTES depois) e o
// manual (botao no painel, sai na hora). Se cada um montasse o proprio texto,
// o envio manual acabaria divergindo do automatico com o tempo.
// ===========================================================================

const brl = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

// O minimo que precisamos saber do agendamento para montar a mensagem.
export interface ReminderAppointment {
  id: bigint;
  businessId: bigint;
  token: string;
  startAt: Date;
  totalAmount: Prisma.Decimal | number;
  depositAmount: Prisma.Decimal | number;
  serviceLabel: string;
  clientName: string;
  clientPhone: string;
}

// Cliente do Prisma OU a transacao -- os dois servem.
type Db = Pick<Prisma.TransactionClient, 'business' | 'notificationTemplate' | 'notificationJob'>;

export async function buildPaymentReminderBody(
  db: Db,
  appointment: ReminderAppointment,
): Promise<string> {
  const business = await db.business.findUnique({
    where: { id: appointment.businessId },
    select: { name: true },
  });

  const total = Number(appointment.totalAmount);
  const deposit = Number(appointment.depositAmount);

  const vars: Record<string, string> = {
    cliente: appointment.clientName.trim(),
    primeiro_nome: firstName(appointment.clientName),
    servico: appointment.serviceLabel,
    data: appointment.startAt.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }),
    hora: appointment.startAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    valor: brl(total),
    sinal: brl(deposit),
    restante: brl(total - deposit),
    studio: business?.name ?? '',
    link: appointmentLink(env.PUBLIC_WEB_URL, appointment.token),
    endereco: STUDIO_ADDRESS_URL,
  };

  // Template salvo no painel tem prioridade, igual as outras mensagens.
  const tpl = await db.notificationTemplate.findFirst({
    where: {
      businessId: appointment.businessId,
      triggerKey: 'payment_pending',
      channel: 'whatsapp',
      active: true,
    },
  });

  return renderTemplate(tpl?.body ?? FALLBACK_BODIES.payment_pending, vars);
}

export async function enqueuePaymentReminder(
  db: Db,
  appointment: ReminderAppointment,
  /** Quando enviar. Omitido = agora (envio manual pelo painel). */
  scheduledFor: Date = new Date(),
): Promise<string> {
  const body = await buildPaymentReminderBody(db, appointment);

  await db.notificationJob.create({
    data: {
      businessId: appointment.businessId,
      appointmentId: appointment.id,
      triggerKey: 'payment_pending',
      channel: 'whatsapp',
      toPhone: appointment.clientPhone,
      body,
      scheduledFor,
      status: 'pending',
    },
  });

  return body;
}
