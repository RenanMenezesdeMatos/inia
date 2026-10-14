import { createHash } from "node:crypto"
import type pg from "pg"
import { DEMO_ORGANIZATION_ID } from "./demo-constants.js"
import { demoId } from "./demo-ids.js"
import type { DemoMass } from "./build-demo-mass.js"

/**
 * Acompanhamento, Ciência e Pendências canônicos da massa demo (rodada de hardening 2026-09-16,
 * Parte C). POUCOS casos, determinísticos, pelos CONTRATOS REAIS do produto — nunca "mock visual":
 *
 * - Feedbacks publicados (`feedbacks.status = PUBLISHED`, com caso + evidência, como
 *   create-indicator-feedback.ts grava) para os operadores canônicos da Supervisora Daniela:
 *   Larissa (reconhecimento, ciência CONFIRMADA), Mariana (performance crítica, ciência PENDENTE),
 *   Beatriz (evolução), Rafael (análise LONGA em Markdown — "Ver análise completa"), Diego (lacuna
 *   de dado, sem avaliação negativa).
 * - UMA Pendência real de Revisão humana para Daniela: um Workflow demo (inativo, nunca agendado)
 *   com versão publicada, uma matrícula em `waiting` no node de revisão com o resultado do agente
 *   já no Execution Context (texto estático coerente com a persona — nenhuma chamada a LLM no
 *   seed) e o alerta `WORKFLOW_HUMAN_REVIEW` com a dedupe_key que o módulo Pendências lê. Aprovar/
 *   reprovar/escalar funciona de verdade pelo runtime: aprovar publica o feedback ao operador,
 *   escalar entrega ao Gerente.
 *
 * Idempotente (upsert por id determinístico — reseed restaura o estado canônico, inclusive a
 * ciência pendente da Mariana e a pendência em `waiting`) e removido pelo reset por lista
 * explícita de ids (`demoFollowUpIds`). Artefatos que uma DECISÃO real gera depois (o feedback
 * publicado ao aprovar, o alerta ao escalar, eventos, outputs) têm id de runtime — não estão na
 * lista, mas são descobertos por LINEAGE real a partir da matrícula demo (`findDemoDerivedArtifacts`)
 * e removidos pelo reset; nada fora dessa cadeia é tocado (saneamento 2026-09-16, Parte B).
 */
type Client = pg.PoolClient

export type DemoFollowUpFeedback = {
  caseId: string
  evidenceId: string
  feedbackId: string
  operatorKey: string
  feedbackKind: "INDICATOR" | "MONITORING"
  title: string
  caseSummary: string
  indicatorCode: string
  indicatorValue: string
  indicatorTarget: string
  evidenceFound: string
  observedBehavior: string
  relatedProcedure: string
  recommendation: string
  publishedAt: string
  acknowledgedAt: string | null
  /** Materiais de apoio recomendados (feedback_support_materials) — só materiais REAIS que já
   * existem em todo banco (cadeia de migrations), nunca um material demo paralelo. */
  supportMaterials?: { materialId: string; reason: string }[]
}

/** "Checklist de Encerramento de Chamada" — base publicada para Todos os grupos desde a
 * migration 009; é o material que o feedback de evolução da Beatriz recomenda. */
export const DEMO_SUPPORT_MATERIAL_ID = "00000000-0000-4000-8000-000000000051"

const PUBLISHED_AT = "2026-09-15T13:10:00.000Z"

const RAFAEL_ANALYSIS = `## Análise de queda de PRV — março a agosto/2026

**Resumo:** seu atingimento oficial de PRV saiu de **110%** em março para **87%** em agosto. A queda é gradual (não um evento isolado) e concentrada em dois indicadores.

### O que os fechamentos mostram

| Competência | PRV | Quartil | Indicador com maior desvio |
|---|---|---|---|
| abr/26 | 110% | Q1 | — |
| jun/26 | 101% | Q2 | Tempo Médio de Atendimento |
| ago/26 | 91% | Q3 | Reincidência em até 7 Dias |
| set/26 | 87% | Q4 | Reincidência em até 7 Dias |

### Padrões observados

- **Reincidência em até 7 Dias** subiu de 7% para 12% (meta: 9%) — o cliente volta a ligar sobre o mesmo assunto.
- **TMA** acima da meta desde junho (470s vs. 400s), com mais transferências do que a média do Subgrupo.
- Monitoria de Qualidade e Nota da URA continuam dentro da referência: a condução do atendimento não é o problema.

> hipótese: a combinação "resolução parcial + transferência" explica a reincidência — o atendimento termina sem confirmar que o cliente entendeu os próximos passos.

### Próximos passos combinados com sua supervisora

1. Nas próximas duas semanas, encerrar toda chamada confirmando **protocolo, prazo e canal de retorno**.
2. Revisar o [Checklist de Encerramento de Chamada](https://wiki.inia.local/procedimentos/checklist-encerramento) antes do turno.
3. Acompanhamento na competência de outubro: meta de Reincidência abaixo de 9%.

Este acompanhamento foi revisado e aprovado pela sua supervisora antes de ser publicado.`

