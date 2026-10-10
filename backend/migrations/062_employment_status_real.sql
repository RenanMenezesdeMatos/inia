-- SITUAÇÕES FUNCIONAIS REAIS do negócio (ADD → MAP/BACKFILL → COMPATIBILITY):
--   EM_PRODUCAO | TRANSFERIDO | FERIAS | INSS | PILOTO | MATERNIDADE | PATERNIDADE | APOSENTADO | ATIVIDADE_OFF
-- Regra positiva única (people/domain/employment-status.ts): só EM_PRODUCAO é elegível
-- operacionalmente; todos os demais são não produtivos. Conceito separado de people.active (conta).
--
-- Compatibilidade com o legado (ACTIVE / VACATION / LEAVE / INACTIVE):
--   • o check constraint continua ACEITANDO os quatro códigos legados (dual-read: leitores canonizam);
--   • backfill determinístico: ACTIVE → EM_PRODUCAO, VACATION → FERIAS; LEAVE e INACTIVE → ATIVIDADE_OFF
--     (NUNCA inventamos INSS/MATERNIDADE/APOSENTADO sem evidência);
--   • o código legado fica preservado em `legacy_status` e, quando a fonte não tinha texto bruto,
--     `raw_status` recebe o código legado — o texto original NUNCA se perde.

alter table employee_status_periods
  add column if not exists legacy_status text;

alter table employee_status_periods
  drop constraint if exists employee_status_periods_status_check;
alter table employee_status_periods
  add constraint employee_status_periods_status_check
  check (status in ('EM_PRODUCAO', 'TRANSFERIDO', 'FERIAS', 'INSS', 'PILOTO', 'MATERNIDADE', 'PATERNIDADE', 'APOSENTADO', 'ATIVIDADE_OFF',
                    'ACTIVE', 'VACATION', 'LEAVE', 'INACTIVE'));

update employee_status_periods
   set legacy_status = status,
       raw_status = coalesce(raw_status, status),
       status = case status
                  when 'ACTIVE' then 'EM_PRODUCAO'
                  when 'VACATION' then 'FERIAS'
                  else 'ATIVIDADE_OFF'
                end,
       updated_at = now()
 where status in ('ACTIVE', 'VACATION', 'LEAVE', 'INACTIVE');

alter table people
  drop constraint if exists people_current_employment_status_check;
alter table people
  add constraint people_current_employment_status_check
  check (current_employment_status in ('EM_PRODUCAO', 'TRANSFERIDO', 'FERIAS', 'INSS', 'PILOTO', 'MATERNIDADE', 'PATERNIDADE', 'APOSENTADO', 'ATIVIDADE_OFF',
                                       'ACTIVE', 'VACATION', 'LEAVE', 'INACTIVE'));
alter table people
  alter column current_employment_status set default 'EM_PRODUCAO';

update people
   set current_employment_status = case current_employment_status
                                     when 'ACTIVE' then 'EM_PRODUCAO'
                                     when 'VACATION' then 'FERIAS'
                                     else 'ATIVIDADE_OFF'
                                   end
 where current_employment_status in ('ACTIVE', 'VACATION', 'LEAVE', 'INACTIVE');

-- Índice parcial de 058 referenciava status em aberto; continua válido (filtro por effective_to).
