// Reconstrói os prompts REAIS do motor (mesmas funções) a partir do banco dev, SÓ LEITURA e com rede bloqueada.
// Saída: só números agregados (nada de transcrição, nome ou conteúdo de base).
import { createRequire } from "node:module"
import { writeFileSync } from "node:fs"
import { createHash } from "node:crypto"

const B = new URL("../../../backend", import.meta.url).pathname.replace(/\/$/, "")
const OUT = import.meta.dirname
const require = createRequire(B + "/package.json")
const pg = require("pg")

// Trava: nenhuma chamada de rede neste processo.
;(globalThis as any).fetch = async () => { throw new Error("REDE BLOQUEADA NESTE DIAGNÓSTICO") }

const db = new pg.Pool({ connectionString: "postgresql://renanmenezes@localhost:5432/inia", options: "-c default_transaction_read_only=on -c statement_timeout=30000", max: 4 })
const ro = (await db.query("show default_transaction_read_only")).rows[0].default_transaction_read_only
if (ro !== "on") throw new Error("conexão não está em modo leitura")

const { loadInteractionForAnalysis, loadAgentProfile, loadAgentDocumentsAt } = await import(B + "/src/modules/feedback-engine/infrastructure/postgres-engine-loaders.ts")
const { loadArgumentScriptsInForce } = await import(B + "/src/modules/argument-scripts/infrastructure/argument-script-loaders.ts")
const { loadProductCatalogAt } = await import(B + "/src/modules/product-catalog/infrastructure/product-catalog-loaders.ts")
const { projectTranscript, renderTranscriptForModel } = await import(B + "/src/modules/investigation/domain/transcript-projection.ts")
const { rawSubjectOf } = await import(B + "/src/modules/interactions/domain/interaction-subject.ts")
const { selectDocumentsForCall } = await import(B + "/src/modules/feedback-engine/domain/document-selection.ts")
const { buildProcedureContext, transcriptStatusOf, renderProcedureForModel, renderArgumentScriptsForModel } = await import(B + "/src/modules/feedback-engine/domain/procedure.ts")
const { productContextOf, scopeLabelFor, renderProductCatalogForModel, renderInteractionMetadataForModel } = await import(B + "/src/modules/feedback-engine/domain/product-applicability.ts")
const { renderCallAnalysisUserTurn } = await import(B + "/src/modules/feedback-engine/domain/call-analysis-prompt.ts")
const { obligationAnalysisContractFor } = await import(B + "/src/modules/feedback-engine/domain/obligation-analysis-prompt.ts")
const { obligationReviewContractFor, obligationConfirmationContractFor, renderObligationReviewUserTurn } = await import(B + "/src/modules/feedback-engine/domain/obligation-review.ts")
const { interactionMetadataOf, TRANSCRIPT_MAX_CHARS } = await import(B + "/src/modules/feedback-engine/application/analyze-call.ts")

const lcp = (a: string, b: string) => { const n = Math.min(a.length, b.length); let i = 0; while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++; return i }
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16)
const q = (arr: number[], p: number) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]! }
const avg = (arr: number[]) => (arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : 0)

const runs = (await db.query(`
  select id, organization_id, interaction_id, agent_id, started_at, trigger, provenance, metrics
  from feedback_analysis_runs
  where kind='CALL_ANALYSIS' and status='COMPLETED' and started_at >= now()-interval '30 days' and interaction_id is not null
  order by started_at`)).rows

type R = Record<string, any>
const rows: R[] = []
const canon = (docs: any[]) => [...docs].sort((a, b) => String(a.documentId).localeCompare(String(b.documentId)))
const specialistBlock = (s: any) => s ? [`ESPECIALISTA CONFIGURADO: ${s.name}`, ...(s.guidance ? [`Orientação do domínio (configurada pela operação; não altera as regras do contrato):\n${s.guidance.slice(0, 3000)}`] : []), ""].join("\n") + "\n" : ""

