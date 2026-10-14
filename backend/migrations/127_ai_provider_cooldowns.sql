-- PAUSA DO PROVEDOR DE IA COMPARTILHADA ENTRE PROCESSOS — shared/infrastructure/model-routing/postgres-provider-cooldown.ts
--
-- Aditiva. O limitador de chamadas de IA (model-routing/ai-call-limiter.ts) pausa o início de lotes quando o provedor devolve
-- 429; a pausa era só do processo que recebeu o 429 — com N APIs e M workers os outros continuavam batendo na mesma cota.
-- Uma linha por escopo (hoje um só: AI_PROVIDER, a mesma granularidade da pausa local): o fim da pausa no relógio do BANCO.
-- Quem recebe o 429 estende a pausa (nunca encurta); os processos leem a linha a cada poucos segundos. Sem dado de negócio:
-- apagar a linha só encerra a pausa em vigor.
create table ai_provider_cooldowns (
  scope text primary key,
  paused_until timestamptz not null,
  reason text not null check (reason in ('RATE_LIMIT', 'UNAVAILABLE')),
  -- Quem pediu (papel do processo, máquina e pid) — diagnóstico; nunca prompt, resposta ou segredo.
  source text not null,
  updated_at timestamptz not null default now()
);
