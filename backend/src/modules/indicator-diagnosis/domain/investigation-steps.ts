import { z } from "zod"

/**
 * INDICATOR DIAGNOSIS V2 — PASSOS DE INVESTIGAÇÃO ORIENTADOS PELA ESTRATÉGIA (domínio puro, ZERO modelo).
 *
 *   ESTRATÉGIA   diz O QUE vale investigar: objetivo + instruções (texto que a IA lê) + passos PERMITIDOS;
 *   SISTEMA      diz o que é POSSÍVEL: disponibilidade de cada passo nos dados reais (configuração, contrato de dados);
 *   IA           escolhe, entre os permitidos E disponíveis, o que faz sentido com os fatos iniciais — só códigos de passo,
 *                nunca parâmetro livre, id de pessoa, equipe ou grupo (o schema da resposta nem aceita);
 *   SISTEMA      valida a escolha (fora da lista = recusado e registrado), executa cada passo de forma determinística e
 *                calcula todos os números.
 *
 * Modo FIXED (ou estratégia sem o bloco `investigation`) = os passos saem das chaves da estratégia, SEM chamada nova ao modelo —
 * é o comportamento homologado do TMA, preservado byte a byte. Nenhum passo conhece um indicador: o catálogo é por CAPACIDADE.
 */
export const INVESTIGATION_STEPS_VERSION = "INVESTIGATION_STEPS_V1" as const

export const INVESTIGATION_MODES = ["FIXED", "AGENT_SELECTED"] as const
export type InvestigationMode = (typeof INVESTIGATION_MODES)[number]

export const INVESTIGATION_STEPS = ["REASON_MIX_SHIFT", "SIGNAL_DISTRIBUTION", "SIGNAL_EVOLUTION", "PROCESS_ASSESSMENT", "TEAM_COMPARISON"] as const
export type InvestigationStep = (typeof INVESTIGATION_STEPS)[number]

/** QUAIS atendimentos têm o processo avaliado: os do motivo investigado (sempre existiu) ou o atendimento ANTERIOR vinculado a cada interação sinalizada (exige vínculo explícito na fonte). */
export const PROCESS_POPULATIONS = ["SEGMENT_INTERACTIONS", "LINKED_PREVIOUS_OF_SIGNAL"] as const
export type ProcessPopulation = (typeof PROCESS_POPULATIONS)[number]

export const INVESTIGATION_STEP_CATALOG: Readonly<Record<InvestigationStep, { label: string; description: string; requires: "SEGMENTATION" | "SIGNAL" | "PROCESS" }>> = {
  REASON_MIX_SHIFT: { label: "Composição dos motivos × período anterior", description: "Compara a participação de cada motivo nos atendimentos do colaborador com o período anterior (fato de composição, nunca causa).", requires: "SEGMENTATION" },
  SIGNAL_DISTRIBUTION: { label: "Interações sinalizadas por motivo", description: "Quantas interações do colaborador carregam o sinal da população (flag já calculada pela fonte), por motivo, e se o sinal se concentra em algum motivo.", requires: "SIGNAL" },
  SIGNAL_EVOLUTION: { label: "Interações sinalizadas × período anterior", description: "Compara as interações sinalizadas do período com as do período anterior (total e por motivo).", requires: "SIGNAL" },
  PROCESS_ASSESSMENT: { label: "Avaliar processos nos atendimentos", description: "Avalia etapas observáveis dos atendimentos contra os processos publicados da Base de Conhecimento (reaproveitando avaliações compatíveis).", requires: "PROCESS" },
  TEAM_COMPARISON: { label: "Comparação agregada com o grupo", description: "Compara os comportamentos com o agregado do grupo do colaborador no período — grupo resolvido pelo sistema, só agregado, com população mínima.", requires: "PROCESS" },
}

export type StepUnavailableReason =
  | "NOT_CONFIGURED"
  /** O contrato de dados não traz vínculo entre interações (ex.: qual atendimento precedeu uma rechamada). */
  | "DATA_CONTRACT_NO_INTERACTION_LINK"
  | "SIGNAL_FLAG_UNAVAILABLE"
  | "NOT_DECOMPOSABLE"

export const STEP_UNAVAILABLE_LABELS: Readonly<Record<StepUnavailableReason, string>> = {
  NOT_CONFIGURED: "não habilitado na estratégia",
  DATA_CONTRACT_NO_INTERACTION_LINK: "os dados de interação não trazem vínculo com o atendimento anterior",
  SIGNAL_FLAG_UNAVAILABLE: "a flag do sinal não existe, está inativa ou não é de sim/não",
  NOT_DECOMPOSABLE: "o indicador não tem métrica por atendimento",
}

