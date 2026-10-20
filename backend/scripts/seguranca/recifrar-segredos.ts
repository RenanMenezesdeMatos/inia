/**
 * `npm run secrets:rotate` — RECIFRA as credenciais guardadas (Central de Dados e conexões de IA) com a chave atual
 * (DATA_HUB_SECRET_KEY), na versão 2 da cifra (presa à organização, ao dono e à finalidade). Resolve R-12 e R-25.
 *
 * Troca da chave, passo a passo (docs/security/configuracao-segura.md › Rotação da chave de cifra):
 *   1. Backup do banco (npm run db:backup).
 *   2. backend/.env: a chave ANTIGA vai para DATA_HUB_SECRET_KEY_PREVIOUS e a NOVA para DATA_HUB_SECRET_KEY
 *      (openssl rand -hex 32). Reinicie: a INIA continua lendo as credenciais antigas pela chave anterior.
 *   3. npm run secrets:rotate            (simulação: mostra o que seria recifrado e se tudo é legível)
 *      npm run secrets:rotate -- --aplicar
 *   4. Tire DATA_HUB_SECRET_KEY_PREVIOUS do .env e reinicie.
 * Sem troca de chave, o mesmo comando só passa as credenciais antigas (v1) para a v2.
 *
 * Nunca imprime segredo. Recifra tudo numa transação por tabela e confere, antes do commit, que cada linha decifra com a chave
 * atual. Credencial que nenhuma das chaves abre não é tocada e faz o comando terminar com código 1 (redigite pela tela).
 */
import { pool } from "../../src/infrastructure/database/pool.js"
import { resolveSecretKeys, rotateStoredSecret, type SecretBinding } from "../../src/modules/data-hub/infrastructure/aes-secret-store.js"

const apply = process.argv.includes("--aplicar")
const keys = resolveSecretKeys()
const TABLES = [
  { table: "data_secrets", store: "data_secrets" as const, ownerColumn: "source_id", label: "Central de Dados" },
  { table: "ai_connection_secrets", store: "ai_connection_secrets" as const, ownerColumn: "connection_id", label: "Conexões de IA" },
]

type Row = { id: string; organization_id: string; owner_id: string; purpose: string; key_version: number; ciphertext: Buffer; iv: Buffer; auth_tag: Buffer }

let unreadableTotal = 0
console.log(`Recifrar credenciais — ${apply ? "APLICANDO" : "simulação (nada é gravado; use --aplicar)"}${keys.previous ? " · com a chave anterior (DATA_HUB_SECRET_KEY_PREVIOUS)" : ""}\n`)
for (const target of TABLES) {
  const client = await pool.connect()
  try {
    await client.query("begin")
    const rows = (await client.query<Row>(
      `select id, organization_id, ${target.ownerColumn} owner_id, purpose, key_version, ciphertext, iv, auth_tag from ${target.table} where revoked_at is null order by id for update`,
    )).rows
    let rotated = 0
    let current = 0
    const unreadable: string[] = []
    for (const row of rows) {
      const binding: SecretBinding = { store: target.store, organizationId: row.organization_id, ownerId: row.owner_id, purpose: row.purpose }
      const decision = rotateStoredSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag, keyVersion: row.key_version }, binding, keys)
      if (decision.kind === "CURRENT") current += 1
      else if (decision.kind === "UNREADABLE") unreadable.push(`${row.id} (${row.purpose})`)
      else {
        await client.query(`update ${target.table} set key_version = $2, ciphertext = $3, iv = $4, auth_tag = $5 where id = $1`, [row.id, decision.encrypted.keyVersion, decision.encrypted.ciphertext, decision.encrypted.iv, decision.encrypted.authTag])
        rotated += 1
      }
    }
    await client.query(apply ? "commit" : "rollback")
    unreadableTotal += unreadable.length
    console.log(`${target.label} (${target.table}): ${rows.length} ativa(s) · ${rotated} ${apply ? "recifrada(s)" : "seria(m) recifrada(s)"} · ${current} já na chave e versão atuais · ${unreadable.length} ilegível(is)`)
    for (const entry of unreadable) console.log(`  ✗ ${entry} — nenhuma das chaves abre; redigite a credencial pela tela`)
  } catch (error) {
    await client.query("rollback").catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
await pool.end()
if (unreadableTotal > 0) {
  console.log("\n✗ Há credenciais ilegíveis (listadas acima). As demais foram tratadas normalmente.")
  process.exit(1)
}
console.log(apply ? "\n✓ Tudo na chave atual. Se trocou a chave, tire DATA_HUB_SECRET_KEY_PREVIOUS do .env e reinicie." : "\n✓ Simulação concluída. Rode com --aplicar para gravar.")
