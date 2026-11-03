-- ===========================================================================
-- 019_ntfy_internal_alerts.sql
-- Avisos internos (sinal recebido) passam a sair por push do ntfy.
--
-- Por que: o aviso interno ia para o proprio numero conectado ao robo. O
-- WhatsApp nao notifica mensagem que voce manda para voce mesma -- ela cai na
-- conversa "Mensagem para voce mesmo" sem nenhum aviso no aparelho. O ntfy
-- resolve com push de verdade (tem app de iPhone e Android).
--
-- As mensagens da CLIENTE (confirmacao, lembretes, cancelamento, correcao de
-- endereco) continuam saindo pelo WhatsApp.
--
-- ntfy_topic e o "canal": quem souber o nome le as mensagens, entao ele e
-- gerado aleatorio e longo pelo painel.
-- ===========================================================================

SET NAMES utf8mb4;

ALTER TABLE businesses
    ADD COLUMN ntfy_server VARCHAR(200) NULL AFTER notify_phone,
    ADD COLUMN ntfy_topic VARCHAR(120) NULL AFTER ntfy_server;

ALTER TABLE notification_jobs
    MODIFY COLUMN channel ENUM('whatsapp','ntfy') NOT NULL DEFAULT 'whatsapp';
