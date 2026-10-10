-- Camada 1 (medição OPERACIONAL) x Camada 2 (fechamento OFICIAL). Esta migration só evolui a
-- camada 1: `indicator_measurements` passa a declarar a GRANULARIDADE do intervalo de negócio
-- ([period_start, period_end], que já existiam) e os COMPONENTES de agregação (numerador,
-- denominador, amostra) — sem isso, agregar vários períodos vira média de médias (TMA de uma
-- semana como AVG dos TMAs diários, ignorando volumes). `value` continua sendo a medição
-- apresentável do período; os componentes servem pra agregar corretamente vários períodos.
-- Nenhuma linha de fechamento oficial (employee_indicator_performance / employee_prv_performance)
-- é tocada. Nenhum dado demo entra por aqui (dados demo = seed, nunca migration).

alter table indicator_measurements
  add column granularity text not null default 'CUSTOM',
  add column numerator numeric,
  add column denominator numeric,
  add column sample_count integer;

alter table indicator_measurements
  add constraint indicator_measurements_granularity_check
    check (granularity in ('DAILY', 'MONTHLY', 'HOURLY', 'INTERACTION', 'CUSTOM')),
  add constraint indicator_measurements_sample_count_check check (sample_count is null or sample_count >= 0),
  add constraint indicator_measurements_denominator_check check (denominator is null or denominator >= 0);

-- Backfill honesto do legado: um intervalo que cobre um mês civil inteiro é MONTHLY; um intervalo
-- de um dia local (00:00 → 23:59:59 / 00:00 do dia seguinte) é DAILY; o resto (pontos de QA com
-- janelas arbitrárias) fica como CUSTOM — nunca reinterpretado.
update indicator_measurements
set granularity = case
  when period_end - period_start >= interval '27 days' and period_end - period_start <= interval '31 days 1 second' then 'MONTHLY'
  when period_end - period_start >= interval '23 hours' and period_end - period_start <= interval '24 hours 1 second' then 'DAILY'
  else 'CUSTOM'
end;

-- Consultas operacionais: (indicador, colaborador, sobreposição com a janela). O índice existente
-- (idx_measurements_subject_period) começa por organization_id, que o resolvedor não filtra —
-- este cobre exatamente o padrão "indicador + subject_id = any(...) + period_start/period_end".
create index idx_measurements_person_indicator_window
  on indicator_measurements (indicator_definition_id, subject_id, period_start, period_end)
  where subject_type = 'PERSON';

-- Semântica de agregação OPERACIONAL do indicador (camada 1). Nunca decide nada do fechamento
-- oficial. `operational_aggregation` = como vários períodos se combinam; `daily_supported` = se
-- o indicador faz sentido como medição diária por colaborador (auditado um a um, ver
-- docs/workflow-engine-wiki.md — "Medição operacional x Fechamento oficial").
alter table indicator_definitions
  add column operational_aggregation text not null default 'AVERAGE',
  add column daily_supported boolean not null default false;

alter table indicator_definitions
  add constraint indicator_definitions_operational_aggregation_check
    check (operational_aggregation in ('WEIGHTED_AVERAGE', 'RATE', 'AVERAGE', 'SUM', 'LATEST'));

-- WEIGHTED_AVERAGE: numerador = total (segundos, pontos), denominador = volume (contatos,
-- avaliações, respostas); agregado = Σnumerador / Σdenominador.
update indicator_definitions set operational_aggregation = 'WEIGHTED_AVERAGE', daily_supported = true
  where code in ('TMA', 'TMT', 'TEMPO_DIAGNOSTICO', 'NOTA_URA', 'NPS', 'MONITORIA_QUALIDADE', 'QUALIDADE_ANALISE');
-- RATE: numerador = ocorrências, denominador = elegíveis; agregado = Σnumerador / Σdenominador × 100.
update indicator_definitions set operational_aggregation = 'RATE', daily_supported = true
  where code in ('FCR', 'REINCIDENCIA_7D', 'TAXA_TRANSFERENCIA', 'TAXA_RETRABALHO', 'TAXA_RETENCAO', 'RECONTATO_CANCELAMENTO', 'SLA_24H', 'ADERENCIA', 'TEMPO_DISPONIVEL');
-- LATEST: snapshot — o "backlog da semana" é o último backlog, nunca a soma dos snapshots.
update indicator_definitions set operational_aggregation = 'LATEST', daily_supported = true
  where code = 'BACKLOG';
-- Sem medição diária por colaborador nesta evolução (ver wiki): taxas de fila/campanha apuradas
-- por estrutura ou por mês, e derivados de flags por interação (granularidade INTERACTION futura).
update indicator_definitions set operational_aggregation = 'RATE', daily_supported = false
  where code in ('TAXA_ABANDONO', 'CONVERSAO_UPSELL');
update indicator_definitions set operational_aggregation = 'WEIGHTED_AVERAGE', daily_supported = false
  where code in ('QUALIDADE', 'TDNA', 'TEMPO_SILENCIO');
update indicator_definitions set operational_aggregation = 'AVERAGE', daily_supported = false
  where code = 'PRODUTIVIDADE';
