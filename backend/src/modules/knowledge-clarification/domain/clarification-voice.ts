import { openStepOf, type ClarificationState } from "./clarification-state.js"

/**
 * ESCLARECIMENTO NA VOZ — como a resposta do esclarecimento pelas bases é FALADA. A tela recebe o mesmo estado da resposta escrita
 * (formulário, cenário, fontes); a fala só acompanha: a pergunta com as opções lidas de forma curta (só os rótulos — nunca fontes nem
 * descrições), a resposta das bases sem os marcadores de fonte, ou o que falta. A resposta FALADA a uma pergunta em aberto volta pela
 * mesma ferramenta que a trouxe, com a pergunta original junto: o planejador interpreta o texto livre (`pendingReply`), como no chat.
 * Nada aqui conhece conteúdo — só o contrato (etapa aberta, rótulos, situação do fluxo).
 */

/** Opções lidas em voz alta; acima disso, só as primeiras e o aviso de que as demais estão na tela. */
export const MAX_SPOKEN_OPTIONS = 5

const inline = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** "A, B ou C" — a leitura natural de uma lista de alternativas. */
export function spokenAlternatives(labels: readonly string[]): string {
  const items = labels.map((label) => inline(label, 80))
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} ou ${items.at(-1)}`
}

/**
 * Instrução anexada ao resultado da ferramenta na VOZ (o modelo de voz recebe o conteúdo + esta instrução; a tela, o conteúdo e o
 * estado). `tool` = a ferramenta que encaminha a pergunta (a resposta falada volta por ela); `null` = a sessão de voz não tem como
 * encaminhar (ex.: aplicação de feedback): a resposta é só pela tela. `withLead` = o conteúdo tem, antes do esclarecimento, um texto
 * de outra parte da resposta (ex.: os números de quem lidera).
 */
export function renderClarificationVoiceInstruction(state: ClarificationState, options: { tool: string | null; withLead?: boolean }): string {
  const lead = options.withLead ? "Comece por um resumo de uma frase do que vem antes do esclarecimento (o detalhe está na tela). " : ""
  const open = openStepOf(state)
  if (open) {
    const labels = open.options.map((option) => option.label)
    const read =
      labels.length <= MAX_SPOKEN_OPTIONS
        ? `diga as opções de forma breve, só os rótulos: ${spokenAlternatives(labels)}`
        : `diga que há ${labels.length} opções na tela e leia só as ${MAX_SPOKEN_OPTIONS - 1} primeiras, de forma breve (${labels.slice(0, MAX_SPOKEN_OPTIONS - 1).map((label) => inline(label, 80)).join(", ")})`
    const reply = options.tool
      ? `Diga que a pessoa pode responder falando ou escolher na tela. Quando ela responder falando, acione ${options.tool} de novo com a pergunta original ("${inline(state.originalQuestion, 300)}") junto da resposta dela, nas palavras dela.`
      : "Diga que a pessoa pode escolher a opção na tela."
    return `\n\n[Instrução para a resposta falada: para responder pelas bases de conhecimento é preciso saber qual cenário se aplica; a pergunta e as opções já estão na tela, num formulário. ${lead}Faça a pergunta em uma frase curta e ${read}. Não leia fontes, descrições nem símbolos, não acrescente opções e não responda o procedimento ainda. ${reply}]`
  }
  if (state.status === "ANSWERED") {
    return `\n\n[Instrução para a resposta falada: a resposta acima vem das bases de conhecimento e já está completa na tela, com as fontes. ${lead}Fale esse mesmo conteúdo em voz natural e fiel: não acrescente, não omita nem altere documentos, passos, prazos ou condições. Não leia os marcadores de fonte ([1], [2]…), títulos nem símbolos de formatação, não fale de fontes e não diga "tópico" ou "lista": listas viram frases em sequência.]`
  }
  return `\n\n[Instrução para a resposta falada: o conteúdo acima já está na tela. ${lead}Fale-o de forma curta e fiel: as bases consultadas não sustentam uma resposta para este caso — diga o que falta e o que a pessoa pode informar ou fazer. Não indique nenhum procedimento.]`
}
