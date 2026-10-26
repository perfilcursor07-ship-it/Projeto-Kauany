-- Atualiza os textos padrão do negócio inicial para confirmação e lembretes.
UPDATE notification_templates
SET body = CASE trigger_key
    WHEN 'confirmed' THEN '{cliente}, seu horário foi agendado!\n\n{data} às {hora}\nServiço: {servico}\nValor: {valor}\n\nEndereço: {endereco}\n\nTe espero no horário combinado! ✨'
    WHEN 'reminder_24h' THEN '{saudacao}, {cliente}! ✨\n\nPassando para te lembrar do seu horário agendado amanhã às {hora}.\n\nEm caso de atraso, temos uma tolerância de 10 minutos e, se possível, venha sem acompanhante. Esse momento é todo seu, te aguardo!'
    WHEN 'reminder_2h' THEN '{saudacao}, {cliente}! ✨\n\nPassando para te lembrar do seu horário agendado hoje às {hora}.\n\nNão esqueça de sair com antecedência para evitar o cancelamento automático do seu horário. ✨\n\nLocalização: {localizacao}'
    ELSE body
END
WHERE business_id = 1
  AND channel = 'whatsapp'
  AND trigger_key IN ('confirmed', 'reminder_24h', 'reminder_2h');
