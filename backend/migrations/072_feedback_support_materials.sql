-- Materiais de apoio recomendados num Feedback (2026-09-17).
--
-- Quando a IA gera um Feedback, ela pode apontar materiais da Base de Conhecimento que ajudam o
-- colaborador a desenvolver o ponto tratado. A IA NUNCA cria link, título ou URL: ela só escolhe
-- IDs dentro do conjunto de materiais efetivamente recuperados naquela execução (ver
-- feedbacks/domain/support-material.ts). Esta tabela guarda a relação REAL Feedback ↔ material —
-- fora do texto livre —, com o motivo curto escrito pela IA e a ordem de relevância. Título, rota
-- e autorização são resolvidos a cada leitura a partir do material real (knowledge_documents e
-- seus alcances), nunca persistidos aqui: um material despublicado, excluído ou fora do alcance do
-- leitor deixa de virar link sem que o histórico do Feedback seja alterado.
--
-- Material de apoio ≠ evidência (`evidences` fundamenta a conclusão; aqui é conteúdo recomendado
-- para desenvolvimento) e abrir o material ≠ ciência (`feedbacks.acknowledged_at`).
create table if not exists feedback_support_materials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  feedback_id uuid not null references feedbacks(id) on delete cascade,
  knowledge_document_id uuid not null references knowledge_documents(id),
  reason text not null check (char_length(reason) between 1 and 280),
  position smallint not null check (position >= 0),
  created_at timestamptz not null default now(),
  unique (feedback_id, knowledge_document_id),
  unique (feedback_id, position)
);

create index if not exists idx_feedback_support_materials_document on feedback_support_materials (knowledge_document_id);
create index if not exists idx_feedback_support_materials_org on feedback_support_materials (organization_id, feedback_id);

comment on table feedback_support_materials is
  'Materiais da Base de Conhecimento recomendados num Feedback pela IA (só IDs escolhidos entre os recuperados na execução). Título/rota/acesso são resolvidos em leitura a partir do material real.';
comment on column feedback_support_materials.reason is
  'Motivo curto e específico (texto da IA, até 280 caracteres) — a única parte produzida pelo modelo.';
