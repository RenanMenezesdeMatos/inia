/**
 * V1.7.1c (§25) — o smoke real da V1.7.1b reproduzido pela ESTRUTURA: a chamada de contestação de um pacote de internet
 * (mesma transcrição sintética do smoke), o procedimento apresentado com a checklist de 20 itens e uma resposta de
 * especialista com mais de 12 etapas, cada status com o evidenceType da matriz e campos opcionais vazios. Sem modelo.
 */
export const V171B_DOC_TITLE = "Procedimento Operacional — Contestação de Contas Móvel"

export const V171B_LINES = {
  validate: "Entendi, Márcio, vou te ajudar a ver isso. Antes eu preciso confirmar alguns dados. Pode me informar os três últimos dígitos do CPF do titular?",
  account: "Obrigada, dados confirmados. Qual conta você está questionando e o que veio diferente nela?",
  charge: "Deixa eu abrir a conta aqui. Na conta de setembro aparece um pacote de internet extra de 5 giga, de R$ 24,90, ativado no dia 18 de agosto.",
  previous: "Olhando as duas contas anteriores, esse pacote não aparece, só nessa de setembro mesmo. E essa conta de setembro, você já pagou?",
  register: "Certo. Então eu vou registrar a contestação desse pacote para a área de faturamento analisar.",
  authorize: "Eu consigo cancelar a renovação dele agora. Você autoriza o cancelamento?",
  cancelled: "Pronto, a renovação do pacote foi cancelada.",
  whatToPay: "Isso vai depender da análise, o pessoal vai verificar e te dá um retorno.",
  deadline: "Aí é só aguardar, o pessoal do setor vai olhar e logo resolve.",
  protocol: "O protocolo do seu atendimento é 2026 0925 7713.",
  closing: "É só isso?",
} as const

export const V171B_TRANSCRIPT = [
  "Operador: Conecta, boa tarde! Meu nome é Larissa. Com quem eu falo?",
  "Cliente: Boa tarde, Larissa. Aqui é o Márcio, sou o titular da linha. Minha conta desse mês veio mais cara e eu não sei de onde saiu essa diferença.",
  `Operador: ${V171B_LINES.validate}`,
  "Cliente: 307.",
  "Operador: E a data de nascimento, por favor?",
  "Cliente: 22 de julho de 1979.",
  `Operador: ${V171B_LINES.account}`,
  "Cliente: A de setembro. Normalmente vem uns 79 reais e dessa vez veio 104 e pouco.",
  `Operador: ${V171B_LINES.charge}`,
  "Cliente: Eu não ativei pacote nenhum. Nem sabia que existia isso.",
  `Operador: ${V171B_LINES.previous}`,
  "Cliente: Ainda não, ela vence dia 5.",
  `Operador: ${V171B_LINES.register}`,
  "Cliente: E esse pacote vai continuar vindo nas próximas contas?",
  `Operador: ${V171B_LINES.authorize}`,
  "Cliente: Autorizo, pode cancelar.",
  `Operador: ${V171B_LINES.cancelled}`,
  "Cliente: E aí, eu pago o quê? A conta inteira?",
  `Operador: ${V171B_LINES.whatToPay}`,
  "Cliente: E demora quanto tempo pra ter esse retorno?",
  `Operador: ${V171B_LINES.deadline}`,
  "Cliente: Tá bom então.",
  `Operador: ${V171B_LINES.protocol}`,
  "Cliente: Só um minuto... anotei.",
  `Operador: ${V171B_LINES.closing}`,
  "Cliente: É, só isso.",
  "Operador: Obrigada por ligar, Márcio. Tenha uma boa tarde!",
].join("\n")

export const V171B_CHECKLIST_ITEMS = [
  "Ouvi a contestação completa?", "Validei o titular?", "Confirmei a conta questionada?", "Identifiquei lançamento, valor e período?", "Verifiquei se a conta foi paga?",
  "Comparei contas anteriores?", "Consultei alterações e contratações?", "Expliquei a composição?", "Identifiquei possível fraude?", "Cancelei eventual recorrência indevida?",
  "Solicitei autorização para bloqueios?", "Apliquei ajuste dentro da alçada?", "Abri análise quando necessário?", "Informei o valor não contestado?", "Emissão de conta ajustada foi avaliada?",
  "Informei prazo e canal de retorno?", "Registrei todos os fatos?", "Forneci protocolo?", "Recapitulei as ações?", "Confirmei se restaram dúvidas?",
] as const
const CHECKLIST = ["## 55. Checklist do operador", "", "Antes de finalizar:", "", ...V171B_CHECKLIST_ITEMS.map((item) => `- [ ] ${item}`)].join("\n")
const DEADLINE = ["## 35. Prazo da análise", "", "O operador deverá informar o prazo exibido na ferramenta.", "", "Evitar:", "", "- “É só aguardar.”", "- “Logo será resolvido.”"].join("\n")

