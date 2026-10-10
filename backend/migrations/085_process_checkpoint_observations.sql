-- V1.6.1 — OBSERVAÇÕES DE ETAPA DE PROCESSO VERIFICADAS (base da evidência de pares)
--
-- Aditiva: só uma tabela NOVA; nada existente muda. Cada linha é UMA etapa de processo de UM atendimento, VERIFICADA pela
-- camada de confiabilidade (V1.6.0): fala do operador conferida por turno na transcrição + regra literal da versão PUBLICADA
-- da base, apresentada na execução e ancorada na conversa (aplicabilidade VERIFIED). Só FOLLOWED/NOT_FOLLOWED entram.
--
-- Para que serve: a evidência de pares do diagnóstico de indicador (PEER_PRACTICE_EVIDENCE_V1) é calculada pelo SISTEMA a
-- partir destas linhas — frequência agregada da mesma prática (documento + trecho verificado = `practice_key`), no mesmo motivo
-- e no mesmo período, entre as pessoas do grupo de referência. Nunca é lida para exibir fala, nome ou resultado de colega.
--
-- Um status por atendimento × prática (unique): uma reavaliação do mesmo atendimento substitui a anterior (a mais recente
-- vence). Apagar o atendimento, o documento ou a pessoa apaga a observação; apagar o artefato de origem só solta a referência.

create table process_checkpoint_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id) on delete cascade,
  interaction_id uuid not null references interactions(id) on delete cascade,
  -- KB:<documento>:<hash do trecho normalizado> — só identidade da BASE (requisito escrito por modelo nunca entra).
  practice_key text not null check (practice_key like 'KB:%'),
  document_id uuid not null references knowledge_documents(id) on delete cascade,
  document_version integer,
  requirement text not null check (char_length(requirement) between 1 and 400),
  status text not null check (status in ('FOLLOWED', 'NOT_FOLLOWED')),
  -- Início do atendimento (copiado de interactions.started_at na gravação) — o recorte de período dos pares.
  occurred_at timestamptz not null,
  source_artifact_id uuid references reliable_feedback_artifacts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (interaction_id, practice_key)
);

create index process_checkpoint_observations_practice_idx on process_checkpoint_observations (organization_id, practice_key, occurred_at);
create index process_checkpoint_observations_person_idx on process_checkpoint_observations (person_id, occurred_at);
