-- Apoio com Anjo (decisão do responsável em 10/11/2026): quando o atendimento do Anjo termina, a conversa com a INIA de onde o
-- pedido saiu é encerrada — o assunto foi resolvido (ou levado adiante) com uma pessoa, e a próxima pergunta abre conversa nova.
-- Motivo próprio no histórico ("Encerrada após o apoio do Anjo"), separado do encerramento manual e da inatividade.
alter table assistant_conversations drop constraint if exists assistant_conversations_close_reason_check;
alter table assistant_conversations add constraint assistant_conversations_close_reason_check
  check (close_reason in ('MANUAL', 'INACTIVITY', 'LEGACY', 'COMPLETED', 'HUMAN_SUPPORT'));
