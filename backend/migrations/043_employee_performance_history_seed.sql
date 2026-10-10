-- Fechamento do Workflow Engine (auditoria de indicadores/PRV): os fixtures de QA existentes
-- ("TESTE Quartil Q1", "TESTE Quartil Q4 Ambos") só tinham UM fechamento mensal (2026-09) em
-- employee_indicator_performance/employee_prv_performance — insuficiente pra exercitar de
-- verdade uma Condition histórica de "últimos 3 fechamentos" (ex.: PRV mínimo no trimestre).
-- Acrescenta dois fechamentos anteriores (2026-07, 2026-08) só pra essas duas pessoas já
-- existentes, sem tocar nas linhas de 2026-09 já lá nem em nenhum outro fixture. Também
-- acrescenta um fechamento de MONITORIA_QUALIDADE (indicador ainda não coberto por
-- employee_indicator_performance pra nenhuma pessoa) pra essas duas, já que os Workflows
-- operacionais reais usam esse indicador como referência de qualidade consolidada. Idempotente
-- via `not exists` — roda limpo tanto em banco novo quanto no banco de dev atual.

insert into employee_indicator_performance (organization_id, person_id, indicator_definition_id, reference_period, value, target_value, achievement_percent, weight_percent, quartile, source)
select '00000000-0000-4000-8000-000000000001', p.id, idef.id, v.reference_period, v.value, v.target_value, v.achievement_percent, v.weight_percent, v.quartile, 'MANUAL_SEED'
from (values
  ('TESTE Quartil Q1', 'MONITORIA_QUALIDADE', '2026-09', 95.0::numeric, 90.0::numeric, 105.6::numeric, 100.0::numeric, 'Q1'),
  ('TESTE Quartil Q4 Ambos', 'MONITORIA_QUALIDADE', '2026-07', 42.0::numeric, 90.0::numeric, 46.7::numeric, 100.0::numeric, 'Q4'),
  ('TESTE Quartil Q4 Ambos', 'MONITORIA_QUALIDADE', '2026-08', 38.0::numeric, 90.0::numeric, 42.2::numeric, 100.0::numeric, 'Q4'),
  ('TESTE Quartil Q4 Ambos', 'MONITORIA_QUALIDADE', '2026-09', 40.0::numeric, 90.0::numeric, 44.4::numeric, 100.0::numeric, 'Q4')
) as v(person_name, indicator_code, reference_period, value, target_value, achievement_percent, weight_percent, quartile)
join people p on p.name = v.person_name and p.organization_id = '00000000-0000-4000-8000-000000000001'
join indicator_definitions idef on idef.code = v.indicator_code and idef.organization_id = '00000000-0000-4000-8000-000000000001'
where not exists (
  select 1 from employee_indicator_performance eip
  where eip.person_id = p.id and eip.indicator_definition_id = idef.id and eip.reference_period = v.reference_period
);

insert into employee_prv_performance (organization_id, person_id, reference_period, achievement_percent, quartile, source)
select '00000000-0000-4000-8000-000000000001', p.id, v.reference_period, v.achievement_percent, v.quartile, 'MANUAL_SEED'
from (values
  ('TESTE Quartil Q4 Ambos', '2026-07', 32.0::numeric, 'Q4'),
  ('TESTE Quartil Q4 Ambos', '2026-08', 38.0::numeric, 'Q4')
) as v(person_name, reference_period, achievement_percent, quartile)
join people p on p.name = v.person_name and p.organization_id = '00000000-0000-4000-8000-000000000001'
where not exists (
  select 1 from employee_prv_performance epp where epp.person_id = p.id and epp.reference_period = v.reference_period
);
