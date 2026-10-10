-- V1.6.2 — ESTRATÉGIA DE DIAGNÓSTICO DO INDICADOR (versionada)
--
-- Aditiva: duas tabelas NOVAS e uma coluna NOVA (nula) em workflow_enrollments; nada existente muda.
--
--   indicator_diagnostic_strategies          → UM cabeçalho por indicador: ativa/inativa (desativar nunca apaga versões).
--   indicator_diagnostic_strategy_versions   → as VERSÕES: DRAFT (editável, nunca executado) → PUBLISHED (a vigente) →
--                                               SUPERSEDED (histórico). Configuração TIPADA (jsonb validado pela aplicação;
--                                               nunca prompt livre). Versão publicada é IMUTÁVEL (trigger abaixo): editar
--                                               uma estratégia publicada cria o próximo número como rascunho.
--   workflow_enrollments.indicator_diagnostic_strategy_version_id
--                                             → a versão EFETIVA no nascimento da execução por Indicador. A execução segue
--                                               com ela mesmo que outra versão seja publicada depois (nada "ao vivo").

create table indicator_diagnostic_strategies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  indicator_definition_id uuid not null references indicator_definitions(id) on delete cascade,
  active boolean not null default true,
  created_by uuid references user_accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, indicator_definition_id)
);

create table indicator_diagnostic_strategy_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  strategy_id uuid not null references indicator_diagnostic_strategies(id) on delete cascade,
  version integer not null check (version >= 1),
  status text not null check (status in ('DRAFT', 'PUBLISHED', 'SUPERSEDED')),
  config jsonb not null,
  created_by uuid references user_accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_by uuid references user_accounts(id) on delete set null,
  published_at timestamptz,
  unique (strategy_id, version),
  -- Publicação registrada ⇔ versão já publicada (vigente ou histórica).
  check ((status = 'DRAFT') = (published_at is null))
);

-- No máximo UM rascunho e UMA versão vigente por estratégia.
create unique index indicator_diagnostic_strategy_one_draft on indicator_diagnostic_strategy_versions (strategy_id) where status = 'DRAFT';
create unique index indicator_diagnostic_strategy_one_published on indicator_diagnostic_strategy_versions (strategy_id) where status = 'PUBLISHED';

-- Versão publicada é imutável: configuração, número, estratégia e autoria de publicação não mudam; só o status pode avançar
-- PUBLISHED → SUPERSEDED. Rascunho nunca "volta" depois de publicado e versão publicada nunca é apagada.
create function indicator_diagnostic_strategy_version_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    -- Só rascunho é apagado — exceto em cascata, quando o próprio indicador (e o cabeçalho) deixou de existir.
    if old.status <> 'DRAFT' and exists (select 1 from indicator_diagnostic_strategies where id = old.strategy_id) then
      raise exception 'versão publicada da estratégia de diagnóstico não pode ser apagada';
    end if;
    return old;
  end if;
  if old.status <> 'DRAFT' then
    if new.config is distinct from old.config or new.version <> old.version or new.strategy_id <> old.strategy_id or new.published_at is distinct from old.published_at or new.published_by is distinct from old.published_by then
      raise exception 'versão publicada da estratégia de diagnóstico é imutável';
    end if;
    if not (old.status = new.status or (old.status = 'PUBLISHED' and new.status = 'SUPERSEDED')) then
      raise exception 'transição de status inválida na estratégia de diagnóstico';
    end if;
  end if;
  return new;
end;
$$;
create trigger indicator_diagnostic_strategy_version_guard before update or delete on indicator_diagnostic_strategy_versions
  for each row execute function indicator_diagnostic_strategy_version_guard();

alter table workflow_enrollments add column indicator_diagnostic_strategy_version_id uuid references indicator_diagnostic_strategy_versions(id);
