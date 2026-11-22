/**
 * BATERIA PAGA — ATRIBUIÇÃO DO ALINHAMENTO NO CHAT (`OPERATIONAL_ALIGNMENT_CONVERSATION_V2`, 17/11/2026). Modelo REAL, teto de US$ 1, nada
 * gravado: o texto do alinhamento é o do produto (`renderAlignmentsForConversation`) sobre candidatos em memória.
 *
 *   npx tsx scripts/dev/publications/alignment-attribution-battery.ts [--teto 1] [--so A1,A2]
 *
 * Pergunta do operador da Ouvidoria: "o cliente pediu a segunda via da fatura, como atendo?"
 *   A1 definido pela supervisora Ana Souza, publicado pelo analista Bruno Lima → começa pela conduta, atribui à Ana (não ao Bruno);
 *   A2 versão antiga (sem responsável), publicada por Bruno → diz quem publicou, sem inventar quem decidiu;
 *   A3 responsável sem cargo no cadastro → só o nome, sem cargo inventado;
 *   A4 definido pelo gerente Carlos Mendes → "o gerente", com o nome dele.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import "../../../src/config/env.js"
import { pool } from "../../../src/infrastructure/database/pool.js"
import { renderProhibitedTopicsBlock } from "../../../src/modules/governance/domain/prohibited-topic.js"
import { renderAlignmentsForConversation, resolveOperationalAlignments, type AlignmentCandidate, type AlignmentSubject } from "../../../src/modules/operational-alignments/domain/operational-alignment.js"
import { runWithAiOrganization } from "../../../src/shared/application/model-routing/ai-runtime.js"
import { generateForRoute, routeFor, type GatewayRequest, type GatewayResponse } from "../../../src/shared/application/model-routing/llm-gateway.js"
import { costTotal } from "../../../src/shared/application/model-routing/model-pricing.js"

const args = process.argv.slice(2)
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] ?? null : null)
const CAP_USD = Number(option("--teto") ?? 1)
const OUT_DIR = option("--saida") ?? "/private/tmp/claude-501/-Users-renanmenezes--claude-spares-spare-Iu7bMZ/429e2ebe-8a5c-442b-bc2f-25ba201c7d2e/scratchpad/gestores-bateria"
const ORG = "00000000-0000-4000-8000-000000000001"
const ONLY = option("--so") ? new Set(option("--so")!.split(",")) : null
const wants = (id: string) => !ONLY || ONLY.has(id)

let spentUsd = 0
const ledger: { label: string; model: string; costUsd: number }[] = []
async function guarded(label: string, request: GatewayRequest): Promise<GatewayResponse> {
  if (spentUsd + 0.04 > CAP_USD) throw new Error(`teto de US$ ${CAP_USD}`)
  const response = await runWithAiOrganization(ORG, () => generateForRoute(request))
  const input = response.usage.promptTokens ?? 0
  const output = Math.max((response.usage.totalTokens ?? 0) - input, (response.usage.outputTokens ?? 0) + (response.usage.reasoningTokens ?? 0))
  const cost = costTotal(response.cost) ?? (input * 2 + output * 12) / 1_000_000
  spentUsd += cost
  ledger.push({ label, model: response.model, costUsd: cost })
  return response
}

const DOC = "dddddddd-0000-4000-8000-000000000001"
const OUVIDORIA = "11111111-1111-4111-8111-111111111111"
const PR_TITLE = "PR — Atendimento da Ouvidoria: fatura"
const PR = `# ${PR_TITLE}\n\n## Solicitação de fatura\n\n- Quando o cliente solicitar a segunda via da fatura, enviar a fatura pelo e-mail cadastrado e confirmar o envio.\n`
const BASE: AlignmentCandidate = {
  alignmentId: "aaaaaaaa-0000-4000-8000-0000000000a1", versionId: "bbbbbbbb-0000-4000-8000-0000000000b1", version: 1,
  title: "Fatura pelo App Meu Telnova ou site", guidance: "Oriente o cliente a acessar e baixar a segunda via da fatura pelo App Meu Telnova ou pelo site da Telnova.\nNão envie a fatura por e-mail enquanto este alinhamento valer.",
  justification: "O envio por e-mail está suspenso enquanto o sistema de envio é substituído.",
  affectedDocuments: [{ id: DOC, title: PR_TITLE }], affectedTopic: "Envio da fatura quando o cliente solicita",
  operatingUniverse: "B2C", scopeType: "GROUPS", links: [{ teamId: OUVIDORIA, teamName: "Ouvidoria", subteamId: null, subteamName: null }], productId: null, productName: null,
  startsOn: "2026-11-10", endsOn: "2026-11-30", timeZone: "America/Sao_Paulo",
  effectiveFrom: new Date("2026-11-10T03:00:00Z"), effectiveUntil: new Date("2026-12-01T03:00:00Z"), endedEarlyAt: null, contentHash: "h1", publishedAt: new Date("2026-11-09T18:00:00Z"), relations: [],
}
const SUBJECT: AlignmentSubject = { teamId: OUVIDORIA, subteamId: null, operatingUniverse: "B2C", universeEnforced: true }
const AT = new Date("2026-11-17T15:00:00Z")
const SYSTEM = (candidate: AlignmentCandidate) => [
  "Você é a INIA, supervisora virtual. Você está conversando com um COLABORADOR (operador) da Ouvidoria.", "",
  "Bases de conhecimento disponíveis (cada uma identificada pelo título exato depois de ###):", `### ${PR_TITLE}`, PR, "",
  renderAlignmentsForConversation(resolveOperationalAlignments([candidate], SUBJECT, AT, new Set([DOC]))), "",
  renderProhibitedTopicsBlock([{ name: "Cancelamento sem retenção", requiredBehavior: "Nunca orientar cancelamento direto." }]),
].join("\n")
const QUESTION = "O cliente pediu a segunda via da fatura, como eu atendo?"

const checks: { scenario: string; check: string; pass: boolean }[] = []
const results: { scenario: string; answer: string }[] = []
const norm = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
function check(scenario: string, description: string, pass: boolean) {
  checks.push({ scenario, check: description, pass })
  console.log(`  ${pass ? "✓" : "✗"} ${scenario} — ${description}`)
}
async function ask(label: string, candidate: AlignmentCandidate) {
  const response = await guarded(label, { systemPrompt: SYSTEM(candidate), contents: [{ role: "user", text: QUESTION }], tools: [], structuredOutput: false, route: routeFor({ purpose: "SPECIALIST_SYNTHESIS", phase: "SYNTHESIS" }), classification: { phase: "SYNTHESIS", purpose: "SPECIALIST_SYNTHESIS", source: "CHAT", semanticType: "TEXT", tags: ["paid-battery:alignment-attribution"] } })
  const answer = response.kind === "text" ? response.text : ""
  results.push({ scenario: label, answer })
  return answer
}
/** A conduta vem antes da origem: "app"/"site" aparece antes do nome de quem decidiu ou da palavra "alinhamento". */
const conductFirst = (answer: string, who: string) => {
  const text = norm(answer)
  const conduct = Math.min(...["app", "site"].map((word) => (text.indexOf(word) < 0 ? Infinity : text.indexOf(word))))
  const origin = Math.min(...[norm(who), "alinhamento"].map((word) => (text.indexOf(word) < 0 ? Infinity : text.indexOf(word))))
  return conduct < origin
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  if (wants("A1")) {
    const answer = await ask("A1", { ...BASE, definedBy: { name: "Ana Souza", jobTitle: "Supervisora de Atendimento" }, publishedBy: { name: "Bruno Lima", jobTitle: "Analista de Processos" } })
    check("A1", "começa pela conduta (app ou site)", conductFirst(answer, "Ana Souza"))
    check("A1", "atribui à Ana Souza", norm(answer).includes("ana souza"))
    check("A1", "não atribui a decisão ao Bruno", !norm(answer).includes("bruno"))
    check("A1", "cita a vigência (30/11)", answer.includes("30/11"))
  }
  if (wants("A2")) {
    const answer = await ask("A2", { ...BASE, definedBy: null, publishedBy: { name: "Bruno Lima", jobTitle: "Analista de Processos" } })
    check("A2", "começa pela conduta", conductFirst(answer, "Bruno Lima"))
    check("A2", "não inventa quem decidiu (não fala em supervisora/gerente)", !/supervisor|gerente|coordenador/.test(norm(answer)))
  }
  if (wants("A3")) {
    const answer = await ask("A3", { ...BASE, definedBy: { name: "Ana Souza", jobTitle: null }, publishedBy: { name: "Ana Souza", jobTitle: null } })
    check("A3", "cita a Ana Souza", norm(answer).includes("ana souza"))
    check("A3", "não inventa cargo", !/supervisor|gerente|coordenador|analista/.test(norm(answer)))
  }
  if (wants("A4")) {
    const answer = await ask("A4", { ...BASE, definedBy: { name: "Carlos Mendes", jobTitle: "Gerente de Operações" }, publishedBy: { name: "Carlos Mendes", jobTitle: "Gerente de Operações" } })
    check("A4", "atribui ao gerente Carlos Mendes", norm(answer).includes("carlos mendes") && /gerente/.test(norm(answer)))
    check("A4", "começa pela conduta", conductFirst(answer, "Carlos Mendes"))
  }
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => {
    const file = join(OUT_DIR, `atribuicao-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
    writeFileSync(file, JSON.stringify({ capUsd: CAP_USD, spentUsd, ledger, checks, results }, null, 1))
    console.log(`\n${checks.filter((item) => item.pass).length}/${checks.length} verificações passaram · ${ledger.length} chamadas · US$ ${spentUsd.toFixed(4)}`)
    console.log(`Respostas: ${file}`)
    await pool.end()
  })