/** Os cinco feedbacks canônicos — ids determinísticos por persona. */
export function demoFollowUpFeedbacks(): DemoFollowUpFeedback[] {
  const fixture = (operatorKey: string, slug: string, fields: Omit<DemoFollowUpFeedback, "caseId" | "evidenceId" | "feedbackId" | "operatorKey">): DemoFollowUpFeedback => ({
    caseId: demoId(`followup:case:${slug}`),
    evidenceId: demoId(`followup:evidence:${slug}`),
    feedbackId: demoId(`followup:feedback:${slug}`),
    operatorKey,
    ...fields,
  })
  return [
    fixture("operator:0001", "larissa", {
      feedbackKind: "INDICATOR",
      title: "Reconhecimento — PRV de agosto/2026",
      caseSummary: "Reconhecimento pelo sexto fechamento consecutivo no Q1 de PRV.",
      indicatorCode: "PRV",
      indicatorValue: "118%",
      indicatorTarget: "100%",
      evidenceFound: "Fechamento 2026-09 — PRV (atingimento oficial): 118% (meta: 100%) | Quartil Q1 em 6 de 6 competências (abr–set/2026) | Monitoria de Qualidade: 96% (meta: 90%) | Reincidência em até 7 Dias: 5% (meta: 9%)",
      observedBehavior: "Resultado consistente acima da meta em todos os indicadores da competência, com destaque para Qualidade e Reincidência.",
      relatedProcedure: "Procedimento Operacional Jeito Vivo de Atender — encerramento com confirmação de entendimento",
      recommendation: "Parabéns pelo sexto fechamento seguido no Q1. O que mais se destaca é a **Reincidência em até 7 Dias** em 5%: seus clientes não precisam ligar de novo. Continue confirmando protocolo e próximos passos no encerramento — é exatamente essa prática que sustenta o resultado. Sua supervisora pode convidar você a compartilhar essa rotina com a equipe.",
      publishedAt: PUBLISHED_AT,
      acknowledgedAt: "2026-09-15T15:42:00.000Z",
    }),
    fixture("operator:0002", "mariana", {
      feedbackKind: "INDICATOR",
      title: "Análise de Performance Individual — agosto/2026",
      caseSummary: "Recorrência no Q4 de PRV em três fechamentos consecutivos.",
      indicatorCode: "PRV",
      indicatorValue: "83,5%",
      indicatorTarget: "100%",
      evidenceFound: "Fechamento 2026-09 (+2 anteriores) — PRV (atingimento oficial): 83,5% (meta: 100%) | Aderência à Escala: 73,6% (meta: 92%) | Monitoria de Qualidade: 78,3% (meta: 90%) | Nota da Pesquisa na URA: 3,56 (meta: 4,3) | Reincidência em até 7 Dias: 11,1% (meta: 9%) | Tempo Médio de Atendimento: 470s (meta: 400s)",
      observedBehavior: "Recorrência no quartil Q4 em todos os indicadores monitorados durante o trimestre, com necessidade de ajustes em múltiplos pontos de controle.",
      relatedProcedure: "Política de Jornada, Horas Extras, Faltas e Banco de Horas — aderência à escala",
      recommendation: "Em agosto de 2026 (último fechamento) seu PRV oficial foi de 83,5%, mantendo-se no quartil Q4. Na Aderência à Escala você atingiu 73,6% frente à meta de 92%; em Monitoria de Qualidade, 78,3% diante da meta de 90%.\n\nPara melhorar, priorize o acompanhamento da **Aderência à Escala** e da **Monitoria de Qualidade**, focando na conformidade aos processos e na qualidade técnica dos atendimentos. Como ação prioritária para o próximo mês, garanta a entrega do protocolo em todas as interações e revise o fluxo de encerramento para reduzir a Reincidência em até 7 Dias.\n\nEste feedback foi revisado e aprovado pela sua supervisora antes de ser publicado.",
      publishedAt: PUBLISHED_AT,
      acknowledgedAt: null,
    }),
    fixture("operator:0003", "beatriz", {
      feedbackKind: "INDICATOR",
      title: "Reconhecimento de evolução — março a agosto/2026",
      caseSummary: "Maior evolução de PRV do Subgrupo no semestre: 83% → 110%.",
      indicatorCode: "PRV",
      indicatorValue: "110%",
      indicatorTarget: "100%",
      evidenceFound: "Fechamentos 2026-04 a 2026-09 — PRV (atingimento oficial): 83% (abr) → 91% (jun) → 104% (ago) → 110% (set) | Quartil: Q4 → Q1 | Tempo Médio de Atendimento: 452s → 388s (meta: 400s)",
      observedBehavior: "Evolução contínua de PRV em seis fechamentos, saindo do Q4 para o Q1, com o TMA passando a fechar dentro da meta a partir de junho.",
      relatedProcedure: "Checklist de Encerramento de Chamada",
      recommendation: "Sua trajetória de março a agosto é a maior evolução de PRV do Subgrupo: de 83% para 110%. O ganho veio principalmente do **Tempo Médio de Atendimento**, que passou a fechar dentro da meta a partir de junho sem perder Qualidade.\n\nOrientação de continuidade: mantenha o roteiro de encerramento que você adotou em julho e registre o que mudou na sua rotina — sua supervisora quer usar o seu caso como referência para a equipe. Para consolidar o roteiro, consulte o material recomendado abaixo.",
      publishedAt: PUBLISHED_AT,
      acknowledgedAt: "2026-09-15T18:05:00.000Z",
      supportMaterials: [{ materialId: DEMO_SUPPORT_MATERIAL_ID, reason: "Este checklist lista as quatro confirmações do encerramento (solução, protocolo, próximo passo e dúvidas) que sustentaram sua queda de TMA sem perder qualidade." }],
    }),
    fixture("operator:0004", "rafael", {
      feedbackKind: "INDICATOR",
      title: "Análise de queda de PRV — março a agosto/2026",
      caseSummary: "Queda gradual de PRV (110% → 87%) concentrada em Reincidência e TMA.",
      indicatorCode: "PRV",
      indicatorValue: "87%",
      indicatorTarget: "100%",
      evidenceFound: "Fechamentos 2026-04 a 2026-09 — PRV (atingimento oficial): 110% (abr) → 101% (jun) → 91% (ago) → 87% (set) | Reincidência em até 7 Dias: 7% → 12% (meta: 9%) | Tempo Médio de Atendimento: 470s (meta: 400s) | Monitoria de Qualidade: 91% (meta: 90%)",
      observedBehavior: "Queda gradual de PRV ao longo de seis competências, concentrada em Reincidência em até 7 Dias e TMA; Qualidade e Nota da URA dentro da referência.",
      relatedProcedure: "Checklist de Encerramento de Chamada",
      recommendation: RAFAEL_ANALYSIS,
      publishedAt: PUBLISHED_AT,
      acknowledgedAt: "2026-09-16T11:20:00.000Z",
    }),
    fixture("operator:0006", "diego", {
      feedbackKind: "INDICATOR",
      title: "Nota da URA — análise não concluída (julho e agosto/2026)",
      caseSummary: "Ausência de medição de Nota da URA em duas competências — lacuna de dado, não de desempenho.",
      indicatorCode: "NOTA_URA",
      indicatorValue: "sem medição",
      indicatorTarget: "4,3",
      evidenceFound: "Fechamentos 2026-07 e 2026-08 — Nota da Pesquisa na URA: sem medição registrada | Demais indicadores da competência: dentro da referência | Fechamento 2026-09 — Nota da URA: 4,4 (meta: 4,3)",
      observedBehavior: "Não há medição de Nota da URA em julho e agosto; os demais indicadores estão dentro da referência.",
      relatedProcedure: "Nenhum procedimento aplicável — verificação de cadastro/integração",
      recommendation: "Não foi possível concluir a análise de **Nota da Pesquisa na URA** para julho e agosto porque não há medição registrada nessas competências. Isso **não** é um resultado abaixo da meta: é uma lacuna de dado, já sinalizada à sua supervisora para verificação de cadastro/integração. Nas medições operacionais diárias de setembro a nota voltou a aparecer (acompanhamento do mês corrente, ainda sem fechamento). Nenhuma ação é necessária da sua parte.",
      publishedAt: PUBLISHED_AT,
      acknowledgedAt: "2026-09-15T16:30:00.000Z",
    }),
  ]
}

