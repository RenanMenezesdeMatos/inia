-- LOGIN DO AD QUE JÁ ENTROU (25/11/2026) — auth/application/directory-gate.ts. Nos formatos de matrícula em que o login do AD pode estar sem o
-- último dígito (AD_LOGIN_WITHOUT_LAST_DIGIT), a primeira entrada certa grava por qual dos dois a conta entra; daí em diante só ele é
-- tentado (nenhuma senha errada vai para o outro login, que pode ser de outra pessoa). Nulo = ainda não se sabe. Deixa de valer sozinho
-- se a matrícula mudar, e é apagado quando o acesso é habilitado de novo. Nunca guarda senha.
alter table user_accounts add column if not exists directory_login text;
alter table user_accounts drop constraint if exists user_accounts_directory_login_check;
alter table user_accounts add constraint user_accounts_directory_login_check check (directory_login is null or directory_login ~ '^[A-Z0-9][A-Z0-9._-]{1,63}$');
