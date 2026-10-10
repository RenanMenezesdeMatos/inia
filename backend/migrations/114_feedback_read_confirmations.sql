-- Confirmação de ciência com login e senha (2026-10-06).
--
-- Ciência = o PRÓPRIO destinatário confirma, com o login (e-mail corporativo) e a senha da SUA conta, que leu o feedback. É a
-- conclusão única do feedback, venha de onde vier: do Acompanhamento ("Confirmar ciência") ou de dentro da sessão com a INIA
-- (que antes tinha um "Concluir aplicação" separado). Confirmar grava `acknowledged_at` na fonte e, se a aplicação estiver em
-- andamento, conclui a aplicação (encerra a conversa dela). As rotas antigas sem credencial deixaram de existir.
--
-- Esta tabela é o registro de USABILIDADE da confirmação: cada abertura do elemento de confirmação é uma TENTATIVA
-- (`attempt_id`, gerado na tela) e cada fato vira uma linha — OPENED → (FAILED…) → CONFIRMED | CANCELLED. Dá para medir tempo
-- até confirmar, erros de login/senha, abandono e onde a confirmação aconteceu. Nunca se grava o login digitado nem a senha.
-- As falhas de credencial também alimentam a trava contra tentativa e erro (a sessão já está aberta).
create table if not exists feedback_read_confirmation_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id),
  account_id uuid not null references user_accounts(id),
  source_kind text not null check (source_kind in ('PUBLISHED_FEEDBACK', 'INTERACTION_FEEDBACK_DELIVERY')),
  feedback_id uuid references feedbacks(id),
  interaction_delivery_id uuid references interaction_feedback_deliveries(id),
  -- Onde o botão estava: no Acompanhamento ou dentro da sessão com a INIA.
  entry_point text not null check (entry_point in ('FOLLOW_UP_FEED', 'FEEDBACK_SESSION')),
  -- Uma abertura do elemento de confirmação (todas as linhas da mesma tentativa compartilham o id).
  attempt_id uuid not null,
  event text not null check (event in ('OPENED', 'CANCELLED', 'FAILED', 'CONFIRMED')),
  failure_reason text check (failure_reason in ('WRONG_LOGIN', 'WRONG_PASSWORD', 'TOO_MANY_ATTEMPTS')),
  -- CONFIRMED: true quando outra aba/outro ponto de entrada já tinha confirmado (nada mudou).
  already_confirmed boolean,
  -- Aplicação da fonte no momento do evento (null = nenhuma aplicação ainda) e a aplicação concluída pela confirmação.
  application_id uuid references feedback_applications(id),
  application_status text check (application_status in ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED')),
  completed_application boolean,
  -- Informados pela tela (usabilidade): tipo de tela e tempo desde a abertura do elemento.
  device text check (device in ('DESKTOP', 'MOBILE')),
  elapsed_ms integer check (elapsed_ms is null or elapsed_ms >= 0),
  occurred_at timestamptz not null,
  constraint feedback_read_confirmation_events_one_source check (
    (source_kind = 'PUBLISHED_FEEDBACK' and feedback_id is not null and interaction_delivery_id is null)
    or (source_kind = 'INTERACTION_FEEDBACK_DELIVERY' and interaction_delivery_id is not null and feedback_id is null)
  ),
  constraint feedback_read_confirmation_events_failure check ((event = 'FAILED') = (failure_reason is not null)),
  constraint feedback_read_confirmation_events_confirmed check (
    (event = 'CONFIRMED') = (already_confirmed is not null and completed_application is not null)
  )
);

-- Trava contra tentativa e erro: falhas recentes da conta.
create index if not exists feedback_read_confirmation_events_failures_idx
  on feedback_read_confirmation_events (account_id, occurred_at)
  where event = 'FAILED';
create index if not exists feedback_read_confirmation_events_org_idx on feedback_read_confirmation_events (organization_id, occurred_at);
create index if not exists feedback_read_confirmation_events_feedback_idx on feedback_read_confirmation_events (feedback_id) where feedback_id is not null;
create index if not exists feedback_read_confirmation_events_delivery_idx on feedback_read_confirmation_events (interaction_delivery_id) where interaction_delivery_id is not null;
create index if not exists feedback_read_confirmation_events_attempt_idx on feedback_read_confirmation_events (attempt_id);
