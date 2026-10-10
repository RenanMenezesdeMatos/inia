-- Adiciona COORDINATOR à hierarquia organizacional (entre Operador e Supervisor) — necessário
-- pro Human Review poder resolver "Coordenador do operador" como alvo real de revisão, andando
-- a mesma cadeia reports_to_id que já resolve Supervisor/Gerente/Gerente Sênior/Diretor. Aditivo:
-- nenhuma linha existente muda, só amplia o conjunto de valores aceitos.
alter table people drop constraint people_role_check;
alter table people add constraint people_role_check
  check (role in ('OPERATOR', 'ADMIN', 'COORDINATOR', 'SUPERVISOR', 'MANAGER', 'SENIOR_MANAGER', 'DIRECTOR'));

alter table user_role_assignments drop constraint user_role_assignments_role_check;
alter table user_role_assignments add constraint user_role_assignments_role_check
  check (role in ('OPERATOR', 'ADMIN', 'COORDINATOR', 'SUPERVISOR', 'MANAGER', 'SENIOR_MANAGER', 'DIRECTOR'));
