/** Initial/incremental diagnostic population. No writer, delivery or Workflow execution. See docs/dev/diagnostic-bootstrap.md. */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join, resolve, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { pool } from "../../src/infrastructure/database/pool.js"
import { analyzeCall } from "../../src/modules/feedback-engine/application/analyze-call.js"
import { createEngineDeps } from "../../src/modules/feedback-engine/application/engine-wiring.js"
import { DEFAULT_ENGINE_BUDGET } from "../../src/modules/feedback-engine/application/engine-meter.js"
import { createGatewayEngineModel, ENGINE_MODEL } from "../../src/modules/feedback-engine/infrastructure/gateway-engine-model.js"
import { loadAgentDocumentsAt, loadAgentProfile, loadInteractionForAnalysis } from "../../src/modules/feedback-engine/infrastructure/postgres-engine-loaders.js"
import { createPostgresFeedbackMemoryStore } from "../../src/modules/feedback-engine/infrastructure/postgres-feedback-memory-store.js"
import { segmentKeySql } from "../../src/modules/feedback-engine/infrastructure/postgres-indicator-data.js"
import { loadArgumentScriptsInForce } from "../../src/modules/argument-scripts/infrastructure/argument-script-loaders.js"
import { resolveOrganizationTimezone } from "../../src/modules/workflows/application/organization-timezone.js"
import { memoryRowsOf } from "../../src/modules/feedback-engine/domain/memory-queries.js"
import { CALL_ANALYSIS_LOGIC_VERSION } from "../../src/modules/feedback-engine/domain/versions.js"
import { createPaidBudget, type LedgerEntry } from "./evaluation/paid-budget.js"
import { hash, periodWindow, positiveNumber, selectPerPerson, selectSample, type Candidate, type Selected } from "./bootstrap-core.js"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const parsed = parseArgs({ allowPositionals: true, options: Object.fromEntries([
  "org", "team", "subteam", "agent", "subject", "period", "indicator", "target-person", "per-person", "limit", "max-usd", "price-input", "price-output", "dir", "take",
].map((key) => [key, { type: "string" as const }])) })
const command = parsed.positionals[0]
const arg = (key: string) => parsed.values[key] as string | undefined
const required = (key: string) => { const v = arg(key); if (!v) throw new Error(`Falta --${key}`); return v }
const dir = command === "opcoes" ? "" : resolve(required("dir"))
const manifestFile = join(dir, "manifest.json"), stateFile = join(dir, "state.json"), lockFile = join(dir, "execution.lock")
const json = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T
function atomic(path: string, value: unknown) {
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 })
  renameSync(temp, path)
}
function codeHash() {
  const files: string[] = []
  const walk = (path: string) => { for (const f of readdirSync(path, { withFileTypes: true })) if (f.isDirectory()) walk(join(path, f.name)); else if (f.name.endsWith(".ts") && !f.name.endsWith(".test.ts")) files.push(join(path, f.name)) }
  walk(join(root, "src"))
  files.push(join(root, "scripts/feedback-engine/bootstrap-core.ts"), join(root, "scripts/feedback-engine/bootstrap-diagnostics.ts"), join(root, "scripts/feedback-engine/evaluation/paid-budget.ts"))
  return hash(files.sort().map((f) => `${relative(root, f)}:${hash(readFileSync(f, "utf8"))}`).join("\n"))
}
type Sources = { fingerprint: string; transcriptChars: number; knowledgeChars: number; documents: { id: string; version: number; perspective: string }[]; argumentScripts: number }
type Manifest = { version: 1; createdAt: string; org: string; team: string; subteam?: string | null; perPerson?: number | null; agent: string; subject: string; period: string; indicator: string; target: string | null; timeZone: string; direction: "LOWER" | "HIGHER"; basis: "OVERALL_INDICATOR"; codeHash: string; logic: string; model: string; maxUsd: number; maxRequests: number; price: { input: number; output: number }; eligible: number; selected: (Selected & { sources: Sources })[] }
type Outcome = { state: "COMPLETED" | "FAILED" | "PENDING"; runId?: string; outcome?: string; reused?: boolean; error?: string }
type State = { manifestHash: string; ledger: LedgerEntry[]; outcomes: Record<string, Outcome>; updatedAt: string }
async function sources(org: string, agentId: string, id: string): Promise<Sources> {
  const interaction = await loadInteractionForAnalysis(pool, org, id)
  if (!interaction?.transcript) throw new Error(`Chamada sem transcrição: ${id}`)
  const agent = await loadAgentProfile(pool, org, agentId)
  if (!agent) throw new Error("Especialista não encontrado na organização.")
  const documents = await loadAgentDocumentsAt(pool, org, agentId, interaction.startedAt)
  if (!documents.length) throw new Error("Especialista sem bases publicadas; não iniciar análise paga.")
  const scripts = await loadArgumentScriptsInForce(pool, org, interaction, interaction.startedAt)
  return { fingerprint: hash(JSON.stringify({ interaction, agent, documents, scripts })), transcriptChars: interaction.transcript.content.length, knowledgeChars: documents.reduce((n, d) => n + d.content.length, 0), documents: documents.map((d) => ({ id: d.documentId, version: d.version, perspective: d.perspective })), argumentScripts: scripts.length }
}
/** Organização da instalação: `--org` ou, quando o banco tem uma só, ela. */
async function organizationId() {
  const given = arg("org")
  if (given) return given
  const rows = (await pool.query<{ id: string; name: string }>("select id, name from organizations order by name")).rows
  if (rows.length === 1) return rows[0]!.id
  throw new Error(`Há ${rows.length} organizações no banco; informe --org. ${rows.map((r) => `${r.name} = ${r.id}`).join(" · ")}`)
}

