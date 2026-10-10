import type { EmittedItem } from "../domain/reliable-feedback-artifact.js"
import type { NarrativeDraft } from "../domain/supervisor-narrative.js"
import { factualityClaimsOf, isAcceptedFactuality, NARRATIVE_FACTUALITY_PROMPT_VERSION, NARRATIVE_FACTUALITY_VERSION, type FactualityClaim, type NarrativeFactualityStatus, type StoredFactuality } from "../domain/narrative-factuality.js"

/**
 * FEEDBACK EXPERIENCE V2.1 — casos de FATUALIDADE SEMÂNTICA (fixtures, sem modelo). Os testes de unidade usam um verificador falso;
 * a avaliação ao vivo (`scripts/dev/eval-narrative-factuality.ts`) roda estes casos contra o modelo real. Os casos "NOVEL" usam
 * vocabulário que não aparece em nenhuma lista do código nem no prompt do verificador — provam generalização, não memória.
 */
export type FactualityCase = { id: string; group: "REQUIRED" | "NOVEL" | "SEMANTIC"; description: string; items: EmittedItem[]; sentence: { text: string; stance: "CONTEXT" | "STRENGTH" | "ADJUSTMENT" | "GUIDANCE"; refs: string[] }; expected: "ACCEPT" | "REJECT" }

let next = 1
export function factualityItem(section: "STRENGTH" | "OPPORTUNITY", title: string, rule: string, lines: string[], options: { declared?: boolean; customer?: string[]; observed?: string } = {}): EmittedItem {
  const index = next++
  return {
    index, domain: "MONITORING", section, sectionLabel: section === "STRENGTH" ? "Ponto forte" : "Ponto de desenvolvimento",
    wording: { observed: options.observed ?? "", whyItMatters: "", whatYouCanDo: "" }, wordingSource: "PROPOSED", qaStatus: "NOT_SELECTED_FOR_QA",
    facts: [...lines.map((text) => ({ role: "OPERADOR", text, truncated: false, masked: false })), ...(options.customer ?? []).map((text) => ({ role: "CLIENTE", text, truncated: false, masked: false }))],
    knowledge: { documentId: "doc", documentTitle: "Guia de Atendimento", heading: title, version: 1, quote: rule, applicability: "VERIFIED", href: "/materiais/doc", contentKind: "RULE_CONTENT" },
    grounding: "OFFICIAL_PROCEDURE",
    process: { title: "Guia de Atendimento", requirement: rule, status: section === "STRENGTH" ? "FOLLOWED" : "NOT_FOLLOWED", checkpointRef: `CP-${index}`, evidenceType: (options.declared ? "OBSERVED_DECLARATION" : "OBSERVED_ACTION") as never, stepTitle: title },
  } as EmittedItem
}
export const oneSentenceDraft = (sentence: FactualityCase["sentence"]): NarrativeDraft => ({ paragraphs: [sentence.text], card: "", cardRefs: [], sentences: [{ paragraph: 1, ...sentence }] })