// ---------------------------------------------------------------------------------------------
// Pendência de Revisão humana (Thiago Moreira → Supervisora Daniela)
// ---------------------------------------------------------------------------------------------

export const DEMO_REVIEW_WORKFLOW_ID = demoId("followup:workflow:human-review")
export const DEMO_REVIEW_VERSION_ID = demoId("followup:version:human-review")
export const DEMO_REVIEW_ENROLLMENT_ID = demoId("followup:enrollment:thiago")
export const DEMO_REVIEW_ALERT_ID = demoId("followup:alert:review:thiago")
export const DEMO_REVIEW_NODE_ID = "review"
export const DEMO_REVIEW_OPERATOR_KEY = "operator:0007"

/** Grafo do Workflow demo — a mesma espinha do Modelo 03 (Agente → Revisão → Feedback/Escalonar),
 * pra decisão retomar pelo runtime real: aprovado publica ao operador, escalar entrega ao Gerente. */
export function demoReviewGraph(performanceAgentId: string) {
  const node = (id: string, type: string, label: string, y: number, config: Record<string, unknown>, x = 0) => ({ id, type, label, position: { x, y }, config })
  return {
    nodes: [
      node("trigger", "trigger", "Agenda mensal (demo)", 0, {}),
      node("agent", "action", "Especialista de Performance Individual", 230, { actionType: "CALL_AGENT", agentId: performanceAgentId, scheduledDataSource: { kind: "PERFORMANCE", closures: 2 } }),
      node(DEMO_REVIEW_NODE_ID, "human_review", "Revisão do supervisor", 460, { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, contentSource: "nodeOutputs.agent", instruction: "Confirme o diagnóstico de volatilidade antes de publicar ao operador." }),
      node("output", "output", "Feedback ao operador", 690, { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.agent" }),
      node("escalar", "action", "Escalonar ao Gerente", 690, { actionType: "ESCALATE", target: { type: "ROLE_OF_OPERATOR", role: "MANAGER" }, contentSource: "nodeOutputs.agent", surfaces: ["FOLLOW_UP"], reason: "O supervisor escalou a revisão deste feedback.", continuation: "END_BRANCH" }, 340),
      node("end", "end", "Fim", 920, {}),
    ],
    edges: [
      { id: "e-trigger-always-agent", source: "trigger", sourceHandle: "always", target: "agent" },
      { id: "e-agent-always-review", source: "agent", sourceHandle: "always", target: DEMO_REVIEW_NODE_ID },
      { id: "e-review-approved-output", source: DEMO_REVIEW_NODE_ID, sourceHandle: "approved", target: "output" },
      { id: "e-review-rejected-end", source: DEMO_REVIEW_NODE_ID, sourceHandle: "rejected", target: "end" },
      { id: "e-review-escalated-escalar", source: DEMO_REVIEW_NODE_ID, sourceHandle: "escalated", target: "escalar" },
      { id: "e-output-always-end", source: "output", sourceHandle: "always", target: "end" },
    ],
  }
}

/**
 * Resultado do agente já no Execution Context (`nodeOutputs.agent`) — o MESMO contrato que
 * run-agent.ts devolve pra fonte PERFORMANCE (`kind: "indicator"` + `input` de
 * create-indicator-feedback.ts). Números lidos da massa (fechamentos reais do Thiago), texto
 * estático coerente com a persona "volátil" — nenhuma chamada a LLM.
 */
export function demoReviewAgentOutput(mass: DemoMass) {
  const operator = mass.structure.byKey.get(DEMO_REVIEW_OPERATOR_KEY)!
  const team = mass.structure.teamByKey.get(operator.teamKey!)!
  const rows = mass.performance.indicatorRows.filter((row) => row.personId === operator.id && (row.referencePeriod === "2026-09" || row.referencePeriod === "2026-08"))
  const prv = mass.performance.prvRows.filter((row) => row.personId === operator.id && (row.referencePeriod === "2026-09" || row.referencePeriod === "2026-08"))
  const latestPrv = prv.find((row) => row.referencePeriod === "2026-09")
  const previousPrv = prv.find((row) => row.referencePeriod === "2026-08")
  const format = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })
  const evidenceFound = [
    `Fechamento 2026-09 (+1 anterior) — PRV (atingimento oficial): ${format(latestPrv?.achievementPercent ?? 0)}% (meta: 100%) | PRV 2026-08: ${format(previousPrv?.achievementPercent ?? 0)}%`,
    ...rows.filter((row) => row.referencePeriod === "2026-09").map((row) => `${row.indicatorCode}: ${format(row.value)} (meta: ${format(row.targetValue)}, atingimento ${format(row.achievementPercent)}%)`),
  ].join(" | ")
  const evidenceSourceId = [...prv.map((row) => row.id), ...rows.map((row) => row.id)].join(",")
  return {
    kind: "indicator",
    input: {
      organizationId: DEMO_ORGANIZATION_ID,
      operatorId: operator.id,
      teamId: team.id,
      evidenceSourceType: "employee_performance",
      evidenceSourceId,
      contextSnapshot: { periodSummary: { periodLabel: "Fechamento 2026-09 (+1 anterior)", periodStart: "2026-08-01", periodEnd: "2026-09-01", performanceRowIds: evidenceSourceId.split(",") }, demoSeed: true },
      measuredAt: "2026-09-01",
      indicatorCode: "GERAL",
      indicatorName: "Resumo geral de indicadores",
      evidenceFound,
      impactedIndicator: "Resumo geral de indicadores",
      observedBehavior: "Resumo de indicadores dos fechamentos de julho e agosto de 2026.",
      structured: {
        title: "Análise de volatilidade — julho e agosto/2026",
        summary: `Seu PRV alternou entre ${format(previousPrv?.achievementPercent ?? 0)}% em julho e ${format(latestPrv?.achievementPercent ?? 0)}% em agosto — o padrão dos últimos meses é de oscilação forte entre competências, não de queda contínua.`,
        recommendation: "A oscilação mês a mês costuma vir de rotina irregular, não de falta de técnica: nos meses bons você fecha acima da meta em todos os indicadores. Combine com sua supervisora um acompanhamento quinzenal (em vez de mensal) para identificar cedo o que muda nos meses ruins — jornada, fila, tipo de demanda — e estabilizar o resultado. Nenhuma ação corretiva é necessária antes dessa conversa.",
        relatedProcedure: "Nenhum procedimento específico cadastrado",
      },
    },
  }
}

