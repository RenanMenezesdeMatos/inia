-- Central de Dados — fixtures mínimas de demonstração (ids determinísticos de00…, idempotente).
-- Duas fontes SEM credencial real e SEM histórico fabricado: uma importação manual ATIVA com dois
-- feeds mapeados (colaboradores e medições) e uma API Pull PAUSADA apontando para um host
-- inexistente (.invalid) — nunca finge conexão externa. As cargas reais nascem pela própria UI.
-- Os feeds de medição usam namespace de origem 'DEMO_SEED': o que entrar por eles é dado demo
-- (mesma coluna `source` que o reset da massa usa para apagar só o que é demo).
insert into data_sources (id, organization_id, public_id, name, description, kind, status, config, connection_health)
select 'de00da7a-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'demoarq01', 'Importação manual (demo)',
       'Arquivos CSV/Excel enviados pela tela da Central de Dados. Fonte de demonstração.', 'FILE_UPLOAD', 'ACTIVE', '{"kind":"FILE_UPLOAD"}'::jsonb, 'HEALTHY'
where not exists (select 1 from data_sources where id = 'de00da7a-0000-4000-8000-000000000001');

insert into data_sources (id, organization_id, public_id, name, description, kind, status, config, connection_health)
select 'de00da7a-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'demoapi01', 'API Operacional (demo)',
       'Exemplo de API Pull configurada e PAUSADA. O host é fictício (.invalid) — nunca conecta de verdade.', 'API_PULL', 'PAUSED',
       '{"kind":"API_PULL","api":{"baseUrl":"https://api-operacional.demo.invalid","auth":{"kind":"BEARER"},"headers":{},"timeoutMs":30000}}'::jsonb, 'UNKNOWN'
where not exists (select 1 from data_sources where id = 'de00da7a-0000-4000-8000-000000000002');

insert into data_feeds (id, organization_id, source_id, feed_key, name, contract_key, contract_version, connector_config, mapping, load_mode, cadence, status, authoritative, source_namespace)
select 'de00da7a-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'de00da7a-0000-4000-8000-000000000001', 'colaboradores', 'Colaboradores (CSV)', 'EMPLOYEES', 1,
       '{"connector":"FILE_UPLOAD","file":{"format":"CSV","csv":{"encoding":"utf-8","delimiter":"auto","hasHeader":true,"skipRows":0},"excel":{"hasHeader":true,"skipRows":0}}}'::jsonb,
       '{"fields":[{"target":"externalEmployeeId","source":"matricula","transforms":[{"kind":"TRIM"}]},{"target":"name","source":"nome","transforms":[{"kind":"TRIM"}]},{"target":"role","source":"perfil","transforms":[{"kind":"CODE_MAP","map":{"Atendente":"OPERATOR","Supervisor":"SUPERVISOR","Coordenador":"COORDINATOR","Gerente":"MANAGER"},"otherwise":"KEEP"}]},{"target":"jobTitle","source":"cargo","transforms":[]},{"target":"groupExternalCode","source":"grupo","transforms":[]},{"target":"subgroupExternalCode","source":"subgrupo","transforms":[]},{"target":"reportsToExternalId","source":"gestor","transforms":[]},{"target":"hiredAt","source":"admissao","transforms":[{"kind":"PARSE_DATE","format":"dd/MM/yyyy"}]},{"target":"active","source":"ativo","transforms":[]}]}'::jsonb,
       'DELTA', '{"kind":"MANUAL"}'::jsonb, 'ACTIVE', true, null
where not exists (select 1 from data_feeds where id = 'de00da7a-0000-4000-8000-000000000011');

