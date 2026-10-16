import type pg from "pg"
import { hashPassword } from "../../../modules/auth/infrastructure/password-hasher.js"
import { buildDemoMass, type DemoMass } from "./build-demo-mass.js"
import { fillDemoClosureComponents } from "./closure-components.js"
import { estimateDailyRows, localToday } from "./daily-measurement-generator.js"
import { DEMO_RANDOM_SEED } from "./demo-constants.js"
import { ensureChannelFlags, ensureDemoVolumeIndicator, loadIndicatorDefinitions, persistDailyMeasurements, persistInteractions, persistPerformance, persistStructure, persistUserAccounts, reportDemoMass, type PersistReport } from "./persist-demo-mass.js"
import { loadDiagnosticCalls, persistDiagnosticCalls } from "./diagnostic-calls.js"
import { persistDemoSubjectCatalog } from "./subject-catalog.js"
import { demoId } from "./demo-ids.js"
import { loadLegacyPeople, removeLegacyLeaders } from "./legacy-adoption.js"
import { persistDemoFollowUps } from "./demo-follow-ups.js"
import { ensureIndicatorCoverageDefaults, ensureWorkActivityEvidenceIndicators, persistDemoEmploymentStatus, touchDemoAvailabilityFeeds } from "./demo-employment-status.js"
import { persistDemoWorkSchedules } from "./demo-work-schedules.js"
import { resetDemoMass, type ResetReport } from "./reset-demo-mass.js"

/**
 * Orquestração da massa demo (chamada pelo runner seed-demo.ts, DEPOIS dos SQL de seeds/demo).
 * A guarda de ambiente (`assertDemoSeedAllowed`) fica no runner — este módulo nunca é
 * importado pelo servidor.
 */
type Log = (message: string) => void

/** Data de referência da massa diária: `DEMO_REFERENCE_DATE` (AAAA-MM-DD) ou "hoje" local (-03). Os 180 dias terminam nela. */
export function resolveDemoReferenceDate(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.DEMO_REFERENCE_DATE
  if (configured && /^\d{4}-\d{2}-\d{2}$/.test(configured)) return configured
  return localToday()
}

export async function loadDemoMass(client: pg.PoolClient, seed = DEMO_RANDOM_SEED, referenceDate = resolveDemoReferenceDate()): Promise<DemoMass> {
  // O indicador de volume da massa (Atendimentos) entra ANTES de carregar o catálogo: a massa mede produção diária com ele.
  await ensureDemoVolumeIndicator(client)
  const definitions = await loadIndicatorDefinitions(client)
  const legacy = await loadLegacyPeople(client)
  // Lote externo de chamadas de diagnóstico (arquivo homologado por SHA-256; lista explícita, nunca varredura).
  const diagnosticCalls = await loadDiagnosticCalls()
  return buildDemoMass(definitions, seed, referenceDate, legacy, diagnosticCalls)
}

