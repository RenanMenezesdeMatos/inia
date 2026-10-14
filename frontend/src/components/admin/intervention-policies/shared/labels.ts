import type { CompetencyActivity, PolicyAction, PolicyCondition, PolicyDefinition, PolicyView } from "@/schemas/admin/intervention-policy.schema"
import type { FormField } from "@/schemas/interventions/intervention.schema"

/**
 * Rótulos de negócio da administração de políticas de acompanhamento. Nenhum código cru aparece na tela: tudo que vem do
 * contrato (`*_V1`) passa por aqui. O backend continua a autoridade dos valores aceitos.
 */
export const SCOPE_TYPE_LABELS: Record<PolicyView["scopeType"], string> = { ORGANIZATION: "Organização inteira", GROUP: "Um grupo", SUBGROUP: "Um subgrupo" }

export const MATCH_STRATEGY_LABELS: Record<PolicyDefinition["matchStrategy"], { title: string; description: string }> = {
  FIRST_MATCH: { title: "Vale a primeira regra atendida pela prioridade", description: "Só a regra atendida de maior prioridade decide as ações." },
  ALL_MATCHES: { title: "Valem todas as regras atendidas", description: "Cada regra atendida aplica as próprias ações (tipos incompatíveis entre si viram conflito, e nada é aplicado)." },
}

export const ACTION_EFFECT_LABELS: Record<PolicyAction["effect"], string> = { RECOMMEND: "Recomendar ao responsável", OPEN: "Abrir" }
export const ACTION_EFFECT_HINTS: Record<PolicyAction["effect"], string> = {
  RECOMMEND: "Nasce como proposta: o responsável aceita ou descarta.",
  OPEN: "Nasce pronta para execução (ou aguardando aprovação, quando o tipo exige).",
}
export const ON_ACTIVE_LABELS: Record<PolicyAction["onActive"], string> = { KEEP: "Manter a ativa", UPDATE: "Registrar novo sinal na ativa" }

export type ConditionKind = PolicyCondition["kind"]
export const CONDITION_KINDS: ConditionKind[] = ["INDICATOR", "INTERACTION_FLAG", "EMPLOYMENT", "PRIOR_INTERVENTIONS", "TIME_SINCE_INTERVENTION", "SUPPORTED_DIAGNOSIS", "PUBLISHED_FEEDBACK"]
export const CONDITION_KIND_LABELS: Record<ConditionKind, string> = {
  INDICATOR: "Indicador",
  INTERACTION_FLAG: "Flag de atendimento",
  EMPLOYMENT: "Situação funcional e disponibilidade",
  PRIOR_INTERVENTIONS: "Intervenções anteriores",
  TIME_SINCE_INTERVENTION: "Tempo desde a última intervenção",
  SUPPORTED_DIAGNOSIS: "Diagnóstico sustentado",
  PUBLISHED_FEEDBACK: "Feedbacks publicados",
}

export const GROUP_OPERATOR_LABELS: Record<"ALL" | "ANY", string> = { ALL: "Atender todas as condições", ANY: "Atender qualquer uma das condições" }

export const PRIOR_STATUS_LABELS: Record<"ACTIVE" | "COMPLETED" | "CANCELLED", string> = { ACTIVE: "Em andamento", COMPLETED: "Concluídas", CANCELLED: "Canceladas" }
export const OPERATIONAL_RESULT_LABELS: Record<"IMPROVED" | "UNCHANGED" | "WORSENED" | "NOT_MEASURED", string> = { IMPROVED: "Melhorou", UNCHANGED: "Não mudou", WORSENED: "Piorou", NOT_MEASURED: "Não medido" }
export const INTERVENTION_EVENT_LABELS: Record<"OPENED" | "COMPLETED", string> = { OPENED: "Desde a abertura", COMPLETED: "Desde a conclusão" }
export const WHEN_NONE_LABELS: Record<"MET" | "NOT_MET", string> = { MET: "Considerar a condição atendida", NOT_MET: "Considerar a condição não atendida" }
export const DIAGNOSIS_EXPECTATION_LABELS: Record<"EXISTS" | "NOT_EXISTS", string> = { EXISTS: "Existe diagnóstico sustentado", NOT_EXISTS: "Não existe diagnóstico sustentado" }
export const FLAG_MEASURE_LABELS: Record<"COUNT" | "PERCENT", string> = { COUNT: "Quantidade de atendimentos", PERCENT: "Percentual dos atendimentos" }
export const FEEDBACK_KIND_LABELS: Record<"INDICATOR" | "MONITORING", string> = { INDICATOR: "De indicador", MONITORING: "De monitoria" }

