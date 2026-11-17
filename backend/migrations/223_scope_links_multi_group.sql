-- ALCANCE POR VÁRIOS GRUPOS (17/11/2026) — Bases de Conhecimento, Comunicados, Alinhamentos Operacionais e Argumentários.
-- Ver docs/dev/memoria/alcance-multigrupo.md.
--
-- Um mesmo conteúdo atende VÁRIOS Grupos com um único cadastro (mesmo id, conteúdo e histórico). Cada VÍNCULO aponta para exatamente um
-- Grupo e, quando há recorte por Subgrupo, para UM Subgrupo daquele Grupo:
--   (team_id = A, subteam_id = null) → o Grupo A inteiro (o mesmo significado que TEAM já tinha);
--   (team_id = B, subteam_id = B1)   → só o Subgrupo B1 do Grupo B.
-- A integridade "o Subgrupo pertence àquele Grupo" é do BANCO (FK composta para subteams(id, team_id)), não só do serviço.
-- O escopo global de cada conteúdo NÃO é vínculo: continua atributo do próprio conteúdo (ALL_TEAMS / UNIVERSE / ORGANIZATION).
--
-- Estrutura: uma tabela de vínculos POR ENTIDADE (FK real para o conteúdo; nada de tabela polimórfica sem integridade):
--   knowledge_document_org_scopes        (já existia, 008: é endurecida aqui — Grupo-pai obrigatório no Subgrupo, sem duplicata);
--   argument_script_version_scopes       (nova; o escopo passa a ser da VERSÃO, como o conteúdo — sai do par da linha);
--   operational_alignment_version_scopes (nova; o público é da VERSÃO, que é imutável depois de publicada);
--   communication_segment_scopes         (nova; substitui os arrays segment_team_ids/segment_subteam_ids, sem FK).
-- As colunas antigas de escopo único são REMOVIDAS depois do backfill: uma fonte de verdade só.
--
-- Backfill: cada registro de escopo único vira um vínculo, preservando ids e o acesso atual. Ausência de dado NUNCA vira acesso global:
-- registro com recorte por Grupo/Subgrupo cujo Grupo/Subgrupo não existe mais fica SEM vínculo (não alcança ninguém por Grupo) e é
-- listado num NOTICE para regularização.

-- Alvo das FKs compostas (o par já é único porque `id` é a chave).
create unique index if not exists subteams_id_team_unique on subteams (id, team_id);

-- ─────────────────────────────── BASES DE CONHECIMENTO ───────────────────────────────
-- SUBTEAM sem team_id (permitido pela 008) recebe o Grupo-pai real; team_id divergente do pai real é corrigido para o pai (o acesso
-- sempre foi decidido pelo subteam_id nas leituras do vínculo SUBTEAM).
update knowledge_document_org_scopes os set team_id = st.team_id
  from subteams st where os.scope_type = 'SUBTEAM' and st.id = os.subteam_id and os.team_id is distinct from st.team_id;

do $$
declare orphan_count integer;
begin
  select count(*) into orphan_count from knowledge_document_org_scopes os
   where os.scope_type = 'SUBTEAM' and not exists (select 1 from subteams st where st.id = os.subteam_id);
  if orphan_count > 0 then raise notice '223: % alcance(s) de base com Subgrupo inexistente removido(s) (não alcançavam ninguém).', orphan_count; end if;
end $$;
delete from knowledge_document_org_scopes os where os.scope_type = 'SUBTEAM' and not exists (select 1 from subteams st where st.id = os.subteam_id);

-- Duplicatas exatas (mesmo documento, tipo, Grupo e Subgrupo): fica uma.
delete from knowledge_document_org_scopes a using knowledge_document_org_scopes b
 where a.knowledge_document_id = b.knowledge_document_id and a.scope_type = b.scope_type
   and a.team_id is not distinct from b.team_id and a.subteam_id is not distinct from b.subteam_id and a.id > b.id;