const informe = () => [factualityItem("OPPORTUNITY", "Informe de pagamento", "Avaliar se a funcionalidade de informe de pagamento está disponível para o cliente.", ["É só você informar o pagamento pelo aplicativo, essa opção está disponível pra você."])]
const reparo = () => [factualityItem("STRENGTH", "Reparo fixa", "Realizar os testes básicos antes de abrir reparo.", ["Desliga o modem da tomada, espera uns trinta segundos e liga de novo.", "O cabo que vem da rua até o modem está bem encaixado?"])]
const cabo = () => [factualityItem("STRENGTH", "Conexão física", "Orientar a conferência das conexões físicas.", ["Confere pra mim se o cabo está bem encaixado atrás do modem?"])]
const condicoes = () => [factualityItem("STRENGTH", "Negociação", "Consultar as condições de parcelamento disponíveis no sistema.", ["Deixa eu consultar aqui no sistema as condições de parcelamento pra sua conta."])]
const declarada = () => [factualityItem("STRENGTH", "Retorno ao cliente", "Informar ao cliente o próximo passo do atendimento.", ["Vou consultar a situação do seu pedido e te retorno ainda hoje."], { declared: true })]
const vivoEmDia = () => [factualityItem("STRENGTH", "Negociação", "Orientar o Vivo em Dia para consulta de débitos e opções.", ["Pelo Vivo em Dia você consegue consultar os valores em aberto e ver as alternativas pra regularizar."])]
const roteador = () => [factualityItem("STRENGTH", "Reinício do equipamento", "Orientar o reinício do equipamento.", ["Tira o roteador da tomada e liga de novo, por favor."])]
const encaminhamento = () => [factualityItem("STRENGTH", "Encaminhamento", "Encaminhar à equipe técnica quando o teste remoto não resolver.", ["Vou abrir uma solicitação para a equipe técnica avaliar a sua linha."], { declared: true })]
const planos = () => [factualityItem("STRENGTH", "Explicação dos planos", "Explicar as diferenças entre os planos.", ["O controle tem franquia fixa todo mês e o pós você paga conforme o uso."])]
const endereco = () => [factualityItem("STRENGTH", "Endereço de instalação", "Confirmar o endereço de instalação.", ["Qual é o CEP do endereço onde vai ser feita a instalação?"], { customer: ["É 04567-000, rua das Flores."] })]
const prazo = () => [factualityItem("STRENGTH", "Prazo da análise", "Informar o prazo da análise.", ["A análise da sua contestação leva até sete dias úteis."])]
const reparoAberto = () => [factualityItem("STRENGTH", "Reparo", "Abrir reparo quando os testes não resolverem e informar o acompanhamento pelo aplicativo.", ["Os testes não resolveram, então eu já abri o reparo e você acompanha pelo aplicativo."], { declared: true })]
const disponibilidade = () => [factualityItem("OPPORTUNITY", "Informe de pagamento", "Avaliar se a funcionalidade de informe de pagamento está disponível para o cliente.", ["Pode informar pelo aplicativo, essa opção está disponível pra você."])]
const desbloqueio = () => [factualityItem("OPPORTUNITY", "Promessas", "Não prometer desbloqueio imediato. Informar que a liberação ocorre após a confirmação do pagamento.", ["Pode ficar tranquilo, o desbloqueio é na hora."])]
const desbloqueioPerguntado = () => [factualityItem("OPPORTUNITY", "Promessas", "Não prometer desbloqueio imediato. Informar que a liberação ocorre após a confirmação do pagamento.", ["Pode ficar tranquilo, o desbloqueio é na hora."], { customer: ["E a linha volta quando?"] })]

