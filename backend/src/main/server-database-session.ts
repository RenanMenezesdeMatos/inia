import { DATABASE_SESSION_MARKER } from "../infrastructure/database/session-limits.js"

// Marca este processo como SERVIDOR (API e/ou processamento) antes de o pool do banco nascer: o pool lê a marca quando é criado
// e aplica os limites de sessão do papel (infrastructure/database/session-limits.ts). Por isso este é o PRIMEIRO import de
// server.ts — módulos ES avaliam os imports na ordem em que aparecem. Migrations, seeds, scripts e testes não passam por aqui e
// ficam sem limite de comando/transação. `session-limits.ts` não importa o pool, então importar a constante não o cria antes.
process.env[DATABASE_SESSION_MARKER] = "server"
