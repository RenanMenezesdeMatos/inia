/**
 * CAPACIDADES TÉCNICAS das intervenções — a única parte "fixa" do catálogo. O TIPO de intervenção (observar, orientar, treinar,
 * plano de ação, revisão pela liderança…) é dado administrável (`intervention_types`); cada tipo declara QUAIS capacidades usa, e
 * cada capacidade traz a sua validação aqui, em código. Nenhum módulo conhece tipos de negócio: só capacidades.
 */
export const INTERVENTION_CAPABILITIES = [
  "TASKS",
  "CHECKPOINTS",
  "TRAINING",
  "ACTION_PLAN",
  "GUIDANCE",
  "OBSERVATION",
  "DATA_REVIEW",
  "LEADERSHIP_REVIEW",
  "RECOGNITION",
  "CONTINUITY_REVIEW",
] as const
export type InterventionCapability = (typeof INTERVENTION_CAPABILITIES)[number]

export type CapabilityDefinition = {
  label: string
  description: string
  /** Pode ser aberta quando a regra é INCONCLUSIVA (dados insuficientes): só capacidades que não classificam o colaborador. */
  allowedOnInconclusive: boolean
  /** Afirma algo sobre a competência do colaborador (lacuna de habilidade) — exige diagnóstico sustentado na regra. */
  assertsSkillGap: boolean
  /** Capacidades que esta implica (o formulário e a validação passam a exigir também as delas). */
  implies: readonly InterventionCapability[]
}

export const CAPABILITY_DEFINITIONS: Record<InterventionCapability, CapabilityDefinition> = {
  TASKS: { label: "Tarefas", description: "Lista de tarefas com responsável e prazo.", allowedOnInconclusive: false, assertsSkillGap: false, implies: [] },
  CHECKPOINTS: { label: "Checkpoints", description: "Pontos de verificação datados com a leitura registrada em cada um.", allowedOnInconclusive: true, assertsSkillGap: false, implies: [] },
  TRAINING: {
    label: "Treinamento",
    description: "Objetivo, conteúdos aprovados da base de conhecimento, atividades, prazo e avaliação de aprendizagem — ligado a uma competência.",
    allowedOnInconclusive: false,
    assertsSkillGap: true,
    implies: [],
  },
  ACTION_PLAN: {
    label: "Plano de ação",
    description: "Situação inicial, objetivo mensurável, tarefas, responsáveis, apoio necessário, checkpoints e critério de encerramento.",
    allowedOnInconclusive: false,
    assertsSkillGap: false,
    implies: ["TASKS", "CHECKPOINTS"],
  },
  GUIDANCE: { label: "Orientação", description: "Registro do que foi orientado, quando e com quais referências da base.", allowedOnInconclusive: false, assertsSkillGap: false, implies: [] },
  OBSERVATION: { label: "Observação", description: "Foco e período de observação, sem cobrança do colaborador.", allowedOnInconclusive: true, assertsSkillGap: false, implies: [] },
  DATA_REVIEW: {
    label: "Revisão de dados / investigação",
    description: "Investigar a qualidade ou a ausência dos dados antes de qualquer conclusão sobre o colaborador.",
    allowedOnInconclusive: true,
    assertsSkillGap: false,
    implies: [],
  },
  LEADERSHIP_REVIEW: { label: "Revisão pela liderança", description: "A liderança analisa o caso e registra um parecer.", allowedOnInconclusive: true, assertsSkillGap: false, implies: [] },
  RECOGNITION: { label: "Reconhecimento", description: "Elogio ou reconhecimento de um bom resultado.", allowedOnInconclusive: false, assertsSkillGap: false, implies: [] },
  CONTINUITY_REVIEW: {
    label: "Solicitar avaliação de continuidade",
    description:
      "Processo humano restrito: pede a uma pessoa autorizada que avalie a continuidade, com evidências e justificativa. Nunca decide, aprova ou altera a situação funcional.",
    allowedOnInconclusive: false,
    assertsSkillGap: false,
    implies: [],
  },
}

/** Capacidades efetivas (com as implicadas), sem repetição e na ordem do catálogo. */
export function effectiveCapabilities(capabilities: readonly InterventionCapability[]): InterventionCapability[] {
  const set = new Set<InterventionCapability>()
  for (const capability of capabilities) {
    set.add(capability)
    for (const implied of CAPABILITY_DEFINITIONS[capability].implies) set.add(implied)
  }
  return INTERVENTION_CAPABILITIES.filter((capability) => set.has(capability))
}

/** Tipos de evidência aceitos numa intervenção — todos apontam para uma fonte verificável (texto de IA nunca é evidência). */
export const EVIDENCE_KINDS = ["EVALUATION", "FEEDBACK", "DIAGNOSIS", "INTERACTION", "INDICATOR_RESULT", "CASE_EVIDENCE"] as const
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  EVALUATION: "Avaliação da política",
  FEEDBACK: "Feedback publicado",
  DIAGNOSIS: "Diagnóstico sustentado",
  INTERACTION: "Atendimento",
  INDICATOR_RESULT: "Resultado de indicador",
  CASE_EVIDENCE: "Evidência do caso",
}
