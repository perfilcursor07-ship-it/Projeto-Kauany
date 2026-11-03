-- ===========================================================================
-- 017_notification_delivery.sql
-- Confirmacao real de entrega das mensagens de WhatsApp.
--
-- Por que existe: o painel marcava "Enviada" assim que o sock.sendMessage()
-- do Baileys resolvia -- ou seja, "o socket aceitou", nunca "chegou no
-- aparelho". Quando o WhatsApp descarta a mensagem do lado do servidor (numero
-- novo, conta limitada, bloqueio), o log continuava verde e a mensagem sumia.
--
-- Agora guardamos o id da mensagem no WhatsApp e escutamos os ACKs:
--   provider_message_id = id devolvido pelo Baileys no envio
--   delivered_at        = ACK de entrega no aparelho (DELIVERY_ACK)
--   read_at             = ACK de leitura (READ)
-- ===========================================================================

SET NAMES utf8mb4;

ALTER TABLE notification_jobs
    ADD COLUMN provider_message_id VARCHAR(120) NULL AFTER sent_at,
    ADD COLUMN delivered_at DATETIME NULL AFTER provider_message_id,
    ADD COLUMN read_at DATETIME NULL AFTER delivered_at,
    ADD INDEX idx_notification_jobs_provider_message_id (provider_message_id);
