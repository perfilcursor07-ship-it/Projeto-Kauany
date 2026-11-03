-- ===========================================================================
-- 018_notification_server_ack.sql
-- Separa "o servidor do WhatsApp confirmou" de "chegou no aparelho".
--
-- Sem essa coluna, uma mensagem sem ACK de entrega e ambigua: pode ser o
-- WhatsApp descartando a mensagem OU o nosso listener de ACK nao funcionando.
-- Com server_ack_at da para distinguir:
--   server_ack_at vazio  -> nenhum ACK chegou (listener ou conexao)
--   server_ack_at cheio e delivered_at vazio -> o WhatsApp aceitou e descartou
-- ===========================================================================

SET NAMES utf8mb4;

ALTER TABLE notification_jobs
    ADD COLUMN server_ack_at DATETIME NULL AFTER provider_message_id;
