import type { RawCheckpoint, RawProcessAssessment } from "../../agents/domain/process-assessment-contract.js"
import type { PresentedKnowledgeExcerpt, PublishedKnowledgeDocument } from "../domain/process-assessment.js"

/**
 * V1.7.1 — FIXTURE ESTRUTURAL do smoke real da V1.7.0 (Workflow "Monitoria · Contestação de conta"), sem dados pessoais: sem
 * nome, CPF, data de nascimento nem número de protocolo; a base é um recorte literal do "Procedimento Operacional —
 * Contestação de Contas Móvel" (§6, §15 e §35). Etapas do smoke: identificar a cobrança (seguida), registrar a contestação
 * (declarada), explicar prazo (omissão), registrar protocolo (seguida, regra só literal), bloqueio preventivo (condicional).
 * A orientação do especialista traz o exemplo do §48 da base ("…protocolo é 202609130184") — o mesmo tipo de conteúdo que no
 * smoke apareceu na orientação e nunca pode virar evidência nem texto do feedback.
 */
export const SMOKE_ORG = "00000000-0000-4000-8000-000000000001"
export const SMOKE_OPERATOR = "11111111-1111-4111-8111-111111111111"
export const SMOKE_INTERACTION = "22222222-2222-4222-8222-222222222222"
export const SMOKE_DOC = "c8f2c818-72db-48dc-8d7d-d8a9fe861c65"
export const SMOKE_DOC_TITLE = "Procedimento Operacional — Contestação de Contas Móvel"
export const SMOKE_LABEL = "Atendimento de 25/09/2026 · Contestação de cobrança"
export const SMOKE_KB_EXAMPLE_PROTOCOL = "202609130184"

export const SMOKE_LINES = {
  identify: "Perfeito, cadastro confirmado. Qual cobrança a senhora não reconhece?",
  register: "Entendi. Vou registrar a contestação desse valor e já vou cancelar o serviço para não vir de novo na próxima conta.",
  analysis: "A área responsável analisa a contestação e, sendo procedente, o valor vem como crédito na próxima conta.",
  protocol: "O serviço já foi cancelado. O protocolo da contestação foi enviado por SMS.",
} as const

export const smokeTranscript = (overrides: { analysis?: string; tail?: string[] | null } = {}) =>
  [
    "Operador: Boa tarde! Em que posso ajudar?",
    "Cliente: Boa tarde. Eu quero contestar uma cobrança da minha conta do celular.",
    "Operador: Claro. Vou confirmar o cadastro do titular.",
    "Cliente: Pode confirmar.",
    `Operador: ${SMOKE_LINES.identify}`,
    "Cliente: Veio um tal de serviço de conteúdo de R$ 19,90 que eu nunca contratei.",
    "Operador: Deixa eu abrir a conta aqui com a senhora. Esse valor é de um serviço adicional ativado no dia 3 deste mês.",
    "Cliente: Eu não ativei nada. Nem sei o que é isso.",
    `Operador: ${SMOKE_LINES.register}`,
    "Cliente: E o dinheiro, eu recebo de volta?",
    ...(overrides.tail === null
      ? []
      : overrides.tail ?? [
          `Operador: ${overrides.analysis ?? SMOKE_LINES.analysis}`,
          "Cliente: Tá bom.",
          `Operador: ${SMOKE_LINES.protocol}`,
          "Cliente: Obrigada.",
          "Operador: A Conecta agradece a sua ligação. Tenha uma boa tarde!",
        ]),
  ].join("\n")

