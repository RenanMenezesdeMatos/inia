-- Suporte a cargas reais vindas do analytics (MATRICULA como chave estável)
-- e à cadeia de hierarquia organizacional (quem reporta para quem).
alter table people add column matricula text;
alter table people add constraint people_matricula_unique unique (organization_id, matricula);
alter table people add column reports_to_id uuid references people(id);

-- Novo gatilho de canal: tempo de silêncio da chamada, em segundos.
insert into channel_flags (organization_id, channel, flag_name, value_type, description) values
  ('00000000-0000-4000-8000-000000000001', 'VOICE', 'tempo_silencio', 'NUMERIC', 'Tempo total de silêncio na chamada, em segundos.');

-- Grupos novos, substituindo "Contas"/"Retenção B2B" como organização vigente
-- (as linhas antigas de teams ficam no banco por causa do histórico já amarrado
-- a elas via FK — supervision_cases e goals — mas deixam de receber gente nova).
insert into teams (organization_id, operation_id, name) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000010', 'FATURAS'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000010', 'SUPORTE TÉCNICO'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000010', 'ATENDIMENTO GERAL'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000010', 'RETENÇÃO/FIDELIZAÇÃO');

-- Dois supervisores novos (faltavam 2 dos 4 necessários: 1 por grupo).
insert into people (organization_id, team_id, name, role, job_title) values
  ('00000000-0000-4000-8000-000000000001',
   (select id from teams where organization_id = '00000000-0000-4000-8000-000000000001' and name = 'SUPORTE TÉCNICO'),
   'Thiago Barreto', 'SUPERVISOR', 'Supervisor — Suporte Técnico'),
  ('00000000-0000-4000-8000-000000000001',
   (select id from teams where organization_id = '00000000-0000-4000-8000-000000000001' and name = 'ATENDIMENTO GERAL'),
   'Vanessa Lopes', 'SUPERVISOR', 'Supervisora — Atendimento Geral');

insert into user_accounts (organization_id, person_id, email, password_hash) values
  ('00000000-0000-4000-8000-000000000001',
   (select id from people where organization_id = '00000000-0000-4000-8000-000000000001' and name = 'Thiago Barreto'),
   'thiago.barreto@inia.com', crypt(gen_random_uuid()::text, gen_salt('bf'))),
  ('00000000-0000-4000-8000-000000000001',
   (select id from people where organization_id = '00000000-0000-4000-8000-000000000001' and name = 'Vanessa Lopes'),
   'vanessa.lopes@inia.com', crypt(gen_random_uuid()::text, gen_salt('bf')));

-- Realoca os 8 operadores + os 2 supervisores já existentes para os grupos novos.
update people set team_id = (select id from teams where organization_id = people.organization_id and name = 'FATURAS')
  where organization_id = '00000000-0000-4000-8000-000000000001' and name in ('Camila Pereira', 'Pamella Albuquerque', 'Bruno Teixeira');

update people set team_id = (select id from teams where organization_id = people.organization_id and name = 'SUPORTE TÉCNICO')
  where organization_id = '00000000-0000-4000-8000-000000000001' and name in ('Juliana Prado', 'Denisy Feitoza');

update people set team_id = (select id from teams where organization_id = people.organization_id and name = 'ATENDIMENTO GERAL')
  where organization_id = '00000000-0000-4000-8000-000000000001' and name in ('Icaro Elias', 'Karoline Wokysbly');

update people set team_id = (select id from teams where organization_id = people.organization_id and name = 'RETENÇÃO/FIDELIZAÇÃO')
  where organization_id = '00000000-0000-4000-8000-000000000001' and name in ('Ana Lima', 'Luzia Ingrid da Silva Nobre', 'Mariana Costa');

-- Cadeia de reporte: operador → supervisor → gerente → gerente sênior → diretor.
update people set reports_to_id = (select id from people p2 where p2.organization_id = people.organization_id and p2.name = 'Bruno Teixeira')
  where organization_id = '00000000-0000-4000-8000-000000000001' and name in ('Camila Pereira', 'Pamella Albuquerque');

