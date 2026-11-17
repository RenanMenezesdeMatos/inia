-- Correções da revisão do universo de atuação (17/11/2026). Idempotente.
--
-- 1) organizations.operating_universe_enforced_by (197) tinha FK para people. organizations é tabela MANTIDA pela limpeza da
--    instalação (installation.ts, KEEP_TABLES) e people é esvaziada com TRUNCATE … CASCADE: com a FK, o CASCADE esvaziaria
--    organizations junto — por isso a limpeza recusa ("organizations → people") e a primeira instalação parava. `on delete set null`
--    não resolve (TRUNCATE ignora a ação da FK e cascateia pela simples existência dela). A coluna é só o registro de quem ligou a
--    exigência (o fato auditável fica em audit_logs); sem FK, também deixa de impedir o apagamento físico de uma pessoa (ver 205).
alter table organizations drop constraint if exists organizations_operating_universe_enforced_by_fkey;

-- 2) UB-08: a propagação do universo do Grupo/Subgrupo para as pessoas (204) filtrava só por team_id/subteam_id, sem
--    organization_id — os índices de people começam por organization_id e não eram usados. Mesmo corpo da 204 + o filtro.
create or replace function propagate_unit_operating_universe() returns trigger language plpgsql as $fn$
begin
  if new.operating_universe is not distinct from old.operating_universe then
    return new;
  end if;
  perform set_config('inia.universe_effective_from', coalesce(new.operating_universe_effective_from::text, ''), true);
  if tg_table_name = 'teams' then
    update people set operating_universe = null where organization_id = new.organization_id and team_id = new.id and operating_universe_override is null;
  else
    update people set operating_universe = null where organization_id = new.organization_id and subteam_id = new.id and operating_universe_override is null;
  end if;
  perform set_config('inia.universe_effective_from', '', true);
  return new;
end
$fn$;
