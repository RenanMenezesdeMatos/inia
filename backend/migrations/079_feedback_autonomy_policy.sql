-- V1.5.5 — FEEDBACK AUTONOMY POLICY + QA REFRAME
--
-- Separa GERAÇÃO do feedback de AVALIAÇÃO DE QUALIDADE (QA). A revisão humana deixa de ser requisito intrínseco do
-- feedback e passa a ser uma política de rollout: cada item recebe uma disposição DETERMINÍSTICA
-- (AUTO_DELIVER | HOLD_FOR_QA | BLOCKED) gravada com a versão da política e os motivos. Aditiva: nenhuma coluna existente
-- muda de significado; nenhum dado é apagado; as revisões da V1.5.4 continuam intactas.
--
--   interaction_feedback_delivery_decisions → a disposição de CADA item de colaborador (inclusive os BLOCKED, que nunca
--                                             têm redação), a política que decidiu, os motivos, se os critérios de
--                                             autonomia foram atendidos (independente da política) e a entrega real.
--   interaction_feedback_item_reviews       → passa a aceitar NOT_SELECTED_FOR_QA (item AUTO_DELIVER: tem redação, não
--                                             tem avaliação). PENDING_REVIEW = selecionado para QA, ainda não avaliado.
--   feedback_quality_reviewer_grants        → capability EXPLÍCITA de QA de feedback (FEEDBACK_QUALITY_REVIEW), com
--                                             escopo. Nenhum papel a recebe implicitamente — nem Admin.

alter table interaction_feedback_item_reviews drop constraint interaction_feedback_item_reviews_review_status_check;
alter table interaction_feedback_item_reviews add constraint interaction_feedback_item_reviews_review_status_check
  check (review_status in ('PENDING_REVIEW', 'APPROVED_UNCHANGED', 'APPROVED_EDITED', 'REJECTED', 'NOT_SELECTED_FOR_QA'));
alter table interaction_feedback_item_reviews drop constraint interaction_feedback_item_reviews_check;
alter table interaction_feedback_item_reviews add constraint interaction_feedback_item_reviews_check check (
  (review_status in ('PENDING_REVIEW', 'NOT_SELECTED_FOR_QA') and final_wording is null and reviewed_by is null and reviewed_at is null)
  or (review_status = 'APPROVED_UNCHANGED' and final_wording is null and reviewed_by is not null and reviewed_at is not null)
  or (review_status = 'APPROVED_EDITED' and final_wording is not null and reason_category is not null and reviewed_by is not null and reviewed_at is not null)
  or (review_status = 'REJECTED' and final_wording is null and reason_category is not null and reviewed_by is not null and reviewed_at is not null)
);

create table interaction_feedback_delivery_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  run_id uuid not null references interaction_feedback_runs(id) on delete cascade,
  item_index integer not null,
  section text not null check (section in ('STRENGTH', 'OPPORTUNITY')),
  finding_kind text not null,
  structural_state text not null check (structural_state in ('STRUCTURALLY_DELIVERABLE', 'BLOCKED')),
  disposition text not null check (disposition in ('AUTO_DELIVER', 'HOLD_FOR_QA', 'BLOCKED')),
  reasons text[] not null,
  policy_version text not null,
  -- Critérios de autonomia atendidos INDEPENDENTE da política (null = não avaliado: item bloqueado ou dado legado).
  autonomy_eligible boolean,
  autonomy_blockers text[] not null default '{}',
  -- Redação do item (só itens estruturalmente entregáveis têm).
  item_review_id uuid references interaction_feedback_item_reviews(id) on delete cascade,
  -- ACTUALLY_DELIVERED: nenhum fluxo grava nesta versão.
  delivered_at timestamptz,
  created_at timestamptz not null,
  unique (run_id, item_index),
  check ((disposition = 'BLOCKED') = (structural_state = 'BLOCKED')),
  check ((structural_state = 'BLOCKED') = (item_review_id is null)),
  check (structural_state = 'STRUCTURALLY_DELIVERABLE' or autonomy_eligible is null),
  check (disposition <> 'BLOCKED' or delivered_at is null)
);
create index interaction_feedback_delivery_decisions_org_idx on interaction_feedback_delivery_decisions (organization_id, disposition, created_at);
create unique index interaction_feedback_delivery_decisions_review_idx on interaction_feedback_delivery_decisions (item_review_id) where item_review_id is not null;

-- Legado (V1.5.0–V1.5.4): toda revisão existente foi criada pela política "todo texto do Writer exige revisão" —
-- equivale a HOLD_FOR_QA dessa política. Critérios de autonomia não foram avaliados na época (null, nunca inventado).
insert into interaction_feedback_delivery_decisions (organization_id, run_id, item_index, section, finding_kind, structural_state, disposition, reasons, policy_version, autonomy_eligible, item_review_id, created_at)
select r.organization_id, r.run_id, r.item_index, r.section, r.finding_kind, 'STRUCTURALLY_DELIVERABLE', 'HOLD_FOR_QA', array['PILOT_HOLD_ALL_FOR_QA'], 'FEEDBACK_PILOT_REVIEW_POLICY_V1', null, r.id, r.created_at
from interaction_feedback_item_reviews r
on conflict (run_id, item_index) do nothing;

create table feedback_quality_reviewer_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id) on delete cascade,
  -- SUBTREE = quem está abaixo da pessoa por reports_to_id; TEAM/SUBTEAM = colaboradores do Grupo/Subgrupo;
  -- ORGANIZATION = toda a organização (concessão EXPLÍCITA, ex.: equipe de Qualidade — nunca implícita).
  scope_type text not null check (scope_type in ('SUBTREE', 'TEAM', 'SUBTEAM', 'ORGANIZATION')),
  team_id uuid references teams(id),
  subteam_id uuid references subteams(id),
  granted_by uuid references people(id),
  granted_at timestamptz not null,
  revoked_by uuid references people(id),
  revoked_at timestamptz,
  check (
    (scope_type in ('SUBTREE', 'ORGANIZATION') and team_id is null and subteam_id is null)
    or (scope_type = 'TEAM' and team_id is not null and subteam_id is null)
    or (scope_type = 'SUBTEAM' and subteam_id is not null and team_id is null)
  ),
  check ((revoked_at is null) = (revoked_by is null))
);
create unique index feedback_quality_reviewer_grants_active_idx on feedback_quality_reviewer_grants (
  organization_id, person_id, scope_type, coalesce(team_id, '00000000-0000-0000-0000-000000000000'), coalesce(subteam_id, '00000000-0000-0000-0000-000000000000')
) where revoked_at is null;