export const V171B_PRESENTED = [
  { documentId: "c8f2c818-72db-48dc-8d7d-d8a9fe861c65", documentTitle: V171B_DOC_TITLE, heading: "55. Checklist do operador", excerpt: CHECKLIST },
  { documentId: "c8f2c818-72db-48dc-8d7d-d8a9fe861c65", documentTitle: V171B_DOC_TITLE, heading: "35. Prazo da análise", excerpt: DEADLINE },
]

type Step = { requirement: string; status: string; evidenceType?: string | null; transcriptEvidence?: string[]; knowledgeQuote?: string | null; knowledgeDetailQuote?: string | null; guidance?: { source: string; text: string | null }; uncertainty?: string | null }
const step = (item: (typeof V171B_CHECKLIST_ITEMS)[number], status: string, evidenceType: string | null, lines: string[], extra: Partial<Step> = {}): Step => ({
  requirement: item.replace(/\?$/, ""),
  status,
  evidenceType,
  transcriptEvidence: lines.map((line) => `Operador: ${line}`),
  knowledgeQuote: `${item}`,
  knowledgeDetailQuote: null,
  guidance: { source: "OFFICIAL_PROCEDURE", text: null },
  uncertainty: null,
  ...extra,
})

/** 14 etapas, como um especialista que avalia a checklist inteira: cumpridas, não cumpridas (ação e omissão), não observáveis
 * e não aplicáveis — com o evidenceType da matriz e campos opcionais que chegam como "" (o modelo às vezes escreve assim). */
export const V171B_STEPS: Step[] = [
  step("Validei o titular?", "FOLLOWED", "OBSERVED", [V171B_LINES.validate]),
  step("Confirmei a conta questionada?", "FOLLOWED", "OBSERVED", [V171B_LINES.account]),
  step("Identifiquei lançamento, valor e período?", "FOLLOWED", "OBSERVED", [V171B_LINES.charge]),
  step("Verifiquei se a conta foi paga?", "FOLLOWED", "OBSERVED", [V171B_LINES.previous]),
  step("Comparei contas anteriores?", "FOLLOWED", "OBSERVED", [V171B_LINES.previous], { uncertainty: "" }),
  step("Cancelei eventual recorrência indevida?", "FOLLOWED", "OBSERVED", [V171B_LINES.cancelled]),
  step("Solicitei autorização para bloqueios?", "FOLLOWED", "OBSERVED", [V171B_LINES.authorize], { knowledgeDetailQuote: "" }),
  step("Abri análise quando necessário?", "FOLLOWED", "OBSERVED", [V171B_LINES.register]),
  step("Informei o valor não contestado?", "NOT_FOLLOWED", "OBSERVED", [V171B_LINES.whatToPay]),
  step("Informei prazo e canal de retorno?", "NOT_FOLLOWED", "OBSERVED", [V171B_LINES.deadline], { knowledgeDetailQuote: "O operador deverá informar o prazo exibido na ferramenta.", guidance: { source: "OFFICIAL_PROCEDURE", text: "Informe o prazo exibido na ferramenta." } }),
  step("Forneci protocolo?", "FOLLOWED", "OBSERVED", [V171B_LINES.protocol]),
  step("Recapitulei as ações?", "NOT_FOLLOWED", "OMISSION", [V171B_LINES.closing]),
  step("Identifiquei possível fraude?", "NOT_OBSERVABLE", null, [], { uncertainty: "A conversa não mostra se houve verificação de fraude." }),
  step("Apliquei ajuste dentro da alçada?", "NOT_APPLICABLE", null, [], { guidance: { source: "NO_GROUNDED_GUIDANCE", text: "" } }),
]

/** Resposta do especialista (JSON do contrato FEEDBACK + processAssessment), no formato que o modelo devolve. */
/** Monitoring Architecture V2 — a resposta histórica é anterior ao `conductEvidence`; o contrato V5 o exige em FOLLOWED/NOT_FOLLOWED.
 * Para exercitar o parser de produção (V5) com a mesma avaliação, a relação declarada é a que a matriz pede. */
export function withDeclaredConduct<T extends { status: string }>(steps: readonly T[]): T[] {
  return steps.map((entry) => (entry.status === "FOLLOWED" ? { ...entry, conductEvidence: { role: "ACTION_PERFORMED", relation: "EQUIVALENT" } } : entry.status === "NOT_FOLLOWED" ? { ...entry, conductEvidence: { role: "ACTION_PERFORMED", relation: "DIFFERENT" } } : entry))
}

export function v171bSpecialistResponse(steps: Step[] = V171B_STEPS): string {
  return JSON.stringify({
    title: "Contestação de pacote de internet",
    summary: "Contestação registrada com cancelamento autorizado; prazo e valor a pagar não foram informados.",
    impactedIndicator: "Qualidade da contestação",
    evidenceFound: V171B_LINES.deadline,
    observedBehavior: "O operador validou o titular, identificou o lançamento e registrou a contestação.",
    relatedProcedure: V171B_DOC_TITLE,
    recommendation: "Informar o prazo exibido na ferramenta.",
    processAssessment: { processes: [{ documentTitle: V171B_DOC_TITLE, product: "", checkpoints: steps }], applicability: [] },
  })
}
