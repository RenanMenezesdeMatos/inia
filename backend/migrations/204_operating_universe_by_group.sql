-- UNIVERSO DE ATUAÇÃO NO GRUPO (16/11/2026, decisão do usuário). O universo é declarado no GRUPO (carga de Grupos), opcionalmente no
-- SUBGRUPO (quando difere do Grupo-pai), e o OPERADOR herda do lugar onde está. Na pessoa fica só a EXCEÇÃO explícita (a base do
-- cliente marca quem é diferente do Grupo). `people.operating_universe` continua existindo, agora CALCULADO pelo banco:
--   exceção da pessoa → universo do Subgrupo → universo do Grupo → nulo (pendente).
-- Liderança não precisa de universo (vê a própria estrutura em qualquer universo — regra na aplicação). Uma pessoa atua em um
-- universo só (resposta do usuário: "hoje não, ou é B2C, ou B2B ou B2X").
-- Vigência: a carga pode informar "universo vigente desde" (no Grupo, no Subgrupo ou na exceção da pessoa); sem ela, vale o momento da
-- carga. Nunca antes do início da vigência atual nem no futuro.

-- Idempotente (auditoria run-4, UB-11): reaplicar não falha nem repete o legado abaixo.
alter table teams
  add column if not exists operating_universe text check (operating_universe in ('B2B', 'B2C', 'B2X')),
  add column if not exists operating_universe_effective_from date;
alter table subteams
  add column if not exists operating_universe text check (operating_universe in ('B2B', 'B2C', 'B2X')),
  add column if not exists operating_universe_effective_from date;

-- Legado da 197: o universo gravado pessoa a pessoa foi uma declaração explícita — vira exceção (nada se perde). Quem quiser que a
-- pessoa passe a herdar do Grupo limpa a exceção na ficha. (A 207 limpa as exceções iguais ao universo do Grupo/Subgrupo.) Só na
-- primeira aplicação: o legado é copiado no mesmo passo em que a coluna nasce.
do $mig$
begin
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'people' and column_name = 'operating_universe_override') then
    alter table people add column operating_universe_override text check (operating_universe_override in ('B2B', 'B2C', 'B2X'));
    update people set operating_universe_override = operating_universe where operating_universe is not null;
  end if;
end
$mig$;
alter table people add column if not exists operating_universe_effective_from date;

create or replace function resolve_person_operating_universe(p_override text, p_team_id uuid, p_subteam_id uuid) returns text language sql stable as $fn$
  select coalesce(p_override, (select st.operating_universe from subteams st where st.id = p_subteam_id), (select t.operating_universe from teams t where t.id = p_team_id))
$fn$;

-- Cálculo na própria linha (antes de gravar): toda escrita em people passa por aqui — Pessoas, Central de Dados, seeds.
create or replace function people_resolve_operating_universe() returns trigger language plpgsql as $fn$
begin
  new.operating_universe := resolve_person_operating_universe(new.operating_universe_override, new.team_id, new.subteam_id);
  return new;
end
$fn$;
drop trigger if exists people_resolve_operating_universe on people;
create trigger people_resolve_operating_universe before insert or update of operating_universe_override, team_id, subteam_id, operating_universe on people
  for each row execute function people_resolve_operating_universe();

-- Vigência (substitui a função da 197): o "vigente desde" vem da carga — da pessoa (exceção) ou do Grupo/Subgrupo que mudou, passado
-- por `inia.universe_effective_from` na mesma transação. O gatilho passa a valer para QUALQUER update (o universo agora muda também
-- quando o cálculo muda, sem a coluna estar no SET).
create or replace function track_person_operating_universe() returns trigger language plpgsql as $fn$
declare
  v_from timestamptz;
  v_open timestamptz;
begin
  if tg_op = 'INSERT' then
    insert into person_operating_universe_history (organization_id, person_id, operating_universe, valid_from) values (new.organization_id, new.id, new.operating_universe, '-infinity');
    return new;
  end if;
  if new.operating_universe is not distinct from old.operating_universe then
    return new;
  end if;
  if old.operating_universe is null and not exists (
    select 1 from person_operating_universe_history h where h.person_id = new.id and h.operating_universe is not null
  ) then
    -- Primeira classificação: o período anterior (legado sem universo) e os casos sem carimbo ficam com o universo declarado agora.
    update person_operating_universe_history set operating_universe = new.operating_universe where person_id = new.id and operating_universe is null;
    update supervision_cases set operating_universe = new.operating_universe where operator_id = new.id and operating_universe is null;
    if not exists (select 1 from person_operating_universe_history h where h.person_id = new.id) then
      insert into person_operating_universe_history (organization_id, person_id, operating_universe, valid_from) values (new.organization_id, new.id, new.operating_universe, '-infinity');
    end if;
    return new;
  end if;
  v_from := coalesce(
    nullif(current_setting('inia.universe_effective_from', true), '')::timestamptz,
    case when new.operating_universe_effective_from is distinct from old.operating_universe_effective_from then new.operating_universe_effective_from::timestamptz end,
    now());
  select valid_from into v_open from person_operating_universe_history where person_id = new.id and valid_until is null;
  v_from := least(v_from, now());
  if v_open is not null and v_from < v_open then v_from := v_open; end if;
  update person_operating_universe_history set valid_until = v_from where person_id = new.id and valid_until is null;
  insert into person_operating_universe_history (organization_id, person_id, operating_universe, valid_from) values (new.organization_id, new.id, new.operating_universe, v_from);
  return new;
end
$fn$;
drop trigger if exists people_track_operating_universe on people;
create trigger people_track_operating_universe after insert or update on people for each row execute function track_person_operating_universe();

-- Grupo ou Subgrupo mudou de universo: as pessoas dele são recalculadas (a exceção de cada uma continua valendo), com a vigência do
-- Grupo/Subgrupo quando a carga a informou.
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
drop trigger if exists teams_propagate_operating_universe on teams;
create trigger teams_propagate_operating_universe after update of operating_universe on teams for each row execute function propagate_unit_operating_universe();
drop trigger if exists subteams_propagate_operating_universe on subteams;
create trigger subteams_propagate_operating_universe after update of operating_universe on subteams for each row execute function propagate_unit_operating_universe();

create index if not exists teams_operating_universe_pending_idx on teams (organization_id) where operating_universe is null;
