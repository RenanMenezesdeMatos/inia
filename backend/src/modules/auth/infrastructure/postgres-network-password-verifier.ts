import type { Database } from "../../../infrastructure/database/pool.js"
import { createNetworkPasswordVerifier } from "../application/authenticate-network.js"
import type { DirectoryAuthenticator } from "../application/directory-authenticator.js"
import { createPostgresCredentialStore, loginIdentifierHash } from "./postgres-credential-store.js"

/**
 * Verificador da senha de rede montado sobre o banco (pool, autocommit) — o que outros módulos usam (a ciência) sem conhecer a
 * loja de credenciais. Recebe o POOL, nunca o cliente de uma transação: a chamada ao AD não pode segurar conexão em transação.
 */
export function createPostgresNetworkPasswordVerifier(db: Database, directory: DirectoryAuthenticator, now: () => Date) {
  return createNetworkPasswordVerifier({ store: createPostgresCredentialStore(db), directory, identifierHash: loginIdentifierHash, now })
}
