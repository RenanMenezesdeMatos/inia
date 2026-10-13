-- Limites de atuação do Agent (2026-10-13): até onde o Agent vai, escrito no próprio Agent.
--
-- Um interruptor e um texto. Ligado, o texto entra nas instruções do Agent junto das restrições ("você só atua em: …") e o
-- Agent recusa, em uma frase, o que estiver fora. Desligado, o Agent responde como sempre; o texto fica guardado para quando
-- o interruptor voltar a ser ligado. Os Agents existentes nascem desligados: nada muda sem alguém ligar.
--
-- Substitui a marcação de assuntos proibidos da Governança por Agent ("Restrições específicas deste agente"), que nunca teve
-- efeito no prompt: os assuntos proibidos da Governança valem para todos os Agents.
alter table agents
  add column action_limits_enabled boolean not null default false,
  add column action_limits text,
  add constraint agents_action_limits_check check (
    (action_limits is null or char_length(action_limits) <= 1000)
    and (not action_limits_enabled or (action_limits is not null and btrim(action_limits) <> ''))
  );
