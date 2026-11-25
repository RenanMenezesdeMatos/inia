-- POR QUE A TENTATIVA DE LOGIN FOI RECUSADA (25/11/2026) — access/application/network-access-*.ts, auth/domain/login-attempt.ts.
--
-- Com o login pela rede ligado, "não consigo entrar" tinha a mesma resposta para causas diferentes (matrícula sem conta na INIA,
-- senha recusada pelo AD, conta de rede bloqueada, AD fora do ar) e nada ficava registrado para o administrador conferir. Cada
-- tentativa passa a guardar o MOTIVO e o código que o AD devolveu (52e, 532, 533, 775…). Nada de senha, nem do que foi digitado: o
-- identificador continua só o HMAC. Linhas antigas ficam com motivo nulo. Retenção de 30 dias, como antes.
alter table auth_login_attempts
  add column if not exists reason text,
  add column if not exists directory_code text;

alter table auth_login_attempts drop constraint if exists auth_login_attempts_reason_check;
alter table auth_login_attempts add constraint auth_login_attempts_reason_check check (reason is null or reason ~ '^[A-Z_]{2,40}$');
alter table auth_login_attempts drop constraint if exists auth_login_attempts_directory_code_check;
alter table auth_login_attempts add constraint auth_login_attempts_directory_code_check check (directory_code is null or directory_code ~ '^[0-9a-f]{1,8}$');
