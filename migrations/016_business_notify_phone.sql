-- ===========================================================================
-- 016_business_notify_phone.sql
-- Numero que recebe os avisos internos (ex: "sinal recebido").
--
-- Por que existe: o aviso interno ia para businesses.phone, que e o MESMO
-- numero conectado ao robo. O WhatsApp nunca notifica as suas proprias
-- mensagens (elas caem na conversa "Mensagem para voce mesmo"), entao o aviso
-- era aceito pelo WhatsApp mas nunca chegava no aparelho.
-- notify_phone deve ser um segundo numero (ex: WhatsApp pessoal da gestora).
-- ===========================================================================

SET NAMES utf8mb4;

ALTER TABLE businesses
    ADD COLUMN notify_phone VARCHAR(30) NULL AFTER phone;
