/**
 * ORGANIZAR o que JÁ foi avaliado e está na memória: regras em PRÁTICAS (`PRACTICE_IDENTITY_V1`) e práticas em TEMAS com nome curto
 * (`PRACTICE_THEMES_V1`). Daqui para frente a própria análise de chamada organiza o que avalia pela primeira vez; este script cobre o
 * que foi avaliado antes. Padrão = SÓ LISTA (dry-run, nenhuma chamada de modelo).
 *
 *   npx tsx scripts/feedback-engine/sync-practices.ts --organization <uuid>                       # lista o que falta organizar
 *   npx tsx scripts/feedback-engine/sync-practices.ts --organization <uuid> --execute --max-requests 6
 *
 * Três passos, cada um só com o que falta:
 *   1. LINHAS das regras avaliadas (âncora e linhas de origem — nunca o documento inteiro). A linha é procurada em todas as versões dos
 *      documentos da organização: uma obrigação antiga pode ter a âncora noutro documento que não o da avaliação. Argumentário: o
 *      vigente hoje no Grupo/Subgrupo avaliado.
 *   2. obrigações de VÁRIAS linhas em que nenhuma linha pede conduta sozinha (análises antigas): organizadas como regra COMPOSTA.
 *   3. TEMA e nome curto das práticas que ainda não têm.
 * `--execute` consome IA e para no teto de pedidos; o que não couber continua como está e entra na próxima execução.
 */
import { writeFileSync } from "node:fs"
import { pool } from "../../src/infrastructure/database/pool.js"
import { loadArgumentScriptsInForce } from "../../src/modules/argument-scripts/infrastructure/argument-script-loaders.js"
import { EngineMeter, meteredModel, DEFAULT_ENGINE_BUDGET } from "../../src/modules/feedback-engine/application/engine-meter.js"
import type { EngineModelRequest, EngineModelResponse } from "../../src/modules/feedback-engine/application/ports.js"
import { resolvePracticeThemes } from "../../src/modules/feedback-engine/application/resolve-practice-themes.js"
import { resolvePractices } from "../../src/modules/feedback-engine/application/resolve-practices.js"
import { buildProcedureContext, type SourceDocument } from "../../src/modules/feedback-engine/domain/procedure.js"
import { PRACTICE_LINES_PER_REQUEST, combinedObligationLinesOf, practiceLinesOf, type PracticeLine } from "../../src/modules/feedback-engine/domain/practice-identity.js"
import { PRACTICES_PER_THEME_REQUEST } from "../../src/modules/feedback-engine/domain/practice-themes.js"
import { createGatewayEngineModel } from "../../src/modules/feedback-engine/infrastructure/gateway-engine-model.js"
import { createPostgresFeedbackMemoryStore } from "../../src/modules/feedback-engine/infrastructure/postgres-feedback-memory-store.js"

const args = process.argv.slice(2)
const option = (name: string) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined }
const organizationId = option("organization")
const execute = args.includes("--execute")
const maxRequests = Number(option("max-requests") ?? "6")