let skipped = 0
for (const run of runs) {
  const interaction = await loadInteractionForAnalysis(db, run.organization_id, run.interaction_id)
  const agent = run.agent_id ? await loadAgentProfile(db, run.organization_id, run.agent_id) : null
  if (!interaction || !agent) { skipped++; continue }
  const projection = projectTranscript(interaction.transcript?.content ?? "", { maxChars: TRANSCRIPT_MAX_CHARS })
  const transcriptStatus = interaction.transcript ? transcriptStatusOf(projection) : "UNAVAILABLE"
  const subject = interaction.subjectCanonical?.name ?? rawSubjectOf(interaction)
  const candidates = await loadAgentDocumentsAt(db, run.organization_id, agent.id, interaction.startedAt)
  const scripts = await loadArgumentScriptsInForce(db, run.organization_id, { teamId: interaction.teamId, subteamId: interaction.subteamId }, interaction.startedAt)
  const catalog = await loadProductCatalogAt(db, run.organization_id, interaction.startedAt, [...candidates.map((d: any) => d.documentId), ...scripts.map((s: any) => s.scriptId)])
  const productScoped = new Set((catalog?.scopes ?? []).map((scope: any) => scope.sourceId)) as Set<string>
  const selection = selectDocumentsForCall(candidates, { subject, transcript: interaction.transcript?.content ?? "", productScoped })
  const build = (docs: any[]) => {
    const context = buildProcedureContext(docs, scripts)
    const products = productContextOf(catalog, { presentedSourceIds: context.documents.map((d: any) => d.documentId), metadata: interactionMetadataOf(interaction, subject) })
    if (products) for (const document of context.documents) document.productScopeLabel = scopeLabelFor(products, document.documentId)
    return { context, products }
  }
  const { context, products } = build(selection.selected)
  const canonical = build(canon(selection.selected))

  const specialist = { name: agent.name, guidance: [agent.objective, agent.contextPrompt].filter(Boolean).join("\n\n") || null }
  const view = { dateLabel: new Date(interaction.startedAt).toISOString().slice(0, 10), channel: interaction.channel, subject, durationSeconds: interaction.endedAt ? (interaction.endedAt.getTime() - interaction.startedAt.getTime()) / 1000 : null, signals: interaction.flags.map((f: any) => `${f.name} = ${f.value}`), selectionReason: run.trigger?.selectionReason ?? "" }
  const contract = obligationAnalysisContractFor(Boolean(products))
  const review = obligationReviewContractFor(Boolean(products))
  const confirmation = obligationConfirmationContractFor(Boolean(products))
  const turn = renderCallAnalysisUserTurn({ specialist, interaction: view, projection, transcriptStatus, context, products })

  const spec = specialistBlock(specialist)
  const transcript = renderTranscriptForModel(projection)
  const proc = renderProcedureForModel(context)
  const scr = renderArgumentScriptsForModel(context)
  const prodMeta = products ? renderInteractionMetadataForModel(products) : ""
  const prodCat = products ? renderProductCatalogForModel(products) : ""
  const kbOf = (c: any, p: any) => ["PROCEDIMENTOS DISPONÍVEIS (seções [S-n], linhas [L-n])", renderProcedureForModel(c), renderArgumentScriptsForModel(c), p ? renderProductCatalogForModel(p) : ""].join("\n")
  const kb = kbOf(context, products)
  const kbCanon = kbOf(canonical.context, canonical.products)
  const callPart = turn.slice(spec.length)

  const reviewTurn = renderObligationReviewUserTurn({ projection, transcriptStatus, subject, context, targets: { claims: [], linesToAssess: [], notAssessed: [] } as any, products })
  const cal = (run.metrics?.calls ?? []) as any[]
  const callOf = (tag: string) => cal.find((c) => c.tag === tag)?.inputTokens ?? null
  rows.push({
    id: run.id, org: run.organization_id, agent: agent.id, at: new Date(run.started_at).getTime(), day: new Date(run.started_at).toISOString().slice(0, 10), productMode: Boolean(products),
    sysA: contract.systemPrompt.length, sysR: review.systemPrompt.length, sysC: confirmation.systemPrompt.length, spec: spec.length, transcript: transcript.length, proc: proc.length, scr: scr.length, prodMeta: prodMeta.length, prodCat: prodCat.length, turn: turn.length, reviewTurn: reviewTurn.length,
    tokensAnalysis: callOf("analysis"), tokensReview: callOf("review:obligations"), tokensConfirm: callOf("confirmation:obligations"),
    renderedChars: context.renderedChars, recordedChars: Number(run.provenance?.procedureChars ?? 0),
    sameOrder: JSON.stringify(context.documents.filter((d: any) => d.kind !== "ARGUMENT_SCRIPT").map((d: any) => `${d.documentId}@${d.version}`)) === JSON.stringify((run.provenance?.documents ?? []).map((d: any) => `${d.documentId}@${d.version}`)),
    nDocs: selection.selected.length, omitted: selection.omitted.length,
    first: selection.selected[0]?.documentId ?? null,
    keyKbOrder: sha(spec + kb), keyKbCanon: sha(spec + kbCanon), keyKbCanonRev: sha(kbCanon),
    // Textos por layout (mantidos só em memória para o LCP)
    v0a: contract.systemPrompt + "\n" + turn,
    v1a: contract.systemPrompt + "\n" + spec + kb + "\n" + callPart,
    v2a: contract.systemPrompt + "\n" + spec + kbCanon + "\n" + callPart,
    v0r: review.systemPrompt + "\n" + reviewTurn,
    v2r: review.systemPrompt + "\n" + kbCanon + "\n" + "CHAMADA",
    prefixV2a: (contract.systemPrompt + "\n" + spec + kbCanon).length,
    prefixV2r: (review.systemPrompt + "\n" + kbCanon).length,
    keySysA: sha(contract.systemPrompt), keySysR: sha(review.systemPrompt),
  })
}