insert into data_feeds (id, organization_id, source_id, feed_key, name, contract_key, contract_version, connector_config, mapping, load_mode, cadence, status, authoritative, source_namespace)
select 'de00da7a-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000001', 'de00da7a-0000-4000-8000-000000000001', 'medicoes', 'Medições operacionais (CSV/Excel)', 'INDICATOR_MEASUREMENTS', 1,
       '{"connector":"FILE_UPLOAD","file":{"format":"CSV","csv":{"encoding":"utf-8","delimiter":"auto","hasHeader":true,"skipRows":0},"excel":{"hasHeader":true,"skipRows":0}}}'::jsonb,
       '{"fields":[{"target":"externalEmployeeId","source":"matricula","transforms":[{"kind":"TRIM"}]},{"target":"indicatorCode","source":"indicador","transforms":[{"kind":"UPPERCASE"}]},{"target":"date","source":"dia","transforms":[{"kind":"PARSE_DATE","format":"dd/MM/yyyy"}]},{"target":"value","source":"valor","transforms":[{"kind":"PARSE_DECIMAL","decimalSeparator":","}]},{"target":"numerator","source":"numerador","transforms":[{"kind":"PARSE_DECIMAL","decimalSeparator":","}]},{"target":"denominator","source":"denominador","transforms":[{"kind":"PARSE_DECIMAL","decimalSeparator":","}]}]}'::jsonb,
       'DELTA', '{"kind":"MANUAL"}'::jsonb, 'ACTIVE', false, 'DEMO_SEED'
where not exists (select 1 from data_feeds where id = 'de00da7a-0000-4000-8000-000000000012');

insert into data_feeds (id, organization_id, source_id, feed_key, name, contract_key, contract_version, connector_config, mapping, load_mode, cadence, expected_interval_minutes, status, authoritative, source_namespace)
select 'de00da7a-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000001', 'de00da7a-0000-4000-8000-000000000002', 'medicoes', 'Medições operacionais (API)', 'INDICATOR_MEASUREMENTS', 1,
       '{"connector":"API_PULL","api":{"format":"JSON","endpoint":"/v1/medicoes","method":"GET","queryParams":{},"headers":{},"extractPath":"data","pagination":{"kind":"PAGE_NUMBER","pageParam":"page","sizeParam":"pageSize","pageSize":500,"startPage":1},"checkpoint":{"kind":"WATERMARK","sourceField":"atualizadoEm","requestParam":"since"},"maxPages":500}}'::jsonb,
       '{"fields":[{"target":"externalEmployeeId","source":"matricula","transforms":[]},{"target":"indicatorCode","source":"indicador","transforms":[]},{"target":"date","source":"dia","transforms":[]},{"target":"value","source":"valor","transforms":[]},{"target":"numerator","source":"numerador","transforms":[]},{"target":"denominator","source":"denominador","transforms":[]}]}'::jsonb,
       'DELTA', '{"kind":"INTERVAL","minutes":60}'::jsonb, 60, 'PAUSED', false, 'DEMO_SEED'
where not exists (select 1 from data_feeds where id = 'de00da7a-0000-4000-8000-000000000021');

-- ------------------------------------------------------------------------------------------
-- DISPONIBILIDADE ESPERADA (migration 069) — "fim do turno ≠ dado fechado". Políticas EXPLÍCITAS de
-- demonstração (nunca presumidas): medições operacionais chegam em D-1 até 11:00; colaboradores/RH em
-- D-2 até 08:00; interações em D-1 até 09:00. Sem política a INIA fica em AVAILABILITY_UNKNOWN e não
-- conclui ausência de ninguém. Idempotente: só preenche quando ainda não há política.
-- Interações nascem no contrato INTERACTIONS@2 (motivo + submotivo, 2026-10-16); um banco que já tinha o feed na
-- versão 1 continua nela até o mapeamento ser salvo de novo pela tela (a troca fica na auditoria).
-- ------------------------------------------------------------------------------------------
insert into data_feeds (id, organization_id, source_id, feed_key, name, contract_key, contract_version, connector_config, mapping, load_mode, cadence, status, authoritative, source_namespace, availability_policy)
select 'de00da7a-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000001', 'de00da7a-0000-4000-8000-000000000001', 'interacoes', 'Interações (CSV)', 'INTERACTIONS', 2,
       '{"connector":"FILE_UPLOAD","file":{"format":"CSV","csv":{"encoding":"utf-8","delimiter":"auto","hasHeader":true,"skipRows":0},"excel":{"hasHeader":true,"skipRows":0}}}'::jsonb,
       '{"fields":[{"target":"externalInteractionId","source":"protocolo","transforms":[{"kind":"TRIM"}]},{"target":"externalEmployeeId","source":"matricula","transforms":[{"kind":"TRIM"}]},{"target":"reason","source":"motivo","transforms":[]},{"target":"subReason","source":"submotivo","transforms":[{"kind":"TRIM"}]},{"target":"startedAt","source":"inicio","transforms":[]},{"target":"endedAt","source":"fim","transforms":[]}]}'::jsonb,
       'DELTA', '{"kind":"MANUAL"}'::jsonb, 'ACTIVE', false, 'DEMO_SEED', '{"lagDays":1,"availableByLocalTime":"09:00"}'::jsonb
