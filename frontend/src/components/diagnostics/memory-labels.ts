/** Rótulos pt-BR da memória de diagnóstico (fonte única da tela). */
export const STATUS_LABELS: Record<string, string> = {
  MET: "Cumprido",
  NOT_MET: "Não cumprido",
  PARTIAL: "Parcial",
  NOT_OBSERVABLE: "Não observável",
  NOT_APPLICABLE: "Não se aplica",
  NOT_ASSESSED: "Não avaliado",
}
export const STATUS_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = { MET: "secondary", NOT_MET: "destructive", PARTIAL: "destructive", NOT_OBSERVABLE: "outline", NOT_APPLICABLE: "outline", NOT_ASSESSED: "outline" }
export const PATH_LABELS: Record<string, string> = {
  CORRECT: "Caminho correto para o cenário",
  INCORRECT: "Caminho inadequado para o cenário",
  PARTIALLY_CORRECT: "Caminho certo, com etapas faltando",
  UNDETERMINED: "Caminho não determinado",
  NO_PROCEDURE: "Sem procedimento aplicável",
}
export const OUTCOME_LABELS: Record<string, string> = { USABLE: "Análise completa", PARTIAL: "Análise parcial", INSUFFICIENT_EVIDENCE: "Evidência insuficiente" }
export const CONCLUSION_LABELS: Record<string, string> = {
  PATTERN_SUPPORTED: "Padrão sustentado nas chamadas",
  STRENGTH_PATTERN: "Prática consistente a preservar",
  RESULT_RECOGNITION: "Resultado a reconhecer",
  CHANGE_LOCATED_NO_CAUSE: "Mudança localizada, sem causa sustentada",
  CHANGE_LOCATED_NOT_EXAMINED: "Mudança localizada, chamadas não examinadas",
  MIX_EFFECT: "Variação explicada pelo mix de assuntos",
  INSUFFICIENT_DATA: "Dados insuficientes",
}
export const FOCUS_LABELS: Record<string, string> = { DETERIORATED: "piorou", HIDDEN_DETERIORATION: "piorou (resultado geral melhor)", IMPROVED: "melhorou" }
export const REFERENCE_BASIS_LABELS: Record<string, string> = { SUBJECT_METRIC: "melhores no mesmo assunto e período", OVERALL_INDICATOR: "melhores no indicador geral (não por assunto)", UNAVAILABLE: "sem grupo comparável" }
export const EVIDENCE_KIND_LABELS: Record<string, string> = { CONDUCT_OBSERVED: "Conduta na conversa", DECLARED_ACTION: "Ação declarada pelo operador (sistema não verificável)", OMISSION: "Ausência verificada na conversa", COMPLIANCE_BY_ABSENCE: "Proibição respeitada (conversa inteira)", CUSTOMER_CONTEXT: "Contexto do cliente", NONE: "Sem evidência individual" }
export const SPEAKER_LABELS: Record<string, string> = { OPERADOR: "Operador", CLIENTE: "Cliente", EVENTO: "Evento", SISTEMA: "Sistema", URA: "URA" }
export const percent = (value: number | null) => (value === null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`)
export const shortDate = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/")
