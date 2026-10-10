/**
 * RETENÇÕES ANTIGAS DE QA (HOLD_FOR_QA do caminho anterior). Padrão = SÓ LISTA (dry-run, nada muda).
 *
 *   npx tsx scripts/feedback-engine/legacy-holds.ts [--organization <uuid>]                       # lista
 *   npx tsx scripts/feedback-engine/legacy-holds.ts --apply --mode REPROCESS --reason "<motivo>" [--artifact <uuid> ...]
 *   npx tsx scripts/feedback-engine/legacy-holds.ts --apply --mode CLOSE --reason "<motivo>" [--artifact <uuid> ...]
 *
 * REPROCESS substitui o artefato antigo e reativa a matrícula no nó "Gerar feedback" (o motor novo roda de novo — consome IA).
 * CLOSE substitui e encerra a matrícula que esperava, sem entrega. Nunca trata a retenção como aprovada; nada é apagado.
 * Operação de dados: rode primeiro a listagem e aplique só com decisão explícita.
 */
import { pool } from "../../src/infrastructure/database/pool.js"
import { findLegacyHolds, resolveLegacyHold } from "../../src/modules/feedback-engine/application/legacy-holds.js"

const args = process.argv.slice(2)
const option = (name: string) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined }
const many = (name: string) => args.flatMap((value, index) => (args[index - 1] === `--${name}` ? [value] : []))
try {
  const holds = await findLegacyHolds(pool, option("organization") ?? null)
  const selected = many("artifact").length > 0 ? holds.filter((hold) => many("artifact").includes(hold.artifactId)) : holds
  console.log(`${holds.length} retenção(ões) antiga(s) aguardando QA${selected.length !== holds.length ? ` · ${selected.length} selecionada(s)` : ""}:`)
  for (const hold of selected) console.log(`- ${hold.artifactId} · ${hold.workflowName ?? "sem Workflow"} · ${hold.collaboratorName ?? "?"} · ${hold.domain} · ${hold.label ?? ""} · ${hold.pendingItems} pendente(s)/${hold.decidedItems} decidido(s) · matrícula ${hold.enrollmentStatus ?? "—"}${hold.waitingAtNode ? " (esperando no nó)" : ""}`)
  if (!args.includes("--apply")) {
    console.log("\nDry-run: nada foi alterado. Use --apply --mode REPROCESS|CLOSE --reason \"…\" para aplicar.")
  } else {
    const mode = option("mode")
    const reason = option("reason")
    if (mode !== "REPROCESS" && mode !== "CLOSE") throw new Error("--mode deve ser REPROCESS ou CLOSE")
    if (!reason?.trim()) throw new Error("--reason é obrigatório")
    for (const hold of selected) console.log(JSON.stringify(await resolveLegacyHold(pool, { organizationId: hold.organizationId, artifactId: hold.artifactId, mode, reason })))
  }
} finally {
  await pool.end()
}