const IDENTIFY = ["## 6. Escuta e identificação da solicitação", "", "O operador deverá permitir que o cliente explique:", "", "- Qual conta está questionando;", "- Qual cobrança não reconhece;", "- Qual valor esperava;"].join("\n")
const DIGITAL = [
  "## 15. Serviços digitais não reconhecidos",
  "",
  "Se o cliente não reconhecer:",
  "",
  "1. Cancelar a recorrência, quando permitido;",
  "2. Registrar contestação;",
  "3. Analisar valores atuais e anteriores elegíveis;",
  "4. Ativar bloqueio preventivo, se disponível e autorizado;",
  "5. Explicar prazo;",
  "6. Orientar sobre conta ajustada;",
  "7. Registrar protocolo.",
].join("\n")
export const SMOKE_DETAIL = "O operador deverá informar o prazo exibido na ferramenta."
export const SMOKE_DETAIL_EXAMPLE = "A contestação foi registrada hoje e será analisada em até cinco dias úteis."
const DEADLINE = ["## 35. Prazo da análise", "", SMOKE_DETAIL, "", "Sempre informar prazo de forma objetiva:", "", `“${SMOKE_DETAIL_EXAMPLE} O retorno será enviado por SMS.”`].join("\n")

export const SMOKE_CONTENT = [`# ${SMOKE_DOC_TITLE}`, "", IDENTIFY, "", DIGITAL, "", DEADLINE].join("\n")
export const smokePublished = new Map<string, PublishedKnowledgeDocument>([[SMOKE_DOC, { documentId: SMOKE_DOC, title: SMOKE_DOC_TITLE, content: SMOKE_CONTENT, version: 1 }]])
export const smokePresented: PresentedKnowledgeExcerpt[] = [
  { documentId: SMOKE_DOC, documentTitle: SMOKE_DOC_TITLE, heading: "6. Escuta e identificação da solicitação", excerpt: IDENTIFY },
  { documentId: SMOKE_DOC, documentTitle: SMOKE_DOC_TITLE, heading: "15. Serviços digitais não reconhecidos", excerpt: DIGITAL },
  { documentId: SMOKE_DOC, documentTitle: SMOKE_DOC_TITLE, heading: "35. Prazo da análise", excerpt: DEADLINE },
]

const step = (overrides: Partial<RawCheckpoint> & Pick<RawCheckpoint, "requirement" | "status">): RawCheckpoint => ({
  evidenceType: "OBSERVED",
  transcriptEvidence: [],
  knowledgeQuote: null,
  knowledgeDetailQuote: null,
  guidance: { source: "OFFICIAL_PROCEDURE", text: null },
  uncertainty: null,
  ...overrides,
})

export const SMOKE_CHECKPOINTS = {
  identify: step({ requirement: "Qual cobrança não reconhece", status: "FOLLOWED", transcriptEvidence: [SMOKE_LINES.identify], knowledgeQuote: "Qual cobrança não reconhece;" }),
  register: step({ requirement: "Registrar contestação", status: "FOLLOWED", transcriptEvidence: [SMOKE_LINES.register], knowledgeQuote: "Registrar contestação;" }),
  deadline: step({
    requirement: "Explicar prazo",
    status: "NOT_FOLLOWED",
    evidenceType: "OMISSION",
    transcriptEvidence: [SMOKE_LINES.analysis],
    knowledgeQuote: "Explicar prazo;",
    knowledgeDetailQuote: SMOKE_DETAIL,
    guidance: { source: "OFFICIAL_PROCEDURE", text: `Informe o prazo: “A contestação foi registrada e será analisada no prazo informado. O retorno será enviado por SMS. Seu protocolo é ${SMOKE_KB_EXAMPLE_PROTOCOL}.”` },
  }),
  protocol: step({ requirement: "Registrar protocolo", status: "FOLLOWED", transcriptEvidence: [SMOKE_LINES.protocol], knowledgeQuote: "Registrar protocolo." }),
  block: step({ requirement: "Ativar bloqueio preventivo, se disponível e autorizado", status: "NOT_APPLICABLE", knowledgeQuote: "Ativar bloqueio preventivo, se disponível e autorizado;" }),
}

export const smokeAssessment = (checkpoints: RawCheckpoint[] = Object.values(SMOKE_CHECKPOINTS)): RawProcessAssessment => ({ processes: [{ documentTitle: SMOKE_DOC_TITLE, checkpoints }] })
