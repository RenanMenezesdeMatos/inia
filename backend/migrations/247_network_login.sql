-- LOGIN PELA REDE (AD por LDAPS) — auth/domain/network-login.ts.
--
-- 1. Interruptor por organização: com ele ligado, as pessoas entram com a matrícula e a senha de rede (a matrícula encontra a
--    pessoa em people.matricula; a conta continua precisando estar habilitada na INIA). Começa DESLIGADO: quem liga é o
--    administrador, na tela de Acessos, depois de conferir os servidores.
-- 2. Conta local de emergência: com o login pela rede ligado, e-mail e senha só valem para estas contas (o administrador entra
--    se o AD cair); para as demais a INIA recusa a senha local. O primeiro administrador da instalação já nasce de emergência;
--    `npm run admin:create` cria outras. Cada entrada por esse caminho vai para a auditoria e avisa quem administra os acessos.

alter table organizations
  add column if not exists network_login_enabled boolean not null default false,
  add column if not exists network_login_changed_at timestamptz,
  -- Sem FK para people (a instalação esvazia people mantendo organizations; quem mudou também fica em audit_logs).
  add column if not exists network_login_changed_by uuid;

alter table user_accounts
  add column if not exists emergency_local_access boolean not null default false;

update user_accounts ua
   set emergency_local_access = true
  from installation_info ii
 where ii.first_admin_account_id = ua.id
   and ua.emergency_local_access = false;
