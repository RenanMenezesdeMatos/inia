import pg from "pg"
import { env } from "../../config/env.js"

export const pool = new pg.Pool({ connectionString: env.activeDatabaseUrl, max: env.DATABASE_POOL_MAX })

// Conexão OCIOSA que cai (PostgreSQL reiniciado ou parado, rede) chega como evento "error" do pool. Sem este
// tratador o Node encerra o processo inteiro; com ele o pool descarta a conexão e abre outra no próximo uso.
pool.on("error", (error) => {
  console.error("Conexão ociosa com o banco interno caiu (o pool abre outra no próximo uso):", error.message)
})

export type Database = Pick<pg.Pool, "query" | "connect">