function checksum(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

export async function persistDemoFollowUps(client: Client, mass: DemoMass, performanceAgentId: string): Promise<DemoDerivedArtifacts> {
  // 0. Estado canônico: o que uma decisão REAL da Pendência demo gerou (caso/feedback publicado ao
  //    Thiago, alerta ao Gerente, eventos/outputs da matrícula) sai ANTES de reescrever a fixture —
  //    senão o reseed deixaria um feedback "aprovado" órfão convivendo com a pendência de novo em
  //    `waiting`. Só por lineage (findDemoDerivedArtifacts); nada fora da cadeia é tocado.
  const derived = await findDemoDerivedArtifacts(client)
  await deleteDerivedDemoArtifacts(client, async (_label, sql, params) => {
    await client.query(sql, params)
  }, derived)
  // A matrícula canônica volta ao estado inicial: eventos da decisão/execução saem (os 3 da
  // fixture são reinseridos abaixo com as mesmas chaves de idempotência).
  await client.query(`delete from workflow_enrollment_events where enrollment_id = $1 and idempotency_key not like 'demo:%'`, [DEMO_REVIEW_ENROLLMENT_ID])
  await client.query(`delete from workflow_outputs where enrollment_id = $1`, [DEMO_REVIEW_ENROLLMENT_ID])

  // 1. Feedbacks publicados (caso + evidência + feedback), por persona.
  for (const fixture of demoFollowUpFeedbacks()) {
    const operator = mass.structure.byKey.get(fixture.operatorKey)
    if (!operator) throw new Error(`Operador canônico ${fixture.operatorKey} não existe na massa demo.`)
    const team = mass.structure.teamByKey.get(operator.teamKey!)!
    await client.query(
      `insert into supervision_cases (id, organization_id, operator_id, team_id, title, summary, status, priority, indicator_code, indicator_value, indicator_target, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, 'DIAGNOSED', 'P2', $7, $8, $9, $10, $10)
       on conflict (id) do update set title = excluded.title, summary = excluded.summary, indicator_code = excluded.indicator_code, indicator_value = excluded.indicator_value, indicator_target = excluded.indicator_target, updated_at = excluded.updated_at`,
      [fixture.caseId, DEMO_ORGANIZATION_ID, operator.id, team.id, fixture.title, fixture.caseSummary, fixture.indicatorCode, fixture.indicatorValue, fixture.indicatorTarget, fixture.publishedAt],
    )
    await client.query(
      `insert into evidences (id, organization_id, case_id, evidence_type, title, description, source_type, source_id, occurred_at, checksum)
       values ($1, $2, $3, 'INDICATOR', $4, $5, 'employee_performance', $6, $7, $8)
       on conflict (id) do update set title = excluded.title, description = excluded.description, checksum = excluded.checksum`,
      [fixture.evidenceId, DEMO_ORGANIZATION_ID, fixture.caseId, `Medição — ${fixture.title}`, fixture.evidenceFound, `demo:${fixture.operatorKey}`, fixture.publishedAt, checksum(fixture.evidenceFound)],
    )
    await client.query(
      `insert into feedbacks (id, organization_id, case_id, operator_id, status, feedback_kind, impacted_indicator, evidence_found, observed_behavior, related_procedure, recommendation, published_at, acknowledged_at, context_snapshot, created_at, updated_at)
       values ($1, $2, $3, $4, 'PUBLISHED', $5, $6, $7, $8, $9, $10, $11, $12, $13, $11, $11)
       on conflict (id) do update set status = 'PUBLISHED', impacted_indicator = excluded.impacted_indicator, evidence_found = excluded.evidence_found, observed_behavior = excluded.observed_behavior,
         related_procedure = excluded.related_procedure, recommendation = excluded.recommendation, published_at = excluded.published_at, acknowledged_at = excluded.acknowledged_at, updated_at = now()`,
      [
        fixture.feedbackId,
        DEMO_ORGANIZATION_ID,
        fixture.caseId,
        operator.id,
        fixture.feedbackKind,
        fixture.title,
        fixture.evidenceFound,
        fixture.observedBehavior,
        fixture.relatedProcedure,
        fixture.recommendation,
        fixture.publishedAt,
        fixture.acknowledgedAt,
        JSON.stringify({ demoSeed: true, persona: fixture.operatorKey }),
      ],
    )
    // Relação Feedback ↔ Material pelo mesmo contrato do runtime (upsert por feedback × material;
    // reseed restaura motivo/ordem canônicos). Cai em cascata quando o feedback demo é apagado.
    for (const [position, material] of (fixture.supportMaterials ?? []).entries()) {
      await client.query(
        `insert into feedback_support_materials (organization_id, feedback_id, knowledge_document_id, reason, position)
         values ($1, $2, $3, $4, $5)
         on conflict (feedback_id, knowledge_document_id) do update set reason = excluded.reason, position = excluded.position`,
        [DEMO_ORGANIZATION_ID, fixture.feedbackId, material.materialId, material.reason, position],
      )
    }
  }

  // 2. Pendência de Revisão humana: Workflow demo (inativo — o agendador nunca o considera) +
  //    versão + matrícula em `waiting` no node de revisão + alerta ao revisor (Supervisora).
  const operator = mass.structure.byKey.get(DEMO_REVIEW_OPERATOR_KEY)!
  const supervisor = mass.structure.byKey.get(operator.reportsToKey!)!
  const graph = demoReviewGraph(performanceAgentId)
  const trigger = { kind: "schedule", mode: "CALENDAR", times: ["09:00"], frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH", day: 5 }, anchorDate: "2026-09-01", intervalDays: 1 }
  await client.query(
    `insert into workflows (id, organization_id, name, description, scope_type, active, trigger_config, draft_graph, created_at, updated_at)
     values ($1, $2, $3, $4, 'ALL_TEAMS', false, $5, $6, $7, $7)
     on conflict (id) do update set name = excluded.name, description = excluded.description, active = false, trigger_config = excluded.trigger_config, draft_graph = excluded.draft_graph, updated_at = now()`,
    [DEMO_REVIEW_WORKFLOW_ID, DEMO_ORGANIZATION_ID, "Demo · Revisão humana pendente (massa demo)", "Workflow da massa demo: mantém UMA revisão humana pendente para a Supervisora Daniela. Inativo — nunca é agendado; a decisão retoma a execução pelo runtime real.", JSON.stringify(trigger), JSON.stringify(graph), PUBLISHED_AT],
  )
  await client.query(
    `insert into workflow_versions (id, workflow_id, graph, created_at) values ($1, $2, $3, $4)
     on conflict (id) do update set graph = excluded.graph`,
    [DEMO_REVIEW_VERSION_ID, DEMO_REVIEW_WORKFLOW_ID, JSON.stringify(graph), PUBLISHED_AT],
  )
  await client.query(`update workflows set active_version_id = $2 where id = $1`, [DEMO_REVIEW_WORKFLOW_ID, DEMO_REVIEW_VERSION_ID])
  const agentOutput = demoReviewAgentOutput(mass)
  const scheduledFor = "2026-09-16T12:00:00.000Z"
  await client.query(
    `insert into workflow_enrollments (id, organization_id, workflow_id, version_id, scheduled_subject_id, scheduled_for, current_node_id, status, next_eval_at, claimed_until, attempts, revision, node_outputs, variables, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, 'waiting', '2999-01-01T00:00:00Z', null, 0, 0, $8, '{}', $6, $6)
     on conflict (id) do update set current_node_id = excluded.current_node_id, status = 'waiting', next_eval_at = excluded.next_eval_at, claimed_until = null, attempts = 0, revision = workflow_enrollments.revision + 1, node_outputs = excluded.node_outputs, updated_at = now()`,
    [DEMO_REVIEW_ENROLLMENT_ID, DEMO_ORGANIZATION_ID, DEMO_REVIEW_WORKFLOW_ID, DEMO_REVIEW_VERSION_ID, operator.id, scheduledFor, DEMO_REVIEW_NODE_ID, JSON.stringify({ trigger: { kind: "schedule", scheduledFor }, agent: agentOutput })],
  )
  // Linha do tempo que o detalhe da pendência mostra (mesmos event_type do motor).
  const events: [string, string, string][] = [
    ["trigger", "node_completed", "demo:trigger"],
    ["agent", "agent_called", "demo:agent"],
    [DEMO_REVIEW_NODE_ID, "human_review_requested", "demo:review"],
  ]
  for (const [nodeId, eventType, key] of events) {
    await client.query(
      `insert into workflow_enrollment_events (enrollment_id, node_id, event_type, payload, idempotency_key, created_at) values ($1, $2, $3, '{"demoSeed": true}', $4, $5)
       on conflict (enrollment_id, idempotency_key) do nothing`,
      [DEMO_REVIEW_ENROLLMENT_ID, nodeId, eventType, key, scheduledFor],
    )
  }
  const summary = (agentOutput.input.structured as { summary: string }).summary
  await client.query(
    `insert into alerts (id, organization_id, case_id, recipient_id, title, description, severity, alert_type, status, dedupe_key, created_at, read_at, resolved_at)
     values ($1, $2, null, $3, $4, $5, 'HIGH', 'WORKFLOW_HUMAN_REVIEW', 'OPEN', $6, $7, null, null)
     on conflict (id) do update set recipient_id = excluded.recipient_id, title = excluded.title, description = excluded.description, status = 'OPEN', read_at = null, resolved_at = null`,
    [
      DEMO_REVIEW_ALERT_ID,
      DEMO_ORGANIZATION_ID,
      supervisor.id,
      `Revisão pendente: ${operator.name}`,
      `Um workflow está aguardando sua decisão (aprovar/reprovar/escalar) sobre uma ocorrência de ${operator.name}. Instrução: Confirme o diagnóstico de volatilidade antes de publicar ao operador. Conteúdo: ${summary}`,
      `workflow_human_review:${DEMO_REVIEW_ENROLLMENT_ID}:${DEMO_REVIEW_NODE_ID}`,
      scheduledFor,
    ],
  )
  return derived
}

/** Ids que o seed cria fora da estrutura/performance — o reset apaga exatamente estes e o
 * verificador de bloqueios os reconhece como "da massa" (nunca como dado real). */
export function demoFollowUpIds(): { cases: string[]; evidences: string[]; feedbacks: string[]; alerts: string[]; enrollments: string[]; workflows: string[]; versions: string[] } {
  const feedbacks = demoFollowUpFeedbacks()
  return {
    cases: feedbacks.map((fixture) => fixture.caseId),
    evidences: feedbacks.map((fixture) => fixture.evidenceId),
    feedbacks: feedbacks.map((fixture) => fixture.feedbackId),
    alerts: [DEMO_REVIEW_ALERT_ID],
    enrollments: [DEMO_REVIEW_ENROLLMENT_ID],
    workflows: [DEMO_REVIEW_WORKFLOW_ID],
    versions: [DEMO_REVIEW_VERSION_ID],
  }
}

/**
 * Artefatos DERIVADOS da fixture — o que o runtime produz quando a Pendência demo é decidida de
 * verdade (aprovar → caso + evidência + feedback publicado + linha do tempo; escalar →
 * alerta ao Gerente; qualquer decisão → eventos e outputs da matrícula). Os ids nascem em runtime,
 * então NÃO são hardcoded: são resolvidos pela cadeia real, sempre a partir de ids que a fixture
 * conhece:
 *
 *   workflow demo (id determinístico)
 *   └ matrículas (FK workflow_id — inclui a canônica e qualquer outra que o mesmo Workflow gere)
 *     ├ eventos (FK enrollment_id) — `payload.caseId` do `output_dispatched`
 *     ├ `node_outputs` da matrícula — `caseId`/`feedbackId` do node Output
 *     ├ workflow_outputs (FK enrollment_id)
 *     └ alerts cuja dedupe_key é a chave estruturada do motor
 *       (`workflow_output|workflow_escalation|workflow_human_review:<enrollmentId>:…`)
 *   └ casos derivados → feedbacks/evidências/linha do tempo/recomendações/planos/escalonamentos/
 *     agent_runs/alertas por FK case_id.
 *
 * Nunca por título, `like '%demo%'` ou "pessoa demo": um caso real aberto pra um operador demo por
 * outro caminho continua sendo bloqueio do reset, não derivado.
 */
export type DemoDerivedArtifacts = { enrollments: string[]; cases: string[]; feedbacks: string[]; alerts: string[]; workflowOutputs: number }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function uniqueUuids(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && UUID_PATTERN.test(value)))]
}

