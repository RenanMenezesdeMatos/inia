-- Remove os times legados "Contas" e "Retenção B2B" (já superseded pelos 4 grupos atuais
-- desde a migration 019, mas ainda existiam em banco só porque tinham fixtures de seed
-- antigo presas por FK) e amplia o catálogo de indicadores pros novos grupos.

-- 1) Realoca as duas pessoas que ainda estavam nos times legados.
update people set team_id = (select id from teams where name = 'FATURAS')
  where id = '4f31f4ce-35aa-4706-a10f-3fabf9fd81ab'; -- Roberta Gaspar (era "Contas")
update people set team_id = (select id from teams where name = 'RETENÇÃO/FIDELIZAÇÃO')
  where id = '00000000-0000-4000-8000-000000000033'; -- Roberto Alves (era "Retenção B2B")

-- 2) Limpa o case de demo preso ao time "Retenção B2B" (fixture de seed antigo, não é
-- atendimento real) e tudo que aponta pra ele sem cascade.
delete from feedbacks where case_id = '00000000-0000-4000-8000-000000000100';
delete from alerts where case_id = '00000000-0000-4000-8000-000000000100';
delete from development_plans where case_id = '00000000-0000-4000-8000-000000000100';
delete from performance_escalations where case_id = '00000000-0000-4000-8000-000000000100';
delete from supervision_cases where id = '00000000-0000-4000-8000-000000000100';

-- 3) Limpa as demais linhas de configuração presas aos times legados.
delete from goals where subject_id in ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000020');
delete from knowledge_document_org_scopes where team_id in ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000020');
delete from indicator_calculation_rules where team_id in ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000020');
delete from call_expectations where team_id in ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000020');
delete from subteams where team_id in ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000020');

-- 4) Remove os times legados. Sobram só os 4 grupos vigentes.
delete from teams where id in ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000020');

-- 5) Catálogo de indicadores: código é único por organização, não por time — o mesmo
-- indicador serve pra todo time que o usa, cada um com sua própria meta em `goals`.
-- `TMA` já existe (SECONDS/LOWER) e é reaproveitado como está.
insert into indicator_definitions (organization_id, code, name, unit, desired_direction)
values
  ('00000000-0000-4000-8000-000000000001', 'TDNA', 'Nota do Atendimento do Operador', 'STARS', 'HIGHER'),
  ('00000000-0000-4000-8000-000000000001', 'ADERENCIA', 'Aderência à Escala', 'PERCENT', 'HIGHER'),
  ('00000000-0000-4000-8000-000000000001', 'TEMPO_DISPONIVEL', 'Tempo Disponível', 'PERCENT', 'HIGHER'),
  ('00000000-0000-4000-8000-000000000001', 'FCR', 'First Call Resolution', 'PERCENT', 'HIGHER'),
  ('00000000-0000-4000-8000-000000000001', 'TEMPO_SILENCIO', 'Tempo de Silêncio na Chamada', 'PERCENT', 'LOWER'),
  ('00000000-0000-4000-8000-000000000001', 'TAXA_ABANDONO', 'Taxa de Abandono', 'PERCENT', 'LOWER'),
  ('00000000-0000-4000-8000-000000000001', 'MONITORIA_QUALIDADE', 'Monitoria de Qualidade', 'PERCENT', 'HIGHER'),
  ('00000000-0000-4000-8000-000000000001', 'TMT', 'Tempo Médio de Tratamento por Caso', 'SECONDS', 'LOWER'),
  ('00000000-0000-4000-8000-000000000001', 'PRODUTIVIDADE', 'Produtividade Média por Colaborador', 'CASES_PER_DAY', 'HIGHER'),
  ('00000000-0000-4000-8000-000000000001', 'TAXA_RETRABALHO', 'Taxa de Retrabalho', 'PERCENT', 'LOWER'),
  ('00000000-0000-4000-8000-000000000001', 'SLA_24H', 'Casos Concluídos em até 24 Horas', 'PERCENT', 'HIGHER'),
  ('00000000-0000-4000-8000-000000000001', 'BACKLOG', 'Quantidade de Casos Pendentes', 'CASES', 'LOWER'),
  ('00000000-0000-4000-8000-000000000001', 'QUALIDADE_ANALISE', 'Qualidade da Análise de Faturas', 'PERCENT', 'HIGHER'),
  ('00000000-0000-4000-8000-000000000001', 'TAXA_RETENCAO', 'Taxa de Retenção', 'PERCENT', 'HIGHER'),
  ('00000000-0000-4000-8000-000000000001', 'RECONTATO_CANCELAMENTO', 'Recontato por Solicitação de Cancelamento', 'PERCENT', 'LOWER'),
  ('00000000-0000-4000-8000-000000000001', 'CONVERSAO_UPSELL', 'Conversão de Oferta Adicional', 'PERCENT', 'HIGHER'),
  ('00000000-0000-4000-8000-000000000001', 'NOTA_URA', 'Nota da Pesquisa na URA', 'STARS', 'HIGHER'),
  ('00000000-0000-4000-8000-000000000001', 'TAXA_TRANSFERENCIA', 'Taxa de Transferência', 'PERCENT', 'LOWER'),
  ('00000000-0000-4000-8000-000000000001', 'REINCIDENCIA_7D', 'Reincidência em até 7 Dias', 'PERCENT', 'LOWER'),
  ('00000000-0000-4000-8000-000000000001', 'TEMPO_DIAGNOSTICO', 'Tempo Médio de Diagnóstico', 'SECONDS', 'LOWER')
on conflict (organization_id, code) do nothing;