// ---- Fidelidade e calibração ----------------------------------------------
const recent = rows.filter((r) => r.day >= "2026-10-20")
const fid = (rs: R[]) => ({ n: rs.length, ordemIgual: rs.filter((r) => r.sameOrder).length, charsIguais: rs.filter((r) => Math.abs(r.renderedChars - r.recordedChars) <= 2).length, charsAte1pct: rs.filter((r) => Math.abs(r.renderedChars - r.recordedChars) <= r.recordedChars * 0.01).length })
const faithful = recent.filter((r) => r.sameOrder && Math.abs(r.renderedChars - r.recordedChars) <= 2 && r.tokensAnalysis)
const ratios = faithful.map((r) => (r.sysA + 1 + r.turn) / r.tokensAnalysis)
const ratiosR = recent.filter((r) => r.sameOrder && Math.abs(r.renderedChars - r.recordedChars) <= 2 && r.tokensReview).map((r) => (r.sysR + 1 + r.reviewTurn) / r.tokensReview)
const k = q(ratios, 0.5)
const kOf = (r: R) => (r.tokensAnalysis ? (r.sysA + 1 + r.turn) / r.tokensAnalysis : meanK)
const meanK = avg(faithful.map((r) => (r.sysA + 1 + r.turn) / r.tokensAnalysis))
const tok = (chars: number) => Math.round(chars / meanK)

// ---- Composição do pedido ------------------------------------------------
const compo = (rs: R[]) => ({ n: rs.length, sysA: Math.round(avg(rs.map((r) => r.sysA))), sysR: Math.round(avg(rs.map((r) => r.sysR))), sysC: Math.round(avg(rs.map((r) => r.sysC))), spec: Math.round(avg(rs.map((r) => r.spec))), transcript: Math.round(avg(rs.map((r) => r.transcript))), proc: Math.round(avg(rs.map((r) => r.proc))), scr: Math.round(avg(rs.map((r) => r.scr))), prodMeta: Math.round(avg(rs.map((r) => r.prodMeta))), prodCat: Math.round(avg(rs.map((r) => r.prodCat))), turn: Math.round(avg(rs.map((r) => r.turn))) })

