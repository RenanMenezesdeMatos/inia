-- Configuração do Workflow em RASCUNHO × PUBLICADA (incidente de 2026-10-05).
-- Construída em 05/10 como 112 (worktree vigilant-poitras, nunca juntada) e adotada em 15/10 como 144.
--
-- Antes: Gatilho, Abrangência e Modo de avaliação (Estrutura Consolidada / Filtro Populacional)
-- eram gravados direto nas colunas que o runtime lê (`trigger_config`, `scope_type`, `team_id`,
-- `subteam_id`, `consolidated_structure`, `population_filter`). Trocar o gatilho de um Workflow
-- ATIVO e publicado (ex.: Manual → Por agenda) passava a valer no minuto seguinte, com o grafo
-- PUBLICADO antigo — o checador de agenda criou 2.264 matrículas em dev antes de alguém publicar.
--
-- Agora o editor grava SÓ as colunas `draft_*` (irmãs de `draft_graph`); as colunas vivas passam
-- a significar "configuração PUBLICADA" e só mudam no caminho de publicação, junto com
-- `active_version_id`, na mesma transação. Workflow nunca publicado não tem runtime nenhum (todo
-- leitor exige `active_version_id`), então nele a edição grava as duas (vivo = rascunho).
--
-- A versão publicada guarda também a configuração com que foi publicada (auditoria: a versão e o
-- gatilho dela sempre batem). Versões anteriores a esta migration ficam com null (não registrado),
-- exceto a ATIVA de cada Workflow, que recebe a configuração viva de agora (é a que está rodando).

alter table workflows
  add column draft_trigger_config jsonb,
  add column draft_scope_type text,
  add column draft_team_id uuid references teams(id),
  add column draft_subteam_id uuid references subteams(id),
  add column draft_consolidated_structure jsonb,
  add column draft_population_filter jsonb;

update workflows set
  draft_trigger_config = trigger_config,
  draft_scope_type = scope_type,
  draft_team_id = team_id,
  draft_subteam_id = subteam_id,
  draft_consolidated_structure = consolidated_structure,
  draft_population_filter = population_filter;

alter table workflows
  alter column draft_scope_type set not null,
  add constraint workflows_draft_scope_check check (
    draft_scope_type in ('ALL_TEAMS', 'TEAM', 'SUBTEAM') and (
      (draft_scope_type = 'ALL_TEAMS' and draft_team_id is null and draft_subteam_id is null) or
      (draft_scope_type = 'TEAM' and draft_team_id is not null and draft_subteam_id is null) or
      (draft_scope_type = 'SUBTEAM' and draft_subteam_id is not null)
    )
  );

-- Escritas diretas em SQL (seeds demo, scripts de dev, provas) continuam coerentes sem conhecer as
-- colunas novas: INSERT sem rascunho copia o vivo; UPDATE que muda só a configuração viva de um
-- Workflow SEM alteração pendente leva o rascunho junto (ex.: reseed da massa demo). Rascunho
-- pendente nunca é sobrescrito por aqui, e o caminho da API sempre grava o rascunho explicitamente.
create function workflows_sync_draft_configuration() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.draft_scope_type is null then
      new.draft_trigger_config := new.trigger_config;
      new.draft_scope_type := new.scope_type;
      new.draft_team_id := new.team_id;
      new.draft_subteam_id := new.subteam_id;
      new.draft_consolidated_structure := new.consolidated_structure;
      new.draft_population_filter := new.population_filter;
    end if;
    return new;
  end if;
  if (new.trigger_config, new.scope_type, new.team_id, new.subteam_id, new.consolidated_structure, new.population_filter)
       is distinct from (old.trigger_config, old.scope_type, old.team_id, old.subteam_id, old.consolidated_structure, old.population_filter)
     and (new.draft_trigger_config, new.draft_scope_type, new.draft_team_id, new.draft_subteam_id, new.draft_consolidated_structure, new.draft_population_filter)
       is not distinct from (old.draft_trigger_config, old.draft_scope_type, old.draft_team_id, old.draft_subteam_id, old.draft_consolidated_structure, old.draft_population_filter)
     and (old.draft_trigger_config, old.draft_scope_type, old.draft_team_id, old.draft_subteam_id, old.draft_consolidated_structure, old.draft_population_filter)
       is not distinct from (old.trigger_config, old.scope_type, old.team_id, old.subteam_id, old.consolidated_structure, old.population_filter)
  then
    new.draft_trigger_config := new.trigger_config;
    new.draft_scope_type := new.scope_type;
    new.draft_team_id := new.team_id;
    new.draft_subteam_id := new.subteam_id;
    new.draft_consolidated_structure := new.consolidated_structure;
    new.draft_population_filter := new.population_filter;
  end if;
  return new;
end
$$;

create trigger workflows_sync_draft_configuration
  before insert or update on workflows
  for each row execute function workflows_sync_draft_configuration();

-- Snapshot (sem FK de propósito: é histórico — a versão não pode impedir excluir um Grupo).
alter table workflow_versions
  add column trigger_config jsonb,
  add column scope_type text,
  add column team_id uuid,
  add column subteam_id uuid,
  add column consolidated_structure jsonb,
  add column population_filter jsonb;

update workflow_versions v set
  trigger_config = w.trigger_config,
  scope_type = w.scope_type,
  team_id = w.team_id,
  subteam_id = w.subteam_id,
  consolidated_structure = w.consolidated_structure,
  population_filter = w.population_filter
from workflows w
where w.active_version_id = v.id;
