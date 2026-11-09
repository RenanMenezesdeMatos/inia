-- Fechamentos oficiais de performance para os 11 operadores LEGADOS de demonstração (os que já
-- tinham conta de acesso antes da massa demo — ver demo-mass/). Achado da reconstrução de
-- Indicadores/Equipe: só os fixtures "TESTE *" tinham linhas em employee_indicator_performance /
-- employee_prv_performance — nenhum operador com login conseguia validar a visão de PRV
-- oficial/composição/histórico. Este seed representa o que a FONTE OFICIAL entregaria (valor,
-- meta vigente do grupo, atingimento, peso e quartil já prontos); a aplicação continua só lendo.
-- `source = 'DEMO_SEED'` marca a proveniência. Idempotente via `not exists` — nunca sobrescreve
-- um fechamento já existente.
--
-- AUTOSSUFICIENTE (hardening do seed:test): as pessoas são referenciadas por id fixo, então o
-- `join people` garante que só entram linhas de pessoas que EXISTEM no banco alvo — num banco
-- recém-migrado só entram Ana Lima e Juliana Prado (as 2 que as migrations criam), as outras 9
-- são puladas em vez de estourar a FK; o runner
-- (run-demo-seed.ts) reporta a contagem. Fechamento oficial só existe para MÊS CIVIL COMPLETO:
-- competências iguais ou posteriores ao mês corrente (calendário America/Fortaleza, o mesmo
-- fallback do motor) nunca entram — o mês corrente é acompanhamento operacional, não fechamento.
-- Peso: divisão igual entre os indicadores do grupo (o programa real define isso).