// ---- LCP entre chamadas seguidas e com qualquer anterior na janela ----------
function lcpStats(rs: R[], field: string, ttlMs = 30 * 60_000) {
  const consec: number[] = []; const best: number[] = []
  const sorted = [...rs].sort((a, b) => a.at - b.at)
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!
    consec.push(lcp(sorted[i - 1]![field], cur[field]))
    let m = 0
    for (let j = i - 1; j >= 0 && cur.at - sorted[j]!.at <= ttlMs; j--) m = Math.max(m, lcp(sorted[j]![field], cur[field]))
    best.push(m)
  }
  const f = (a: number[]) => ({ p10: tok(q(a, 0.1)), p50: tok(q(a, 0.5)), p90: tok(q(a, 0.9)), media: tok(avg(a)) })
  return { pares: consec.length, seguidas_tokens: f(consec), melhorNaJanela_tokens: f(best), media_seguidas_chars: Math.round(avg(consec)) }
}
const byPeriod: Record<string, R[]> = { todos: rows, "10-05..06": rows.filter((r) => r.day < "2026-10-20"), "10-20..22": recent, "10-21..22 (modo produto)": rows.filter((r) => r.productMode) }

// ---- Replay: cache explícito na linha do tempo real -----------------------
const IN = 0.75, CA = 0.075, ST = 0.5
function replay(rs: R[], keyField: string, tokensOf: (r: R) => number, ttlMin: number) {
  const ttl = ttlMin * 60_000; const active = new Map<string, number>(); let creates = 0, hits = 0, baseline = 0, withCache = 0, cachedTokens = 0, keys = new Set<string>()
  for (const r of [...rs].sort((a, b) => a.at - b.at)) {
    const key = `${r[keyField]}`; keys.add(key); const P = tokensOf(r); const expires = active.get(key) ?? 0
    baseline += P * IN / 1e6
    if (r.at < expires) { hits++; withCache += P * CA / 1e6; cachedTokens += P } else { creates++; active.set(key, r.at + ttl); withCache += P * (IN + ST * (ttlMin / 60) + CA) / 1e6; cachedTokens += P }
  }
  return { chamadas: rs.length, chaves: keys.size, criacoes: creates, acertos: hits, pctAcerto: Math.round(100 * hits / Math.max(1, rs.length)), custoSem: +baseline.toFixed(4), custoCom: +withCache.toFixed(4), liquido: +(baseline - withCache).toFixed(4), liquidoPorChamada: +((baseline - withCache) / Math.max(1, rs.length)).toFixed(6) }
}
const tokensSysA = (r: R) => Math.round(r.sysA / kOf(r)), tokensSysR = (r: R) => Math.round(r.sysR / kOf(r))
const replayAll = (rs: R[]) => ({
  "A: só instruções (texto igual)": { analise: replay(rs, "keySysA", tokensSysA, 30), revisao: replay(rs, "keySysR", tokensSysR, 30) },
  "B: base antes da chamada, ordem por chamada": { analise: replay(rs, "keyKbOrder", (r) => Math.round(r.prefixV2a / kOf(r)), 30) },
  "C: base antes da chamada, ordem estável (TTL 30)": { analise: replay(rs, "keyKbCanon", (r) => Math.round(r.prefixV2a / kOf(r)), 30), revisao: replay(rs, "keyKbCanonRev", (r) => Math.round(r.prefixV2r / kOf(r)), 30) },
  "C: TTL 5": { analise: replay(rs, "keyKbCanon", (r) => Math.round(r.prefixV2a / kOf(r)), 5), revisao: replay(rs, "keyKbCanonRev", (r) => Math.round(r.prefixV2r / kOf(r)), 5) },
  "C: TTL 60": { analise: replay(rs, "keyKbCanon", (r) => Math.round(r.prefixV2a / kOf(r)), 60), revisao: replay(rs, "keyKbCanonRev", (r) => Math.round(r.prefixV2r / kOf(r)), 60) },
})

