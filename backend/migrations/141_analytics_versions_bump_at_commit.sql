-- VERSÕES POR ORGANIZAÇÃO (128) sobem NO COMMIT — docs/dev/memoria/read-model-e-ciclo-de-vida.md.
--
-- Na 128, cada statement que gravava em people/teams/subteams ou na camada oficial fazia, NA HORA, o upsert da linha
-- (organização, domínio) de analytics_versions, e o lock dessa linha ficava com a transação até o fim. Uma transação longa
-- (importação da Central de Dados, seed, script) segurava TODOS os outros gravadores do mesmo domínio na organização até
-- terminar; uma transação aberta de prova travou a prova seguinte (manual-run-proof, 13/10/2026).
--
-- Agora o trigger por statement só ANOTA a pendência (analytics_version_pending). A chave leva o id da própria transação,
-- então duas transações nunca disputam a mesma linha. Um constraint trigger ADIADO aplica as pendências no commit, em ordem
-- fixa (organização, domínio): o lock da linha da versão dura só o commit, e transações que sobem STRUCTURE e OFFICIAL
-- nunca se travam em ordem cruzada. Continua tudo na MESMA transação da escrita: a versão nova fica visível junto com os
-- dados, e uma transação desfeita não sobe nada (as pendências somem com ela, inclusive num savepoint desfeito).
-- A própria transação enxerga as suas pendências (analytics-versions.ts): quem grava e lê o analytics na mesma transação
-- nunca recebe um cache anterior à própria escrita.
create table analytics_version_pending (
  xact_id xid8 not null,
  organization_id uuid not null,
  domain text not null check (domain in ('STRUCTURE', 'OFFICIAL')),
  primary key (xact_id, organization_id, domain)
);

-- Mesma assinatura da 128: os triggers existentes continuam chamando esta função, que agora só anota.
create or replace function analytics_bump_versions(p_domain text, p_organization_ids uuid[]) returns void language sql as $$
  insert into analytics_version_pending (xact_id, organization_id, domain)
  select pg_current_xact_id(), organization_id, p_domain
    from (select distinct organization_id from unnest(p_organization_ids) organization_id where organization_id is not null) changed
  on conflict do nothing
$$;

-- A primeira execução no commit aplica TODAS as pendências da transação; as seguintes não encontram nada.
create function analytics_apply_pending_versions() returns trigger language plpgsql as $$
begin
  with pending as (
    delete from analytics_version_pending where xact_id = pg_current_xact_id() returning organization_id, domain
  )
  insert into analytics_versions (organization_id, domain, version, changed_at)
  select organization_id, domain, nextval('analytics_version_seq'), now()
    from pending
   where exists (select 1 from organizations o where o.id = pending.organization_id)
   order by organization_id, domain
  on conflict (organization_id, domain) do update set version = excluded.version, changed_at = excluded.changed_at;
  return null;
end $$;

create constraint trigger analytics_version_pending_apply after insert on analytics_version_pending
  deferrable initially deferred for each row execute function analytics_apply_pending_versions();