-- Escritores antigos (provas, sementes congeladas, SQL direto) gravam SUBTEAM sem o Grupo: o banco completa com o Grupo-pai REAL (e
-- corrige um Grupo divergente) antes das checagens — o vínculo nunca aponta para um Grupo que não é o do Subgrupo.
create or replace function knowledge_document_org_scopes_fill_team() returns trigger language plpgsql as $$
begin
  if new.scope_type = 'SUBTEAM' and new.subteam_id is not null then
    select st.team_id into new.team_id from subteams st where st.id = new.subteam_id;
  end if;
  return new;
end $$;
create trigger knowledge_document_org_scopes_fill_team before insert or update on knowledge_document_org_scopes
  for each row execute function knowledge_document_org_scopes_fill_team();

alter table knowledge_document_org_scopes drop constraint if exists knowledge_document_org_scopes_check;
alter table knowledge_document_org_scopes add constraint knowledge_document_org_scopes_shape check (
  (scope_type = 'ALL_TEAMS' and team_id is null and subteam_id is null) or
  (scope_type = 'TEAM' and team_id is not null and subteam_id is null) or
  (scope_type = 'SUBTEAM' and team_id is not null and subteam_id is not null)
);
alter table knowledge_document_org_scopes add constraint knowledge_document_org_scopes_subteam_of_team
  foreign key (subteam_id, team_id) references subteams (id, team_id);
create unique index if not exists knowledge_document_org_scopes_unique on knowledge_document_org_scopes (knowledge_document_id, scope_type, team_id, subteam_id) nulls not distinct;
create index if not exists knowledge_document_org_scopes_team on knowledge_document_org_scopes (team_id) where team_id is not null;
create index if not exists knowledge_document_org_scopes_subteam on knowledge_document_org_scopes (subteam_id) where subteam_id is not null;

-- ─────────────────────────────── ARGUMENTÁRIOS ───────────────────────────────
-- O escopo passa a ser da VERSÃO (como o conteúdo): a análise de uma chamada usa a versão vigente NA DATA DA CHAMADA, então incluir ou
-- remover um Grupo vale a partir da publicação da nova versão e nunca reescreve a quem a regra valia antes (era por isso que o escopo de
-- um argumentário publicado ficava travado). Versão publicada continua imutável — agora também no escopo e nos vínculos.
alter table argument_script_versions add column if not exists scope_type text;
update argument_script_versions v set scope_type = case when s.scope_type = 'ALL_TEAMS' then 'ALL_TEAMS' else 'GROUPS' end
  from argument_scripts_all s where s.id = v.script_id;
alter table argument_script_versions alter column scope_type set not null;
alter table argument_script_versions add constraint argument_script_versions_scope_type_check check (scope_type in ('ALL_TEAMS', 'GROUPS'));

create table if not exists argument_script_version_scopes (
  version_id uuid not null references argument_script_versions (id) on delete cascade,
  organization_id uuid not null references organizations (id),
  team_id uuid not null references teams (id),
  subteam_id uuid,
  foreign key (subteam_id, team_id) references subteams (id, team_id)
);
create unique index if not exists argument_script_version_scopes_unique on argument_script_version_scopes (version_id, team_id, subteam_id) nulls not distinct;
create index if not exists argument_script_version_scopes_team on argument_script_version_scopes (organization_id, team_id);
create index if not exists argument_script_version_scopes_subteam on argument_script_version_scopes (organization_id, subteam_id) where subteam_id is not null;

insert into argument_script_version_scopes (version_id, organization_id, team_id, subteam_id)
select v.id, v.organization_id, s.team_id, null from argument_script_versions v join argument_scripts_all s on s.id = v.script_id
 where s.scope_type = 'TEAM' and exists (select 1 from teams t where t.id = s.team_id)
union all
select v.id, v.organization_id, st.team_id, st.id from argument_script_versions v join argument_scripts_all s on s.id = v.script_id join subteams st on st.id = s.subteam_id
 where s.scope_type = 'SUBTEAM'
on conflict do nothing;

do $$
declare orphan_count integer;
begin
  select count(*) into orphan_count from argument_scripts_all s
   where s.scope_type in ('TEAM', 'SUBTEAM') and not exists (
     select 1 from argument_script_versions v join argument_script_version_scopes l on l.version_id = v.id where v.script_id = s.id);
  if orphan_count > 0 then raise notice '223: % argumentário(s) com Grupo/Subgrupo inexistente ficaram sem vínculo (não valem para ninguém por Grupo).', orphan_count; end if;
