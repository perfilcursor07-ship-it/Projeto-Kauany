-- ===========================================================================
-- 004_seed.sql
-- Dados iniciais para comecar a testar. Ajuste nome/servicos depois no painel.
-- O usuario admin NAO e criado aqui (a senha precisa ser gerada com hash):
-- use  ->  npm run create-admin
-- ===========================================================================

SET NAMES utf8mb4;

-- Negocio principal (a esposa). Ajuste name/slug/phone conforme necessario.
INSERT INTO businesses (id, name, slug, phone, timezone)
VALUES (1, 'Studio Juliana Nails', 'juliana-nails', '5563999999999', 'America/Sao_Paulo');

-- Profissional (a propria esposa).
INSERT INTO professionals (id, business_id, name)
VALUES (1, 1, 'Juliana');

-- Horario de funcionamento (0=Dom ... 6=Sab).
INSERT INTO business_hours (business_id, weekday, is_open, open_time, close_time) VALUES
    (1, 0, FALSE, '08:00', '18:00'),  -- Domingo: fechado
    (1, 1, TRUE,  '08:00', '18:00'),  -- Segunda
    (1, 2, TRUE,  '08:00', '18:00'),  -- Terca
    (1, 3, TRUE,  '08:00', '18:00'),  -- Quarta
    (1, 4, TRUE,  '08:00', '18:00'),  -- Quinta
    (1, 5, TRUE,  '08:00', '18:00'),  -- Sexta
    (1, 6, TRUE,  '08:00', '13:00');  -- Sabado

-- Servicos de exemplo (preco, duracao e sinal fixo).
INSERT INTO services
    (business_id, name, description, price, deposit_type, deposit_value, duration_minutes, buffer_minutes)
VALUES
    (1, 'Esmaltacao',      'Esmaltacao tradicional',        40.00, 'fixed', 10.00,  50, 10),
    (1, 'Banho de Gel',    'Banho de gel nas unhas',        80.00, 'fixed', 20.00,  90, 15),
    (1, 'Alongamento',     'Alongamento em gel',           120.00, 'fixed', 30.00, 120, 15),
    (1, 'Manutencao',      'Manutencao de alongamento',     90.00, 'fixed', 20.00,  90, 15);

-- Templates de mensagem (placeholders: {cliente}, {servico}, {data}, {hora},
-- {valor}, {sinal}, {restante}, {studio}, {endereco}, {localizacao}, {saudacao}).
INSERT INTO notification_templates (business_id, trigger_key, channel, body) VALUES
(1, 'confirmed', 'whatsapp',
 '{cliente}, seu horário foi agendado!\n\n{data} às {hora}\nServiço: {servico}\nValor: {valor}\n\nEndereço: {endereco}\n\nTe espero no horário combinado! ✨'),
(1, 'reminder_24h', 'whatsapp',
 '{saudacao}, {cliente}! ✨\n\nPassando para te lembrar do seu horário agendado amanhã às {hora}.\n\nEm caso de atraso, temos uma tolerância de 10 minutos e, se possível, venha sem acompanhante. Esse momento é todo seu, te aguardo!'),
(1, 'reminder_2h', 'whatsapp',
 '{saudacao}, {cliente}! ✨\n\nPassando para te lembrar do seu horário agendado hoje às {hora}.\n\nNão esqueça de sair com antecedência para evitar o cancelamento automático do seu horário. ✨\n\nLocalização: {localizacao}'),
(1, 'cancelled', 'whatsapp',
 'Ola, {cliente}. Seu agendamento de {data} as {hora} foi cancelado. Qualquer duvida e so falar com a gente. 💕');