insert into employee_indicator_performance_all (organization_id, person_id, indicator_definition_id, reference_period, value, target_value, achievement_percent, weight_percent, quartile, source)
select '00000000-0000-4000-8000-000000000001', v.person_id::uuid, idef.id, v.reference_period, v.value, v.target_value, v.achievement_percent, v.weight_percent, v.quartile, 'DEMO_SEED'
from (values
  ('00000000-0000-4000-8000-000000000030', 'ADERENCIA', '2026-07', 103.14::numeric, 91.0::numeric, 113.3::numeric, 13::numeric, 'Q1'),  -- Ana Lima
  ('00000000-0000-4000-8000-000000000030', 'CONVERSAO_UPSELL', '2026-07', 12.75::numeric, 12.0::numeric, 106.2::numeric, 13::numeric, 'Q3'),  -- Ana Lima
  ('00000000-0000-4000-8000-000000000030', 'MONITORIA_QUALIDADE', '2026-07', 92.28::numeric, 93.0::numeric, 99.2::numeric, 13::numeric, 'Q3'),  -- Ana Lima
  ('00000000-0000-4000-8000-000000000030', 'RECONTATO_CANCELAMENTO', '2026-07', 8.94::numeric, 8.0::numeric, 89.5::numeric, 13::numeric, 'Q3'),  -- Ana Lima
  ('00000000-0000-4000-8000-000000000030', 'TAXA_RETENCAO', '2026-07', 54.36::numeric, 62.0::numeric, 87.7::numeric, 12::numeric, 'Q3'),  -- Ana Lima
  ('00000000-0000-4000-8000-000000000030', 'TDNA', '2026-07', 4.15::numeric, 4.5::numeric, 92.2::numeric, 12::numeric, 'Q3'),  -- Ana Lima
  ('00000000-0000-4000-8000-000000000030', 'TEMPO_SILENCIO', '2026-07', 15.47::numeric, 15.0::numeric, 97.0::numeric, 12::numeric, 'Q1'),  -- Ana Lima
  ('00000000-0000-4000-8000-000000000030', 'TMA', '2026-07', 596.0::numeric, 600.0::numeric, 100.7::numeric, 12::numeric, 'Q1'),  -- Ana Lima
  ('00000000-0000-4000-8000-000000000030', 'ADERENCIA', '2026-08', 98.01::numeric, 91.0::numeric, 107.7::numeric, 13::numeric, 'Q1'),  -- Ana Lima
  ('00000000-0000-4000-8000-000000000030', 'CONVERSAO_UPSELL', '2026-08', 12.88::numeric, 12.0::numeric, 107.3::numeric, 13::numeric, 'Q1'),  -- Ana Lima
  ('00000000-0000-4000-8000-000000000030', 'MONITORIA_QUALIDADE', '2026-08', 97.05::numeric, 93.0::numeric, 104.4::numeric, 13::numeric, 'Q3'),  -- Ana Lima
  ('00000000-0000-4000-8000-000000000030', 'RECONTATO_CANCELAMENTO', '2026-08', 8.41::numeric, 8.0::numeric, 95.1::numeric, 13::numeric, 'Q3'),  -- Ana Lima
  ('00000000-0000-4000-8000-000000000030', 'TAXA_RETENCAO', '2026-08', 52.18::numeric, 62.0::numeric, 84.2::numeric, 12::numeric, 'Q3'),  -- Ana Lima
  ('00000000-0000-4000-8000-000000000030', 'TDNA', '2026-08', 4.34::numeric, 4.5::numeric, 96.4::numeric, 12::numeric, 'Q3'),  -- Ana Lima
  ('00000000-0000-4000-8000-000000000030', 'TEMPO_SILENCIO', '2026-08', 15.64::numeric, 15.0::numeric, 95.9::numeric, 12::numeric, 'Q1'),  -- Ana Lima
  ('00000000-0000-4000-8000-000000000030', 'TMA', '2026-08', 542.0::numeric, 600.0::numeric, 110.7::numeric, 12::numeric, 'Q1'),  -- Ana Lima
  ('00000000-0000-4000-8000-000000000030', 'ADERENCIA', '2026-09', 99.92::numeric, 91.0::numeric, 109.8::numeric, 13::numeric, 'Q1'),  -- Ana Lima
  ('00000000-0000-4000-8000-000000000030', 'CONVERSAO_UPSELL', '2026-09', 12.61::numeric, 12.0::numeric, 105.1::numeric, 13::numeric, 'Q1'),  -- Ana Lima
  ('00000000-0000-4000-8000-000000000030', 'MONITORIA_QUALIDADE', '2026-09', 95.97::numeric, 93.0::numeric, 103.2::numeric, 13::numeric, 'Q3'),  -- Ana Lima
  ('00000000-0000-4000-8000-000000000030', 'RECONTATO_CANCELAMENTO', '2026-09', 8.58::numeric, 8.0::numeric, 93.2::numeric, 13::numeric, 'Q3'),  -- Ana Lima
  ('00000000-0000-4000-8000-000000000030', 'TAXA_RETENCAO', '2026-09', 51.64::numeric, 62.0::numeric, 83.3::numeric, 12::numeric, 'Q3'),  -- Ana Lima
  ('00000000-0000-4000-8000-000000000030', 'TDNA', '2026-09', 4.16::numeric, 4.5::numeric, 92.4::numeric, 12::numeric, 'Q3'),  -- Ana Lima
  ('00000000-0000-4000-8000-000000000030', 'TEMPO_SILENCIO', '2026-09', 16.15::numeric, 15.0::numeric, 92.9::numeric, 12::numeric, 'Q3'),  -- Ana Lima
  ('00000000-0000-4000-8000-000000000030', 'TMA', '2026-09', 566.0::numeric, 600.0::numeric, 106.0::numeric, 12::numeric, 'Q1'),  -- Ana Lima
  ('53d33ea1-6b44-4cbc-b865-3ad44f1507fa', 'BACKLOG', '2026-07', 202.0::numeric, 180.0::numeric, 89.1::numeric, 15::numeric, 'Q3'),  -- Camila Pereira
  ('53d33ea1-6b44-4cbc-b865-3ad44f1507fa', 'MONITORIA_QUALIDADE', '2026-07', 101.46::numeric, 92.0::numeric, 110.3::numeric, 15::numeric, 'Q1'),  -- Camila Pereira
  ('53d33ea1-6b44-4cbc-b865-3ad44f1507fa', 'PRODUTIVIDADE', '2026-07', 42.53::numeric, 38.0::numeric, 111.9::numeric, 14::numeric, 'Q1'),  -- Camila Pereira
  ('53d33ea1-6b44-4cbc-b865-3ad44f1507fa', 'QUALIDADE_ANALISE', '2026-07', 95.41::numeric, 94.0::numeric, 101.5::numeric, 14::numeric, 'Q3'),  -- Camila Pereira
  ('53d33ea1-6b44-4cbc-b865-3ad44f1507fa', 'SLA_24H', '2026-07', 87.09::numeric, 90.0::numeric, 96.8::numeric, 14::numeric, 'Q3'),  -- Camila Pereira
  ('53d33ea1-6b44-4cbc-b865-3ad44f1507fa', 'TAXA_RETRABALHO', '2026-07', 3.61::numeric, 4.0::numeric, 110.8::numeric, 14::numeric, 'Q1'),  -- Camila Pereira
  ('53d33ea1-6b44-4cbc-b865-3ad44f1507fa', 'TMT', '2026-07', 648.0::numeric, 720.0::numeric, 111.1::numeric, 14::numeric, 'Q1'),  -- Camila Pereira
  ('53d33ea1-6b44-4cbc-b865-3ad44f1507fa', 'BACKLOG', '2026-08', 209.0::numeric, 180.0::numeric, 86.1::numeric, 15::numeric, 'Q3'),  -- Camila Pereira
  ('53d33ea1-6b44-4cbc-b865-3ad44f1507fa', 'MONITORIA_QUALIDADE', '2026-08', 101.4::numeric, 92.0::numeric, 110.2::numeric, 15::numeric, 'Q1'),  -- Camila Pereira
  ('53d33ea1-6b44-4cbc-b865-3ad44f1507fa', 'PRODUTIVIDADE', '2026-08', 41.7::numeric, 38.0::numeric, 109.7::numeric, 14::numeric, 'Q1'),  -- Camila Pereira
  ('53d33ea1-6b44-4cbc-b865-3ad44f1507fa', 'QUALIDADE_ANALISE', '2026-08', 100.62::numeric, 94.0::numeric, 107.0::numeric, 14::numeric, 'Q2'),  -- Camila Pereira
  ('53d33ea1-6b44-4cbc-b865-3ad44f1507fa', 'SLA_24H', '2026-08', 87.76::numeric, 90.0::numeric, 97.5::numeric, 14::numeric, 'Q3'),  -- Camila Pereira
  ('53d33ea1-6b44-4cbc-b865-3ad44f1507fa', 'TAXA_RETRABALHO', '2026-08', 3.78::numeric, 4.0::numeric, 105.8::numeric, 14::numeric, 'Q1'),  -- Camila Pereira
  ('53d33ea1-6b44-4cbc-b865-3ad44f1507fa', 'TMT', '2026-08', 664.0::numeric, 720.0::numeric, 108.4::numeric, 14::numeric, 'Q1'),  -- Camila Pereira
  ('53d33ea1-6b44-4cbc-b865-3ad44f1507fa', 'BACKLOG', '2026-09', 200.0::numeric, 180.0::numeric, 90.0::numeric, 15::numeric, 'Q2'),  -- Camila Pereira
  ('53d33ea1-6b44-4cbc-b865-3ad44f1507fa', 'MONITORIA_QUALIDADE', '2026-09', 99.7::numeric, 92.0::numeric, 108.4::numeric, 15::numeric, 'Q1'),  -- Camila Pereira
  ('53d33ea1-6b44-4cbc-b865-3ad44f1507fa', 'PRODUTIVIDADE', '2026-09', 41.35::numeric, 38.0::numeric, 108.8::numeric, 14::numeric, 'Q1'),  -- Camila Pereira
  ('53d33ea1-6b44-4cbc-b865-3ad44f1507fa', 'QUALIDADE_ANALISE', '2026-09', 101.06::numeric, 94.0::numeric, 107.5::numeric, 14::numeric, 'Q2'),  -- Camila Pereira
  ('53d33ea1-6b44-4cbc-b865-3ad44f1507fa', 'SLA_24H', '2026-09', 90.82::numeric, 90.0::numeric, 100.9::numeric, 14::numeric, 'Q3'),  -- Camila Pereira
  ('53d33ea1-6b44-4cbc-b865-3ad44f1507fa', 'TAXA_RETRABALHO', '2026-09', 3.6::numeric, 4.0::numeric, 111.1::numeric, 14::numeric, 'Q1'),  -- Camila Pereira
  ('53d33ea1-6b44-4cbc-b865-3ad44f1507fa', 'TMT', '2026-09', 679.0::numeric, 720.0::numeric, 106.0::numeric, 14::numeric, 'Q1'),  -- Camila Pereira
  ('46625f7e-a98f-49a0-b7ce-6812891d5264', 'FCR', '2026-07', 78.6::numeric, 75.0::numeric, 104.8::numeric, 13::numeric, 'Q1'),  -- Denisy Feitoza
  ('46625f7e-a98f-49a0-b7ce-6812891d5264', 'MONITORIA_QUALIDADE', '2026-07', 81.45::numeric, 91.0::numeric, 89.5::numeric, 13::numeric, 'Q2'),  -- Denisy Feitoza
  ('46625f7e-a98f-49a0-b7ce-6812891d5264', 'NOTA_URA', '2026-07', 3.6::numeric, 4.3::numeric, 83.7::numeric, 13::numeric, 'Q3'),  -- Denisy Feitoza
  ('46625f7e-a98f-49a0-b7ce-6812891d5264', 'REINCIDENCIA_7D', '2026-07', 8.93::numeric, 9.0::numeric, 100.8::numeric, 13::numeric, 'Q2'),  -- Denisy Feitoza
  ('46625f7e-a98f-49a0-b7ce-6812891d5264', 'TAXA_TRANSFERENCIA', '2026-07', 10.04::numeric, 10.0::numeric, 99.6::numeric, 12::numeric, 'Q1'),  -- Denisy Feitoza
  ('46625f7e-a98f-49a0-b7ce-6812891d5264', 'TEMPO_DIAGNOSTICO', '2026-07', 293.0::numeric, 300.0::numeric, 102.4::numeric, 12::numeric, 'Q3'),  -- Denisy Feitoza
  ('46625f7e-a98f-49a0-b7ce-6812891d5264', 'TEMPO_DISPONIVEL', '2026-07', 79.9::numeric, 80.0::numeric, 99.9::numeric, 12::numeric, 'Q3'),  -- Denisy Feitoza
  ('46625f7e-a98f-49a0-b7ce-6812891d5264', 'TMA', '2026-07', 513.0::numeric, 540.0::numeric, 105.3::numeric, 12::numeric, 'Q2'),  -- Denisy Feitoza
  ('46625f7e-a98f-49a0-b7ce-6812891d5264', 'FCR', '2026-08', 81.71::numeric, 75.0::numeric, 108.9::numeric, 13::numeric, 'Q1'),  -- Denisy Feitoza
  ('46625f7e-a98f-49a0-b7ce-6812891d5264', 'MONITORIA_QUALIDADE', '2026-08', 80.44::numeric, 91.0::numeric, 88.4::numeric, 13::numeric, 'Q2'),  -- Denisy Feitoza
  ('46625f7e-a98f-49a0-b7ce-6812891d5264', 'NOTA_URA', '2026-08', 3.53::numeric, 4.3::numeric, 82.1::numeric, 13::numeric, 'Q3'),  -- Denisy Feitoza
  ('46625f7e-a98f-49a0-b7ce-6812891d5264', 'REINCIDENCIA_7D', '2026-08', 8.83::numeric, 9.0::numeric, 101.9::numeric, 13::numeric, 'Q1'),  -- Denisy Feitoza
  ('46625f7e-a98f-49a0-b7ce-6812891d5264', 'TAXA_TRANSFERENCIA', '2026-08', 10.07::numeric, 10.0::numeric, 99.3::numeric, 12::numeric, 'Q1'),  -- Denisy Feitoza
  ('46625f7e-a98f-49a0-b7ce-6812891d5264', 'TEMPO_DIAGNOSTICO', '2026-08', 293.0::numeric, 300.0::numeric, 102.4::numeric, 12::numeric, 'Q3'),  -- Denisy Feitoza
  ('46625f7e-a98f-49a0-b7ce-6812891d5264', 'TEMPO_DISPONIVEL', '2026-08', 78.19::numeric, 80.0::numeric, 97.7::numeric, 12::numeric, 'Q2'),  -- Denisy Feitoza
  ('46625f7e-a98f-49a0-b7ce-6812891d5264', 'TMA', '2026-08', 546.0::numeric, 540.0::numeric, 98.9::numeric, 12::numeric, 'Q2'),  -- Denisy Feitoza
  ('46625f7e-a98f-49a0-b7ce-6812891d5264', 'FCR', '2026-09', 81.69::numeric, 75.0::numeric, 108.9::numeric, 13::numeric, 'Q1'),  -- Denisy Feitoza
  ('46625f7e-a98f-49a0-b7ce-6812891d5264', 'MONITORIA_QUALIDADE', '2026-09', 82.16::numeric, 91.0::numeric, 90.3::numeric, 13::numeric, 'Q2'),  -- Denisy Feitoza
  ('46625f7e-a98f-49a0-b7ce-6812891d5264', 'NOTA_URA', '2026-09', 3.47::numeric, 4.3::numeric, 80.7::numeric, 13::numeric, 'Q3'),  -- Denisy Feitoza
  ('46625f7e-a98f-49a0-b7ce-6812891d5264', 'REINCIDENCIA_7D', '2026-09', 8.43::numeric, 9.0::numeric, 106.8::numeric, 13::numeric, 'Q1'),  -- Denisy Feitoza
  ('46625f7e-a98f-49a0-b7ce-6812891d5264', 'TAXA_TRANSFERENCIA', '2026-09', 10.61::numeric, 10.0::numeric, 94.3::numeric, 12::numeric, 'Q1'),  -- Denisy Feitoza
  ('46625f7e-a98f-49a0-b7ce-6812891d5264', 'TEMPO_DIAGNOSTICO', '2026-09', 278.0::numeric, 300.0::numeric, 107.9::numeric, 12::numeric, 'Q2'),  -- Denisy Feitoza
  ('46625f7e-a98f-49a0-b7ce-6812891d5264', 'TEMPO_DISPONIVEL', '2026-09', 81.54::numeric, 80.0::numeric, 101.9::numeric, 12::numeric, 'Q3'),  -- Denisy Feitoza
  ('46625f7e-a98f-49a0-b7ce-6812891d5264', 'TMA', '2026-09', 517.0::numeric, 540.0::numeric, 104.4::numeric, 12::numeric, 'Q2'),  -- Denisy Feitoza
  ('bd5c6664-7fbc-4adc-acdd-1cfde552ff9b', 'BACKLOG', '2026-07', 194.0::numeric, 180.0::numeric, 92.8::numeric, 15::numeric, 'Q2'),  -- Gustavo Santos
  ('bd5c6664-7fbc-4adc-acdd-1cfde552ff9b', 'MONITORIA_QUALIDADE', '2026-07', 91.7::numeric, 92.0::numeric, 99.7::numeric, 15::numeric, 'Q2'),  -- Gustavo Santos
  ('bd5c6664-7fbc-4adc-acdd-1cfde552ff9b', 'PRODUTIVIDADE', '2026-07', 38.02::numeric, 38.0::numeric, 100.1::numeric, 14::numeric, 'Q3'),  -- Gustavo Santos
  ('bd5c6664-7fbc-4adc-acdd-1cfde552ff9b', 'QUALIDADE_ANALISE', '2026-07', 98.38::numeric, 94.0::numeric, 104.7::numeric, 14::numeric, 'Q2'),  -- Gustavo Santos
  ('bd5c6664-7fbc-4adc-acdd-1cfde552ff9b', 'SLA_24H', '2026-07', 97.2::numeric, 90.0::numeric, 108.0::numeric, 14::numeric, 'Q2'),  -- Gustavo Santos
  ('bd5c6664-7fbc-4adc-acdd-1cfde552ff9b', 'TAXA_RETRABALHO', '2026-07', 4.68::numeric, 4.0::numeric, 85.5::numeric, 14::numeric, 'Q2'),  -- Gustavo Santos
  ('bd5c6664-7fbc-4adc-acdd-1cfde552ff9b', 'TMT', '2026-07', 770.0::numeric, 720.0::numeric, 93.5::numeric, 14::numeric, 'Q2'),  -- Gustavo Santos
  ('bd5c6664-7fbc-4adc-acdd-1cfde552ff9b', 'BACKLOG', '2026-08', 202.0::numeric, 180.0::numeric, 89.1::numeric, 15::numeric, 'Q1'),  -- Gustavo Santos
  ('bd5c6664-7fbc-4adc-acdd-1cfde552ff9b', 'MONITORIA_QUALIDADE', '2026-08', 91.67::numeric, 92.0::numeric, 99.6::numeric, 15::numeric, 'Q2'),  -- Gustavo Santos
  ('bd5c6664-7fbc-4adc-acdd-1cfde552ff9b', 'PRODUTIVIDADE', '2026-08', 40.31::numeric, 38.0::numeric, 106.1::numeric, 14::numeric, 'Q2'),  -- Gustavo Santos
  ('bd5c6664-7fbc-4adc-acdd-1cfde552ff9b', 'QUALIDADE_ANALISE', '2026-08', 99.05::numeric, 94.0::numeric, 105.4::numeric, 14::numeric, 'Q3'),  -- Gustavo Santos
  ('bd5c6664-7fbc-4adc-acdd-1cfde552ff9b', 'SLA_24H', '2026-08', 96.72::numeric, 90.0::numeric, 107.5::numeric, 14::numeric, 'Q1'),  -- Gustavo Santos
  ('bd5c6664-7fbc-4adc-acdd-1cfde552ff9b', 'TAXA_RETRABALHO', '2026-08', 4.47::numeric, 4.0::numeric, 89.5::numeric, 14::numeric, 'Q3'),  -- Gustavo Santos
  ('bd5c6664-7fbc-4adc-acdd-1cfde552ff9b', 'TMT', '2026-08', 850.0::numeric, 720.0::numeric, 84.7::numeric, 14::numeric, 'Q3'),  -- Gustavo Santos
  ('bd5c6664-7fbc-4adc-acdd-1cfde552ff9b', 'BACKLOG', '2026-09', 193.0::numeric, 180.0::numeric, 93.3::numeric, 15::numeric, 'Q1'),  -- Gustavo Santos
  ('bd5c6664-7fbc-4adc-acdd-1cfde552ff9b', 'MONITORIA_QUALIDADE', '2026-09', 96.35::numeric, 92.0::numeric, 104.7::numeric, 15::numeric, 'Q2'),  -- Gustavo Santos
  ('bd5c6664-7fbc-4adc-acdd-1cfde552ff9b', 'PRODUTIVIDADE', '2026-09', 38.82::numeric, 38.0::numeric, 102.2::numeric, 14::numeric, 'Q3'),  -- Gustavo Santos
  ('bd5c6664-7fbc-4adc-acdd-1cfde552ff9b', 'QUALIDADE_ANALISE', '2026-09', 96.98::numeric, 94.0::numeric, 103.2::numeric, 14::numeric, 'Q3'),  -- Gustavo Santos
  ('bd5c6664-7fbc-4adc-acdd-1cfde552ff9b', 'SLA_24H', '2026-09', 93.54::numeric, 90.0::numeric, 103.9::numeric, 14::numeric, 'Q2'),  -- Gustavo Santos
  ('bd5c6664-7fbc-4adc-acdd-1cfde552ff9b', 'TAXA_RETRABALHO', '2026-09', 4.75::numeric, 4.0::numeric, 84.2::numeric, 14::numeric, 'Q3'),  -- Gustavo Santos
  ('bd5c6664-7fbc-4adc-acdd-1cfde552ff9b', 'TMT', '2026-09', 802.0::numeric, 720.0::numeric, 89.8::numeric, 14::numeric, 'Q2'),  -- Gustavo Santos
  ('5690796d-e5af-4cb3-84b8-88eee6e7f2cf', 'ADERENCIA', '2026-07', 93.75::numeric, 92.0::numeric, 101.9::numeric, 13::numeric, 'Q2'),  -- Icaro Elias
  ('5690796d-e5af-4cb3-84b8-88eee6e7f2cf', 'FCR', '2026-07', 80.1::numeric, 78.0::numeric, 102.7::numeric, 13::numeric, 'Q2'),  -- Icaro Elias
  ('5690796d-e5af-4cb3-84b8-88eee6e7f2cf', 'MONITORIA_QUALIDADE', '2026-07', 95.72::numeric, 90.0::numeric, 106.4::numeric, 13::numeric, 'Q1'),  -- Icaro Elias
  ('5690796d-e5af-4cb3-84b8-88eee6e7f2cf', 'TAXA_ABANDONO', '2026-07', 4.56::numeric, 5.0::numeric, 109.6::numeric, 13::numeric, 'Q1'),  -- Icaro Elias
  ('5690796d-e5af-4cb3-84b8-88eee6e7f2cf', 'TDNA', '2026-07', 4.61::numeric, 4.4::numeric, 104.8::numeric, 12::numeric, 'Q2'),  -- Icaro Elias
  ('5690796d-e5af-4cb3-84b8-88eee6e7f2cf', 'TEMPO_DISPONIVEL', '2026-07', 80.7::numeric, 82.0::numeric, 98.4::numeric, 12::numeric, 'Q1'),  -- Icaro Elias
  ('5690796d-e5af-4cb3-84b8-88eee6e7f2cf', 'TEMPO_SILENCIO', '2026-07', 10.99::numeric, 12.0::numeric, 109.2::numeric, 12::numeric, 'Q1'),  -- Icaro Elias
  ('5690796d-e5af-4cb3-84b8-88eee6e7f2cf', 'TMA', '2026-07', 390.0::numeric, 420.0::numeric, 107.7::numeric, 12::numeric, 'Q1'),  -- Icaro Elias
  ('5690796d-e5af-4cb3-84b8-88eee6e7f2cf', 'ADERENCIA', '2026-08', 103.59::numeric, 92.0::numeric, 112.6::numeric, 13::numeric, 'Q1'),  -- Icaro Elias
  ('5690796d-e5af-4cb3-84b8-88eee6e7f2cf', 'FCR', '2026-08', 77.29::numeric, 78.0::numeric, 99.1::numeric, 13::numeric, 'Q2'),  -- Icaro Elias
  ('5690796d-e5af-4cb3-84b8-88eee6e7f2cf', 'MONITORIA_QUALIDADE', '2026-08', 100.2::numeric, 90.0::numeric, 111.3::numeric, 13::numeric, 'Q1'),  -- Icaro Elias
  ('5690796d-e5af-4cb3-84b8-88eee6e7f2cf', 'TAXA_ABANDONO', '2026-08', 4.62::numeric, 5.0::numeric, 108.2::numeric, 13::numeric, 'Q1'),  -- Icaro Elias
  ('5690796d-e5af-4cb3-84b8-88eee6e7f2cf', 'TDNA', '2026-08', 4.66::numeric, 4.4::numeric, 105.9::numeric, 12::numeric, 'Q1'),  -- Icaro Elias
  ('5690796d-e5af-4cb3-84b8-88eee6e7f2cf', 'TEMPO_DISPONIVEL', '2026-08', 75.7::numeric, 82.0::numeric, 92.3::numeric, 12::numeric, 'Q1'),  -- Icaro Elias
  ('5690796d-e5af-4cb3-84b8-88eee6e7f2cf', 'TEMPO_SILENCIO', '2026-08', 11.51::numeric, 12.0::numeric, 104.3::numeric, 12::numeric, 'Q2'),  -- Icaro Elias
  ('5690796d-e5af-4cb3-84b8-88eee6e7f2cf', 'TMA', '2026-08', 390.0::numeric, 420.0::numeric, 107.7::numeric, 12::numeric, 'Q1'),  -- Icaro Elias
  ('5690796d-e5af-4cb3-84b8-88eee6e7f2cf', 'ADERENCIA', '2026-09', 98.39::numeric, 92.0::numeric, 106.9::numeric, 13::numeric, 'Q2'),  -- Icaro Elias
  ('5690796d-e5af-4cb3-84b8-88eee6e7f2cf', 'FCR', '2026-09', 81.49::numeric, 78.0::numeric, 104.5::numeric, 13::numeric, 'Q1'),  -- Icaro Elias
  ('5690796d-e5af-4cb3-84b8-88eee6e7f2cf', 'MONITORIA_QUALIDADE', '2026-09', 98.09::numeric, 90.0::numeric, 109.0::numeric, 13::numeric, 'Q1'),  -- Icaro Elias
  ('5690796d-e5af-4cb3-84b8-88eee6e7f2cf', 'TAXA_ABANDONO', '2026-09', 4.71::numeric, 5.0::numeric, 106.2::numeric, 13::numeric, 'Q1'),  -- Icaro Elias
  ('5690796d-e5af-4cb3-84b8-88eee6e7f2cf', 'TDNA', '2026-09', 4.61::numeric, 4.4::numeric, 104.8::numeric, 12::numeric, 'Q2'),  -- Icaro Elias
  ('5690796d-e5af-4cb3-84b8-88eee6e7f2cf', 'TEMPO_DISPONIVEL', '2026-09', 77.21::numeric, 82.0::numeric, 94.2::numeric, 12::numeric, 'Q1'),  -- Icaro Elias
  ('5690796d-e5af-4cb3-84b8-88eee6e7f2cf', 'TEMPO_SILENCIO', '2026-09', 11.61::numeric, 12.0::numeric, 103.4::numeric, 12::numeric, 'Q2'),  -- Icaro Elias
  ('5690796d-e5af-4cb3-84b8-88eee6e7f2cf', 'TMA', '2026-09', 388.0::numeric, 420.0::numeric, 108.2::numeric, 12::numeric, 'Q1'),  -- Icaro Elias
  ('00000000-0000-4000-8000-000000000036', 'FCR', '2026-07', 78.18::numeric, 75.0::numeric, 104.2::numeric, 13::numeric, 'Q2'),  -- Juliana Prado
  ('00000000-0000-4000-8000-000000000036', 'MONITORIA_QUALIDADE', '2026-07', 76.57::numeric, 91.0::numeric, 84.1::numeric, 13::numeric, 'Q3'),  -- Juliana Prado
  ('00000000-0000-4000-8000-000000000036', 'NOTA_URA', '2026-07', 4.06::numeric, 4.3::numeric, 94.4::numeric, 13::numeric, 'Q2'),  -- Juliana Prado
  ('00000000-0000-4000-8000-000000000036', 'REINCIDENCIA_7D', '2026-07', 8.23::numeric, 9.0::numeric, 109.4::numeric, 13::numeric, 'Q1'),  -- Juliana Prado
  ('00000000-0000-4000-8000-000000000036', 'TAXA_TRANSFERENCIA', '2026-07', 11.65::numeric, 10.0::numeric, 85.8::numeric, 12::numeric, 'Q3'),  -- Juliana Prado
  ('00000000-0000-4000-8000-000000000036', 'TEMPO_DIAGNOSTICO', '2026-07', 281.0::numeric, 300.0::numeric, 106.8::numeric, 12::numeric, 'Q2'),  -- Juliana Prado
  ('00000000-0000-4000-8000-000000000036', 'TEMPO_DISPONIVEL', '2026-07', 80.72::numeric, 80.0::numeric, 100.9::numeric, 12::numeric, 'Q2'),  -- Juliana Prado
  ('00000000-0000-4000-8000-000000000036', 'TMA', '2026-07', 646.0::numeric, 540.0::numeric, 83.6::numeric, 12::numeric, 'Q3'),  -- Juliana Prado
  ('00000000-0000-4000-8000-000000000036', 'FCR', '2026-08', 75.14::numeric, 75.0::numeric, 100.2::numeric, 13::numeric, 'Q2'),  -- Juliana Prado
  ('00000000-0000-4000-8000-000000000036', 'MONITORIA_QUALIDADE', '2026-08', 74.46::numeric, 91.0::numeric, 81.8::numeric, 13::numeric, 'Q3'),  -- Juliana Prado
  ('00000000-0000-4000-8000-000000000036', 'NOTA_URA', '2026-08', 4.35::numeric, 4.3::numeric, 101.2::numeric, 13::numeric, 'Q2'),  -- Juliana Prado
  ('00000000-0000-4000-8000-000000000036', 'REINCIDENCIA_7D', '2026-08', 8.88::numeric, 9.0::numeric, 101.4::numeric, 13::numeric, 'Q2'),  -- Juliana Prado
  ('00000000-0000-4000-8000-000000000036', 'TAXA_TRANSFERENCIA', '2026-08', 11.34::numeric, 10.0::numeric, 88.2::numeric, 12::numeric, 'Q3'),  -- Juliana Prado
  ('00000000-0000-4000-8000-000000000036', 'TEMPO_DIAGNOSTICO', '2026-08', 262.0::numeric, 300.0::numeric, 114.5::numeric, 12::numeric, 'Q1'),  -- Juliana Prado
  ('00000000-0000-4000-8000-000000000036', 'TEMPO_DISPONIVEL', '2026-08', 82.77::numeric, 80.0::numeric, 103.5::numeric, 12::numeric, 'Q1'),  -- Juliana Prado
  ('00000000-0000-4000-8000-000000000036', 'TMA', '2026-08', 649.0::numeric, 540.0::numeric, 83.2::numeric, 12::numeric, 'Q3'),  -- Juliana Prado
  ('00000000-0000-4000-8000-000000000036', 'FCR', '2026-09', 76.5::numeric, 75.0::numeric, 102.0::numeric, 13::numeric, 'Q2'),  -- Juliana Prado
  ('00000000-0000-4000-8000-000000000036', 'MONITORIA_QUALIDADE', '2026-09', 75.82::numeric, 91.0::numeric, 83.3::numeric, 13::numeric, 'Q3'),  -- Juliana Prado
  ('00000000-0000-4000-8000-000000000036', 'NOTA_URA', '2026-09', 4.31::numeric, 4.3::numeric, 100.2::numeric, 13::numeric, 'Q2'),  -- Juliana Prado
  ('00000000-0000-4000-8000-000000000036', 'REINCIDENCIA_7D', '2026-09', 8.52::numeric, 9.0::numeric, 105.6::numeric, 13::numeric, 'Q2'),  -- Juliana Prado
  ('00000000-0000-4000-8000-000000000036', 'TAXA_TRANSFERENCIA', '2026-09', 11.19::numeric, 10.0::numeric, 89.4::numeric, 12::numeric, 'Q3'),  -- Juliana Prado
  ('00000000-0000-4000-8000-000000000036', 'TEMPO_DIAGNOSTICO', '2026-09', 275.0::numeric, 300.0::numeric, 109.1::numeric, 12::numeric, 'Q1'),  -- Juliana Prado
  ('00000000-0000-4000-8000-000000000036', 'TEMPO_DISPONIVEL', '2026-09', 85.0::numeric, 80.0::numeric, 106.2::numeric, 12::numeric, 'Q1'),  -- Juliana Prado
  ('00000000-0000-4000-8000-000000000036', 'TMA', '2026-09', 632.0::numeric, 540.0::numeric, 85.4::numeric, 12::numeric, 'Q3'),  -- Juliana Prado
  ('75a6dca3-54bb-4c49-88b4-b7b3d0911f43', 'ADERENCIA', '2026-07', 75.15::numeric, 92.0::numeric, 81.7::numeric, 13::numeric, 'Q3'),  -- Karoline Wokysbly
  ('75a6dca3-54bb-4c49-88b4-b7b3d0911f43', 'FCR', '2026-07', 79.49::numeric, 78.0::numeric, 101.9::numeric, 13::numeric, 'Q3'),  -- Karoline Wokysbly
  ('75a6dca3-54bb-4c49-88b4-b7b3d0911f43', 'MONITORIA_QUALIDADE', '2026-07', 93.59::numeric, 90.0::numeric, 104.0::numeric, 13::numeric, 'Q2'),  -- Karoline Wokysbly
  ('75a6dca3-54bb-4c49-88b4-b7b3d0911f43', 'TAXA_ABANDONO', '2026-07', 5.56::numeric, 5.0::numeric, 89.9::numeric, 13::numeric, 'Q3'),  -- Karoline Wokysbly
  ('75a6dca3-54bb-4c49-88b4-b7b3d0911f43', 'TDNA', '2026-07', 4.91::numeric, 4.4::numeric, 111.6::numeric, 12::numeric, 'Q1'),  -- Karoline Wokysbly
  ('75a6dca3-54bb-4c49-88b4-b7b3d0911f43', 'TEMPO_DISPONIVEL', '2026-07', 75.93::numeric, 82.0::numeric, 92.6::numeric, 12::numeric, 'Q2'),  -- Karoline Wokysbly
  ('75a6dca3-54bb-4c49-88b4-b7b3d0911f43', 'TEMPO_SILENCIO', '2026-07', 12.36::numeric, 12.0::numeric, 97.1::numeric, 12::numeric, 'Q3'),  -- Karoline Wokysbly
  ('75a6dca3-54bb-4c49-88b4-b7b3d0911f43', 'TMA', '2026-07', 485.0::numeric, 420.0::numeric, 86.6::numeric, 12::numeric, 'Q3'),  -- Karoline Wokysbly
  ('75a6dca3-54bb-4c49-88b4-b7b3d0911f43', 'ADERENCIA', '2026-08', 73.35::numeric, 92.0::numeric, 79.7::numeric, 13::numeric, 'Q3'),  -- Karoline Wokysbly
  ('75a6dca3-54bb-4c49-88b4-b7b3d0911f43', 'FCR', '2026-08', 80.88::numeric, 78.0::numeric, 103.7::numeric, 13::numeric, 'Q1'),  -- Karoline Wokysbly
  ('75a6dca3-54bb-4c49-88b4-b7b3d0911f43', 'MONITORIA_QUALIDADE', '2026-08', 96.62::numeric, 90.0::numeric, 107.4::numeric, 13::numeric, 'Q2'),  -- Karoline Wokysbly
  ('75a6dca3-54bb-4c49-88b4-b7b3d0911f43', 'TAXA_ABANDONO', '2026-08', 5.81::numeric, 5.0::numeric, 86.1::numeric, 13::numeric, 'Q3'),  -- Karoline Wokysbly
  ('75a6dca3-54bb-4c49-88b4-b7b3d0911f43', 'TDNA', '2026-08', 4.45::numeric, 4.4::numeric, 101.1::numeric, 12::numeric, 'Q3'),  -- Karoline Wokysbly
  ('75a6dca3-54bb-4c49-88b4-b7b3d0911f43', 'TEMPO_DISPONIVEL', '2026-08', 73.11::numeric, 82.0::numeric, 89.2::numeric, 12::numeric, 'Q2'),  -- Karoline Wokysbly
  ('75a6dca3-54bb-4c49-88b4-b7b3d0911f43', 'TEMPO_SILENCIO', '2026-08', 12.39::numeric, 12.0::numeric, 96.9::numeric, 12::numeric, 'Q3'),  -- Karoline Wokysbly
  ('75a6dca3-54bb-4c49-88b4-b7b3d0911f43', 'TMA', '2026-08', 468.0::numeric, 420.0::numeric, 89.7::numeric, 12::numeric, 'Q3'),  -- Karoline Wokysbly
  ('75a6dca3-54bb-4c49-88b4-b7b3d0911f43', 'ADERENCIA', '2026-09', 77.09::numeric, 92.0::numeric, 83.8::numeric, 13::numeric, 'Q3'),  -- Karoline Wokysbly
  ('75a6dca3-54bb-4c49-88b4-b7b3d0911f43', 'FCR', '2026-09', 78.93::numeric, 78.0::numeric, 101.2::numeric, 13::numeric, 'Q3'),  -- Karoline Wokysbly
  ('75a6dca3-54bb-4c49-88b4-b7b3d0911f43', 'MONITORIA_QUALIDADE', '2026-09', 91.98::numeric, 90.0::numeric, 102.2::numeric, 13::numeric, 'Q2'),  -- Karoline Wokysbly
  ('75a6dca3-54bb-4c49-88b4-b7b3d0911f43', 'TAXA_ABANDONO', '2026-09', 5.51::numeric, 5.0::numeric, 90.7::numeric, 13::numeric, 'Q3'),  -- Karoline Wokysbly
  ('75a6dca3-54bb-4c49-88b4-b7b3d0911f43', 'TDNA', '2026-09', 4.69::numeric, 4.4::numeric, 106.6::numeric, 12::numeric, 'Q1'),  -- Karoline Wokysbly
  ('75a6dca3-54bb-4c49-88b4-b7b3d0911f43', 'TEMPO_DISPONIVEL', '2026-09', 76.07::numeric, 82.0::numeric, 92.8::numeric, 12::numeric, 'Q2'),  -- Karoline Wokysbly
  ('75a6dca3-54bb-4c49-88b4-b7b3d0911f43', 'TEMPO_SILENCIO', '2026-09', 13.06::numeric, 12.0::numeric, 91.9::numeric, 12::numeric, 'Q3'),  -- Karoline Wokysbly
  ('75a6dca3-54bb-4c49-88b4-b7b3d0911f43', 'TMA', '2026-09', 481.0::numeric, 420.0::numeric, 87.3::numeric, 12::numeric, 'Q3'),  -- Karoline Wokysbly
  ('5d4cb9a6-f838-44e7-9b61-04e1e27a774d', 'ADERENCIA', '2026-07', 96.73::numeric, 92.0::numeric, 105.1::numeric, 13::numeric, 'Q1'),  -- Luana Brenda
  ('5d4cb9a6-f838-44e7-9b61-04e1e27a774d', 'FCR', '2026-07', 81.49::numeric, 78.0::numeric, 104.5::numeric, 13::numeric, 'Q1'),  -- Luana Brenda
  ('5d4cb9a6-f838-44e7-9b61-04e1e27a774d', 'MONITORIA_QUALIDADE', '2026-07', 80.53::numeric, 90.0::numeric, 89.5::numeric, 13::numeric, 'Q3'),  -- Luana Brenda
  ('5d4cb9a6-f838-44e7-9b61-04e1e27a774d', 'TAXA_ABANDONO', '2026-07', 5.19::numeric, 5.0::numeric, 96.3::numeric, 13::numeric, 'Q2'),  -- Luana Brenda
  ('5d4cb9a6-f838-44e7-9b61-04e1e27a774d', 'TDNA', '2026-07', 4.43::numeric, 4.4::numeric, 100.7::numeric, 12::numeric, 'Q3'),  -- Luana Brenda
  ('5d4cb9a6-f838-44e7-9b61-04e1e27a774d', 'TEMPO_DISPONIVEL', '2026-07', 69.0::numeric, 82.0::numeric, 84.1::numeric, 12::numeric, 'Q3'),  -- Luana Brenda
  ('5d4cb9a6-f838-44e7-9b61-04e1e27a774d', 'TEMPO_SILENCIO', '2026-07', 11.97::numeric, 12.0::numeric, 100.3::numeric, 12::numeric, 'Q2'),  -- Luana Brenda
  ('5d4cb9a6-f838-44e7-9b61-04e1e27a774d', 'TMA', '2026-07', 421.0::numeric, 420.0::numeric, 99.8::numeric, 12::numeric, 'Q2'),  -- Luana Brenda
  ('5d4cb9a6-f838-44e7-9b61-04e1e27a774d', 'ADERENCIA', '2026-08', 100.05::numeric, 92.0::numeric, 108.7::numeric, 13::numeric, 'Q2'),  -- Luana Brenda
  ('5d4cb9a6-f838-44e7-9b61-04e1e27a774d', 'FCR', '2026-08', 76.38::numeric, 78.0::numeric, 97.9::numeric, 13::numeric, 'Q3'),  -- Luana Brenda
  ('5d4cb9a6-f838-44e7-9b61-04e1e27a774d', 'MONITORIA_QUALIDADE', '2026-08', 81.75::numeric, 90.0::numeric, 90.8::numeric, 13::numeric, 'Q3'),  -- Luana Brenda
  ('5d4cb9a6-f838-44e7-9b61-04e1e27a774d', 'TAXA_ABANDONO', '2026-08', 5.01::numeric, 5.0::numeric, 99.8::numeric, 13::numeric, 'Q2'),  -- Luana Brenda
  ('5d4cb9a6-f838-44e7-9b61-04e1e27a774d', 'TDNA', '2026-08', 4.47::numeric, 4.4::numeric, 101.6::numeric, 12::numeric, 'Q2'),  -- Luana Brenda
  ('5d4cb9a6-f838-44e7-9b61-04e1e27a774d', 'TEMPO_DISPONIVEL', '2026-08', 70.56::numeric, 82.0::numeric, 86.0::numeric, 12::numeric, 'Q3'),  -- Luana Brenda
  ('5d4cb9a6-f838-44e7-9b61-04e1e27a774d', 'TEMPO_SILENCIO', '2026-08', 10.93::numeric, 12.0::numeric, 109.8::numeric, 12::numeric, 'Q1'),  -- Luana Brenda
  ('5d4cb9a6-f838-44e7-9b61-04e1e27a774d', 'TMA', '2026-08', 393.0::numeric, 420.0::numeric, 106.9::numeric, 12::numeric, 'Q2'),  -- Luana Brenda
  ('5d4cb9a6-f838-44e7-9b61-04e1e27a774d', 'ADERENCIA', '2026-09', 100.27::numeric, 92.0::numeric, 109.0::numeric, 13::numeric, 'Q1'),  -- Luana Brenda
  ('5d4cb9a6-f838-44e7-9b61-04e1e27a774d', 'FCR', '2026-09', 79.76::numeric, 78.0::numeric, 102.3::numeric, 13::numeric, 'Q2'),  -- Luana Brenda
  ('5d4cb9a6-f838-44e7-9b61-04e1e27a774d', 'MONITORIA_QUALIDADE', '2026-09', 83.99::numeric, 90.0::numeric, 93.3::numeric, 13::numeric, 'Q3'),  -- Luana Brenda
  ('5d4cb9a6-f838-44e7-9b61-04e1e27a774d', 'TAXA_ABANDONO', '2026-09', 5.3::numeric, 5.0::numeric, 94.3::numeric, 13::numeric, 'Q2'),  -- Luana Brenda
  ('5d4cb9a6-f838-44e7-9b61-04e1e27a774d', 'TDNA', '2026-09', 4.41::numeric, 4.4::numeric, 100.2::numeric, 12::numeric, 'Q3'),  -- Luana Brenda
  ('5d4cb9a6-f838-44e7-9b61-04e1e27a774d', 'TEMPO_DISPONIVEL', '2026-09', 71.3::numeric, 82.0::numeric, 87.0::numeric, 12::numeric, 'Q3'),  -- Luana Brenda
  ('5d4cb9a6-f838-44e7-9b61-04e1e27a774d', 'TEMPO_SILENCIO', '2026-09', 11.41::numeric, 12.0::numeric, 105.2::numeric, 12::numeric, 'Q1'),  -- Luana Brenda
  ('5d4cb9a6-f838-44e7-9b61-04e1e27a774d', 'TMA', '2026-09', 400.0::numeric, 420.0::numeric, 105.0::numeric, 12::numeric, 'Q2'),  -- Luana Brenda
  ('3d117c66-0add-478d-9170-cb0ab2a18ad6', 'ADERENCIA', '2026-07', 85.01::numeric, 91.0::numeric, 93.4::numeric, 13::numeric, 'Q3'),  -- Luzia Ingrid da Silva Nobre
  ('3d117c66-0add-478d-9170-cb0ab2a18ad6', 'CONVERSAO_UPSELL', '2026-07', 13.01::numeric, 12.0::numeric, 108.4::numeric, 13::numeric, 'Q1'),  -- Luzia Ingrid da Silva Nobre
  ('3d117c66-0add-478d-9170-cb0ab2a18ad6', 'MONITORIA_QUALIDADE', '2026-07', 95.57::numeric, 93.0::numeric, 102.8::numeric, 13::numeric, 'Q1'),  -- Luzia Ingrid da Silva Nobre
  ('3d117c66-0add-478d-9170-cb0ab2a18ad6', 'RECONTATO_CANCELAMENTO', '2026-07', 7.84::numeric, 8.0::numeric, 102.0::numeric, 13::numeric, 'Q1'),  -- Luzia Ingrid da Silva Nobre
  ('3d117c66-0add-478d-9170-cb0ab2a18ad6', 'TAXA_RETENCAO', '2026-07', 61.14::numeric, 62.0::numeric, 98.6::numeric, 12::numeric, 'Q1'),  -- Luzia Ingrid da Silva Nobre
  ('3d117c66-0add-478d-9170-cb0ab2a18ad6', 'TDNA', '2026-07', 4.66::numeric, 4.5::numeric, 103.6::numeric, 12::numeric, 'Q1'),  -- Luzia Ingrid da Silva Nobre
  ('3d117c66-0add-478d-9170-cb0ab2a18ad6', 'TEMPO_SILENCIO', '2026-07', 16.19::numeric, 15.0::numeric, 92.6::numeric, 12::numeric, 'Q3'),  -- Luzia Ingrid da Silva Nobre
  ('3d117c66-0add-478d-9170-cb0ab2a18ad6', 'TMA', '2026-07', 628.0::numeric, 600.0::numeric, 95.5::numeric, 12::numeric, 'Q3'),  -- Luzia Ingrid da Silva Nobre
  ('3d117c66-0add-478d-9170-cb0ab2a18ad6', 'ADERENCIA', '2026-08', 84.31::numeric, 91.0::numeric, 92.6::numeric, 13::numeric, 'Q3'),  -- Luzia Ingrid da Silva Nobre
  ('3d117c66-0add-478d-9170-cb0ab2a18ad6', 'CONVERSAO_UPSELL', '2026-08', 12.33::numeric, 12.0::numeric, 102.8::numeric, 13::numeric, 'Q3'),  -- Luzia Ingrid da Silva Nobre
  ('3d117c66-0add-478d-9170-cb0ab2a18ad6', 'MONITORIA_QUALIDADE', '2026-08', 104.78::numeric, 93.0::numeric, 112.7::numeric, 13::numeric, 'Q1'),  -- Luzia Ingrid da Silva Nobre
  ('3d117c66-0add-478d-9170-cb0ab2a18ad6', 'RECONTATO_CANCELAMENTO', '2026-08', 7.78::numeric, 8.0::numeric, 102.8::numeric, 13::numeric, 'Q1'),  -- Luzia Ingrid da Silva Nobre
  ('3d117c66-0add-478d-9170-cb0ab2a18ad6', 'TAXA_RETENCAO', '2026-08', 66.74::numeric, 62.0::numeric, 107.6::numeric, 12::numeric, 'Q1'),  -- Luzia Ingrid da Silva Nobre
  ('3d117c66-0add-478d-9170-cb0ab2a18ad6', 'TDNA', '2026-08', 4.58::numeric, 4.5::numeric, 101.8::numeric, 12::numeric, 'Q1'),  -- Luzia Ingrid da Silva Nobre
  ('3d117c66-0add-478d-9170-cb0ab2a18ad6', 'TEMPO_SILENCIO', '2026-08', 16.23::numeric, 15.0::numeric, 92.4::numeric, 12::numeric, 'Q3'),  -- Luzia Ingrid da Silva Nobre
  ('3d117c66-0add-478d-9170-cb0ab2a18ad6', 'TMA', '2026-08', 696.0::numeric, 600.0::numeric, 86.2::numeric, 12::numeric, 'Q3'),  -- Luzia Ingrid da Silva Nobre
  ('3d117c66-0add-478d-9170-cb0ab2a18ad6', 'ADERENCIA', '2026-09', 83.06::numeric, 91.0::numeric, 91.3::numeric, 13::numeric, 'Q3'),  -- Luzia Ingrid da Silva Nobre
  ('3d117c66-0add-478d-9170-cb0ab2a18ad6', 'CONVERSAO_UPSELL', '2026-09', 12.35::numeric, 12.0::numeric, 102.9::numeric, 13::numeric, 'Q3'),  -- Luzia Ingrid da Silva Nobre
  ('3d117c66-0add-478d-9170-cb0ab2a18ad6', 'MONITORIA_QUALIDADE', '2026-09', 100.1::numeric, 93.0::numeric, 107.6::numeric, 13::numeric, 'Q1'),  -- Luzia Ingrid da Silva Nobre
  ('3d117c66-0add-478d-9170-cb0ab2a18ad6', 'RECONTATO_CANCELAMENTO', '2026-09', 7.5::numeric, 8.0::numeric, 106.7::numeric, 13::numeric, 'Q1'),  -- Luzia Ingrid da Silva Nobre
  ('3d117c66-0add-478d-9170-cb0ab2a18ad6', 'TAXA_RETENCAO', '2026-09', 64.94::numeric, 62.0::numeric, 104.7::numeric, 12::numeric, 'Q1'),  -- Luzia Ingrid da Silva Nobre
  ('3d117c66-0add-478d-9170-cb0ab2a18ad6', 'TDNA', '2026-09', 4.76::numeric, 4.5::numeric, 105.8::numeric, 12::numeric, 'Q1'),  -- Luzia Ingrid da Silva Nobre
  ('3d117c66-0add-478d-9170-cb0ab2a18ad6', 'TEMPO_SILENCIO', '2026-09', 15.91::numeric, 15.0::numeric, 94.3::numeric, 12::numeric, 'Q1'),  -- Luzia Ingrid da Silva Nobre
  ('3d117c66-0add-478d-9170-cb0ab2a18ad6', 'TMA', '2026-09', 664.0::numeric, 600.0::numeric, 90.4::numeric, 12::numeric, 'Q3'),  -- Luzia Ingrid da Silva Nobre
  ('c52b10d7-9a8d-4de3-8bf6-0eb9e1a31b25', 'BACKLOG', '2026-07', 189.0::numeric, 180.0::numeric, 95.2::numeric, 15::numeric, 'Q1'),  -- Pamella Albuquerque
  ('c52b10d7-9a8d-4de3-8bf6-0eb9e1a31b25', 'MONITORIA_QUALIDADE', '2026-07', 82.16::numeric, 92.0::numeric, 89.3::numeric, 15::numeric, 'Q3'),  -- Pamella Albuquerque
  ('c52b10d7-9a8d-4de3-8bf6-0eb9e1a31b25', 'PRODUTIVIDADE', '2026-07', 39.64::numeric, 38.0::numeric, 104.3::numeric, 14::numeric, 'Q2'),  -- Pamella Albuquerque
  ('c52b10d7-9a8d-4de3-8bf6-0eb9e1a31b25', 'QUALIDADE_ANALISE', '2026-07', 104.37::numeric, 94.0::numeric, 111.0::numeric, 14::numeric, 'Q1'),  -- Pamella Albuquerque
  ('c52b10d7-9a8d-4de3-8bf6-0eb9e1a31b25', 'SLA_24H', '2026-07', 98.97::numeric, 90.0::numeric, 110.0::numeric, 14::numeric, 'Q1'),  -- Pamella Albuquerque
  ('c52b10d7-9a8d-4de3-8bf6-0eb9e1a31b25', 'TAXA_RETRABALHO', '2026-07', 4.82::numeric, 4.0::numeric, 83.0::numeric, 14::numeric, 'Q3'),  -- Pamella Albuquerque
  ('c52b10d7-9a8d-4de3-8bf6-0eb9e1a31b25', 'TMT', '2026-07', 847.0::numeric, 720.0::numeric, 85.0::numeric, 14::numeric, 'Q3'),  -- Pamella Albuquerque
  ('c52b10d7-9a8d-4de3-8bf6-0eb9e1a31b25', 'BACKLOG', '2026-08', 203.0::numeric, 180.0::numeric, 88.7::numeric, 15::numeric, 'Q2'),  -- Pamella Albuquerque
  ('c52b10d7-9a8d-4de3-8bf6-0eb9e1a31b25', 'MONITORIA_QUALIDADE', '2026-08', 76.16::numeric, 92.0::numeric, 82.8::numeric, 15::numeric, 'Q3'),  -- Pamella Albuquerque
  ('c52b10d7-9a8d-4de3-8bf6-0eb9e1a31b25', 'PRODUTIVIDADE', '2026-08', 40.11::numeric, 38.0::numeric, 105.6::numeric, 14::numeric, 'Q3'),  -- Pamella Albuquerque
  ('c52b10d7-9a8d-4de3-8bf6-0eb9e1a31b25', 'QUALIDADE_ANALISE', '2026-08', 104.76::numeric, 94.0::numeric, 111.4::numeric, 14::numeric, 'Q1'),  -- Pamella Albuquerque
  ('c52b10d7-9a8d-4de3-8bf6-0eb9e1a31b25', 'SLA_24H', '2026-08', 95.88::numeric, 90.0::numeric, 106.5::numeric, 14::numeric, 'Q2'),  -- Pamella Albuquerque
  ('c52b10d7-9a8d-4de3-8bf6-0eb9e1a31b25', 'TAXA_RETRABALHO', '2026-08', 4.45::numeric, 4.0::numeric, 89.9::numeric, 14::numeric, 'Q2'),  -- Pamella Albuquerque
  ('c52b10d7-9a8d-4de3-8bf6-0eb9e1a31b25', 'TMT', '2026-08', 839.0::numeric, 720.0::numeric, 85.8::numeric, 14::numeric, 'Q2'),  -- Pamella Albuquerque
  ('c52b10d7-9a8d-4de3-8bf6-0eb9e1a31b25', 'BACKLOG', '2026-09', 200.0::numeric, 180.0::numeric, 90.0::numeric, 15::numeric, 'Q3'),  -- Pamella Albuquerque
  ('c52b10d7-9a8d-4de3-8bf6-0eb9e1a31b25', 'MONITORIA_QUALIDADE', '2026-09', 79.29::numeric, 92.0::numeric, 86.2::numeric, 15::numeric, 'Q3'),  -- Pamella Albuquerque
  ('c52b10d7-9a8d-4de3-8bf6-0eb9e1a31b25', 'PRODUTIVIDADE', '2026-09', 40.2::numeric, 38.0::numeric, 105.8::numeric, 14::numeric, 'Q2'),  -- Pamella Albuquerque
  ('c52b10d7-9a8d-4de3-8bf6-0eb9e1a31b25', 'QUALIDADE_ANALISE', '2026-09', 101.41::numeric, 94.0::numeric, 107.9::numeric, 14::numeric, 'Q1'),  -- Pamella Albuquerque
  ('c52b10d7-9a8d-4de3-8bf6-0eb9e1a31b25', 'SLA_24H', '2026-09', 94.87::numeric, 90.0::numeric, 105.4::numeric, 14::numeric, 'Q1'),  -- Pamella Albuquerque
  ('c52b10d7-9a8d-4de3-8bf6-0eb9e1a31b25', 'TAXA_RETRABALHO', '2026-09', 4.58::numeric, 4.0::numeric, 87.3::numeric, 14::numeric, 'Q2'),  -- Pamella Albuquerque
  ('c52b10d7-9a8d-4de3-8bf6-0eb9e1a31b25', 'TMT', '2026-09', 808.0::numeric, 720.0::numeric, 89.1::numeric, 14::numeric, 'Q3'),  -- Pamella Albuquerque
  ('b0f7d45a-acb9-4471-8338-d7e3e04b5711', 'FCR', '2026-07', 67.58::numeric, 75.0::numeric, 90.1::numeric, 13::numeric, 'Q3'),  -- Samuel Avelino
  ('b0f7d45a-acb9-4471-8338-d7e3e04b5711', 'MONITORIA_QUALIDADE', '2026-07', 96.45::numeric, 91.0::numeric, 106.0::numeric, 13::numeric, 'Q1'),  -- Samuel Avelino
  ('b0f7d45a-acb9-4471-8338-d7e3e04b5711', 'NOTA_URA', '2026-07', 4.34::numeric, 4.3::numeric, 100.9::numeric, 13::numeric, 'Q1'),  -- Samuel Avelino
  ('b0f7d45a-acb9-4471-8338-d7e3e04b5711', 'REINCIDENCIA_7D', '2026-07', 10.05::numeric, 9.0::numeric, 89.6::numeric, 13::numeric, 'Q3'),  -- Samuel Avelino
  ('b0f7d45a-acb9-4471-8338-d7e3e04b5711', 'TAXA_TRANSFERENCIA', '2026-07', 10.59::numeric, 10.0::numeric, 94.4::numeric, 12::numeric, 'Q2'),  -- Samuel Avelino
  ('b0f7d45a-acb9-4471-8338-d7e3e04b5711', 'TEMPO_DIAGNOSTICO', '2026-07', 267.0::numeric, 300.0::numeric, 112.4::numeric, 12::numeric, 'Q1'),  -- Samuel Avelino
  ('b0f7d45a-acb9-4471-8338-d7e3e04b5711', 'TEMPO_DISPONIVEL', '2026-07', 85.81::numeric, 80.0::numeric, 107.3::numeric, 12::numeric, 'Q1'),  -- Samuel Avelino
  ('b0f7d45a-acb9-4471-8338-d7e3e04b5711', 'TMA', '2026-07', 512.0::numeric, 540.0::numeric, 105.5::numeric, 12::numeric, 'Q1'),  -- Samuel Avelino
  ('b0f7d45a-acb9-4471-8338-d7e3e04b5711', 'FCR', '2026-08', 74.35::numeric, 75.0::numeric, 99.1::numeric, 13::numeric, 'Q3'),  -- Samuel Avelino
  ('b0f7d45a-acb9-4471-8338-d7e3e04b5711', 'MONITORIA_QUALIDADE', '2026-08', 86.94::numeric, 91.0::numeric, 95.5::numeric, 13::numeric, 'Q1'),  -- Samuel Avelino
  ('b0f7d45a-acb9-4471-8338-d7e3e04b5711', 'NOTA_URA', '2026-08', 4.47::numeric, 4.3::numeric, 104.0::numeric, 13::numeric, 'Q1'),  -- Samuel Avelino
  ('b0f7d45a-acb9-4471-8338-d7e3e04b5711', 'REINCIDENCIA_7D', '2026-08', 10.09::numeric, 9.0::numeric, 89.2::numeric, 13::numeric, 'Q3'),  -- Samuel Avelino
  ('b0f7d45a-acb9-4471-8338-d7e3e04b5711', 'TAXA_TRANSFERENCIA', '2026-08', 10.37::numeric, 10.0::numeric, 96.4::numeric, 12::numeric, 'Q2'),  -- Samuel Avelino
  ('b0f7d45a-acb9-4471-8338-d7e3e04b5711', 'TEMPO_DIAGNOSTICO', '2026-08', 291.0::numeric, 300.0::numeric, 103.1::numeric, 12::numeric, 'Q2'),  -- Samuel Avelino
  ('b0f7d45a-acb9-4471-8338-d7e3e04b5711', 'TEMPO_DISPONIVEL', '2026-08', 77.62::numeric, 80.0::numeric, 97.0::numeric, 12::numeric, 'Q3'),  -- Samuel Avelino
  ('b0f7d45a-acb9-4471-8338-d7e3e04b5711', 'TMA', '2026-08', 532.0::numeric, 540.0::numeric, 101.5::numeric, 12::numeric, 'Q1'),  -- Samuel Avelino
  ('b0f7d45a-acb9-4471-8338-d7e3e04b5711', 'FCR', '2026-09', 70.66::numeric, 75.0::numeric, 94.2::numeric, 13::numeric, 'Q3'),  -- Samuel Avelino
  ('b0f7d45a-acb9-4471-8338-d7e3e04b5711', 'MONITORIA_QUALIDADE', '2026-09', 91.96::numeric, 91.0::numeric, 101.1::numeric, 13::numeric, 'Q1'),  -- Samuel Avelino
  ('b0f7d45a-acb9-4471-8338-d7e3e04b5711', 'NOTA_URA', '2026-09', 4.58::numeric, 4.3::numeric, 106.5::numeric, 13::numeric, 'Q1'),  -- Samuel Avelino
  ('b0f7d45a-acb9-4471-8338-d7e3e04b5711', 'REINCIDENCIA_7D', '2026-09', 10.6::numeric, 9.0::numeric, 84.9::numeric, 13::numeric, 'Q3'),  -- Samuel Avelino
  ('b0f7d45a-acb9-4471-8338-d7e3e04b5711', 'TAXA_TRANSFERENCIA', '2026-09', 10.83::numeric, 10.0::numeric, 92.3::numeric, 12::numeric, 'Q2'),  -- Samuel Avelino
  ('b0f7d45a-acb9-4471-8338-d7e3e04b5711', 'TEMPO_DIAGNOSTICO', '2026-09', 281.0::numeric, 300.0::numeric, 106.8::numeric, 12::numeric, 'Q3'),  -- Samuel Avelino
  ('b0f7d45a-acb9-4471-8338-d7e3e04b5711', 'TEMPO_DISPONIVEL', '2026-09', 81.71::numeric, 80.0::numeric, 102.1::numeric, 12::numeric, 'Q2'),  -- Samuel Avelino
  ('b0f7d45a-acb9-4471-8338-d7e3e04b5711', 'TMA', '2026-09', 513.0::numeric, 540.0::numeric, 105.3::numeric, 12::numeric, 'Q1')  -- Samuel Avelino
) as v(person_id, indicator_code, reference_period, value, target_value, achievement_percent, weight_percent, quartile)
join indicator_definitions idef on idef.code = v.indicator_code and idef.organization_id = '00000000-0000-4000-8000-000000000001'
join people p on p.id = v.person_id::uuid
where v.reference_period < to_char(now() at time zone 'America/Fortaleza', 'YYYY-MM')
  and not exists (
  select 1 from employee_indicator_performance_all eip
  where eip.person_id = v.person_id::uuid and eip.indicator_definition_id = idef.id and eip.reference_period = v.reference_period
);