/** Só leitura, zero IA: lista os valores que o plano pede, para copiar e colar (nada é gravado). */
async function options() {
  const org = await organizationId()
  const line = (text = "") => console.log(text)
  const organization = (await pool.query<{ name: string }>("select name from organizations where id=$1", [org])).rows[0]
  if (!organization) throw new Error("Organização não encontrada.")
  line(`ORGANIZAÇÃO: ${organization.name}\n  --org ${org}`)
  line("\nGRUPOS E SUBGRUPOS (copie o código do grupo para --team e, se quiser, o do subgrupo para --subteam)")
  const teams = (await pool.query<{ id: string; name: string; people: string }>(
    "select t.id, t.name, (select count(*) from people p where p.team_id=t.id and p.active)::text people from teams t where t.organization_id=$1 order by t.name", [org])).rows
  const subteams = (await pool.query<{ id: string; team_id: string; name: string; people: string }>(
    "select s.id, s.team_id, s.name, (select count(*) from people p where p.subteam_id=s.id and p.active)::text people from subteams s where s.organization_id=$1 order by s.name", [org])).rows
  for (const t of teams) {
    line(`  ${t.name} (${t.people} pessoas ativas)\n    --team ${t.id}`)
    for (const st of subteams.filter((x) => x.team_id === t.id)) line(`      subgrupo ${st.name} (${st.people})  --subteam ${st.id}`)
  }
  line("\nESPECIALISTAS COM BASE PUBLICADA (copie para --agent; use o especialista do assunto das chamadas)")
  const agents = (await pool.query<{ id: string; name: string; domain: string | null }>(
    `select a.id, a.name, d.name domain from agents a left join business_domains d on d.id=a.business_domain_id
     where a.organization_id=$1 and a.active order by a.name`, [org])).rows
  let usable = 0
  for (const a of agents) {
    const documents = await loadAgentDocumentsAt(pool, org, a.id, new Date())
    if (!documents.length) continue
    usable++
    line(`  ${a.name}${a.domain ? ` · domínio ${a.domain}` : ""} · ${documents.length} base(s): ${documents.map((d) => d.title).join(", ").slice(0, 160)}\n    --agent ${a.id}`)
  }
  if (!usable) line("  Nenhum especialista ativo com base publicada. Configure antes (IT-INIA-005, etapas de bases e especialistas).")
  line("\nINDICADORES QUE ORDENAM QUEM VAI MELHOR (copie o código para --indicator)")
  const indicators = (await pool.query<{ code: string; name: string; desired_direction: string }>(
    "select code, name, desired_direction from indicator_definitions where organization_id=$1 and active and desired_direction in ('LOWER','HIGHER') order by code", [org])).rows
  for (const i of indicators) line(`  ${i.name} (${i.desired_direction === "LOWER" ? "menor é melhor" : "maior é melhor"})  --indicator ${i.code}`)
  line(`\nPREÇO DO MODELO DA ANÁLISE (${ENGINE_MODEL}, em dólares por milhão de tokens)`)
  const price = (await pool.query<{ currency: string; input: string; output: string }>(
    `select p.currency, p.input_per_million::text input, p.output_per_million::text output from ai_model_pricing p join ai_models m on m.id=p.model_id
     where p.organization_id=$1 and m.provider_model_id=$2 and p.effective_from <= now() and (p.effective_to is null or p.effective_to > now())
     order by p.effective_from desc limit 1`, [org, ENGINE_MODEL])).rows[0]
  if (price?.currency === "USD") line(`  --price-input ${Number(price.input)} --price-output ${Number(price.output)}  (cadastrado em Administração › IA / Modelos)`)
  else line("  Não cadastrado em dólar. Use o preço do contrato com o provedor (Administração › IA / Modelos mostra o que está cadastrado).")
  const team = arg("team"), period = arg("period")
  if (team && period) {
    const window = periodWindow(period), timeZone = await resolveOrganizationTimezone(pool, org), subteam = arg("subteam") ?? null
    line(`\nASSUNTOS COM CHAMADAS TRANSCRITAS EM ${period}${subteam ? " NO SUBGRUPO" : " NO GRUPO"} (copie para --subject)`)
    const subjects = (await pool.query<{ subject: string; calls: string; people: string }>(
      `select ${segmentKeySql("i")} subject, count(*)::text calls, count(distinct i.operator_id)::text people
       from interactions i join people p on p.id=i.operator_id and p.organization_id=i.organization_id
       where i.organization_id=$1 and p.team_id=$2 and ($6::uuid is null or p.subteam_id=$6)
         and i.started_at >= ($3::date::timestamp at time zone $5) and i.started_at < ($4::date::timestamp at time zone $5)
         and exists (select 1 from transcripts t where t.interaction_id=i.id and length(btrim(t.content))>0)
       group by 1 having ${segmentKeySql("i")} is not null order by count(*) desc, 1 limit 40`,
      [org, team, window.from, window.until, timeZone, subteam])).rows
    if (!subjects.length) line("  Nenhuma chamada com transcrição nesse grupo e mês.")
    for (const r of subjects) line(`  ${r.calls} chamada(s) de ${r.people} pessoa(s)  --subject ${/\s/.test(r.subject) ? `"${r.subject}"` : r.subject}`)
  } else line("\nPara ver os assuntos com chamadas, rode de novo com --team <código do grupo> --period AAAA-MM.")
}
async function plan() {
  if (existsSync(manifestFile)) throw new Error("Manifesto existente: use execute/report ou um novo diretório para uma nova seleção.")
  const org = await organizationId(), team = required("team"), agent = required("agent"), subject = required("subject"), period = required("period"), indicator = required("indicator")
  const limit = positiveNumber(arg("limit") ?? "40", "limit", true), maxUsd = positiveNumber(required("max-usd"), "max-usd")
  const target = arg("target-person") ?? null, window = periodWindow(period)
  const subteam = arg("subteam") ?? null, perPerson = arg("per-person") ? positiveNumber(required("per-person"), "per-person", true) : null
  const timeZone = await resolveOrganizationTimezone(pool, org)
  const meta = (await pool.query<{ id: string; desired_direction: string }>("select id, desired_direction from indicator_definitions where organization_id=$1 and code=$2", [org, indicator])).rows[0]
  if (!meta || !["LOWER", "HIGHER"].includes(meta.desired_direction)) throw new Error("Indicador ausente ou sem direção ranqueável; não inferir melhores operadores.")
  if (!(await pool.query("select id from teams where organization_id=$1 and id=$2", [org, team])).rowCount) throw new Error("Grupo fora da organização.")
  if (subteam && !(await pool.query("select id from subteams where organization_id=$1 and team_id=$2 and id=$3", [org, team, subteam])).rowCount) throw new Error("Subgrupo fora do grupo.")
  if (target && !(await pool.query("select id from people where organization_id=$1 and team_id=$2 and id=$3", [org, team, target])).rowCount) throw new Error("Pessoa alvo fora do grupo.")
  const rows = (await pool.query<{ id: string; person_id: string; subject: string; started_at: Date; content: string; performance: string | null; subteam_id: string | null }>(
    `select i.id, i.operator_id person_id, ${segmentKeySql("i")} subject, i.started_at, t.content, ep.value performance, p.subteam_id
     from interactions i join people p on p.id=i.operator_id and p.organization_id=i.organization_id
     join lateral(select content from transcripts where interaction_id=i.id order by version desc limit 1)t on true
     left join employee_indicator_performance ep on ep.organization_id=i.organization_id and ep.person_id=p.id and ep.indicator_definition_id=$7 and ep.reference_period=$8
     where i.organization_id=$1 and p.team_id=$2 and ${segmentKeySql("i")}=$3 and ($9::uuid is null or p.subteam_id=$9)
       and i.started_at >= ($4::date::timestamp at time zone $6) and i.started_at < ($5::date::timestamp at time zone $6) and length(btrim(t.content))>0`,
    [org, team, subject, window.from, window.until, timeZone, meta.id, period, subteam])).rows
  const candidates: Candidate[] = rows.map((r) => ({ id: r.id, personId: r.person_id, subject: r.subject, startedAt: r.started_at.toISOString(), transcriptHash: hash(r.content), transcriptChars: r.content.length, performance: r.performance === null ? null : Number(r.performance), subteamId: r.subteam_id }))
  const selected: Manifest["selected"] = []
  const direction = meta.desired_direction as "LOWER" | "HIGHER"
  const sample = perPerson ? selectPerPerson(candidates, perPerson, limit, target, direction) : selectSample(candidates, limit, target, direction)
  for (const row of sample) selected.push({ ...row, sources: await sources(org, agent, row.id) })
  if (!selected.length) throw new Error("Nenhuma transcrição elegível.")
  const manifest: Manifest = { version: 1, createdAt: new Date().toISOString(), org, team, subteam, perPerson, agent, subject, period, indicator, target, timeZone, direction: meta.desired_direction as "LOWER" | "HIGHER", basis: "OVERALL_INDICATOR", codeHash: codeHash(), logic: CALL_ANALYSIS_LOGIC_VERSION, model: ENGINE_MODEL, maxUsd, maxRequests: selected.length * 6, price: { input: positiveNumber(required("price-input"), "price-input"), output: positiveNumber(required("price-output"), "price-output") }, eligible: candidates.length, selected }
  mkdirSync(dir, { recursive: true, mode: 0o700 }); atomic(manifestFile, manifest)
  console.log(JSON.stringify({ mode: "PLAN_ONLY_NO_AI_NO_DB_WRITES", selected: selected.length, people: new Set(selected.map((r) => r.personId)).size, cohorts: Object.fromEntries(["TARGET", "REFERENCE_CANDIDATE", "COMPARISON"].map((c) => [c, selected.filter((r) => r.cohort === c).length])), maxUsd, maxRequests: manifest.maxRequests, knowledgeChars: [...new Set(selected.map((r) => r.sources.knowledgeChars))], argumentScripts: [...new Set(selected.map((r) => r.sources.argumentScripts))], perspectives: [...new Set(selected.flatMap((r) => r.sources.documents.map((d) => d.perspective)))], manifest: manifestFile }, null, 2))
}
async function report(manifest: Manifest, state: State) {
  const stores = createPostgresFeedbackMemoryStore(pool)
  const snapshot = await stores.currentMemory(manifest.org, { personIds: [...new Set(manifest.selected.map((r) => r.personId))], interactionIds: manifest.selected.map((r) => r.id) })
  const rows = memoryRowsOf(snapshot, manifest.logic, null)
  const selected = new Map(manifest.selected.map((r) => [r.id, r]))
  const practices = new Map<string, { criterionKey: string; rule: string; document: string; eligible: number; met: number; people: Set<string>; examples: unknown[]; currentRuleReevaluations: number }>()
  for (const row of rows) {
    if (selected.get(row.interactionId)?.cohort !== "REFERENCE_CANDIDATE" || !["MET", "NOT_MET", "PARTIAL"].includes(row.status)) continue
    const p = practices.get(row.criterionKey) ?? { criterionKey: row.criterionKey, rule: row.text, document: row.documentTitle, eligible: 0, met: 0, people: new Set<string>(), examples: [], currentRuleReevaluations: 0 }
    p.eligible++; p.people.add(row.personId)
    if (row.reevaluation) p.currentRuleReevaluations++
    if (row.status === "MET") { p.met++; if (p.examples.length < 3) p.examples.push({ interactionId: row.interactionId, date: row.localDate, evidence: row.evidence, rationale: row.rationale }) }
    practices.set(row.criterionKey, p)
  }
  const aggregated = [...practices.values()].map((p) => ({ ...p, people: p.people.size, metRate: p.met / p.eligible, candidateRepeatedPractice: p.eligible >= 5 && p.people.size >= 3 && p.met / p.eligible >= 0.8 })).sort((a, b) => Number(b.candidateRepeatedPractice) - Number(a.candidateRepeatedPractice) || b.eligible - a.eligible)
  const summary = { generatedAt: new Date().toISOString(), subject: manifest.subject, period: manifest.period, requested: manifest.selected.length, processed: Object.values(state.outcomes).filter((r) => r.state === "COMPLETED").length, pendingOrFailed: Object.values(state.outcomes).filter((r) => r.state !== "COMPLETED").length, usableAssessments: snapshot.assessments.filter((r) => r.logicVersion === manifest.logic && ["USABLE", "PARTIAL"].includes(r.outcome)).length, criteria: rows.length, confirmedMet: rows.filter((r) => r.status === "MET").length, confirmedAdverseRules: rows.filter((r) => ["NOT_MET", "PARTIAL"].includes(r.status)).length, requests: state.ledger.filter((r) => r.status !== "BLOCKED").length, spentUsd: state.ledger.reduce((n, r) => n + r.spentUsd, 0), repeatedPracticeCandidates: aggregated.filter((r) => r.candidateRepeatedPractice).length, limitations: ["Dados do ambiente conectado; a massa local é demonstração, não validação de operação real.", "Seleção por desempenho oficial geral do indicador no mês, não desempenho medido por motivo.", "Grupo/subgrupo são os atuais; não presumir histórico organizacional.", "Critérios agregados por identidade normativa; obrigações semanticamente equivalentes com identidades distintas não são unidas por texto.", "Práticas são candidatas sustentadas pelas avaliações, não prova de causalidade do indicador.", "Reavaliações por base posterior à chamada orientam a prática atual, não comprovam infração histórica.", "Nenhum feedback foi gerado ou entregue por este script."] }
  atomic(join(dir, "report.json"), { summary, practices: aggregated, outcomes: state.outcomes })
  writeFileSync(join(dir, "report.md"), `# Carga inicial de diagnósticos\n\n${JSON.stringify(summary, null, 2)}\n\n## Práticas candidatas\n\n${aggregated.filter((r) => r.candidateRepeatedPractice).map((p) => `- ${p.rule.replaceAll("\n", " ")} — ${p.met}/${p.eligible} avaliações; ${p.people} operadores; base: ${p.document}.`).join("\n") || "Nenhuma atingiu os critérios da amostra. Não confundir ausência de referência com atendimento sem falhas."}\n`)
  console.log(JSON.stringify(summary, null, 2))
}
async function execute(manifest: Manifest, state: State) {
  if (manifest.codeHash !== codeHash()) throw new Error("Código mudou desde o plano. Use uma cópia congelada ou gere um novo plano; o livro-razão atual permanece intacto.")
  // Validate the entire selection before the first paid call or database mutation.
  for (const row of manifest.selected) if ((await sources(manifest.org, manifest.agent, row.id)).fingerprint !== row.sources.fingerprint) throw new Error(`Fonte/configuração mudou: ${row.id}. Nada novo foi enviado.`)
  const priorLedger = [...state.ledger], spent = priorLedger.reduce((n, e) => n + e.spentUsd, 0)
  const originalFetch = globalThis.fetch
  const persist = () => { state.ledger = [...priorLedger, ...budget.ledger.map((e) => ({ ...e, index: priorLedger.length + e.index }))]; state.updatedAt = new Date().toISOString(); atomic(stateFile, state) }
  const budget = createPaidBudget({ maxRequests: Math.max(0, manifest.maxRequests - priorLedger.filter((r) => r.status !== "BLOCKED").length), maxUsd: Math.max(0, manifest.maxUsd - spent), pricePerMillion: manifest.price, hostPattern: /^https:\/\/generativelanguage\.googleapis\.com\// }, async (input, init) => { persist(); return originalFetch(input, init) })
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    if (!/^https:\/\/generativelanguage\.googleapis\.com\//.test(url)) throw new Error("Bootstrap só permite o provedor Gemini configurado.")
    try { return await budget.fetch(input, init) } finally { persist() }
  }
  let attempted = 0
  const take = arg("take") ? positiveNumber(required("take"), "take", true) : manifest.selected.length
  try {
    for (const row of manifest.selected) {
      if (state.outcomes[row.id]?.state === "COMPLETED") continue
      if (attempted >= take) break
      if (manifest.codeHash !== codeHash()) throw new Error("Código alterado durante a carga; parada para preservar comparabilidade.")
      attempted++
      const real = createGatewayEngineModel()
      const deps = createEngineDeps({ db: pool, model: { async generate(request) {
        if (!["CALL_ANALYSIS", "CALL_REVIEW", "CALL_CONFIRMATION"].includes(request.stage)) throw new Error("Etapa proibida na carga: " + request.stage)
        budget.setLabel(`${row.id}:${request.stage}:${request.tag ?? ""}`)
        return real.generate(request)
      } }, budget: { ...DEFAULT_ENGINE_BUDGET, maxModelCalls: 6, maxCostUsd: Math.max(0, manifest.maxUsd - spent - budget.totals().spentUsd), compositionReserve: null, transientRetries: 0 }, price: { inputPerMillion: manifest.price.input, outputPerMillion: manifest.price.output } })
      console.log(JSON.stringify({ event: "START", call: row.id, cohort: row.cohort, completed: Object.keys(state.outcomes).length, spentUsd: spent + budget.totals().spentUsd }))
      state.outcomes[row.id] = { state: "PENDING" }; persist()
      try {
        const result = await analyzeCall(deps.analyze, { organizationId: manifest.org, interactionId: row.id, collaboratorId: row.personId, agentId: manifest.agent, trigger: { kind: "DIAGNOSTIC_BOOTSTRAP", selectionReason: `Carga inicial de diagnósticos ${hash(JSON.stringify(manifest)).slice(0, 12)}; ${manifest.subject}/${manifest.period}; seleção ${row.cohort}; sem geração/entrega de feedback.` } })
        state.outcomes[row.id] = { state: "COMPLETED", runId: result.runId, outcome: result.outcome, reused: result.reused }
      } catch (error) {
        state.outcomes[row.id] = { state: "FAILED", error: error instanceof Error ? error.name + ": " + error.message.slice(0, 300) : "UNKNOWN" }
        persist()
        console.log(JSON.stringify({ event: "STOP_ON_FAILURE", call: row.id, ...state.outcomes[row.id] }))
        break
      }
      persist()
      console.log(JSON.stringify({ event: "DONE", call: row.id, ...state.outcomes[row.id], spentUsd: spent + budget.totals().spentUsd }))
    }
  } finally { persist(); globalThis.fetch = originalFetch }
  await report(manifest, state)
}
try {
  if (command === "opcoes") await options()
  else if (command === "plan") await plan()
  else if (command === "execute" || command === "report") {
    const manifest = json<Manifest>(manifestFile), manifestHash = hash(JSON.stringify(manifest))
    const state = existsSync(stateFile) ? json<State>(stateFile) : { manifestHash, ledger: [], outcomes: {}, updatedAt: new Date().toISOString() }
    if (state.manifestHash !== manifestHash) throw new Error("Manifesto alterado depois de iniciar a carga.")
    if (command === "report") await report(manifest, state)
    else {
      const fd = openSync(lockFile, "wx", 0o600)
      writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); closeSync(fd)
      try { await execute(manifest, state) } finally { unlinkSync(lockFile) }
    }
  } else throw new Error("Uso: bootstrap-diagnostics.ts opcoes | plan|execute|report --dir <diretório> (veja docs/dev/diagnostic-bootstrap.md)")
} finally { await pool.end() }
