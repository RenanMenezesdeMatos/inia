// GABARITO dos testes de pré-seleção de argumentários: para cada análise concluída, os argumentários que ela RECEBEU (montados pelas
// funções reais, como estavam na data da chamada), a conversa e os que a análise julgou "aplica" / "não aplica". Só leitura, rede
// bloqueada, nenhuma IA. O arquivo de saída tem transcrições e conteúdo de base: vai para o caminho passado (pasta temporária da
// sessão), nunca para o repositório.
//
//   cd backend && NODE_OPTIONS=--max-old-space-size=6144 npx tsx ../docs/dev/varredura-prompts/argumentarios-gabarito.mts <saida.json>
import { createRequire } from "node:module"
import { writeFileSync } from "node:fs"
const OUT = process.argv[2]
if (!OUT || OUT.includes("/Developer/Works/inia/")) throw new Error("informe um caminho FORA do repositório para o gabarito")
const B = new URL("../../../backend", import.meta.url).pathname.replace(/\/$/, "")
const require = createRequire(B + "/package.json")
const pg = require("pg")
;(globalThis as any).fetch = async () => {
  throw new Error("REDE BLOQUEADA")
}
const db = new pg.Pool({ connectionString: "postgresql://renanmenezes@localhost:5432/inia", options: "-c default_transaction_read_only=on -c statement_timeout=30000", max: 4 })
if ((await db.query("show default_transaction_read_only")).rows[0].default_transaction_read_only !== "on") throw new Error("não está em leitura")

const { loadInteractionForAnalysis, loadAgentProfile, loadAgentDocumentsAt } = await import(B + "/src/modules/feedback-engine/infrastructure/postgres-engine-loaders.ts")
const { loadArgumentScriptsInForce } = await import(B + "/src/modules/argument-scripts/infrastructure/argument-script-loaders.ts")
const { projectTranscript, renderTranscriptForModel } = await import(B + "/src/modules/investigation/domain/transcript-projection.ts")
const { rawSubjectOf } = await import(B + "/src/modules/interactions/domain/interaction-subject.ts")
const { selectDocumentsForCall } = await import(B + "/src/modules/feedback-engine/domain/document-selection.ts")
const { buildProcedureContext, renderArgumentScriptsForModel, renderProcedureForModel } = await import(B + "/src/modules/feedback-engine/domain/procedure.ts")
const { TRANSCRIPT_MAX_CHARS } = await import(B + "/src/modules/feedback-engine/application/analyze-call.ts")

const runs = (
  await db.query(`
  select id, organization_id, interaction_id, agent_id, started_at
    from feedback_analysis_runs
   where kind = 'CALL_ANALYSIS' and status = 'COMPLETED' and started_at >= now() - interval '45 days' and interaction_id is not null
   order by started_at`)
).rows
const truth = new Map<string, { applies: Set<string>; notApplies: Set<string>; documents: Set<string> }>()
for (const row of (await db.query(`select analysis_run_id, argument_script_id, document_id, applicability from call_criterion_assessments where analysis_run_id = any($1::uuid[])`, [runs.map((r: any) => r.id)])).rows) {
  const entry = truth.get(row.analysis_run_id) ?? { applies: new Set(), notApplies: new Set(), documents: new Set() }
  if (row.argument_script_id) (row.applicability === "DOES_NOT_APPLY" ? entry.notApplies : entry.applies).add(row.argument_script_id)
  else if (row.document_id) entry.documents.add(row.document_id)
  truth.set(row.analysis_run_id, entry)
}

const out: any[] = []
for (const run of runs) {
  const interaction = await loadInteractionForAnalysis(db, run.organization_id, run.interaction_id)
  const agent = run.agent_id ? await loadAgentProfile(db, run.organization_id, run.agent_id) : null
  if (!interaction || !agent) continue
  const projection = projectTranscript(interaction.transcript?.content ?? "", { maxChars: TRANSCRIPT_MAX_CHARS })
  const subject = interaction.subjectCanonical?.name ?? rawSubjectOf(interaction)
  const candidates = await loadAgentDocumentsAt(db, run.organization_id, agent.id, interaction.startedAt)
  const scripts = await loadArgumentScriptsInForce(db, run.organization_id, { teamId: interaction.teamId, subteamId: interaction.subteamId }, interaction.startedAt)
  const selection = selectDocumentsForCall(candidates, { subject, transcript: interaction.transcript?.content ?? "", productScoped: new Set() })
  const context = buildProcedureContext(selection.selected, scripts)
  const t = truth.get(run.id) ?? { applies: new Set(), notApplies: new Set(), documents: new Set() }
  const argumentDocs = context.documents.filter((d: any) => d.kind === "ARGUMENT_SCRIPT")
  const procedureDocs = context.documents.filter((d: any) => d.kind !== "ARGUMENT_SCRIPT")
  out.push({
    run: run.id,
    subject,
    subjectId: interaction.subjectCanonical?.id ?? null,
    channel: interaction.channel,
    signals: interaction.flags.map((f: any) => `${f.name} = ${f.value}`),
    transcript: renderTranscriptForModel(projection),
    scripts: argumentDocs.map((d: any) => ({
      id: d.documentId,
      name: d.argument?.name ?? d.title,
      trigger: d.argument?.trigger ?? null,
      notApplicableWhen: d.argument?.notApplicableWhen ?? null,
      subjectName: d.argument?.subjectName ?? null,
      areaName: d.argument?.areaName ?? null,
      // Tamanho do bloco do argumentário como vai para a análise (para estimar a economia).
      renderedChars: renderArgumentScriptsForModel({ documents: [d], sameText: [] }).length,
    })),
    procedures: procedureDocs.map((d: any) => ({ id: d.documentId, renderedChars: renderProcedureForModel({ documents: [d] }).length })),
    applies: [...t.applies],
    notApplies: [...t.notApplies],
    proceduresAssessed: [...t.documents],
  })
}
writeFileSync(OUT, JSON.stringify(out))
const total = out.reduce((s, r) => s + r.applies.length, 0)
const missing = out.reduce((s, r) => s + r.applies.filter((id: string) => !r.scripts.some((x: any) => x.id === id)).length, 0)
console.log(JSON.stringify({ analises: out.length, argumentariosPorAnalise: +(out.reduce((s, r) => s + r.scripts.length, 0) / out.length).toFixed(1), aplica: total, aplicaForaDaLista: missing, naoAplica: out.reduce((s, r) => s + r.notApplies.length, 0) }))
await db.end()
