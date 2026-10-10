-- CALENDÁRIO OPERACIONAL — último hardening estrutural: DISPONIBILIDADE DOS DADOS × CLASSIFICAÇÃO.
--
-- Fim do turno NÃO significa dado fechado: grande parte dos indicadores chega em D-1, alguns em D-2, e a
-- base de RH também atrasa. Esta migration acrescenta (1) a POLÍTICA DE DISPONIBILIDADE esperada de cada
-- feed (lagDays + horário local) — conceito distinto de freshness/saúde da conexão; (2) o override por
-- indicador, só quando um mesmo feed mistura SLAs; (3) a política de FALTA INJUSTIFICADA por indicador
-- (sem amostra × contribuição zero — nunca medição sintética); (4) a CLASSIFICAÇÃO OPERACIONAL posterior
-- de um dia sem produção (falta injustificada / ausência justificada / trabalhou — dados não chegaram),
-- revisável, com histórico por revisão — NÃO é exceção de calendário: a escala continua dizendo "deveria
-- trabalhar". Nada anterior é apagado; o estado do dia continua DERIVADO.

-- 1) Disponibilidade esperada por feed: {"lagDays": 1, "availableByLocalTime": "11:00"} no fuso da
--    organização. NULL = AVAILABILITY_UNKNOWN — a INIA não assume D+1 por padrão e não conclui ausência.
alter table data_feeds
  add column if not exists availability_policy jsonb;

-- 2) Override opcional por indicador (mesma forma). NULL = herda a política dos feeds de medição.
alter table indicator_definitions
  add column if not exists availability_policy jsonb;

-- 3) Tratamento de falta injustificada CONFIRMADA pelo Supervisor: NO_SAMPLE (TMA, Qualidade — não
--    existe amostra) ou ZERO_CONTRIBUTION (Produção — contribuição lógica 0 na agregação, sem linha em
--    indicator_measurements). Configuração, nunca `if code === 'PRODUCAO'`.
alter table indicator_definitions
  add column if not exists unjustified_absence_policy text not null default 'NO_SAMPLE';
alter table indicator_definitions drop constraint if exists indicator_definitions_unjustified_absence_policy_check;
alter table indicator_definitions
  add constraint indicator_definitions_unjustified_absence_policy_check check (unjustified_absence_policy in ('NO_SAMPLE', 'ZERO_CONTRIBUTION'));

-- 4) Classificação operacional de um dia — uma linha por REVISÃO (nunca overwrite): a vigente tem
--    superseded_at nulo; a anterior fica com quem/quando/por quê a substituiu. Para ATESTADO guarda-se
--    SÓ o motivo (sem CID, diagnóstico, documento ou descrição clínica — não existe coluna para isso).
create table if not exists workday_classifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id) on delete cascade,
  workday date not null,
  classification text not null check (classification in ('UNJUSTIFIED_ABSENCE', 'JUSTIFIED_ABSENCE', 'WORKED_DATA_MISSING')),
  reason_code text check (reason_code is null or reason_code in ('ATESTADO', 'DAY_OFF', 'BANCO_HORAS', 'FOLGA_EXTRAORDINARIA', 'OTHER_JUSTIFIED')),
  origin text not null default 'SUPERVISOR_MANUAL' check (origin in ('SUPERVISOR_MANUAL')),
  classified_by_person_id uuid references people(id),
  classified_at timestamptz not null default now(),
  reconciliation_id uuid references workday_reconciliations(id),
  -- Revisão: aponta para a classificação que esta substituiu.
  supersedes_id uuid references workday_classifications(id),
  superseded_at timestamptz,
  superseded_by_person_id uuid references people(id),
  superseded_reason text check (superseded_reason is null or superseded_reason in ('REVISED', 'CONTRADICTED_BY_WORK_EVIDENCE', 'SUPERSEDED_BY_AUTHORITATIVE_STATUS')),
  check ((classification = 'JUSTIFIED_ABSENCE') = (reason_code is not null))
);
create unique index if not exists workday_classifications_active_uk on workday_classifications (person_id, workday) where superseded_at is null;
create index if not exists idx_workday_classifications_person_day on workday_classifications (person_id, workday);
create index if not exists idx_workday_classifications_org_day on workday_classifications (organization_id, workday);

-- 5) Reconciliação: novas resoluções (classificação humana) + vínculo com a classificação vigente.
--    NOT_WORKED continua aceito para linhas anteriores (legado: criava exceção).
alter table workday_reconciliations drop constraint if exists workday_reconciliations_resolution_check;
alter table workday_reconciliations
  add constraint workday_reconciliations_resolution_check check (resolution is null or resolution in ('NOT_WORKED', 'UNJUSTIFIED_ABSENCE', 'JUSTIFIED_ABSENCE', 'WORKED_DATA_MISSING', 'SCHEDULE_CORRECTED', 'PRODUCTION_RECEIVED_AFTER_ALERT', 'PLAN_UPDATED_AFTER_ALERT'));
alter table workday_reconciliations
  add column if not exists classification_id uuid references workday_classifications(id);
