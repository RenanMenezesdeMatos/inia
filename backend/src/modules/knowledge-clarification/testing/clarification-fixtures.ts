import { chunkKnowledgeDocument } from "../../knowledge/domain/knowledge-chunking.js"
import { loadReadableKnowledge, type ReadableKnowledgePorts, type ReadableKnowledgeRequest } from "../../knowledge/application/knowledge-catalog.js"
import type { ClarificationModel } from "../application/clarification-model.js"

/**
 * BASES FICTÍCIAS — existem só para os testes do esclarecimento. Nenhum produto, público ou procedimento daqui é regra de
 * produção: o código de produção não conhece nenhum destes nomes (um teste garante isso).
 */
export const TEST_ORG = "00000000-0000-4000-8000-0000000000aa"
export const TEST_PERSON = "00000000-0000-4000-8000-0000000000bb"
export const TEST_ORCHESTRATOR_AGENT = "00000000-0000-4000-8000-0000000000c1"
export const TEST_SPECIALIST_AGENT = "00000000-0000-4000-8000-0000000000c2"
export const TEST_OTHER_SPECIALIST_AGENT = "00000000-0000-4000-8000-0000000000c3"

export type TestKnowledgeBase = { id: string; title: string; content: string; agentIds?: string[]; organizationId?: string }

export const TEST_KNOWLEDGE_BASES: TestKnowledgeBase[] = [
  {
    id: "kb-fic-end-basica",
    title: "Mudança de endereço — Linha básica (fictícia)",
    content: "## 1. Quando se aplica\nMudança de endereço da linha básica fixa para outro endereço na mesma cidade.\n\n## 2. Documentos\nComprovante do novo endereço emitido há no máximo 90 dias.\n\n## 3. Prazo\nA mudança de endereço da linha básica é concluída em até 5 dias úteis.",
  },
  {
    id: "kb-fic-end-lp",
    title: "Mudança de endereço — LP de Dados (fictícia)",
    content: "## 1. Quando se aplica\nMudança de endereço do circuito de LP de Dados contratado por empresa.\n\n## 2. Viabilidade técnica\nA mudança de endereço da LP de Dados exige estudo de viabilidade no novo endereço antes do pedido.\n\n## 3. Prazo\nAté 30 dias corridos depois da viabilidade aprovada.",
  },
  {
    id: "kb-fic-end-bl",
    title: "Mudança de endereço — Banda larga (fictícia)",
    content: "## 1. Mudança de endereço na mesma tecnologia\nQuando o novo endereço tem a mesma tecnologia, a mudança de endereço da banda larga é agendada direto com a visita técnica.\n\n## 2. Mudança de endereço com troca de tecnologia\nQuando o novo endereço só tem outra tecnologia, a mudança de endereço da banda larga vira um novo pedido de instalação, com troca do equipamento.\n\n## 3. Prazo\nVisita técnica em até 7 dias úteis.",
    agentIds: [TEST_SPECIALIST_AGENT, TEST_OTHER_SPECIALIST_AGENT],
  },
  {
    id: "kb-fic-end-bl-guia",
    title: "Guia rápido — mudança de endereço da banda larga (fictícia)",
    content: "## Resumo\nA mudança de endereço da banda larga depende da tecnologia disponível no novo endereço: mesma tecnologia = agendamento da visita; outra tecnologia = nova instalação.",
  },
  {
    id: "kb-fic-end-sip",
    title: "Mudança de endereço — SIP (fictícia)",
    content: "## 1. Quando se aplica\nMudança de endereço do tronco SIP de voz corporativa.\n\n## 2. Procedimento\nA mudança de endereço do SIP mantém a numeração e exige reconfiguração do PABX do cliente.",
  },
  {
    id: "kb-fic-end-fwt",
    title: "Mudança de endereço — Linha FWT (fictícia)",
    content: "## 1. Quando se aplica\nMudança de endereço da linha FWT (fixo sem fio).\n\n## 2. Cobertura\nA mudança de endereço da linha FWT só é possível se o novo endereço tiver cobertura celular.\n\n## 3. Prazo\nO prazo da mudança de endereço da linha FWT é imediato após a validação da cobertura.",
  },
  {
    id: "kb-fic-tt-empresa",
    title: "Troca de titularidade — Empresa (fictícia)",
    content: [
      "## 1. Tipos de troca entre titulares",
      "A troca de titularidade empresarial pode ser entre pessoas jurídicas (PJ para PJ), de pessoa jurídica para pessoa física (PJ para PF) ou de pessoa física para pessoa jurídica (PF para PJ).",
      "",
      "## 2. Documentos da troca PJ para PJ — troca comum",
      "Contrato social das duas empresas e documento de identificação dos representantes legais.",
      "",
      "## 3. Documentos da troca PJ para PF",
      "Contrato social da empresa cedente e documento de identificação da pessoa física.",
      "",
      "## 4. Documentos da troca PF para PJ",
      "Documento de identificação do titular atual e contrato social da empresa.",
      "",
      "## 5. Sucessão empresarial (PJ para PJ)",
      "Na sucessão empresarial, além dos documentos da troca comum, apresentar o documento que formaliza a sucessão registrado na junta comercial.",
      "",
      "## 6. Falecimento do titular empresário individual",
      "No falecimento do titular empresário individual, apresentar a certidão de óbito e o documento do inventariante.",
    ].join("\n"),
  },
  {
    id: "kb-fic-tt-residencial",
    title: "Troca de titularidade — Residencial (fictícia)",
    content: "## 1. Documentos do titular atual\nDocumento de identificação com foto e autorização da troca de titularidade assinada.\n\n## 2. Documentos do novo titular\nDocumento de identificação com foto e comprovante de endereço.",
  },
  {
    id: "kb-fic-ferias",
    title: "Política de férias (fictícia)",
    content: "## 1. Solicitação\nAs férias são pedidas no portal com 30 dias de antecedência.",
  },
]

