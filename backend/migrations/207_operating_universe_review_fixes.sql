-- Correções da revisão do universo de atuação (auditoria run-4, 17/11/2026). Idempotente.
--
-- 1) UB-01: a 204 transformou TODO universo gravado pessoa a pessoa (197) em exceção. Exceção igual ao universo que a pessoa já
--    herdaria do Subgrupo/Grupo dela não é exceção: só impedia a pessoa de acompanhar o Grupo quando ele muda de universo. Essas
--    exceções redundantes saem — o universo calculado não muda (nenhuma vigência nova é aberta) e a pessoa passa a herdar. A
--    exceção DIFERENTE do Grupo (ou com o Grupo ainda sem universo) continua valendo.
update people
   set operating_universe_override = null
 where operating_universe_override is not null
   and operating_universe_override = resolve_person_operating_universe(null, team_id, subteam_id);

-- 2) UB-06: vigência informada ANTES do início do período aberto era trazida para o início dele (204) e o gatilho fechava o período
--    aberto nesse mesmo instante — sobrava um período de duração zero que ainda casava com a competência do mês. Agora, quando a
--    vigência cai no início do período aberto (ou antes dele), o período aberto troca de universo no lugar: nenhum período vazio.
--    Mesmo corpo da 204 no resto.
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
  if v_open is not null and v_from <= v_open then
    update person_operating_universe_history set operating_universe = new.operating_universe where person_id = new.id and valid_until is null;
    return new;
  end if;
  update person_operating_universe_history set valid_until = v_from where person_id = new.id and valid_until is null;
  insert into person_operating_universe_history (organization_id, person_id, operating_universe, valid_from) values (new.organization_id, new.id, new.operating_universe, v_from);
  return new;
end
$fn$;
