-- A nova ação "Escalonar" do workflow (action-executors.ts/escalateToRoles) grava um alerta
-- por destinatário usando um dedupe_key determinístico (enrollment + nó + destinatário) e
-- confia num "on conflict (dedupe_key) do nothing" pra nunca duplicar se o mesmo nó rodar mais
-- de uma vez pro mesmo enrollment — precisa de um índice único de verdade pra isso funcionar.
create unique index uq_alerts_dedupe_key on alerts (dedupe_key);
