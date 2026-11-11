-- Diagnóstico de erros (migration 187): ocorrências de erro pesquisáveis pela REFERÊNCIA que a pessoa copia da tela.
--
-- Uma linha por falha registrada pela API (respostas 4xx/5xx relevantes, stream do chat, tarefas periódicas, processo) e pelo
-- navegador (POST /api/v1/client-errors). Guarda só o necessário para investigar — código, status, rota normalizada, serviço,
-- versão, horário UTC e um resumo técnico já SANITIZADO (sem corpo, cookies, query, e-mail, CPF, token ou senha). Nunca guarda a
-- pessoa: só a organização (para o escopo de leitura) e se havia sessão. Retenção: tarefa periódica apaga após
-- INIA_ERROR_OCCURRENCE_RETENTION_DAYS (padrão 30). Banco fora do ar não grava nada — a mesma linha está no log do serviço.
-- Só aditiva e idempotente.

create table if not exists error_occurrences (
  id uuid primary key default gen_random_uuid(),
  reference text not null check (reference ~ '^[A-Za-z0-9._:-]{8,80}$'),
  code text not null check (char_length(code) between 2 and 80),
  source text not null check (source in ('API','STREAM','JOB','PROCESS','INTERFACE','CLIENT')),
  http_status smallint check (http_status between 100 and 599),
  severity text not null check (severity in ('info','warning','error','critical')),
  service text not null check (char_length(service) <= 40),
  release text not null check (char_length(release) <= 64),
  method text check (char_length(method) <= 10),
  route text check (char_length(route) <= 200),
  organization_id uuid references organizations(id),
  authenticated boolean not null default false,
  occurred_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb check (pg_column_size(details) <= 16384)
);

create index if not exists idx_error_occurrences_reference on error_occurrences (reference);
create index if not exists idx_error_occurrences_code_time on error_occurrences (code, occurred_at desc);
create index if not exists idx_error_occurrences_time on error_occurrences (occurred_at);
