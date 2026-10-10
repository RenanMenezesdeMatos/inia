-- Ícone e nome de exibição para o colaborador entender, de relance, POR QUE recebeu um feedback (2026-10-06).
--
-- O Acompanhamento mostra o motivo de cada feedback: a flag que disparou a monitoria (ex.: Rechamada, Nota da URA), a rotina,
-- a execução avulsa ou o indicador investigado (ex.: Tempo Médio de Atendimento). A aplicação conhece TIPOS de motivo, nunca
-- flags ou indicadores concretos — por isso ícone e nome são DADOS configurados pelo administrador:
--   * `channel_flags.label`: nome de exibição da flag ("Nota da URA"); sem ele, a tela usa o nome técnico legível.
--   * `channel_flags.icon_key` / `indicator_definitions.icon_key`: chave de um catálogo FECHADO de ícones (validado pela
--     aplicação); sem ela, a tela usa um ícone padrão pelo COMPORTAMENTO (tipo de valor da flag / unidade do indicador).
-- Aditiva: nada existente muda; a constraint só garante o formato da chave (ícone novo no catálogo não exige migration).
alter table channel_flags add column if not exists label text check (label is null or char_length(btrim(label)) between 1 and 60);
alter table channel_flags add column if not exists icon_key text check (icon_key is null or icon_key ~ '^[a-z][a-z0-9-]{1,39}$');
alter table indicator_definitions add column if not exists icon_key text check (icon_key is null or icon_key ~ '^[a-z][a-z0-9-]{1,39}$');