/** Só o que a descoberta usa — permite o fake dos testes sem um PoolClient inteiro. */
export type LineageQuerier = { query: <R extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: R[] }> }

export async function findDemoDerivedArtifacts(client: LineageQuerier): Promise<DemoDerivedArtifacts> {
  const owned = demoFollowUpIds()
  // 1. Matrículas do Workflow demo — FK inequívoca (a canônica + qualquer outra do mesmo Workflow).
  const enrollmentRows = await client.query<{ id: string; node_outputs: Record<string, unknown> | null }>(
    `select id, node_outputs from workflow_enrollments where workflow_id = any($1::uuid[]) or id = any($2::uuid[])`,
    [owned.workflows, owned.enrollments],
  )
  const enrollments = uniqueUuids(enrollmentRows.rows.map((row) => row.id))
  if (enrollments.length === 0) return { enrollments: [], cases: [], feedbacks: [], alerts: [], workflowOutputs: 0 }

  // 2. Casos/feedbacks que o node Output gravou: no `node_outputs` da matrícula e no payload dos eventos.
  const fromNodeOutputs = enrollmentRows.rows.flatMap((row) =>
    Object.values(row.node_outputs ?? {}).flatMap((value) => {
      if (!value || typeof value !== "object") return []
      const record = value as { caseId?: unknown; feedbackId?: unknown }
      return [{ caseId: record.caseId, feedbackId: record.feedbackId }]
    }),
  )
  const eventRows = await client.query<{ case_id: string | null }>(
    `select distinct payload->>'caseId' as case_id from workflow_enrollment_events where enrollment_id = any($1::uuid[]) and payload ? 'caseId'`,
    [enrollments],
  )
  const seedCases = new Set(owned.cases)
  const cases = uniqueUuids([...fromNodeOutputs.map((entry) => entry.caseId), ...eventRows.rows.map((row) => row.case_id)]).filter((id) => !seedCases.has(id))

  // 3. Feedbacks: os apontados pelo Output + todos os do caso derivado (FK).
  const feedbackRows = await client.query<{ id: string }>(`select id from feedbacks where case_id = any($1::uuid[]) or id = any($2::uuid[])`, [cases, uniqueUuids(fromNodeOutputs.map((entry) => entry.feedbackId))])
  const seedFeedbacks = new Set(owned.feedbacks)
  const feedbacks = uniqueUuids(feedbackRows.rows.map((row) => row.id)).filter((id) => !seedFeedbacks.has(id))

  // 4. Alertas: chave estruturada do motor com a matrícula demo (segmento 2 da dedupe_key) ou FK do caso derivado.
  const alertRows = await client.query<{ id: string }>(
    `select id from alerts
      where (split_part(dedupe_key, ':', 1) in ('workflow_output', 'workflow_escalation', 'workflow_human_review') and split_part(dedupe_key, ':', 2) = any($1::text[]))
         or case_id = any($2::uuid[])`,
    [enrollments, cases],
  )
  const seedAlerts = new Set(owned.alerts)
  const alerts = uniqueUuids(alertRows.rows.map((row) => row.id)).filter((id) => !seedAlerts.has(id))

  const outputRows = await client.query<{ count: string }>(`select count(*)::text from workflow_outputs where enrollment_id = any($1::uuid[])`, [enrollments])
  return { enrollments, cases, feedbacks, alerts, workflowOutputs: Number(outputRows.rows[0]?.count ?? 0) }
}