update people set reports_to_id = (select id from people p2 where p2.organization_id = people.organization_id and p2.name = 'Thiago Barreto')
  where organization_id = '00000000-0000-4000-8000-000000000001' and name in ('Juliana Prado', 'Denisy Feitoza');

update people set reports_to_id = (select id from people p2 where p2.organization_id = people.organization_id and p2.name = 'Vanessa Lopes')
  where organization_id = '00000000-0000-4000-8000-000000000001' and name in ('Icaro Elias', 'Karoline Wokysbly');

update people set reports_to_id = (select id from people p2 where p2.organization_id = people.organization_id and p2.name = 'Mariana Costa')
  where organization_id = '00000000-0000-4000-8000-000000000001' and name in ('Ana Lima', 'Luzia Ingrid da Silva Nobre');

update people set reports_to_id = (select id from people p2 where p2.organization_id = people.organization_id and p2.name = 'Roberta Gaspar')
  where organization_id = '00000000-0000-4000-8000-000000000001' and name in ('Bruno Teixeira', 'Thiago Barreto');

update people set reports_to_id = (select id from people p2 where p2.organization_id = people.organization_id and p2.name = 'Roberto Alves')
  where organization_id = '00000000-0000-4000-8000-000000000001' and name in ('Vanessa Lopes', 'Mariana Costa');

update people set reports_to_id = (select id from people p2 where p2.organization_id = people.organization_id and p2.name = 'Fernanda Dias')
  where organization_id = '00000000-0000-4000-8000-000000000001' and name in ('Roberto Alves', 'Roberta Gaspar');

update people set reports_to_id = (select id from people p2 where p2.organization_id = people.organization_id and p2.name = 'Paulo Ricardo')
  where organization_id = '00000000-0000-4000-8000-000000000001' and name = 'Fernanda Dias';

-- Metas para os grupos novos, replicando os mesmos alvos que "Retenção B2B" já tinha
-- (sem isso a aba de indicadores do operador fica vazia pros grupos novos).
insert into goals (organization_id, indicator_definition_id, subject_type, subject_id, target_value, valid_from)
select '00000000-0000-4000-8000-000000000001', v.indicator_definition_id, 'TEAM', t.id, v.target_value, '2026-01-01'
from teams t
cross join (values
  ('00000000-0000-4000-8000-000000000300'::uuid, 300::numeric),
  ('00000000-0000-4000-8000-000000000301'::uuid, 70::numeric),
  ('00000000-0000-4000-8000-000000000302'::uuid, 85::numeric)
) as v(indicator_definition_id, target_value)
where t.organization_id = '00000000-0000-4000-8000-000000000001'
  and t.name in ('FATURAS', 'SUPORTE TÉCNICO', 'ATENDIMENTO GERAL', 'RETENÇÃO/FIDELIZAÇÃO');

-- Gatilhos por grupo — cada grupo com sua particularidade, todos usando o
-- Agente de Feedback de Chamadas já existente.
update triggers set scope_type = 'TEAM',
  team_id = (select id from teams where organization_id = '00000000-0000-4000-8000-000000000001' and name = 'RETENÇÃO/FIDELIZAÇÃO')
  where organization_id = '00000000-0000-4000-8000-000000000001' and name = 'Rechamada detectada';

insert into triggers (organization_id, name, channel_flag_id, comparator, threshold_numeric, scope_type, team_id, agent_id)
select '00000000-0000-4000-8000-000000000001', v.name, cf.id, v.comparator, v.threshold, 'TEAM', t.id, '00000000-0000-4000-8000-000000000070'
from (values
  ('Silêncio prolongado — Suporte Técnico', 'tempo_silencio', 'GTE', 45::numeric, 'SUPORTE TÉCNICO'),
  ('Baixa aderência — Faturas', 'tdna', 'LTE', 40::numeric, 'FATURAS'),
  ('Nota URA baixa — Atendimento Geral', 'nota_ura', 'LTE', 3::numeric, 'ATENDIMENTO GERAL')
) as v(name, flag_name, comparator, threshold, team_name)
join channel_flags cf on cf.organization_id = '00000000-0000-4000-8000-000000000001' and cf.flag_name = v.flag_name
join teams t on t.organization_id = '00000000-0000-4000-8000-000000000001' and t.name = v.team_name;
