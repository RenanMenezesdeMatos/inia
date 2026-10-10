import type pg from "pg"
import { hashPassword } from "../infrastructure/password-hasher.js"

/**
 * As contas das migrations antigas (carla.nunes@inia.com, ana.lima@inia.com…) nascem com senha ALEATÓRIA — nenhuma
 * senha fica no código. Uma prova contra o banco de TESTE que entra com uma dessas contas define antes a senha que vai
 * usar, para funcionar também num banco de teste recém-migrado.
 */
export async function setProofAccountPassword(db: Pick<pg.Pool, "query">, email: string, password: string): Promise<void> {
  const result = await db.query(`update user_accounts set password_hash = $1 where lower(email) = lower($2)`, [await hashPassword(password), email])
  if (result.rowCount !== 1) throw new Error(`Conta ${email} não encontrada no banco de teste (rode as migrations: npm run db:migrate:test).`)
}