end $$;

-- Imutabilidade do escopo da versão publicada (a função da 105 cobre o conteúdo; esta cobre o escopo e os vínculos).
create or replace function argument_script_version_scope_immutable() returns trigger language plpgsql as $$
begin
  if old.status in ('PUBLISHED', 'SUPERSEDED') and new.scope_type is distinct from old.scope_type then
    raise exception 'Escopo de versão publicada de argumentário é imutável.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger argument_script_version_scope_immutable before update on argument_script_versions
  for each row execute function argument_script_version_scope_immutable();

create or replace function argument_script_version_links_immutable() returns trigger language plpgsql as $$
declare version_status text;
begin
  if pg_trigger_depth() > 1 then return case when tg_op = 'DELETE' then old else new end; end if; -- cascata do argumentário/rascunho
  select status into version_status from argument_script_versions where id = case when tg_op = 'DELETE' then old.version_id else new.version_id end;
  if version_status in ('PUBLISHED', 'SUPERSEDED') then
    raise exception 'Vínculos de versão publicada de argumentário são imutáveis.' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger argument_script_version_links_immutable before insert or update or delete on argument_script_version_scopes
  for each row execute function argument_script_version_links_immutable();

drop view if exists argument_scripts;
drop index if exists argument_scripts_scope_idx;
alter table argument_scripts_all drop column scope_type, drop column team_id, drop column subteam_id;

create or replace function pg_temp.refresh_logical_view(target text) returns void language plpgsql as $fn$
declare view_columns text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into view_columns
    from information_schema.columns
   where table_schema = 'public' and table_name = target || '_all' and column_name not in ('deleted_at', 'deleted_by_person_id');
  execute format('create or replace view %I as select %s from %I where deleted_at is null', target, view_columns, target || '_all');
end
$fn$;
select pg_temp.refresh_logical_view('argument_scripts');

-- ─────────────────────────────── ALINHAMENTOS OPERACIONAIS ───────────────────────────────
-- O público é da VERSÃO (imutável depois de publicada): os vínculos também. Rascunho troca os vínculos; versão publicada nunca.
create table if not exists operational_alignment_version_scopes (
  version_id uuid not null references operational_alignment_versions (id) on delete cascade,
  organization_id uuid not null references organizations (id),
  team_id uuid not null references teams (id),
  subteam_id uuid,
  foreign key (subteam_id, team_id) references subteams (id, team_id)
);
create unique index if not exists operational_alignment_version_scopes_unique on operational_alignment_version_scopes (version_id, team_id, subteam_id) nulls not distinct;
create index if not exists operational_alignment_version_scopes_team on operational_alignment_version_scopes (organization_id, team_id);
create index if not exists operational_alignment_version_scopes_subteam on operational_alignment_version_scopes (organization_id, subteam_id) where subteam_id is not null;

insert into operational_alignment_version_scopes (version_id, organization_id, team_id, subteam_id)
select v.id, v.organization_id, v.team_id, null from operational_alignment_versions v
 where v.scope_type = 'TEAM' and exists (select 1 from teams t where t.id = v.team_id)
union all
select v.id, v.organization_id, st.team_id, st.id from operational_alignment_versions v join subteams st on st.id = v.subteam_id
 where v.scope_type = 'SUBTEAM'
on conflict do nothing;

do $$
declare orphan_count integer;
begin
  select count(*) into orphan_count from operational_alignment_versions v
   where v.scope_type in ('TEAM', 'SUBTEAM') and not exists (select 1 from operational_alignment_version_scopes l where l.version_id = v.id);
  if orphan_count > 0 then raise notice '223: % versão(ões) de alinhamento com Grupo/Subgrupo inexistente ficaram sem vínculo (não alcançam ninguém).', orphan_count; end if;
end $$;