insert into employee_prv_performance_all (organization_id, person_id, reference_period, achievement_percent, quartile, source)
select '00000000-0000-4000-8000-000000000001', v.person_id::uuid, v.reference_period, v.achievement_percent, v.quartile, 'DEMO_SEED'
from (values
  ('00000000-0000-4000-8000-000000000030', '2026-07', 98.4::numeric, 'Q3'),  -- Ana Lima
  ('00000000-0000-4000-8000-000000000030', '2026-08', 100.3::numeric, 'Q1'),  -- Ana Lima
  ('00000000-0000-4000-8000-000000000030', '2026-09', 98.4::numeric, 'Q3'),  -- Ana Lima
  ('53d33ea1-6b44-4cbc-b865-3ad44f1507fa', '2026-07', 104.4::numeric, 'Q1'),  -- Camila Pereira
  ('53d33ea1-6b44-4cbc-b865-3ad44f1507fa', '2026-08', 103.4::numeric, 'Q1'),  -- Camila Pereira
  ('53d33ea1-6b44-4cbc-b865-3ad44f1507fa', '2026-09', 104.6::numeric, 'Q1'),  -- Camila Pereira
  ('46625f7e-a98f-49a0-b7ce-6812891d5264', '2026-07', 98.1::numeric, 'Q2'),  -- Denisy Feitoza
  ('46625f7e-a98f-49a0-b7ce-6812891d5264', '2026-08', 97.4::numeric, 'Q2'),  -- Denisy Feitoza
  ('46625f7e-a98f-49a0-b7ce-6812891d5264', '2026-09', 99.3::numeric, 'Q1'),  -- Denisy Feitoza
  ('bd5c6664-7fbc-4adc-acdd-1cfde552ff9b', '2026-07', 97.7::numeric, 'Q2'),  -- Gustavo Santos
  ('bd5c6664-7fbc-4adc-acdd-1cfde552ff9b', '2026-08', 97.4::numeric, 'Q2'),  -- Gustavo Santos
  ('bd5c6664-7fbc-4adc-acdd-1cfde552ff9b', '2026-09', 97.4::numeric, 'Q2'),  -- Gustavo Santos
  ('5690796d-e5af-4cb3-84b8-88eee6e7f2cf', '2026-07', 105.1::numeric, 'Q1'),  -- Icaro Elias
  ('5690796d-e5af-4cb3-84b8-88eee6e7f2cf', '2026-08', 105.3::numeric, 'Q1'),  -- Icaro Elias
  ('5690796d-e5af-4cb3-84b8-88eee6e7f2cf', '2026-09', 104.7::numeric, 'Q1'),  -- Icaro Elias
  ('00000000-0000-4000-8000-000000000036', '2026-07', 96.2::numeric, 'Q3'),  -- Juliana Prado
  ('00000000-0000-4000-8000-000000000036', '2026-08', 96.7::numeric, 'Q3'),  -- Juliana Prado
  ('00000000-0000-4000-8000-000000000036', '2026-09', 97.7::numeric, 'Q3'),  -- Juliana Prado
  ('75a6dca3-54bb-4c49-88b4-b7b3d0911f43', '2026-07', 95.6::numeric, 'Q3'),  -- Karoline Wokysbly
  ('75a6dca3-54bb-4c49-88b4-b7b3d0911f43', '2026-08', 94.2::numeric, 'Q3'),  -- Karoline Wokysbly
  ('75a6dca3-54bb-4c49-88b4-b7b3d0911f43', '2026-09', 94.6::numeric, 'Q3'),  -- Karoline Wokysbly
  ('5d4cb9a6-f838-44e7-9b61-04e1e27a774d', '2026-07', 97.6::numeric, 'Q2'),  -- Luana Brenda
  ('5d4cb9a6-f838-44e7-9b61-04e1e27a774d', '2026-08', 100.2::numeric, 'Q2'),  -- Luana Brenda
  ('5d4cb9a6-f838-44e7-9b61-04e1e27a774d', '2026-09', 99.5::numeric, 'Q2'),  -- Luana Brenda
  ('3d117c66-0add-478d-9170-cb0ab2a18ad6', '2026-07', 99.7::numeric, 'Q1'),  -- Luzia Ingrid da Silva Nobre
  ('3d117c66-0add-478d-9170-cb0ab2a18ad6', '2026-08', 100.0::numeric, 'Q3'),  -- Luzia Ingrid da Silva Nobre
  ('3d117c66-0add-478d-9170-cb0ab2a18ad6', '2026-09', 100.5::numeric, 'Q1'),  -- Luzia Ingrid da Silva Nobre
  ('c52b10d7-9a8d-4de3-8bf6-0eb9e1a31b25', '2026-07', 96.7::numeric, 'Q3'),  -- Pamella Albuquerque
  ('c52b10d7-9a8d-4de3-8bf6-0eb9e1a31b25', '2026-08', 95.6::numeric, 'Q3'),  -- Pamella Albuquerque
  ('c52b10d7-9a8d-4de3-8bf6-0eb9e1a31b25', '2026-09', 95.8::numeric, 'Q3'),  -- Pamella Albuquerque
  ('b0f7d45a-acb9-4471-8338-d7e3e04b5711', '2026-07', 100.6::numeric, 'Q1'),  -- Samuel Avelino
  ('b0f7d45a-acb9-4471-8338-d7e3e04b5711', '2026-08', 98.2::numeric, 'Q1'),  -- Samuel Avelino
  ('b0f7d45a-acb9-4471-8338-d7e3e04b5711', '2026-09', 99.1::numeric, 'Q2')  -- Samuel Avelino
) as v(person_id, reference_period, achievement_percent, quartile)
join people p on p.id = v.person_id::uuid
where v.reference_period < to_char(now() at time zone 'America/Fortaleza', 'YYYY-MM')
  and not exists (select 1 from employee_prv_performance_all epp where epp.person_id = v.person_id::uuid and epp.reference_period = v.reference_period);
