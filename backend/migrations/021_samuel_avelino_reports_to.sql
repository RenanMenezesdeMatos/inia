update people set reports_to_id = (select id from people p2 where p2.organization_id = people.organization_id and p2.name = 'Thiago Barreto')
  where organization_id = '00000000-0000-4000-8000-000000000001' and name = 'Samuel Avelino';