export async function seedDemoMass(client: pg.PoolClient, log: Log, demoPassword: string): Promise<PersistReport> {
  const startedAt = Date.now()
  const elapsed = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`
  const mass = await loadDemoMass(client)
  log(`massa gerada em memória (seed ${mass.seed}): ${mass.structure.people.length} pessoas, ${mass.performance.indicatorRows.length} fechamentos de indicador, ${mass.performance.prvRows.length} PRV — ${elapsed()}`)

  const flagIds = await ensureChannelFlags(client)
  await persistStructure(client, mass)
  log(`estrutura persistida (operação, grupos, subgrupos, pessoas) — ${elapsed()}`)
  const { adoption } = mass
  log(`cadeia legada: ${adoption.adopted.length} pessoa(s) adotada(s) na estrutura demo, ${adoption.generated.length} gerada(s) pra completar o desenho${adoption.missing.length > 0 ? ` — não encontradas: ${adoption.missing.join(", ")}` : ""}`)
  const relocated = adoption.adopted.filter((person) => person.adopted?.relocatedFrom)
  if (relocated.length > 0) log(`operadores legados com gravações no Subgrupo de diagnóstico (Supervisora 01): ${relocated.map((person) => person.name).join(", ")}`)
  // Só depois de reposicionar os Gerentes legados (persistStructure): Diretor/Gerente Sênior legados não têm mais subordinados.
  const leaders = await removeLegacyLeaders(client)
  if (leaders.removed.length > 0) log(`lideranças legadas removidas: ${leaders.removed.join(", ")}`)
  for (const kept of leaders.deactivated) log(`liderança legada DESATIVADA (não apagada — referenciada por ${kept.references.join(", ")}): ${kept.name}`)

  // Um único hash bcrypt (mesmo hashPassword do cadastro real) reaproveitado: a senha é a mesma
  // pra todos os usuários demo, e 2.109 hashes de 10 rounds levariam minutos sem ganho.
  const passwordHash = await hashPassword(demoPassword)
  await persistUserAccounts(client, mass, passwordHash)
  log(`contas de acesso e jornadas persistidas — ${elapsed()}`)

  const statuses = await persistDemoEmploymentStatus(client, mass)
  const coverageDefaults = await ensureIndicatorCoverageDefaults(client)
  log(`situação funcional: ${statuses.periods} período(s) em ${statuses.people} colaborador(es) (nove situações reais); cobertura mínima padrão do catálogo definida em ${coverageDefaults} indicador(es) — ${elapsed()}`)
  const schedules = await persistDemoWorkSchedules(client, mass.structure.people, mass.referenceDate)
  const evidenceIndicators = await ensureWorkActivityEvidenceIndicators(client)
  const touchedFeeds = await touchDemoAvailabilityFeeds(client, mass.referenceDate)
  log(`escalas: ${schedules.regimes} regime(s) 5x2/6x1, ${schedules.days} dia(s) de calendário explícito e ${schedules.exceptions} exceção(ões) e ${schedules.classifications} classificação(ões) (operadores 0021–0030); ${evidenceIndicators} indicador(es) de eficiência marcado(s) como evidência de produção; ${touchedFeeds} feed(s) da Central com carga registrada (disponibilidade D-1/D-2) — ${elapsed()}`)

  const official = await persistPerformance(client, mass)
  log(`metas persistidas; fechamentos oficiais (snapshot as-supplied, insert-only): ${official.indicatorRowsInserted} indicador criado(s) / ${official.indicatorRowsKept} já existente(s) mantido(s), ${official.prvRowsInserted} PRV criado(s) / ${official.prvRowsKept} mantido(s) — ${elapsed()}`)
  // Fechamentos DEMO gravados antes da migration 147 (ou pelo seed SQL 001) ganham numerador/denominador; nada mais muda neles.
  const components = await fillDemoClosureComponents(client)
  log(`numerador/denominador nos fechamentos demo: ${components.filled} preenchido(s) (${components.withoutComponents} de estratégia sem componentes ficam nulos) — ${elapsed()}`)

  const estimate = estimateDailyRows(mass.structure, mass.definitions, mass.referenceDate)
  log(`medições diárias: referência ${mass.referenceDate}, ${estimate.operators} operadores × ${estimate.businessDays} dias úteis × ${estimate.averageDailyIndicators.toFixed(2)} indicadores diários ≈ ${estimate.estimatedRows.toLocaleString("pt-BR")} linhas estimadas (dias sem amostra ficam fora)`)
  const daily = await persistDailyMeasurements(client, mass, 50, (done, total) => {
    if (done % 500 === 0 || done === total) log(`medições diárias: ${done}/${total} operadores — ${elapsed()}`)
  })
  log(`medições diárias persistidas: ${daily.rows.toLocaleString("pt-BR")} linhas — ${elapsed()}`)

  await persistInteractions(client, mass, flagIds, 100, (done, total) => {
    if (done % 500 === 0 || done === total) log(`interações: ${done}/${total} operadores — ${elapsed()}`)
  })
  const subjects = await persistDemoSubjectCatalog(client)
  log(`assuntos canônicos: ${subjects.definitions} definição(ões) e ${subjects.aliases} alias(es) do bruto (catálogo demo; ambíguos recusados: ${subjects.ambiguousRejected.length})`)
  const calls = await persistDiagnosticCalls(client, mass.diagnosticCalls, flagIds)
  log(`chamadas de diagnóstico (lote ${mass.diagnosticCalls.length > 0 ? "inia_demo_90_v1" : "ausente"}): ${calls.read} lida(s), ${calls.inserted} inserida(s), ${calls.updated} atualizada(s), ${calls.transcripts} transcrição(ões), ${calls.flagRows} flag(s) — ${elapsed()}`)

  // Acompanhamento/Ciência/Pendência canônicos — o agente do grafo demo é o Especialista de
  // Performance do catálogo (configurado pela UI); sem ele, qualquer agente ativo, ou um id
  // determinístico só de referência (a matrícula já está depois do node do agente).
  const agentId = await resolveDemoPerformanceAgentId(client)
  const derived = await persistDemoFollowUps(client, mass, agentId)
  if (derived.cases.length + derived.feedbacks.length + derived.alerts.length + derived.workflowOutputs > 0 || derived.enrollments.length > 1) {
    log(`estado canônico restaurado: artefatos de uma decisão real da Pendência demo removidos por lineage — ${derived.cases.length} caso(s), ${derived.feedbacks.length} feedback(s), ${derived.alerts.length} alerta(s), ${derived.workflowOutputs} output(s)`)
  }
  log(`acompanhamentos, ciências e pendência de revisão canônicos persistidos — ${elapsed()}`)

  const report = await reportDemoMass(client, mass)
  log(`carga concluída em ${elapsed()}`)
  return report
}

async function resolveDemoPerformanceAgentId(client: pg.PoolClient): Promise<string> {
  const named = await client.query<{ id: string }>(`select id from agents where name = 'Especialista de Performance Individual' and active limit 1`)
  if (named.rows[0]) return named.rows[0].id
  const any = await client.query<{ id: string }>(`select id from agents where active and agent_type <> 'ORCHESTRATOR' order by created_at limit 1`)
  return any.rows[0]?.id ?? demoId("followup:agent:placeholder")
}

export async function resetDemoMassSeed(client: pg.PoolClient, log: Log): Promise<ResetReport> {
  const mass = await loadDemoMass(client)
  const report = await resetDemoMass(client, mass)
  const derived = report.derived
  if (derived.cases.length + derived.feedbacks.length + derived.alerts.length + derived.workflowOutputs > 0 || derived.enrollments.length > 1) {
    log(`derivados da Pendência demo reconhecidos por lineage (decisão real): ${derived.cases.length} caso(s), ${derived.feedbacks.length} feedback(s), ${derived.alerts.length} alerta(s), ${derived.workflowOutputs} output(s), ${derived.enrollments.length} matrícula(s)`)
  }
  if (report.blockers.length > 0) {
    log("reset ABORTADO: existem registros fora da massa demo apontando para pessoas/interações/Grupos demo:")
    for (const blocker of report.blockers) log(`  - ${blocker.table}.${blocker.column}: ${blocker.count} linha(s)`)
    log("Apague/encerre esses registros (casos, feedbacks, alertas, matrículas de workflow, Workflows/Agentes/Orquestradores com Abrangência num Grupo demo…) e rode o reset de novo. Nada foi apagado. (O que a própria Pendência demo gerou ao ser decidida NÃO bloqueia: é reconhecido por lineage e removido.)")
  }
  return report
}

export function formatReport(report: PersistReport): string {
  const roles = report.people
  const lines = [
    "=== Massa demo — relatório (contado no banco) ===",
    `Diretores:              ${roles.DIRECTOR ?? 0}`,
    `Gerentes Sêniores:      ${roles.SENIOR_MANAGER ?? 0}`,
    `Gerentes:               ${roles.MANAGER ?? 0}`,
    `Coordenadores:          ${roles.COORDINATOR ?? 0}`,
    `Supervisores:           ${roles.SUPERVISOR ?? 0}`,
    `Operadores:             ${roles.OPERATOR ?? 0}`,
    `Users:                  ${report.users}`,
    `Operations:             ${report.operations}`,
    `Groups:                 ${report.teams}`,
    `Subgroups:              ${report.subteams}`,
    `Goals:                  ${report.goals}`,
    `Work shifts:            ${report.workShifts}`,
    `Competências:           ${report.periods}`,
    `Indicator perf. rows:   ${report.indicatorPerformanceRows}`,
    `PRV rows:               ${report.prvRows}`,
    `Medições diárias:       ${report.dailyMeasurements.toLocaleString("pt-BR")} (${report.dailyFirstDay ?? "?"} → ${report.dailyLastDay ?? "?"}, ${report.dailyDaysWithData} dias com dado)`,
    `  por indicador:        ${Object.entries(report.dailyByIndicator).map(([code, count]) => `${code}=${count}`).join(", ")}`,
    `Interactions:           ${report.interactions} (canônicas: ${report.canonicalInteractions})`,
    `  por duração:          ${Object.entries(report.interactionsByLength).map(([bucket, count]) => `${bucket}=${count}`).join(", ")}`,
    `Interactions flagged:   ${report.interactionsFlagged} (${report.interactions ? Math.round((report.interactionsFlagged / report.interactions) * 100) : 0}%)`,
    `Interactions sem flag:  ${report.interactions - report.interactionsFlagged}`,
    `Flags (linhas):         ${report.flagRows}`,
    `  por flag:             ${Object.entries(report.flagsByName).map(([name, count]) => `${name}=${count}`).join(", ")}`,
    `Transcrições:           ${(report.transcriptBytes / 1024 / 1024).toFixed(1)} MB de texto`,
    `Chamadas de diagnóstico: ${report.diagnosticCalls.interactions} (transcrições ${report.diagnosticCalls.transcripts}, flags ${report.diagnosticCalls.flagRows})`,
    `  por operador:         ${report.diagnosticCalls.byOperator.map((row) => `${row.name}=${row.interactions}`).join(", ") || "—"}`,
    `  por assunto:          ${report.diagnosticCalls.bySubject.map((row) => `${row.subject}=${row.interactions}`).join(", ") || "—"}`,
    `Subgrupo diagnóstico:   ${report.diagnosticSubgroup.operators} operadores, ${report.diagnosticSubgroup.interactions} interações (${report.diagnosticSubgroup.transcripts} com transcrição)`,
  ]
  return lines.join("\n")
}
