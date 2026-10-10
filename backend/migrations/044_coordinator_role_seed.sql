-- Achado real da validação dos 10 Workflows operacionais: `escalationRoleSchema` já suporta o
-- papel COORDINATOR (entre Operador e Supervisor na cadeia reports_to — migration 037), mas
-- NENHUMA pessoa com esse papel existe na organização de demonstração — "Escalonar → Coordenador"
-- nunca tinha um destinatário real pra resolver. Completa (nunca reescreve) um único elo da
-- hierarquia já existente do time ATENDIMENTO GERAL: insere uma Coordenadora entre a supervisora
-- Vanessa Lopes e o gerente Roberto Alves — nenhuma pessoa/vínculo anterior é removido, só o elo
-- que faltava é preenchido. Idempotente via `not exists`.

insert into people (organization_id, team_id, name, role, job_title, reports_to_id)
select '00000000-0000-4000-8000-000000000001', p.team_id, 'Patrícia Coordenadora', 'COORDINATOR',
       'Coordenadora de Atendimento', p.reports_to_id
from people p
where p.name = 'Vanessa Lopes'
  and not exists (select 1 from people c where c.organization_id = '00000000-0000-4000-8000-000000000001' and c.role = 'COORDINATOR');

update people
set reports_to_id = (select id from people where name = 'Patrícia Coordenadora')
where name = 'Vanessa Lopes'
  and reports_to_id <> (select id from people where name = 'Patrícia Coordenadora')
  and exists (select 1 from people where name = 'Patrícia Coordenadora');