try {
  if (!organizationId) throw new Error("--organization <uuid> é obrigatório")
  const memory = createPostgresFeedbackMemoryStore(pool)
  // Obrigações avaliadas: a chave inteira (com '#' quando é de várias linhas), as linhas (âncora + origem) e de onde vêm.
  const obligations = (await pool.query<{ line_key: string; anchor: string; source_line_keys: string[] | null; criterion_text: string; section_heading: string | null; document_id: string | null; document_version: number | null; document_title: string | null; argument_script_id: string | null; argument_script_version: number | null; argument_title: string | null }>(
    `select distinct on (c.verification->>'lineKey') c.verification->>'lineKey' line_key, split_part(c.verification->>'lineKey', '#', 1) anchor,
            case when jsonb_typeof(c.verification->'sourceLineKeys') = 'array' then array(select jsonb_array_elements_text(c.verification->'sourceLineKeys')) end source_line_keys,
            c.criterion_text, c.section_heading, c.document_id, c.document_version, d.title document_title, c.argument_script_id, c.argument_script_version, s.name argument_title
       from call_criterion_assessments c left join knowledge_documents d on d.id = c.document_id left join argument_scripts s on s.id = c.argument_script_id
      where c.organization_id = $1 and c.verification->>'lineKey' is not null
      order by c.verification->>'lineKey', c.created_at desc`,
    [organizationId],
  )).rows
  const wanted = new Set(obligations.flatMap((row) => [row.anchor, ...(row.source_line_keys ?? [])]))
  // Todas as versões dos documentos da organização: a chave da linha inclui o documento, então só a linha certa casa.
  const versions = (await pool.query<{ document_id: string; version: number; title: string; content: string; content_hash: string }>(
    `select v.document_id, v.version, kd.title, v.content, coalesce(v.content_hash, '') content_hash
       from knowledge_versions v join knowledge_documents kd on kd.id = v.document_id and kd.organization_id = $1 order by kd.title, v.version`,
    [organizationId],
  )).rows
  const scopes = (await pool.query<{ team_id: string | null; subteam_id: string | null }>("select distinct team_id, subteam_id from call_assessments where organization_id = $1", [organizationId])).rows
  const scripts = new Map((await Promise.all(scopes.map((scope) => loadArgumentScriptsInForce(pool, organizationId, { teamId: scope.team_id, subteamId: scope.subteam_id }, new Date())))).flat().map((script) => [`${script.scriptId}@${script.version}`, script]))
  const found = new Map<string, PracticeLine>()
  for (const row of versions) {
    const document: SourceDocument = { documentId: row.document_id, title: row.title, version: row.version, content: row.content, contentHash: row.content_hash, perspective: "RULE_IN_FORCE_AT_CALL", selection: "INCLUDED_ALL", relevance: 0 }
    for (const line of practiceLinesOf(buildProcedureContext([document]), wanted)) if (!found.has(line.lineKey)) found.set(line.lineKey, line)
  }
  if (scripts.size > 0) for (const line of practiceLinesOf(buildProcedureContext([], [...scripts.values()]), wanted)) if (!found.has(line.lineKey)) found.set(line.lineKey, line)
  const lines = [...found.values()]
  const knownLines = await memory.practiceMemberships(organizationId, lines.map((line) => line.lineKey))
  const pendingLines = lines.filter((line) => !knownLines.has(line.lineKey)).length
  console.log(`1. Linhas avaliadas: ${wanted.size} (${wanted.size - lines.length} não encontrada(s) em nenhuma versão — ficam pela própria identidade); ${pendingLines} sem prática → ${Math.ceil(pendingLines / PRACTICE_LINES_PER_REQUEST)} pedido(s).`)

  const obligationsOf = () => obligations.map((row) => ({
    lineKey: row.line_key,
    lineKeys: [...new Set([row.anchor, ...(row.source_line_keys ?? [])])],
    text: row.criterion_text,
    heading: row.section_heading,
    source: row.argument_script_id
      ? { sourceKind: "ARGUMENT_SCRIPT" as const, sourceId: row.argument_script_id, sourceVersion: row.argument_script_version ?? 1, sourceTitle: row.argument_title ?? "Argumentário" }
      : row.document_id && row.document_version !== null ? { sourceKind: "KNOWLEDGE" as const, sourceId: row.document_id, sourceVersion: row.document_version, sourceTitle: row.document_title ?? "Documento" } : null,
  }))
  const combinedNow = async () => combinedObligationLinesOf(obligationsOf(), await memory.practiceMemberships(organizationId, [...new Set(obligations.flatMap((row) => [row.anchor, ...(row.source_line_keys ?? []), row.line_key]))]))
  const combined = await combinedNow()
  console.log(`2. Obrigações compostas sem linha de conduta: ${combined.length}${pendingLines > 0 ? " (pode mudar depois do passo 1)" : ""} → ${Math.ceil(combined.length / PRACTICE_LINES_PER_REQUEST)} pedido(s).`)
  const unthemed = await memory.practicesWithoutTheme(organizationId, null)
  console.log(`3. Práticas sem tema: ${unthemed.length}${pendingLines + combined.length > 0 ? " (+ as que os passos 1 e 2 criarem)" : ""} → ${Math.ceil(Math.max(unthemed.length, 1) / PRACTICES_PER_THEME_REQUEST)} pedido(s).`)

  if (!execute) {
    console.log("\nDry-run: nenhuma chamada de modelo. Use --execute [--max-requests N] para organizar.")
  } else {
    const meter = new EngineMeter({ ...DEFAULT_ENGINE_BUDGET, maxModelCalls: maxRequests, compositionReserve: null }, () => Date.now(), null)
    const model = meteredModel(createGatewayEngineModel(), meter)
    let cost = 0
    // Respostas brutas guardadas FORA do repositório (diagnóstico de contrato; nunca vão para o banco).
    const rawPath = option("raw-out")
    const raws: { stage: string; finishReason: string | null; outputTokens: number | null; text: string }[] = []
    const deps = {
      memory,
      now: () => new Date(),
      call: async (request: EngineModelRequest) => { const response = await model.generate(request); cost += response.costUsd ?? 0; return response },
      onResponse: (request: EngineModelRequest, response: EngineModelResponse) => raws.push({ stage: request.stage, finishReason: response.finishReason, outputTokens: response.usage?.outputTokens ?? null, text: response.text }),
    }
    // Todas as fontes juntas: a mesma conduta em documentos diferentes é reconhecida no MESMO lote.
    const byLines = await resolvePractices(deps, organizationId, lines)
    console.log("1.", JSON.stringify(byLines))
    const byCombined = await resolvePractices(deps, organizationId, await combinedNow())
    console.log("2.", JSON.stringify(byCombined))
    const byThemes = await resolvePracticeThemes(deps, organizationId, null)
    console.log("3.", JSON.stringify(byThemes))
    if (rawPath) writeFileSync(rawPath, JSON.stringify(raws, null, 1))
    console.log(`\nCusto informado pelo provedor: US$ ${cost.toFixed(4)}`)
  }
} finally {
  await pool.end()
}
