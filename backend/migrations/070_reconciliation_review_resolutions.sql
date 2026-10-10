-- Reavaliação de pendências pela regra atual (upgrade sem apagar nada): pendências "Produção não
-- identificada" abertas por uma regra anterior (fim do turno = cobrança) são reavaliadas em cada rodada
-- do job com SLA D-1/D-2, saúde das fontes, RH, situação, evidência, classificação e plano — e
-- encerradas com o MOTIVO. Novas resoluções: SOURCES_STILL_OPEN, DATA_SOURCE_DELAYED, STATUS_NON_PRODUCTIVE.
alter table workday_reconciliations drop constraint if exists workday_reconciliations_resolution_check;
alter table workday_reconciliations
  add constraint workday_reconciliations_resolution_check check (resolution is null or resolution in (
    'NOT_WORKED', 'UNJUSTIFIED_ABSENCE', 'JUSTIFIED_ABSENCE', 'WORKED_DATA_MISSING', 'SCHEDULE_CORRECTED',
    'PRODUCTION_RECEIVED_AFTER_ALERT', 'PLAN_UPDATED_AFTER_ALERT', 'SOURCES_STILL_OPEN', 'DATA_SOURCE_DELAYED', 'STATUS_NON_PRODUCTIVE'));
