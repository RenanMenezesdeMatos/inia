-- Material de apoio como CAPACIDADE COMUM de resposta (2026-09-17) — evolução da migration 072.
--
-- A recomendação deixa de ser exclusiva do Feedback: Agent respondendo diretamente, Orquestrador
-- (chat, voz e Workflow) e as superfícies que entregam a resposta passam a compartilhar o mesmo
-- fluxo (candidatos do retrieval → seleção pela IA → validação/persistência pela aplicação).
--
-- 1. Configuração por responsável, tudo OFF por padrão (nada muda em silêncio):
--    * agents.recommend_support_materials — "quando este Agente responder DIRETAMENTE, pode
--      recomendar materiais?" (como especialista de um Orquestrador ele só fornece candidatos);
--    * assistant_orchestrators.recommend_support_materials — "nas respostas finais, o Orquestrador
--      pode selecionar e recomendar materiais encontrados pelos especialistas?".
--    O Output do Workflow decide, por node (`includeSupportMaterials` no grafo), se AQUELA entrega
--    apresenta o que já foi recomendado — configuração do grafo, não coluna.
alter table agents add column if not exists recommend_support_materials boolean not null default false;
alter table assistant_orchestrators add column if not exists recommend_support_materials boolean not null default false;

comment on column agents.recommend_support_materials is
  'Quando o Agente responde diretamente (Workflow/teste), pode recomendar materiais das bases que consultou. Como especialista de Orquestrador só fornece candidatos.';
comment on column assistant_orchestrators.recommend_support_materials is
  'Nas respostas finais (chat, voz, Workflow), o Orquestrador pode selecionar até 3 materiais entre os encontrados pelos especialistas acionados.';

-- 2. Recomendação fora do Feedback: cada resposta de chat/voz persistida em assistant_interactions
--    (role = assistant) pode carregar os materiais recomendados — relação tipada com FK (nunca
--    source_type/source_id solto), com proveniência: a própria interação diz canal (chat/voz),
--    operador, agente/tool acionado e instante; `orchestrator_id` diz qual Orquestrador
--    respondeu. Título/rota/acesso continuam resolvidos em leitura a partir do material real.
create table if not exists assistant_interaction_support_materials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  interaction_id uuid not null references assistant_interactions(id) on delete cascade,
  knowledge_document_id uuid not null references knowledge_documents(id),
  orchestrator_id uuid references assistant_orchestrators(id),
  reason text not null check (char_length(reason) between 1 and 280),
  position smallint not null check (position >= 0),
  created_at timestamptz not null default now(),
  unique (interaction_id, knowledge_document_id),
  unique (interaction_id, position)
);

create index if not exists idx_assistant_interaction_support_materials_document on assistant_interaction_support_materials (knowledge_document_id);
create index if not exists idx_assistant_interaction_support_materials_org on assistant_interaction_support_materials (organization_id, interaction_id);

comment on table assistant_interaction_support_materials is
  'Materiais recomendados numa resposta de chat/voz (assistant_interactions.role = assistant). Proveniência: interação (canal, operador, agente, instante) + orchestrator_id.';
