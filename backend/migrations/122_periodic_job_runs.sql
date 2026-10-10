-- TAREFAS PERIÓDICAS COM 2+ PROCESSOS (INIA_PROCESS_ROLE=api|worker) — infrastructure/jobs/periodic-jobs.ts
--
-- Aditiva. A trava consultiva (pg_try_advisory_lock) já impede duas rodadas AO MESMO TEMPO; esta tabela impede que dois
-- processos com timers defasados rodem a mesma tarefa uma depois da outra dentro do mesmo intervalo. Sob a trava, quem vai
-- rodar marca o início (relógio do BANCO, o mesmo para todas as máquinas); se outra rodada começou há menos de ~90% do
-- intervalo, esta é pulada. Uma linha por tarefa; sem dado de negócio. Apagar a tabela inteira só faz a próxima rodada rodar.
create table periodic_job_runs (
  name text primary key,
  last_started_at timestamptz not null
);
