-- Resposta da INIA em andamento no chat (19/11/2026). Regra: SAIR DA TELA NÃO CANCELA A RESPOSTA — trocar de aba do navegador,
-- trocar de área da INIA (Acompanhamento → Indicadores), recarregar a página ou perder a conexão: a resposta continua sendo
-- gerada e é GRAVADA na conversa. Só o pedido explícito ("Parar", `POST /realtime/messages/:clientMessageId/cancel`) cancela.
--
-- Uma linha por resposta EM ANDAMENTO (apagada ao terminar, com ou sem sucesso): serve para
--   (1) a tela que volta (outra instância da API, outra aba) saber que a resposta ainda está sendo gerada e mostrar o indicador
--       com a etapa real (`stage_label`) até ela aparecer no histórico;
--   (2) o "Parar" chegar à instância que gera, mesmo atrás de uma farm com várias APIs (`cancel_requested_at`, lido a cada
--       batimento; na mesma instância o cancelamento é imediato).
-- `heartbeat_at` renovado a cada ~3 s: processo que morreu deixa a linha parada e ela deixa de valer como "em andamento".
create table if not exists assistant_reply_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  owner_person_id uuid not null references people(id),
  conversation_id uuid not null references assistant_conversations(id) on delete cascade,
  question_interaction_id uuid not null references assistant_interactions(id) on delete cascade,
  client_message_id text not null,
  stage_label text,
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  cancel_requested_at timestamptz
);
create unique index if not exists assistant_reply_runs_client_key on assistant_reply_runs (organization_id, owner_person_id, client_message_id);
create index if not exists assistant_reply_runs_conversation on assistant_reply_runs (conversation_id, started_at desc);