export const FACTUALITY_CASES: FactualityCase[] = [
  { id: "A", group: "REQUIRED", description: "informar pagamento → enviar comprovante", items: informe(), sentence: { text: "Você orientou o envio do comprovante pelo aplicativo sem checar se a opção estava disponível.", stance: "ADJUSTMENT", refs: ["A1"] }, expected: "REJECT" },
  { id: "A'", group: "REQUIRED", description: "informar pagamento → informe pelo aplicativo (mesma ação)", items: informe(), sentence: { text: "Você indicou o aplicativo para informar o pagamento sem checar se a opção estava disponível.", stance: "ADJUSTMENT", refs: ["A1"] }, expected: "ACCEPT" },
  { id: "B", group: "REQUIRED", description: "reinício + cabo → testes de diagnóstico", items: reparo(), sentence: { text: "Você fez verificações de diagnóstico antes de avançar com o atendimento.", stance: "STRENGTH", refs: ["S1"] }, expected: "ACCEPT" },
  { id: "C", group: "REQUIRED", description: "reinício + cabo → diagnóstico completo", items: reparo(), sentence: { text: "Você fez um diagnóstico completo da conexão antes de avançar.", stance: "STRENGTH", refs: ["S1"] }, expected: "REJECT" },
  { id: "C'", group: "REQUIRED", description: "reinício + cabo → realizou todos os testes", items: reparo(), sentence: { text: "Você realizou todos os testes antes de avançar com o atendimento.", stance: "STRENGTH", refs: ["S1"] }, expected: "REJECT" },
  { id: "D", group: "REQUIRED", description: "cabo encaixado → verificar a conexão do cabo", items: cabo(), sentence: { text: "Você orientou o cliente a verificar a conexão do cabo.", stance: "STRENGTH", refs: ["S1"] }, expected: "ACCEPT" },
  { id: "E", group: "REQUIRED", description: "cabo encaixado → integridade física do cabo", items: cabo(), sentence: { text: "Você confirmou a integridade física do cabo com o cliente.", stance: "STRENGTH", refs: ["S1"] }, expected: "REJECT" },
  { id: "F", group: "REQUIRED", description: "consultar condições → aprovação confirmada", items: condicoes(), sentence: { text: "Você consultou o sistema e confirmou a aprovação do parcelamento.", stance: "STRENGTH", refs: ["S1"] }, expected: "REJECT" },
  { id: "G", group: "REQUIRED", description: "'vou consultar' → 'consultou'", items: declarada(), sentence: { text: "Você consultou a situação do pedido e deu o retorno ao cliente.", stance: "STRENGTH", refs: ["S1"] }, expected: "REJECT" },
  { id: "H", group: "REQUIRED", description: "Vivo em Dia valores/opções → débitos e alternativas", items: vivoEmDia(), sentence: { text: "Você orientou o uso do Vivo em Dia para consultar débitos e opções de regularização.", stance: "STRENGTH", refs: ["S1"] }, expected: "ACCEPT" },
  { id: "N1", group: "NOVEL", description: "reiniciar roteador → atualizar firmware", items: roteador(), sentence: { text: "Você pediu ao cliente que atualizasse o firmware do roteador.", stance: "STRENGTH", refs: ["S1"] }, expected: "REJECT" },
  { id: "N2", group: "NOVEL", description: "reiniciar roteador → reinício do equipamento", items: roteador(), sentence: { text: "Você orientou o cliente a reiniciar o equipamento.", stance: "STRENGTH", refs: ["S1"] }, expected: "ACCEPT" },
  { id: "N3", group: "NOVEL", description: "'vou abrir solicitação' → caso já em resolução pela equipe", items: encaminhamento(), sentence: { text: "Você encaminhou o caso à equipe técnica, que já está cuidando do reparo da linha.", stance: "STRENGTH", refs: ["S1"] }, expected: "REJECT" },
  { id: "N4", group: "NOVEL", description: "franquia × uso → explicou as diferenças", items: planos(), sentence: { text: "Você explicou ao cliente as diferenças entre os planos.", stance: "STRENGTH", refs: ["S1"] }, expected: "ACCEPT" },
  { id: "N5", group: "NOVEL", description: "franquia × uso → recomendou o pós como melhor opção", items: planos(), sentence: { text: "Você comparou os planos e recomendou o pós-pago como a melhor opção para o perfil do cliente.", stance: "STRENGTH", refs: ["S1"] }, expected: "REJECT" },
  { id: "N6", group: "NOVEL", description: "perguntou o CEP → conferiu o endereço", items: endereco(), sentence: { text: "Você conferiu o endereço de instalação com o cliente.", stance: "STRENGTH", refs: ["S1"] }, expected: "ACCEPT" },
  { id: "N7", group: "NOVEL", description: "perguntou o CEP → validou a viabilidade técnica no endereço", items: endereco(), sentence: { text: "Você validou a viabilidade técnica da instalação no endereço do cliente.", stance: "STRENGTH", refs: ["S1"] }, expected: "REJECT" },
  { id: "N8", group: "NOVEL", description: "prazo da análise → informou o prazo", items: prazo(), sentence: { text: "Você deixou claro para o cliente quanto tempo a análise pode levar.", stance: "STRENGTH", refs: ["S1"] }, expected: "ACCEPT" },
  { id: "N9", group: "NOVEL", description: "prazo da análise → garantiu o ressarcimento no prazo", items: prazo(), sentence: { text: "Você garantiu ao cliente que o ressarcimento sairia dentro do prazo da análise.", stance: "STRENGTH", refs: ["S1"] }, expected: "REJECT" },
  { id: "N10", group: "NOVEL", description: "orientação pela regra (liberação após confirmação)", items: desbloqueio(), sentence: { text: "Na próxima chamada, explique que a liberação acontece depois que o pagamento for confirmado, sem prometer que é na hora.", stance: "GUIDANCE", refs: ["A1"] }, expected: "ACCEPT" },
  { id: "N11", group: "NOVEL", description: "orientação que pressupõe objeto novo (número da transação)", items: desbloqueio(), sentence: { text: "Na próxima chamada, peça o código da transação bancária antes de falar sobre a liberação da linha.", stance: "GUIDANCE", refs: ["A1"] }, expected: "REJECT" },
  { id: "S1", group: "SEMANTIC", description: "efeito/resultado novo (cliente tranquilo, não vai ligar de novo)", items: prazo(), sentence: { text: "Ao informar o prazo, você deixou o cliente tranquilo e evitou que ele ligasse de novo.", stance: "STRENGTH", refs: ["S1"] }, expected: "REJECT" },
  { id: "S2", group: "SEMANTIC", description: "causa ligando fatos (prazo informado → compreensão do processo)", items: prazo(), sentence: { text: "Por ter informado o prazo, o cliente passou a entender todo o processo da contestação.", stance: "STRENGTH", refs: ["S1"] }, expected: "REJECT" },
  { id: "S3", group: "SEMANTIC", description: "um episódio vira hábito ('você costuma')", items: disponibilidade(), sentence: { text: "Você costuma indicar o aplicativo sem checar se a opção está disponível.", stance: "ADJUSTMENT", refs: ["A1"] }, expected: "REJECT" },
  { id: "S4", group: "SEMANTIC", description: "ajuste dito como feito (checagem não feita dita como feita)", items: disponibilidade(), sentence: { text: "Você confirmou que a opção estava disponível e depois indicou o aplicativo.", stance: "ADJUSTMENT", refs: ["A1"] }, expected: "REJECT" },
  { id: "S5", group: "SEMANTIC", description: "relato fiel de uma promessa do operador (não é efeito garantido)", items: desbloqueioPerguntado(), sentence: { text: "Quando o cliente perguntou, você garantiu que o desbloqueio seria na hora.", stance: "ADJUSTMENT", refs: ["A1"] }, expected: "ACCEPT" },
  { id: "S6", group: "SEMANTIC", description: "negação sobre o problema do cliente dentro de um acerto (não é falha do operador)", items: reparoAberto(), sentence: { text: "Como os testes não resolveram o problema, você informou que abriu o reparo e explicou o acompanhamento pelo aplicativo.", stance: "STRENGTH", refs: ["S1"] }, expected: "ACCEPT" },
  { id: "S7", group: "SEMANTIC", description: "ação em sistema só declarada dita como executada", items: reparoAberto(), sentence: { text: "Você abriu o reparo no sistema e explicou o acompanhamento pelo aplicativo.", stance: "STRENGTH", refs: ["S1"] }, expected: "REJECT" },
]

/** Veredito VERIFIED para testes: todas as afirmações aceitas, salvo as que `statusOf` disser outra coisa. */
export function factualityVerdictFor(draft: NarrativeDraft, statusOf: (claim: FactualityClaim) => NarrativeFactualityStatus = () => "SUPPORTED"): StoredFactuality {
  return {
    version: NARRATIVE_FACTUALITY_VERSION, promptVersion: NARRATIVE_FACTUALITY_PROMPT_VERSION, status: "VERIFIED", error: null,
    verdicts: factualityClaimsOf(draft).map((claim) => {
      const status = statusOf(claim)
      return { id: claim.id, textSha256: claim.textSha256, status, unsupportedMeaning: isAcceptedFactuality(status) ? null : "acréscimo", reason: "teste" }
    }),
  }
}
/** Verificador falso (sem modelo) para os testes de geração. */
export const fakeFactualityVerifier = (statusOf?: (claim: FactualityClaim) => NarrativeFactualityStatus) => async (draft: NarrativeDraft) => factualityVerdictFor(draft, statusOf)
