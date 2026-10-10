-- V1.5.6 — FEEDBACK OUTPUT → ACOMPANHAMENTO (entrega do feedback de interação ao colaborador)
--
-- Aditiva: só uma tabela nova; nenhuma coluna existente muda; nenhum dado existente é tocado. A entrega NÃO vira linha em
-- `feedbacks`: aquela tabela exige indicador/procedimento (que este feedback não tem) e alimenta o contexto do chat e os
-- contadores de analytics — efeitos que esta etapa não quer. O Acompanhamento lê esta tabela como mais uma FONTE do mesmo
-- feed (cada item aponta para a sua linha de origem, como feedbacks e alertas).
--
-- Uma linha = UM item de feedback entregue, EXATAMENTE UMA VEZ (unique por item revisado e por decisão). O texto NÃO é
-- duplicado: a origem persistida e imutável é `interaction_feedback_item_reviews` (proposto ou final humano, pelo
-- `wording_source`); `wording_sha256` prova qual versão saiu. `interaction_feedback_delivery_decisions.delivered_at` é
-- marcado na MESMA instrução (entregue ⇔ existe a linha).

create table interaction_feedback_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  collaborator_id uuid not null references people(id),
  run_id uuid not null references interaction_feedback_runs(id) on delete cascade,
  item_review_id uuid not null unique references interaction_feedback_item_reviews(id) on delete cascade,
  delivery_decision_id uuid not null unique references interaction_feedback_delivery_decisions(id) on delete cascade,
  -- QA_APPROVED = entregue depois de APPROVED_* no QA; AUTONOMOUS = a política dispensou QA (AUTO_DELIVER).
  delivery_mode text not null check (delivery_mode in ('QA_APPROVED', 'AUTONOMOUS')),
  -- PROPOSED = texto proposto (redator ou fallback); HUMAN_EDITED = versão final do QA.
  wording_source text not null check (wording_source in ('PROPOSED', 'HUMAN_EDITED')),
  -- Origem do texto proposto (auditoria; nunca exibida ao colaborador).
  proposed_origin text not null check (proposed_origin in ('WRITER', 'FALLBACK')),
  -- Resultado de QA no momento da entrega.
  qa_status text not null check (qa_status in ('APPROVED_UNCHANGED', 'APPROVED_EDITED', 'NOT_SELECTED_FOR_QA')),
  policy_version text not null,
  wording_sha256 text not null check (wording_sha256 ~ '^[0-9a-f]{64}$'),
  delivered_at timestamptz not null,
  -- Ciência do PRÓPRIO colaborador (mesma semântica do Acompanhamento de feedbacks). Entregue ≠ lido.
  acknowledged_at timestamptz,
  created_at timestamptz not null,
  check ((delivery_mode = 'QA_APPROVED') = (qa_status in ('APPROVED_UNCHANGED', 'APPROVED_EDITED'))),
  check ((wording_source = 'HUMAN_EDITED') = (qa_status = 'APPROVED_EDITED')),
  -- Autonomia nunca entrega fallback.
  check (delivery_mode <> 'AUTONOMOUS' or proposed_origin = 'WRITER'),
  check (acknowledged_at is null or acknowledged_at >= delivered_at)
);
create index interaction_feedback_deliveries_collaborator_idx on interaction_feedback_deliveries (organization_id, collaborator_id, delivered_at desc);