where not exists (select 1 from data_feeds where id = 'de00da7a-0000-4000-8000-000000000013');

update data_feeds set availability_policy = '{"lagDays":1,"availableByLocalTime":"11:00"}'::jsonb
 where id in ('de00da7a-0000-4000-8000-000000000012', 'de00da7a-0000-4000-8000-000000000021') and availability_policy is null;
update data_feeds set availability_policy = '{"lagDays":2,"availableByLocalTime":"08:00"}'::jsonb
 where id = 'de00da7a-0000-4000-8000-000000000011' and availability_policy is null;

-- ------------------------------------------------------------------------------------------
-- FECHAMENTO OFICIAL com numerador e denominador (contrato OFFICIAL_INDICATOR_PERFORMANCE@2, migration 147):
-- feed de arquivo já mapeado para a planilha mensal do cliente — valor, meta, atingimento, peso e quartil como a
-- fonte calculou e, quando a estratégia do indicador define o valor por componentes (Taxa, Média ponderada), os
-- dois componentes. Sem histórico fabricado: as cargas nascem pela tela. Namespace 'DEMO_SEED' (dado demo).
-- ------------------------------------------------------------------------------------------
insert into data_feeds (id, organization_id, source_id, feed_key, name, contract_key, contract_version, connector_config, mapping, load_mode, cadence, status, authoritative, source_namespace)
select 'de00da7a-0000-4000-8000-000000000014', '00000000-0000-4000-8000-000000000001', 'de00da7a-0000-4000-8000-000000000001', 'fechamento', 'Fechamento oficial mensal (CSV/Excel)', 'OFFICIAL_INDICATOR_PERFORMANCE', 2,
       '{"connector":"FILE_UPLOAD","file":{"format":"CSV","csv":{"encoding":"utf-8","delimiter":"auto","hasHeader":true,"skipRows":0},"excel":{"hasHeader":true,"skipRows":0}}}'::jsonb,
       '{"fields":[{"target":"externalEmployeeId","source":"matricula","transforms":[{"kind":"TRIM"}]},{"target":"indicatorCode","source":"indicador","transforms":[{"kind":"UPPERCASE"}]},{"target":"referencePeriod","source":"competencia","transforms":[]},{"target":"value","source":"valor","transforms":[{"kind":"PARSE_DECIMAL","decimalSeparator":","}]},{"target":"numerator","source":"numerador","transforms":[{"kind":"PARSE_DECIMAL","decimalSeparator":","}]},{"target":"denominator","source":"denominador","transforms":[{"kind":"PARSE_DECIMAL","decimalSeparator":","}]},{"target":"targetValue","source":"meta","transforms":[{"kind":"PARSE_DECIMAL","decimalSeparator":","}]},{"target":"achievementPercent","source":"atingimento","transforms":[{"kind":"PARSE_DECIMAL","decimalSeparator":","}]},{"target":"weightPercent","source":"peso","transforms":[{"kind":"PARSE_DECIMAL","decimalSeparator":","}]},{"target":"quartile","source":"quartil","transforms":[]}]}'::jsonb,
       'DELTA', '{"kind":"MANUAL"}'::jsonb, 'ACTIVE', false, 'DEMO_SEED'
where not exists (select 1 from data_feeds where id = 'de00da7a-0000-4000-8000-000000000014');
