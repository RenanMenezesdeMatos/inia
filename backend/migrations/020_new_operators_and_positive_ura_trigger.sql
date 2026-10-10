-- Dois operadores novos (Gustavo Santos, Luana Brenda) já foram criados e
-- alocados em grupo pelo admin — só falta a cadeia de reporte deles.
update people set reports_to_id = (select id from people p2 where p2.organization_id = people.organization_id and p2.name = 'Bruno Teixeira')
  where organization_id = '00000000-0000-4000-8000-000000000001' and name = 'Gustavo Santos';

update people set reports_to_id = (select id from people p2 where p2.organization_id = people.organization_id and p2.name = 'Vanessa Lopes')
  where organization_id = '00000000-0000-4000-8000-000000000001' and name = 'Luana Brenda';

-- Nota URA positiva também é gatilho — não só corretivo (baixa nota), como
-- reconhecimento quando o atendimento vai muito bem.
insert into triggers (organization_id, name, channel_flag_id, comparator, threshold_numeric, scope_type, team_id, agent_id)
select '00000000-0000-4000-8000-000000000001', 'Nota URA positiva — Atendimento Geral', cf.id, 'GTE', 9, 'TEAM', t.id, '00000000-0000-4000-8000-000000000070'
from channel_flags cf, teams t
where cf.organization_id = '00000000-0000-4000-8000-000000000001' and cf.flag_name = 'nota_ura'
  and t.organization_id = '00000000-0000-4000-8000-000000000001' and t.name = 'ATENDIMENTO GERAL';