export type StepAvailability = { step: InvestigationStep; available: boolean; reason: StepUnavailableReason | null }

/**
 * Disponibilidade REAL de cada passo para uma investigação (determinística). `linkedInteractionsSupported` vem do contrato de
 * dados — hoje nenhuma fonte entrega vínculo entre interações, e o sistema diz isso em vez de parear chamadas por semelhança.
 */
export function stepAvailabilityOf(input: {
  decomposable: boolean
  segmentationEnabled: boolean
  processEnabled: boolean
  processPopulation: ProcessPopulation
  signalConfigured: boolean
  signalFlagValid: boolean
  linkedInteractionsSupported: boolean
}): StepAvailability[] {
  const entry = (step: InvestigationStep, reason: StepUnavailableReason | null): StepAvailability => ({ step, available: reason === null, reason })
  const signalReason: StepUnavailableReason | null = !input.signalConfigured ? "NOT_CONFIGURED" : !input.signalFlagValid ? "SIGNAL_FLAG_UNAVAILABLE" : null
  const processReason: StepUnavailableReason | null = !input.decomposable ? "NOT_DECOMPOSABLE"
    : !input.processEnabled ? "NOT_CONFIGURED"
    : input.processPopulation === "LINKED_PREVIOUS_OF_SIGNAL" && !input.linkedInteractionsSupported ? "DATA_CONTRACT_NO_INTERACTION_LINK"
    : input.processPopulation === "LINKED_PREVIOUS_OF_SIGNAL" && signalReason ? signalReason
    : null
  return [
    entry("REASON_MIX_SHIFT", !input.decomposable ? "NOT_DECOMPOSABLE" : !input.segmentationEnabled ? "NOT_CONFIGURED" : null),
    entry("SIGNAL_DISTRIBUTION", signalReason),
    entry("SIGNAL_EVOLUTION", signalReason),
    entry("PROCESS_ASSESSMENT", processReason),
    entry("TEAM_COMPARISON", processReason),
  ]
}

export type PlannerStatus =
  /** Modo FIXED: nenhuma chamada ao modelo (passos das chaves da estratégia). */
  | "NOT_APPLICABLE"
  /** Nenhuma escolha real (0 ou 1 passo permitido e disponível): sem chamada ao modelo. */
  | "SKIPPED_NO_CHOICE"
  | "SELECTED"
  /** A resposta do modelo não cumpriu o contrato duas vezes: vale o padrão (todos os permitidos e disponíveis). */
  | "FALLBACK_DEFAULT"

export type StepChoice = { step: string; purpose: string }
export type RejectedStep = { step: string; reason: "UNKNOWN_STEP" | "NOT_ALLOWED" | "UNAVAILABLE" | "DUPLICATE"; detail: string | null }

export type InvestigationStepSelection = {
  version: typeof INVESTIGATION_STEPS_VERSION
  mode: InvestigationMode
  allowed: InvestigationStep[]
  availability: StepAvailability[]
  selected: InvestigationStep[]
  /** Propósito declarado pela IA para cada passo escolhido (curto; nunca raciocínio livre). */
  purposes: { step: InvestigationStep; purpose: string }[]
  notSelected: InvestigationStep[]
  rejected: RejectedStep[]
  planner: { status: PlannerStatus; agentRunId: string | null; attempts: number; error: string | null }
}

/** Passos implícitos do modo FIXED (a tradução exata das chaves da estratégia — o comportamento do TMA). */
export function fixedStepsOf(input: { segmentationEnabled: boolean; processEnabled: boolean; signalConfigured: boolean }): InvestigationStep[] {
  return INVESTIGATION_STEPS.filter((step) => {
    const requirement = INVESTIGATION_STEP_CATALOG[step].requires
    return requirement === "SEGMENTATION" ? input.segmentationEnabled : requirement === "PROCESS" ? input.processEnabled : input.signalConfigured
  })
}

/** Os passos entre os quais a IA pode escolher: permitidos pela estratégia E disponíveis nos dados (ordem do catálogo). */
export function choosableSteps(allowed: readonly InvestigationStep[], availability: readonly StepAvailability[]): InvestigationStep[] {
  return INVESTIGATION_STEPS.filter((step) => allowed.includes(step) && availability.some((entry) => entry.step === step && entry.available))
}