type Runner = (label: string, sql: string, params: unknown[]) => Promise<void>

/** Remove SÓ os derivados (lineage) — filhos antes dos pais; FKs respeitadas, nada em cascata "por
 * tabela". Usado pelo reset (antes da fixture) e pelo seed (antes de reescrever a fixture). */
export async function deleteDerivedDemoArtifacts(_client: Pick<Client, "query">, run: Runner, derived: DemoDerivedArtifacts): Promise<void> {
  const ids = demoFollowUpIds()
  if (derived.cases.length > 0) {
    await run("derived:development_actions", `delete from development_actions where plan_id in (select id from development_plans where case_id = any($1::uuid[]))`, [derived.cases])
    await run("derived:development_plans", `delete from development_plans where case_id = any($1::uuid[])`, [derived.cases])
    await run("derived:performance_escalations", `delete from performance_escalations where case_id = any($1::uuid[])`, [derived.cases])
    await run("derived:recommendations", `delete from recommendations where case_id = any($1::uuid[])`, [derived.cases])
    await run("derived:agent_runs", `delete from agent_runs where case_id = any($1::uuid[])`, [derived.cases])
  }
  if (derived.feedbacks.length > 0) await run("derived:feedbacks", `delete from feedbacks where id = any($1::uuid[])`, [derived.feedbacks])
  if (derived.alerts.length > 0) await run("derived:alerts", `delete from alerts where id = any($1::uuid[])`, [derived.alerts])
  if (derived.cases.length > 0) {
    await run("derived:evidences", `delete from evidences where case_id = any($1::uuid[])`, [derived.cases])
    await run("derived:case_timeline_events", `delete from case_timeline_events where case_id = any($1::uuid[])`, [derived.cases])
    await run("derived:supervision_cases", `delete from supervision_cases where id = any($1::uuid[])`, [derived.cases])
  }
  const extraEnrollments = derived.enrollments.filter((id) => !ids.enrollments.includes(id))
  if (extraEnrollments.length > 0) {
    await run("derived:workflow_outputs", `delete from workflow_outputs where enrollment_id = any($1::uuid[])`, [extraEnrollments])
    await run("derived:workflow_enrollment_events", `delete from workflow_enrollment_events where enrollment_id = any($1::uuid[])`, [extraEnrollments])
    await run("derived:workflow_enrollments", `delete from workflow_enrollments where id = any($1::uuid[])`, [extraEnrollments])
  }
}

