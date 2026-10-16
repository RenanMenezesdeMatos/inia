import type { Domain } from "../indicator-catalog.js"
import type { Gender } from "../names.js"
import type { Random } from "../random.js"

export type Speaker = "Operador" | "Cliente"
export type Turn = { speaker: Speaker; text: string }

export type TranscriptLength = "CURTA" | "MEDIA" | "LONGA"
export const LENGTH_TURN_RANGE: Record<TranscriptLength, { min: number; max: number }> = {
  CURTA: { min: 15, max: 40 },
  MEDIA: { min: 41, max: 100 },
  LONGA: { min: 101, max: 170 },
}

/** Tom do cliente — só narrativa; o domínio não persiste "sentimento". */
export type CustomerTone = "SATISFEITO" | "NEUTRO" | "FRUSTRADO" | "IRRITADO_DEPOIS_SATISFEITO" | "INSATISFEITO_FINAL"

export type Outcome = "RESOLVIDO" | "PARCIAL" | "TRANSFERIDO" | "RETORNO_PROMETIDO" | "NAO_RESOLVIDO"

/** Falhas operacionais APARENTES e auditáveis na transcrição. */
export type OperationalFailure =
  | "SEM_CONFIRMACAO_ENTENDIMENTO"
  | "EXPLICACAO_INCOMPLETA"
  | "INFORMACAO_DIVERGENTE"
  | "TRANSFERENCIA_PREMATURA"
  | "SEM_ENCERRAMENTO"
  | "SEM_ALTERNATIVA"
  | "PROCEDIMENTO_INTERROMPIDO"
  | "RETORNO_SEM_CONTEXTO"

/** A transcrição NÃO permite confirmar uma etapa (≠ falha). */
export type InconclusiveKind = "INICIO_SEM_AUDIO" | "TRECHO_INAUDIVEL" | "GRAVACAO_INTERROMPIDA"

export type ScenarioKey =
  | "DUVIDA_FATURA"
  | "CONTESTACAO_COBRANCA"
  | "SEGUNDA_VIA"
  | "ALTERACAO_VENCIMENTO"
  | "NEGOCIACAO_DEBITO"
  | "SUPORTE_LENTIDAO"
  | "SUPORTE_QUEDA_CONEXAO"
  | "SUPORTE_SEM_SINAL"
  | "SUPORTE_APP"
  | "CANCELAMENTO"
  | "RETENCAO_OFERTA"
  | "MUDANCA_PLANO"
  | "INFORMACAO_GERAL"
  | "RECLAMACAO"
  | "ALTERACAO_CADASTRAL"

/** Tudo que a composição decide ANTES de escrever falas — é o "roteiro" da chamada. */
export type CallPlan = {
  scenario: ScenarioKey
  /** Segundo assunto (chamadas multidomínio, só LONGA). */
  secondaryScenario: ScenarioKey | null
  length: TranscriptLength
  tone: CustomerTone
  outcome: Outcome
  failures: OperationalFailure[]
  inconclusive: InconclusiveKind | null
  /** Cliente já havia ligado sobre o mesmo motivo. */
  isRecall: boolean
  /** Cliente respondeu a pesquisa da URA (nota 1–5). */
  surveyScore: number | null
  /** Segundos totais de espera ("um momento…") narrados na chamada. */
  holdSeconds: number
  /** Formato sem rótulos Operador:/Cliente: (fallback textual do QA). */
  plainFormat: boolean
}

export type CallContext = {
  random: Random
  operatorFirstName: string
  operatorGender: Gender
  customerFirstName: string
  customerSurname: string
  customerGender: Gender
  segment: "B2C" | "B2B"
  domain: Domain
  companyName: string | null
  plan: string
  amount: string
  extraAmount: string
  dueDay: number
  protocol: string
  city: string
  monthName: string
  /** Variante fixa da chamada (0..5) — escolhas que precisam bater entre abertura/resumo/blocos. */
  variant: number
}

export type ComposedTranscript = {
  turns: Turn[]
  content: string
  /** Frase específica do assunto (submotivo na massa) — "X e y" em chamadas multidomínio, "(rechamada)" em rechamadas. */
  reason: string
  /** Motivo genérico do cenário principal (`ScenarioSpec.motive`). */
  motive: string
  plan: CallPlan
  /** Flags semânticas que a transcrição SUSTENTA (nome da flag → valor). */
  flags: Record<string, boolean | number>
  durationSeconds: number
}