/**
 * Seleção FINAL (determinística). FIXED: passos das chaves ∩ disponíveis. AGENT_SELECTED: escolha da IA ∩ permitidos ∩
 * disponíveis; sem escolha válida (planner não chamado ou falhou) = todos os permitidos e disponíveis. Tudo fora disso é recusado
 * com motivo — nunca executado.
 */
export function selectInvestigationSteps(input: {
  mode: InvestigationMode
  allowed: readonly InvestigationStep[]
  fixed: readonly InvestigationStep[]
  availability: readonly StepAvailability[]
  choice: readonly StepChoice[] | null
  planner: InvestigationStepSelection["planner"]
}): InvestigationStepSelection {
  const available = (step: InvestigationStep) => input.availability.some((entry) => entry.step === step && entry.available)
  if (input.mode === "FIXED") {
    const selected = input.fixed.filter(available)
    return { version: INVESTIGATION_STEPS_VERSION, mode: "FIXED", allowed: [...input.fixed], availability: [...input.availability], selected, purposes: [], notSelected: input.fixed.filter((step) => !selected.includes(step)), rejected: [], planner: input.planner }
  }
  const choosable = choosableSteps(input.allowed, input.availability)
  const rejected: RejectedStep[] = []
  const purposes: { step: InvestigationStep; purpose: string }[] = []
  let selected: InvestigationStep[]
  if (input.choice) {
    selected = []
    for (const entry of input.choice) {
      const step = (INVESTIGATION_STEPS as readonly string[]).includes(entry.step) ? (entry.step as InvestigationStep) : null
      if (!step) { rejected.push({ step: entry.step.slice(0, 60), reason: "UNKNOWN_STEP", detail: null }); continue }
      if (selected.includes(step)) { rejected.push({ step, reason: "DUPLICATE", detail: null }); continue }
      if (!input.allowed.includes(step)) { rejected.push({ step, reason: "NOT_ALLOWED", detail: null }); continue }
      if (!available(step)) { rejected.push({ step, reason: "UNAVAILABLE", detail: input.availability.find((item) => item.step === step)?.reason ?? null }); continue }
      selected.push(step)
      purposes.push({ step, purpose: entry.purpose.trim().slice(0, 200) })
    }
  } else {
    selected = choosable
  }
  selected = INVESTIGATION_STEPS.filter((step) => selected.includes(step))
  return { version: INVESTIGATION_STEPS_VERSION, mode: "AGENT_SELECTED", allowed: [...input.allowed], availability: [...input.availability], selected, purposes, notSelected: choosable.filter((step) => !selected.includes(step)), rejected, planner: input.planner }
}

// ---------------------------------------------------------------------------------------------
// CONTRATO DO PLANEJADOR (a resposta da IA — só códigos de passo; nenhum campo para id/escopo/número)
// ---------------------------------------------------------------------------------------------

export const INVESTIGATION_PLAN_CONTRACT = "INDICATOR_INVESTIGATION_PLAN_V1" as const
export const investigationPlanOutputSchema = z.object({
  selectedSteps: z.array(z.object({ step: z.string().min(1).max(60), purpose: z.string().max(300) }).strict()).max(INVESTIGATION_STEPS.length * 2),
  notSelected: z.array(z.object({ step: z.string().min(1).max(60), reason: z.string().max(300) }).strict()).max(INVESTIGATION_STEPS.length * 2),
}).strict()

export type InvestigationPlanParse = { ok: true; choice: StepChoice[] } | { ok: false; error: "PLAN_MALFORMED_JSON" | "PLAN_SCHEMA_INVALID"; detail: string | null }

/** Parse ESTRITO (JSON puro): campo desconhecido (ex.: um id de pessoa/equipe) invalida a resposta inteira. */
export function parseInvestigationPlan(text: string): InvestigationPlanParse {
  let json: unknown
  try {
    json = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""))
  } catch (error) {
    return { ok: false, error: "PLAN_MALFORMED_JSON", detail: error instanceof Error ? error.message.slice(0, 200) : null }
  }
  const parsed = investigationPlanOutputSchema.safeParse(json)
  if (!parsed.success) return { ok: false, error: "PLAN_SCHEMA_INVALID", detail: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ").slice(0, 300) }
  return { ok: true, choice: parsed.data.selectedSteps.map((entry) => ({ step: entry.step, purpose: entry.purpose })) }
}