alter table operational_alignment_versions drop constraint if exists operational_alignment_versions_check1;
alter table operational_alignment_versions drop constraint if exists operational_alignment_versions_check2;
alter table operational_alignment_versions drop constraint if exists operational_alignment_versions_scope_type_check;
do $$
declare constraint_name text;
begin
  -- A checagem antiga de forma (UNIVERSE/TEAM/SUBTEAM × team_id/subteam_id) tem nome gerado: removida pela definição.
  for constraint_name in select conname from pg_constraint where conrelid = 'operational_alignment_versions'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%subteam_id%'
  loop execute format('alter table operational_alignment_versions drop constraint %I', constraint_name); end loop;
end $$;
update operational_alignment_versions set scope_type = 'GROUPS' where scope_type in ('TEAM', 'SUBTEAM');
alter table operational_alignment_versions drop column team_id, drop column subteam_id;
alter table operational_alignment_versions add constraint operational_alignment_versions_scope_type_check check (scope_type in ('UNIVERSE', 'GROUPS'));

-- ─────────────────────────────── COMUNICADOS ───────────────────────────────
-- Público SEGMENT: universo (opcional) E (qualquer vínculo). Os arrays da 220 eram uma UNIÃO (Grupo inteiro OU Subgrupo) sem FK e sem o
-- Grupo do Subgrupo; viram vínculos com o mesmo alcance. Subgrupo de um Grupo que já estava inteiro não acrescentava ninguém: some.
create table if not exists communication_segment_scopes (
  communication_id uuid not null references communications (id),
  organization_id uuid not null references organizations (id),
  team_id uuid not null references teams (id),
  subteam_id uuid,
  foreign key (subteam_id, team_id) references subteams (id, team_id)
);
create unique index if not exists communication_segment_scopes_unique on communication_segment_scopes (communication_id, team_id, subteam_id) nulls not distinct;
create index if not exists communication_segment_scopes_team on communication_segment_scopes (organization_id, team_id);
create index if not exists communication_segment_scopes_subteam on communication_segment_scopes (organization_id, subteam_id) where subteam_id is not null;

insert into communication_segment_scopes (communication_id, organization_id, team_id, subteam_id)
select c.id, c.organization_id, t.id, null from communications c cross join lateral unnest(c.segment_team_ids) as ids(team_id) join teams t on t.id = ids.team_id
union all
select c.id, c.organization_id, st.team_id, st.id from communications c cross join lateral unnest(c.segment_subteam_ids) as ids(subteam_id) join subteams st on st.id = ids.subteam_id
 where not (st.team_id = any(c.segment_team_ids))
on conflict do nothing;

-- Recorte que tinha Grupo/Subgrupo e ficou SEM vínculo (todos apagados): antes não alcançava ninguém; sem vínculo, o leitor trataria
-- como o universo inteiro (ou a organização). Para nunca ABRIR o público na migração, esses comunicados saem do ar (arquivados,
-- reversível pela tela, que mostra o público antes de republicar) e o rascunho continua rascunho (run-6 MG-01).
do $$
declare orphan_count integer;
begin
  with orphans as (
    select c.id from communications c
     where c.audience = 'SEGMENT' and (cardinality(c.segment_team_ids) > 0 or cardinality(c.segment_subteam_ids) > 0)
       and not exists (select 1 from communication_segment_scopes l where l.communication_id = c.id)
  ), archived as (
    update communications c set status = 'ARCHIVED', archived_at = now(), updated_at = now()
      from orphans o where c.id = o.id and c.status = 'PUBLISHED'
    returning c.id
  )
  select (select count(*) from orphans) into orphan_count;
  if orphan_count > 0 then raise notice '223: % comunicado(s) por recorte ficaram sem Grupo/Subgrupo existente; os publicados foram arquivados (sem vínculo o público abriria para o universo/organização).', orphan_count; end if;
end $$;

drop index if exists communications_segment_feed;
alter table communications drop constraint if exists communications_segment_check;
alter table communications drop column segment_team_ids, drop column segment_subteam_ids;
create index if not exists communications_segment_feed on communications (organization_id, published_at desc, id desc) where deleted_at is null and audience = 'SEGMENT' and status = 'PUBLISHED';
