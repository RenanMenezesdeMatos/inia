-- Jornadas de teste pros operadores já existentes — variedade de entrada/carga horária pra
-- validar o Trigger "Por agenda" relativo ao expediente, incluindo um caso que atravessa a
-- meia-noite (Gustavo Santos, turno noturno). Idempotente: só insere se a pessoa ainda não tiver
-- nenhuma jornada cadastrada (nunca duplica ao reaplicar).

insert into employee_work_shifts (organization_id, person_id, start_time, work_minutes)
select p.organization_id, p.id, v.start_time::time, v.work_minutes
from people p
join (values
  ('Icaro Elias', '08:00', 480),
  ('Karoline Wokysbly', '09:00', 480),
  ('Luana Brenda', '07:30', 360),
  ('Denisy Feitoza', '13:00', 360),
  ('Samuel Avelino', '14:00', 480),
  ('Camila Pereira', '06:00', 360),
  ('Gustavo Santos', '22:00', 480),
  ('Pamella Albuquerque', '08:30', 480),
  ('Ana Lima', '09:00', 360),
  ('Luzia Ingrid da Silva Nobre', '07:00', 480)
) as v(name, start_time, work_minutes) on v.name = p.name
where p.organization_id = '00000000-0000-4000-8000-000000000001'
  and not exists (select 1 from employee_work_shifts s where s.person_id = p.id);
