-- CARGOS DA ORGANIZAÇÃO (24/11/2026): o cargo da base do cliente vira CADASTRO, não código. Cada cargo tem o nome que aparece na INIA,
-- os nomes que a base usa para ele (termos) e o PERFIL — o nível da hierarquia (`people.role`) que ele representa. A carga de
-- Colaboradores aceita o nome do cargo no campo de nível, em português, e resolve por aqui; o código do nível continua aceito.
-- Vários cargos podem ter o mesmo perfil ("Operador" e "Assistente de Relacionamento" são OPERATOR). Cargo nunca concede acesso.
--
-- Perfil novo STAFF ("Apoio"): quem está na base mas não atende nem lidera (estagiário, analista, consultor, assistente administrativo).
-- Fica fora de tudo que conta operador (indicadores, populações, universo obrigatório) e não é nível de liderança.

alter table people drop constraint people_role_check;
alter table people add constraint people_role_check
  check (role in ('OPERATOR', 'ADMIN', 'COORDINATOR', 'SUPERVISOR', 'MANAGER', 'SENIOR_MANAGER', 'DIRECTOR', 'STAFF'));

create table job_positions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null check (length(btrim(name)) between 2 and 80),
  -- Perfil: nunca 'ADMIN' (legado "fora da hierarquia", só de cadastro manual).
  level text not null check (level in ('OPERATOR', 'SUPERVISOR', 'COORDINATOR', 'MANAGER', 'SENIOR_MANAGER', 'DIRECTOR', 'STAFF')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

-- Como a base escreve o cargo. `term_key` = termo normalizado pela aplicação (people/domain/job-position.ts): sem acento, maiúsculo,
-- sem pontuação. Um termo aponta para um cargo só na organização. O nome do cargo é sempre um dos termos dele.
create table job_position_terms (
  organization_id uuid not null references organizations(id),
  term_key text not null check (length(term_key) between 1 and 120),
  term text not null check (length(btrim(term)) between 1 and 120),
  job_position_id uuid not null,
  primary key (organization_id, term_key),
  foreign key (organization_id, job_position_id) references job_positions(organization_id, id) on delete cascade
);
create index idx_job_position_terms_position on job_position_terms(job_position_id);

alter table people add column job_position_id uuid;
alter table people add constraint people_job_position_fk foreign key (organization_id, job_position_id) references job_positions(organization_id, id);
create index idx_people_job_position on people(job_position_id) where job_position_id is not null;

-- Cargos iniciais da organização: ponto de partida editável na tela (Central de Dados › Cargos), idempotente por termo.
create function seed_default_job_positions(p_organization_id uuid) returns void language plpgsql as $$
declare
  item record;
  position_id uuid;
begin
  for item in
    select * from (values
      ('Operador', 'OPERATOR', array['OPERADOR', 'OPERADORA', 'ATENDENTE']),
      ('Assistente de Relacionamento', 'OPERATOR', array['ASSISTENTE DE RELACIONAMENTO', 'ASSISTENTE RELACIONAMENTO']),
      ('Supervisor', 'SUPERVISOR', array['SUPERVISOR', 'SUPERVISORA']),
      ('Coordenador', 'COORDINATOR', array['COORDENADOR', 'COORDENADORA']),
      ('Gerente', 'MANAGER', array['GERENTE']),
      ('Gerente Sênior', 'SENIOR_MANAGER', array['GERENTE SENIOR', 'GERENTE SR']),
      ('Diretor', 'DIRECTOR', array['DIRETOR', 'DIRETORA']),
      ('Estagiário', 'STAFF', array['ESTAGIARIO', 'ESTAGIARIA']),
      ('Analista', 'STAFF', array['ANALISTA']),
      ('Consultor', 'STAFF', array['CONSULTOR', 'CONSULTORA']),
      ('Assistente Administrativo', 'STAFF', array['ASSISTENTE ADMINISTRATIVO', 'ASSISTENTE ADMINISTRATIVA'])
    ) as defaults(name, level, terms)
  loop
    continue when exists (select 1 from job_position_terms t where t.organization_id = p_organization_id and t.term_key = any(item.terms));
    insert into job_positions (organization_id, name, level) values (p_organization_id, item.name, item.level) returning id into position_id;
    insert into job_position_terms (organization_id, term_key, term, job_position_id)
      select p_organization_id, term, case when term = item.terms[1] then item.name else initcap(term) end, position_id from unnest(item.terms) term;
  end loop;
end $$;

select seed_default_job_positions(id) from organizations;

-- Escopo/organograma em cache: o cargo da pessoa e o nome dele fazem parte do que é lido.
create or replace function analytics_people_structure_trigger() returns trigger language plpgsql as $fn$
begin
  perform analytics_bump_versions('STRUCTURE', array(
    select unnest(array[n.organization_id, o.organization_id])
      from new_rows n join old_rows o on o.id = n.id
     where (n.organization_id, n.name, n.role, n.reports_to_id, n.team_id, n.subteam_id, n.avatar_url, n.job_title, n.operational_capital_code, n.active, n.operating_universe, n.job_position_id)
           is distinct from (o.organization_id, o.name, o.role, o.reports_to_id, o.team_id, o.subteam_id, o.avatar_url, o.job_title, o.operational_capital_code, o.active, o.operating_universe, o.job_position_id)));
  return null;
end $fn$;
create trigger job_positions_analytics_structure_update after update on job_positions referencing old table as old_rows new table as new_rows for each statement execute function analytics_bump_version_trigger('STRUCTURE');