const partes = (rs: R[]) => { const f = rs.filter((r) => r.tokensAnalysis); const m = (g: (r: R) => number) => Math.round(avg(f.map(g))); return { n: f.length, charsPorToken: +avg(f.map(kOf)).toFixed(3), entradaAnalise: m((r) => r.tokensAnalysis), entradaRevisao: Math.round(avg(rs.filter((r) => r.tokensReview).map((r) => r.tokensReview))), sistemaA: m((r) => r.sysA / kOf(r)), sistemaR: m((r) => r.sysR / kOf(r)), especialista: m((r) => r.spec / kOf(r)), procedimentos: m((r) => r.proc / kOf(r)), argumentarios: m((r) => r.scr / kOf(r)), catalogoProduto: m((r) => r.prodCat / kOf(r)), transcricao: m((r) => r.transcript / kOf(r)), fixoAnalise: m((r) => r.prefixV2a / kOf(r)), fixoRevisao: m((r) => r.prefixV2r / kOf(r)), pctFixoAnalise: +(100 * avg(f.map((r) => r.prefixV2a / (r.sysA + 1 + r.turn)))).toFixed(1) } }
const result: R = {
  partes: Object.fromEntries(Object.entries(byPeriod).map(([p, rs]) => [p, partes(rs)])), meanK: +meanK.toFixed(3),
  rodadas: runs.length, reconstruidas: rows.length, puladas: skipped,
  fidelidade: { todas: fid(rows), desde_10_20: fid(recent) },
  calibracao: { n: ratios.length, charsPorToken_p50: +k.toFixed(3), p10: +q(ratios, 0.1).toFixed(3), p90: +q(ratios, 0.9).toFixed(3), revisao_p50: +q(ratiosR, 0.5).toFixed(3) },
  variacao: { ordensDistintasNoPeriodo: Object.fromEntries(Object.entries(byPeriod).map(([p, rs]) => [p, { runs: rs.length, primeiroDoc: new Set(rs.map((r) => r.first)).size, kbOrdem: new Set(rs.map((r) => r.keyKbOrder)).size, kbEstavel: new Set(rs.map((r) => r.keyKbCanon)).size, agentes: new Set(rs.map((r) => r.agent)).size, omitidos: Math.round(avg(rs.map((r) => r.omitted)) * 10) / 10, docs: Math.round(avg(rs.map((r) => r.nDocs)) * 10) / 10 }])) },
  composicaoChars: Object.fromEntries(Object.entries(byPeriod).map(([p, rs]) => [p, compo(rs)])),
  tokensRegistrados: Object.fromEntries(Object.entries(byPeriod).map(([p, rs]) => [p, { analise: Math.round(avg(rs.filter((r) => r.tokensAnalysis).map((r) => r.tokensAnalysis))), revisao: Math.round(avg(rs.filter((r) => r.tokensReview).map((r) => r.tokensReview))), confirmacao: Math.round(avg(rs.filter((r) => r.tokensConfirm).map((r) => r.tokensConfirm))) }])),
  lcpAnalise: Object.fromEntries(Object.entries(byPeriod).map(([p, rs]) => [p, { atual: lcpStats(rs, "v0a"), baseAntes_ordemPorChamada: lcpStats(rs, "v1a"), baseAntes_ordemEstavel: lcpStats(rs, "v2a") }])),
  lcpRevisao: Object.fromEntries(Object.entries(byPeriod).map(([p, rs]) => [p, { atual: lcpStats(rs, "v0r"), baseAntes_ordemEstavel: lcpStats(rs, "v2r") }])),
  replay: Object.fromEntries(Object.entries(byPeriod).map(([p, rs]) => [p, replayAll(rs)])),
}
writeFileSync(OUT + "/reconstruct-result.json", JSON.stringify(result, null, 1))
console.log(JSON.stringify({ meanK: result.meanK, partes: result.partes["10-20..22"], partesProduto: result.partes["10-21..22 (modo produto)"] }))
for (const p of ["10-20..22", "10-21..22 (modo produto)"]) { console.log("=== " + p); console.log("LCP ANALISE", JSON.stringify(result.lcpAnalise[p])); console.log("LCP REVISAO", JSON.stringify(result.lcpRevisao[p])); for (const [k2, v] of Object.entries(result.replay[p])) console.log("REPLAY " + k2, JSON.stringify(v)) }
await db.end()
