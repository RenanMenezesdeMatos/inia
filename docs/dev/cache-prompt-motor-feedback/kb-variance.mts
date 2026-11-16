// O que muda no bloco de fontes entre chamadas seguidas (desde 20/10, onde a reconstrução é fiel). Só leitura, rede bloqueada, só contagens.
import { createRequire } from "node:module"
import { createHash } from "node:crypto"
const B = new URL("../../../backend", import.meta.url).pathname.replace(/\/$/, "")
const require = createRequire(B + "/package.json")
const pg = require("pg")
;(globalThis as any).fetch = async () => { throw new Error("REDE BLOQUEADA") }
const db = new pg.Pool({ connectionString: "postgresql://renanmenezes@localhost:5432/inia", options: "-c default_transaction_read_only=on -c statement_timeout=30000", max: 4 })
if ((await db.query("show default_transaction_read_only")).rows[0].default_transaction_read_only !== "on") throw new Error("não está em leitura")
const { loadInteractionForAnalysis, loadAgentProfile, loadAgentDocumentsAt } = await import(B + "/src/modules/feedback-engine/infrastructure/postgres-engine-loaders.ts")
const { loadArgumentScriptsInForce } = await import(B + "/src/modules/argument-scripts/infrastructure/argument-script-loaders.ts")
const { loadProductCatalogAt } = await import(B + "/src/modules/product-catalog/infrastructure/product-catalog-loaders.ts")
const { rawSubjectOf } = await import(B + "/src/modules/interactions/domain/interaction-subject.ts")
const { selectDocumentsForCall } = await import(B + "/src/modules/feedback-engine/domain/document-selection.ts")
const { buildProcedureContext, renderArgumentScriptsForModel } = await import(B + "/src/modules/feedback-engine/domain/procedure.ts")
const { productContextOf, renderProductCatalogForModel } = await import(B + "/src/modules/feedback-engine/domain/product-applicability.ts")
const { interactionMetadataOf } = await import(B + "/src/modules/feedback-engine/application/analyze-call.ts")
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12)
const runs = (await db.query(`select id, organization_id, interaction_id, agent_id, started_at from feedback_analysis_runs where kind='CALL_ANALYSIS' and status='COMPLETED' and started_at >= '2026-10-20' and interaction_id is not null order by started_at`)).rows
const rows: any[] = []
for (const run of runs) {
  const interaction = await loadInteractionForAnalysis(db, run.organization_id, run.interaction_id)
  const agent = run.agent_id ? await loadAgentProfile(db, run.organization_id, run.agent_id) : null
  if (!interaction || !agent) continue
  const subject = interaction.subjectCanonical?.name ?? rawSubjectOf(interaction)
  const candidates = await loadAgentDocumentsAt(db, run.organization_id, agent.id, interaction.startedAt)
  const scripts = await loadArgumentScriptsInForce(db, run.organization_id, { teamId: interaction.teamId, subteamId: interaction.subteamId }, interaction.startedAt)
  const catalog = await loadProductCatalogAt(db, run.organization_id, interaction.startedAt, [...candidates.map((d: any) => d.documentId), ...scripts.map((s: any) => s.scriptId)])
  const selection = selectDocumentsForCall(candidates, { subject, transcript: interaction.transcript?.content ?? "", productScoped: new Set((catalog?.scopes ?? []).map((s: any) => s.sourceId)) as Set<string> })
  const context = buildProcedureContext(selection.selected, scripts)
  const products = productContextOf(catalog, { presentedSourceIds: context.documents.map((d: any) => d.documentId), metadata: interactionMetadataOf(interaction, subject) })
  const order = selection.selected.map((d: any) => `${d.documentId}@${d.version}`)
  rows.push({
    at: new Date(run.started_at).getTime(), agent: agent.id, order: order.join(","), set: [...order].sort().join(","), scripts: sha(scripts.map((s: any) => s.versionId ?? s.scriptId).join(",")),
    scriptsText: sha(renderArgumentScriptsForModel(context)), products: products ? sha(renderProductCatalogForModel(products)) : "-", omitted: selection.omitted.length, candidates: candidates.length, budgetCut: selection.omitted.length > 0,
  })
}
const distinct = (f: (r: any) => string) => new Set(rows.map(f)).size
console.log("execuções:", rows.length, "| agentes:", distinct((r) => r.agent), "| conjuntos de documentos:", distinct((r) => r.set), "| ordens:", distinct((r) => r.order), "| escopos de argumentários:", distinct((r) => r.scripts), "| texto de argumentários:", distinct((r) => r.scriptsText), "| catálogos de produto:", distinct((r) => r.products))
console.log("com corte por orçamento:", rows.filter((r) => r.budgetCut).length, "| candidatos por agente (média):", (rows.reduce((a, r) => a + r.candidates, 0) / rows.length).toFixed(1))
const first = { agente: 0, escopoArgumentarios: 0, conjuntoDocs: 0, ordemDocs: 0, textoArgumentarios: 0, produtos: 0, nada: 0 }
const sorted = [...rows].sort((a, b) => a.at - b.at)
for (let i = 1; i < sorted.length; i++) {
  const a = sorted[i - 1], b = sorted[i]
  if (a.agent !== b.agent) first.agente++
  else if (a.set !== b.set) first.conjuntoDocs++
  else if (a.order !== b.order) first.ordemDocs++
  else if (a.scripts !== b.scripts) first.escopoArgumentarios++
  else if (a.scriptsText !== b.scriptsText) first.textoArgumentarios++
  else if (a.products !== b.products) first.produtos++
  else first.nada++
}
console.log("par a par, o primeiro motivo de a base ser diferente:", JSON.stringify(first))
// Dentro de um mesmo agente: quantas chaves (ordem) × quantas execuções
const byAgent = new Map<string, any[]>(); for (const r of rows) { if (!byAgent.has(r.agent)) byAgent.set(r.agent, []); byAgent.get(r.agent)!.push(r) }
for (const [, rs] of [...byAgent.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 5)) console.log(`agente com ${rs.length} execuções: conjuntos=${new Set(rs.map((r) => r.set)).size} ordens=${new Set(rs.map((r) => r.order)).size} escopos=${new Set(rs.map((r) => r.scripts)).size} corte=${rs.filter((r) => r.budgetCut).length}`)
await db.end()