export type PlannerFacts = {
  indicator: { name: string; unit: string; direction: string }
  period: string
  official: { value: string; target: string | null; position: string | null; quartile: string | null; previous: string | null }
  triage: string
  population: { interactions: number; reasons: { label: string; interactions: number; signaled: number | null }[] }
  signal: { label: string; signaled: number; previousSignaled: number | null } | null
}

export const INVESTIGATION_PLANNER_SYSTEM_PROMPT = `Você planeja a investigação de UM indicador de desempenho de um colaborador de atendimento.

Você recebe (1) a ESTRATÉGIA do indicador — objetivo e instruções de investigação escritas pela operação; (2) os PASSOS que a estratégia permite, cada um com a disponibilidade real nos dados; (3) FATOS iniciais já calculados pelo sistema.

Sua tarefa é só ESCOLHER quais passos disponíveis vale executar para responder ao objetivo com evidência. O sistema executa cada passo e calcula todos os números; você não calcula, não conclui e não explica causa.

REGRAS
- Escolha apenas passos marcados como disponíveis. Um passo indisponível nunca pode ser escolhido — nem "adaptado".
- Não invente dados, janelas, vínculos entre atendimentos, pessoas, equipes ou grupos. Comparações com grupo são resolvidas pelo sistema.
- Resultado ruim não obriga a encontrar um problema: se os fatos não pedem investigação adicional, escolha menos passos.
- As instruções da estratégia orientam a escolha, mas nunca autorizam afirmar causa nem pedir dado fora da lista.
- "purpose" e "reason": uma frase curta dizendo para que o passo serve nesta análise (nada de raciocínio longo).

RESPOSTA: apenas um objeto JSON, sem texto antes ou depois:
{"selectedSteps": [{"step": "CODIGO_DO_PASSO", "purpose": "…"}], "notSelected": [{"step": "CODIGO_DO_PASSO", "reason": "…"}]}`

/** Turno do usuário do planejador: estratégia (instruções declaradas como da operação) + passos + fatos. Nenhum id. */
export function renderInvestigationPlannerTurn(input: { objective: string; instructions: string; steps: readonly StepAvailability[]; allowed: readonly InvestigationStep[]; facts: PlannerFacts }): string {
  const steps = input.steps
    .filter((entry) => input.allowed.includes(entry.step))
    .map((entry) => `- ${entry.step} — ${INVESTIGATION_STEP_CATALOG[entry.step].label}: ${INVESTIGATION_STEP_CATALOG[entry.step].description} ${entry.available ? "[DISPONÍVEL]" : `[INDISPONÍVEL: ${STEP_UNAVAILABLE_LABELS[entry.reason!]}]`}`)
  const facts = input.facts
  const reasons = facts.population.reasons.map((reason) => `- ${reason.label}: ${reason.interactions} atendimento(s)${reason.signaled !== null ? `, ${reason.signaled} com o sinal` : ""}`)
  return [
    `${INVESTIGATION_PLAN_CONTRACT}`,
    "",
    "ESTRATÉGIA DO INDICADOR (escrita pela operação):",
    `Objetivo: ${input.objective}`,
    `Instruções de investigação: ${input.instructions}`,
    "",
    "PASSOS PERMITIDOS PELA ESTRATÉGIA:",
    ...steps,
    "",
    "FATOS INICIAIS (calculados pelo sistema):",
    `- Indicador: ${facts.indicator.name} (unidade ${facts.indicator.unit}; sentido ${facts.indicator.direction === "LOWER" ? "quanto menor, melhor" : facts.indicator.direction === "HIGHER" ? "quanto maior, melhor" : "meta como alvo"})`,
    `- Período: ${facts.period}`,
    `- Resultado oficial: ${facts.official.value}${facts.official.target ? `; meta ${facts.official.target}` : ""}${facts.official.position ? ` (${facts.official.position})` : ""}${facts.official.quartile ? `; quartil ${facts.official.quartile}` : ""}${facts.official.previous ? `; período anterior ${facts.official.previous}` : ""}`,
    `- Triagem da estratégia: ${facts.triage}`,
    `- Atendimentos do colaborador no período: ${facts.population.interactions}`,
    ...(facts.signal ? [`- Interações com o sinal "${facts.signal.label}": ${facts.signal.signaled}${facts.signal.previousSignaled !== null ? ` (período anterior: ${facts.signal.previousSignaled})` : ""}`] : []),
    ...(reasons.length > 0 ? ["- Atendimentos por motivo:", ...reasons] : []),
  ].join("\n")
}