export async function deleteDemoFollowUps(client: Client, run: Runner, derived: DemoDerivedArtifacts): Promise<void> {
  const ids = demoFollowUpIds()
  await deleteDerivedDemoArtifacts(client, run, derived)
  await run("workflow_outputs", `delete from workflow_outputs where enrollment_id = any($1::uuid[])`, [ids.enrollments])
  await run("alerts", `delete from alerts where id = any($1::uuid[])`, [ids.alerts])
  await run("workflow_enrollment_events", `delete from workflow_enrollment_events where enrollment_id = any($1::uuid[])`, [ids.enrollments])
  await run("workflow_enrollments", `delete from workflow_enrollments where id = any($1::uuid[])`, [ids.enrollments])
  await client.query(`update workflows set active_version_id = null where id = any($1::uuid[])`, [ids.workflows])
  await run("workflow_versions", `delete from workflow_versions where id = any($1::uuid[])`, [ids.versions])
  await run("workflows", `delete from workflows where id = any($1::uuid[])`, [ids.workflows])
  await run("feedbacks", `delete from feedbacks where id = any($1::uuid[])`, [ids.feedbacks])
  await run("evidences", `delete from evidences where id = any($1::uuid[])`, [ids.evidences])
  await run("case_timeline_events", `delete from case_timeline_events where case_id = any($1::uuid[])`, [ids.cases])
  await run("supervision_cases", `delete from supervision_cases where id = any($1::uuid[])`, [ids.cases])
}
