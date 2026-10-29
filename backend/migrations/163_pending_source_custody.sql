-- CUSTÓDIA PENDENTE DA CREDENCIAL (2026-10-29, item h19 da 4ª auditoria). Pessoa cadastrada à mão (conta liberada por quem
-- administra o Grupo dela) que uma carga de Colaboradores liga SEM definir o lugar dela continua com o Grupo e o nível de antes
-- guardados aqui. A primeira carga que definir o lugar — de Colaboradores ou de Estrutura organizacional — aplica a mesma regra
-- do AUTH-13: outro Grupo, nível de liderança ou subordinado de outro Grupo = acesso desabilitado até quem administra o lugar novo
-- liberar; o mesmo lugar = custódia confirmada. Nos dois casos as colunas voltam a null.
--
--   people.pending_custody_team_id   Grupo do cadastro manual enquanto a base não definiu o lugar (null = nada pendente)
--   people.pending_custody_role      nível do cadastro manual no mesmo momento
-- Ver person-identity.ts (enforceSourceCustody) e docs/dev/memoria/seguranca.md.

alter table people add column pending_custody_team_id uuid references teams(id) on delete set null;
alter table people add column pending_custody_role text;
create index people_pending_custody_idx on people (organization_id) where pending_custody_team_id is not null;
