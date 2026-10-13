-- Remove a marcação de assuntos proibidos por Agent (2026-10-13).
--
-- "Restrições específicas deste agente" gravava vínculos aqui, mas o prompt sempre recebeu todos os assuntos ativos da
-- organização: a marcação nunca teve efeito. O limite de um Agent agora é escrito no próprio Agent (migration 124) e os
-- assuntos proibidos da Governança valem para todos os Agents. O código não lê nem grava mais esta tabela; o Histórico de
-- cada Agent continua guardando e exibindo as marcações antigas (campo `prohibitedTopicIds`).
drop table agent_prohibited_topics;
