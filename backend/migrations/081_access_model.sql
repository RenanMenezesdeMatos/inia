-- V1.5.7 — ACCESS MODEL FOUNDATION: contas × papéis × permissões × escopos
--
-- Separa definitivamente a REALIDADE ORGANIZACIONAL (people: matrícula, cargo/job_title, nível hierárquico people.role,
-- grupo, subgrupo, reports_to — vinda da carga do cliente) do ACESSO ao INIA (quem pode fazer o quê). Importar ou alterar
-- um colaborador NUNCA concede privilégio: acesso só existe como ATRIBUIÇÃO explícita de um PAPEL (pacote de permissões,
-- catálogo em modules/access/domain/roles.ts) a uma CONTA de usuário (user_accounts), num ESCOPO estruturado.
--
-- Aditiva. Tabelas legadas NÃO são alteradas nem apagadas; deixam de ser lidas pelo código:
--   user_role_assignments              → papéis ADMIN escopados (migrados abaixo);
--   feedback_quality_reviewer_grants   → capability de QA da V1.5.5 (migrada abaixo para o papel QA_DE_FEEDBACK).

create table access_role_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  user_account_id uuid not null references user_accounts(id) on delete cascade,
  -- Código do papel (sistema hoje; papéis do tenant no futuro). Validado pela aplicação contra o catálogo.
  role_code text not null check (role_code ~ '^[A-Z][A-Z0-9_]{1,59}$'),
  scope_type text not null check (scope_type in ('ORGANIZATION', 'GROUP', 'SUBGROUP', 'MY_STRUCTURE')),
  team_id uuid references teams(id),
  subteam_id uuid references subteams(id),
  -- De onde veio: concessão manual pela UI/API ou migração de um modelo legado (auditoria).
  source text not null default 'MANUAL' check (source in ('MANUAL', 'MIGRATION_LEGACY_ADMIN', 'MIGRATION_FEEDBACK_QA_GRANT')),
  granted_by_account_id uuid references user_accounts(id),
  granted_at timestamptz not null,
  -- Revogar nunca apaga: o histórico de quem teve qual papel permanece.
  revoked_at timestamptz,
  revoked_by_account_id uuid references user_accounts(id),
  revocation_reason text check (revocation_reason is null or length(revocation_reason) <= 500),
  check (
    (scope_type in ('ORGANIZATION', 'MY_STRUCTURE') and team_id is null and subteam_id is null)
    or (scope_type = 'GROUP' and team_id is not null and subteam_id is null)
    or (scope_type = 'SUBGROUP' and subteam_id is not null and team_id is null)
  ),
  check (revoked_at is not null or revoked_by_account_id is null)
);
create unique index access_role_assignments_active_idx on access_role_assignments (
  user_account_id, role_code, scope_type, coalesce(team_id, '00000000-0000-0000-0000-000000000000'), coalesce(subteam_id, '00000000-0000-0000-0000-000000000000')
) where revoked_at is null;
create index access_role_assignments_org_idx on access_role_assignments (organization_id, role_code) where revoked_at is null;

-- 1) Administradores legados. Antes: people.role = 'ADMIN' passava pelo guard administrativo; sem nenhuma linha ADMIN em
--    user_role_assignments (ou com ALL_TEAMS) era "administrador global" (QA Lab, IA). Agora isso vira papel explícito:
--    global → ADMINISTRADOR_GERAL (organização); escopado por Grupo/Subgrupo → ADMINISTRADOR no mesmo escopo.
--    Linhas de user_role_assignments com papel ≠ ADMIN nunca tiveram efeito (só ADMIN era lido) — não são migradas.
insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, source, granted_at)
select ua.organization_id, ua.id, 'ADMINISTRADOR_GERAL', 'ORGANIZATION', 'MIGRATION_LEGACY_ADMIN', now()
from user_accounts ua join people p on p.id = ua.person_id
where p.role = 'ADMIN'
  and (
    not exists (select 1 from user_role_assignments ura where ura.person_id = p.id and ura.role = 'ADMIN')
    or exists (select 1 from user_role_assignments ura where ura.person_id = p.id and ura.role = 'ADMIN' and ura.scope_type = 'ALL_TEAMS')
  );

insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, subteam_id, source, granted_at)
select distinct ua.organization_id, ua.id, 'ADMINISTRADOR', case ura.scope_type when 'TEAM' then 'GROUP' else 'SUBGROUP' end, ura.team_id, ura.subteam_id, 'MIGRATION_LEGACY_ADMIN', now()
from user_role_assignments ura
join people p on p.id = ura.person_id and p.role = 'ADMIN'
join user_accounts ua on ua.person_id = p.id
where ura.role = 'ADMIN' and ura.scope_type in ('TEAM', 'SUBTEAM')
  and not exists (select 1 from user_role_assignments g where g.person_id = p.id and g.role = 'ADMIN' and g.scope_type = 'ALL_TEAMS')
on conflict do nothing;

-- 2) QA de feedback (V1.5.5, migration 079): concessões ATIVAS viram o papel QA_DE_FEEDBACK com o escopo equivalente
--    (SUBTREE → MY_STRUCTURE, TEAM → GROUP, SUBTEAM → SUBGROUP, ORGANIZATION → ORGANIZATION). Concessão de pessoa SEM conta
--    de acesso não tem a quem ser atribuída (acesso é sempre de uma conta) e fica só no histórico da 079.
insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, subteam_id, source, granted_by_account_id, granted_at)
select g.organization_id, ua.id, 'QA_DE_FEEDBACK',
       case g.scope_type when 'SUBTREE' then 'MY_STRUCTURE' when 'TEAM' then 'GROUP' when 'SUBTEAM' then 'SUBGROUP' else 'ORGANIZATION' end,
       g.team_id, g.subteam_id, 'MIGRATION_FEEDBACK_QA_GRANT', grantor.id, g.granted_at
from feedback_quality_reviewer_grants g
join user_accounts ua on ua.person_id = g.person_id and ua.organization_id = g.organization_id
left join user_accounts grantor on grantor.person_id = g.granted_by
where g.revoked_at is null
on conflict do nothing;
