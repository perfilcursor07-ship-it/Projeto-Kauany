// Link unico do studio no mapa. {endereco} e {localizacao} apontam para o
// mesmo lugar, entao trocar a linha abaixo atualiza TODAS as mensagens.
export const STUDIO_ADDRESS_URL = 'https://maps.app.goo.gl/WmtcSPEgADHH12rR6';
export const STUDIO_LOCATION_URL = STUDIO_ADDRESS_URL;

// Substitui placeholders {chave} pelas variaveis fornecidas.
export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
}

// Link que abre o agendamento da cliente ja na tela de pagamento.
export function appointmentLink(webUrl: string, token: string): string {
  return `${webUrl.replace(/\/$/, '')}/?agendamento=${token}`;
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

// ===========================================================================
// Textos padrao de cada mensagem, num lugar so.
//
// Ficam aqui (e nao espalhados pelo codigo) para que o envio de teste do
// painel mostre exatamente o mesmo texto que a cliente recebe de verdade.
// Quando existe uma linha ativa em notification_templates, ela tem prioridade
// sobre o texto daqui -- igual ao que acontece no envio real.
// ===========================================================================

export const TRIGGER_LABELS = {
  confirmed: 'Confirmação',
  reminder_24h: 'Lembrete 24h',
  reminder_2h: 'Lembrete do dia',
  cancelled: 'Cancelamento',
  payment_pending: 'Cobrança do sinal',
  address_update: 'Correção de endereço',
  manager_paid: 'Aviso interno',
} as const;

export const FALLBACK_BODIES = {
  confirmed:
    '{cliente}, seu horário foi agendado!\n\n{data} às {hora}\n' +
    'Serviço: {servico}\nValor: {valor}\n\nEndereço: {endereco}\n\n' +
    'Te espero no horário combinado! ✨',

  reminder_24h:
    '{saudacao}, {cliente}! ✨\n\n' +
    'Passando para te lembrar do seu horário agendado amanhã às {hora}.\n\n' +
    'Em caso de atraso, temos uma tolerância de 10 minutos e, se possível, venha sem acompanhante. ' +
    'Esse momento é todo seu, te aguardo!',

  reminder_2h:
    '{saudacao}, {cliente}! ✨\n\n' +
    'Passando para te lembrar do seu horário agendado hoje às {hora}.\n\n' +
    'Não esqueça de sair com antecedência para evitar o cancelamento automático do seu horário. ✨\n\n' +
    'Localização: {localizacao}',

  cancelled: 'Ola, {cliente}. Seu agendamento de {data} as {hora} foi cancelado.',

  // Cobranca automatica de quem agendou e nao pagou o sinal. O {link} abre
  // o agendamento dela direto na tela de pagamento.
  payment_pending:
    '{cliente}, seu agendamento ainda NÃO foi confirmado. ⏳\n\n' +
    'Serviço: {servico}\n📅 {data} às {hora}\n' +
    'Valor: {valor} · Sinal para confirmar: {sinal}\n\n' +
    'Para garantir o seu horário, é preciso pagar o sinal por aqui:\n{link}\n\n' +
    'Sem o pagamento do sinal o horário não fica reservado e pode ser ocupado por outra pessoa. ✨',

  address_update:
    'Olá, {primeiro_nome}! ✨\n\n' +
    'Passando para corrigir o endereço do seu agendamento. O endereço correto é:\n{endereco}\n\n' +
    'Desculpe pelo transtorno. Te espero no horário combinado!',

  manager_paid:
    '💰 Sinal recebido!\n\n{cliente} pagou {sinal} de sinal.\n' +
    'Servico: {servico}\n📅 {data} às {hora}\n' +
    'Valor total: {valor} · Restante: {restante}',
} as const;

// Busca por chave dinamica (ex: o triggerKey que veio do painel).
export function fallbackBody(triggerKey: string): string | null {
  return (FALLBACK_BODIES as Record<string, string | undefined>)[triggerKey] ?? null;
}

export function triggerLabel(triggerKey: string): string {
  return (TRIGGER_LABELS as Record<string, string | undefined>)[triggerKey] ?? triggerKey;
}

// Mensagens que o painel sabe enviar como teste, na ordem em que aparecem.
export const TESTABLE_TRIGGERS = [
  'confirmed',
  'reminder_24h',
  'reminder_2h',
  'payment_pending',
  'cancelled',
  'address_update',
  'manager_paid',
] as const;

// Avisos internos vao para a gestora, nao para a cliente.
export const INTERNAL_TRIGGERS = ['manager_paid'];

const brl = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

export function greetingFor(date: Date, timezone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(date),
  );
  if (hour < 12) return 'Bom Dia';
  if (hour < 18) return 'Boa Tarde';
  return 'Boa Noite';
}

// Dados ficticios para o envio de teste: amanha, as 14h, com valores redondos.
export function sampleVars(
  studioName: string,
  timezone = 'America/Sao_Paulo',
  webUrl = '',
): Record<string, string> {
  const when = new Date();
  when.setDate(when.getDate() + 1);
  when.setHours(14, 0, 0, 0);

  const total = 150;
  const deposit = 50;

  return {
    cliente: 'Maria Silva',
    primeiro_nome: 'Maria',
    servico: 'Alongamento em Gel',
    data: when.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    hora: when.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    valor: brl(total),
    sinal: brl(deposit),
    restante: brl(total - deposit),
    studio: studioName,
    link: appointmentLink(webUrl, '00000000-0000-0000-0000-000000000000'),
    endereco: STUDIO_ADDRESS_URL,
    localizacao: STUDIO_LOCATION_URL,
    saudacao: greetingFor(new Date(), timezone),
  };
}