/** Fontes de histórico aceitas numa política — o quartil OPERACIONAL não existe aqui (depende da população de um Workflow). */
export const POLICY_HISTORICAL_SOURCES = ["MEASUREMENT", "INDICATOR_ACHIEVEMENT", "PRV_ACHIEVEMENT"] as const
export type PolicyHistoricalSource = (typeof POLICY_HISTORICAL_SOURCES)[number]
export const POLICY_HISTORICAL_SOURCE_LABELS: Record<PolicyHistoricalSource, string> = {
  MEASUREMENT: "Medição diária",
  INDICATOR_ACHIEVEMENT: "Atingimento oficial do indicador",
  PRV_ACHIEVEMENT: "Atingimento oficial do PRV",
}

export const QUARTILES = ["Q1", "Q2", "Q3", "Q4"] as const
export const QUARTILE_LABELS: Record<(typeof QUARTILES)[number], string> = { Q1: "Q1 — melhor quartil", Q2: "Q2", Q3: "Q3", Q4: "Q4 — pior quartil" }

export const FORM_FIELD_KIND_LABELS: Record<FormField["kind"], string> = { TEXT: "Texto curto", LONG_TEXT: "Texto longo", NUMBER: "Número", DATE: "Data", SELECT: "Lista de opções", BOOLEAN: "Sim ou não" }
export const ACTIVITY_KIND_LABELS: Record<CompetencyActivity["kind"], string> = { STUDY: "Estudo", PRACTICE: "Prática", SHADOWING: "Acompanhar um colega", ROLE_PLAY: "Simulação", ASSESSMENT: "Avaliação", OTHER: "Outra" }

export const COMPLETION_LABELS: Record<"requireAllTasksDone" | "requireLearningAssessment" | "requireOperationalReading" | "requireOutcomeNote", { title: string; description: string }> = {
  requireAllTasksDone: { title: "Todas as tarefas concluídas", description: "Só conclui com todas as tarefas feitas ou justificadas (exige a capacidade Tarefas)." },
  requireLearningAssessment: { title: "Avaliação de aprendizagem", description: "Exige registrar a avaliação de aprendizagem (exige a capacidade Treinamento)." },
  requireOperationalReading: { title: "Leitura do resultado operacional", description: "Exige registrar se o indicador melhorou, não mudou ou piorou." },
  requireOutcomeNote: { title: "Nota de encerramento", description: "Exige um texto de quem encerra explicando o resultado." },
}

export const SIMULATION_MODE_LABELS: Record<"RECOMMEND_ONLY" | "APPLY_POLICY", { title: string; description: string }> = {
  RECOMMEND_ONLY: { title: "Somente recomendar", description: "Toda ação aparece como recomendação ao responsável." },
  APPLY_POLICY: { title: "Abrir conforme a política", description: "Cada ação segue o efeito da regra (abrir ou recomendar)." },
}

export const EVALUATION_ORIGIN_LABELS: Record<string, string> = { WORKFLOW: "Workflow", MANUAL: "Manual", REEVALUATION: "Reavaliação" }

export const AUDIT_ENTITY_LABELS: Record<string, string> = { intervention_type: "Tipo de intervenção", intervention_policy: "Política", competency: "Competência" }
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  INTERVENTION_TYPE_CREATED: "Tipo de intervenção criado",
  INTERVENTION_TYPE_DRAFT_SAVED: "Rascunho do tipo salvo",
  INTERVENTION_TYPE_PUBLISHED: "Tipo publicado",
  INTERVENTION_TYPE_DRAFT_DISCARDED: "Rascunho do tipo descartado",
  INTERVENTION_TYPE_ACTIVATED: "Tipo ativado",
  INTERVENTION_TYPE_DEACTIVATED: "Tipo desativado",
  COMPETENCY_CREATED: "Competência criada",
  COMPETENCY_UPDATED: "Competência atualizada",
  COMPETENCY_ACTIVATED: "Competência ativada",
  COMPETENCY_DEACTIVATED: "Competência desativada",
  INTERVENTION_POLICY_CREATED: "Política criada",
  INTERVENTION_POLICY_UPDATED: "Política atualizada",
  INTERVENTION_POLICY_DRAFT_SAVED: "Rascunho da política salvo",
  INTERVENTION_POLICY_PUBLISHED: "Versão da política publicada",
  INTERVENTION_POLICY_DRAFT_DISCARDED: "Rascunho da política descartado",
  INTERVENTION_POLICY_ACTIVATED: "Política ativada",
  INTERVENTION_POLICY_DEACTIVATED: "Política desativada",
}
export const auditActionLabel = (action: string) => AUDIT_ACTION_LABELS[action] ?? "Alteração de configuração"
