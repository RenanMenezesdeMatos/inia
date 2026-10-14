-- VAGAS E PAUSA POR CONEXÃO DE IA, COMPARTILHADAS ENTRE PROCESSOS — shared/infrastructure/model-routing/postgres-provider-call-gate.ts
--
-- Aditiva. Com N APIs e M workers, quem limita o provedor é o ACESSO (a conexão cadastrada em Administração › IA › Provedores,
-- com a própria chave e a própria cota), não cada processo. Cada conexão ganha um teto opcional de chamadas simultâneas
-- somando TODAS as instâncias (null = sem teto próprio; vale só o limitador de cada processo). As vagas em uso ficam numa
-- tabela UNLOGGED com prazo renovado enquanto a chamada roda: processo que morre solta a vaga quando o prazo vence.
-- A pausa depois de um 429 continua em `ai_provider_cooldowns` (migration 127), agora com uma linha por chave
-- (`connection:<id>`; a rota do ambiente, sem conexão cadastrada, usa `legacy:<provedor>`).
alter table ai_connections
  add column max_concurrent_calls integer check (max_concurrent_calls is null or max_concurrent_calls between 1 and 1000);

comment on column ai_connections.max_concurrent_calls is
  'Chamadas simultâneas desta conexão somando todas as instâncias da INIA (APIs + processamentos). null = sem teto próprio.';

create unlogged table ai_call_slot_leases (
  -- `connection:<id>` ou `legacy:<provedor>` — o mesmo vocabulário de ai_provider_cooldowns.scope.
  key text not null,
  slot integer not null check (slot >= 1),
  priority text not null check (priority in ('INTERACTIVE', 'BATCH')),
  -- Quem segura a vaga (papel, máquina, pid e um id por chamada) — diagnóstico; nunca prompt, resposta ou segredo.
  holder text not null,
  expires_at timestamptz not null,
  primary key (key, slot)
);