/**
 * O catálogo REAL (`loadReadableKnowledge`) sobre as bases fictícias: cada base é autorizada aos agentes dela (padrão: o
 * especialista de teste) e `accessible` decide o que a pessoa pode ler.
 */
export function fixtureKnowledge(options: { bases?: TestKnowledgeBase[]; accessible?: (documentId: string) => boolean } = {}) {
  const bases = options.bases ?? TEST_KNOWLEDGE_BASES
  const requests: ReadableKnowledgeRequest[] = []
  const ports: ReadableKnowledgePorts = {
    snapshot: async (agentId) => {
      const mine = bases.filter((base) => (base.agentIds ?? [TEST_SPECIALIST_AGENT]).includes(agentId))
      return {
        documents: mine.map((base) => ({ id: base.id, title: base.title, versionId: `${base.id}-v1`, documentType: "PROCEDURE", organizationId: base.organizationId ?? TEST_ORG })),
        chunks: mine.flatMap((base) => chunkKnowledgeDocument({ id: base.id, title: base.title, content: base.content })),
      }
    },
    accessible: async (_organizationId, _viewer, documentIds) => new Set(documentIds.filter((id) => options.accessible?.(id) ?? true)),
    glossary: async () => [{ term: "PJ", definition: "Pessoa jurídica" }, { term: "PF", definition: "Pessoa física" }],
  }
  return {
    requests,
    ports,
    knowledge: (request: ReadableKnowledgeRequest) => {
      requests.push(request)
      return loadReadableKnowledge(request, ports)
    },
  }
}

export type PromptRef = { ref: string; documentTitle: string; heading: string }

/** Marcadores de um prompt: bases (B-n, `heading` vazio) e seções (K-n) — na lista, nos sumários abertos ou no texto lido. */
export function refsInPrompt(prompt: string): PromptRef[] {
  const refs: PromptRef[] = []
  let documentTitle = ""
  for (const line of prompt.split("\n")) {
    const base = /^\[(B\d+)\] (.+) \((?:[^()]* · )?\d+ seç(?:ão|ões)\)/.exec(line)
    if (base) {
      refs.push({ ref: base[1]!, documentTitle: base[2]!, heading: "" })
      for (const sample of line.matchAll(/\[(K\d+)\] (.+?)(?= · |$)/g)) refs.push({ ref: sample[1]!, documentTitle: base[2]!, heading: sample[2]! })
      continue
    }
    const header = /^### (.+?)(?: \[B\d+\])?$/.exec(line)
    if (header) {
      documentTitle = header[1]!
      continue
    }
    const section = /^\[(K\d+)\] (?:Seção "(.*)":|Trecho \d+:|(.+?))(?: — texto abaixo)?$/.exec(line)
    if (section) refs.push({ ref: section[1]!, documentTitle, heading: section[2] ?? section[3] ?? "" })
  }
  return refs
}

/** Como a IA "aponta" uma fonte: sem seção = a base inteira (B-n); com seção = o marcador da seção (K-n). */
export function refOf(prompt: string, document: string, heading?: string): string {
  const found = refsInPrompt(prompt).find((entry) => entry.documentTitle.includes(document) && (heading === undefined ? entry.ref.startsWith("B") : entry.ref.startsWith("K") && entry.heading.includes(heading)))
  if (!found) throw new Error(`Marcador não encontrado no prompt: ${document}${heading ? ` › ${heading}` : ""}`)
  return found.ref
}

/** `prompt` = sistema + mensagem: o que o modelo lê inteiro (a lista das bases fica no sistema; o resto, na mensagem). */
export type ScriptedCall = { stage: "PLANNER" | "ANSWER"; system: string; user: string; prompt: string; correction: boolean; streamed: boolean }

/** A chamada cai DEPOIS de já ter entregue `partial` em fluxo (a conexão caiu no meio da resposta). */
export class FailAfterStreaming extends Error {
  constructor(readonly partial: string) {
    super("conexão caiu no meio da resposta")
  }
}

/** Pedaço do fluxo da IA falsa: pequeno, para cortar marcadores, escapes e campos no meio. */
const STREAM_PIECE = 7

/**
 * IA falsa: cada chamada recebe o que o modelo receberia e devolve o JSON roteirizado pelo teste (string = resposta crua). Pedida em
 * fluxo (`onText`), entrega o mesmo texto em pedaços antes de devolvê-lo.
 */
export function scriptedModel(script: (call: ScriptedCall, index: number) => unknown) {
  const calls: ScriptedCall[] = []
  const model: ClarificationModel = async (input) => {
    const call = { stage: input.stage, system: input.system, user: input.user, prompt: `${input.system}\n\n${input.user}`, correction: input.correction, streamed: Boolean(input.onText) }
    calls.push(call)
    const output = script(call, calls.length - 1)
    const deliver = (text: string) => {
      for (let index = 0; input.onText && index < text.length; index += STREAM_PIECE) input.onText(text.slice(index, index + STREAM_PIECE))
    }
    if (output instanceof FailAfterStreaming) deliver(output.partial)
    if (output instanceof Error) throw output
    const text = typeof output === "string" ? output : JSON.stringify(output)
    deliver(text)
    return text
  }
  return { model, calls }
}
