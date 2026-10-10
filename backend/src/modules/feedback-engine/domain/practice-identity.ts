import { createHash } from "node:crypto"
import { z } from "zod"
import type { ProcedureContext } from "./procedure.js"

/**
 * PRÁTICAS DA OPERAÇÃO (`PRACTICE_IDENTITY_V1`) — a unidade que a liderança acompanha e o feedback cobra.
 *
 * Uma prática é UMA conduta esperada do operador numa situação. A mesma conduta aparece escrita de vários jeitos: em outra seção, em
 * outro documento, num checklist ("Forneci o protocolo?"), num argumentário, numa versão nova do texto. Cada uma continua sendo uma
 * regra avaliada; a prática as junta para:
 *   - o Diagnóstico mostrar UM ponto por conduta (com as fontes), nunca a mesma coisa repetida com outras palavras;
 *   - o feedback contar a reincidência e a orientação anterior pela conduta (rodada V14: "35. Prazo da análise" em duas linhas da
 *     mesma seção virou duas práticas com 2 de 2 cada — o padrão de 4 de 4 nunca apareceu);
 *   - o histórico atravessar edições da base (digitação, sinônimo, seção renumerada não criam um ponto novo).
 *
 * Quem decide se duas regras pedem a mesma conduta é a LEITURA do modelo — nunca palavra, regex, lista de verbos ou semelhança de
 * texto. O código só confere a forma da resposta (cada regra uma vez, prática existente ou nova com título) e registra. Na dúvida o
 * modelo SEPARA: juntar condutas diferentes mistura números na liderança e no histórico de quem é avaliado. Ninguém aprova.
 */
export const PRACTICE_IDENTITY_VERSION = "PRACTICE_IDENTITY_V1" as const
// V2 (05/10): regra COMPOSTA — obrigação de várias linhas cujas linhas, uma a uma, não pedem conduta (abertura de lista, objetivo).
export const PRACTICE_IDENTITY_PROMPT_VERSION = "PRACTICE_IDENTITY_PROMPT_V2" as const

/** Uma linha de regra (documento da base ou item de argumentário) a organizar. `lineKey` = identidade da linha (estável enquanto o texto não muda). */
export type PracticeLine = {
  lineKey: string
  sourceKind: "KNOWLEDGE" | "ARGUMENT_SCRIPT"
  sourceId: string
  sourceVersion: number
  sourceTitle: string
  heading: string | null
  leadIn: string | null
  text: string
  /** Linha que ABRE uma lista: os itens que vêm sob ela (contexto para entender a conduta; até oito). */
  listItems?: string[]
  /**
   * Regra COMPOSTA: uma obrigação de várias linhas (`lineKey` = a chave da obrigação, com '#') cujas linhas, uma a uma, não pedem
   * conduta. É organizada como um todo — sem isso a avaliação dela ficaria sem ponto e apareceria pelo texto cru das linhas.
   */
  combined?: true
}
/** Prática já registrada, com até duas regras de exemplo (o que o modelo precisa para reconhecer a mesma conduta). */
export type CatalogPractice = { practiceKey: string; title: string; examples: { sourceTitle: string; heading: string | null; text: string }[]; /** Nome curto dado na organização em temas (`PRACTICE_THEMES_V1`); ausente = sem tema ainda. */ shortTitle?: string | null }
export type PracticeMemberBasis = "SAME_AS_EXISTING" | "NEW_PRACTICE" | "NO_CONDUCT"
export type PracticeAssignment = { line: PracticeLine; practiceKey: string | null; basis: PracticeMemberBasis }
export type PracticeIdentityResult = {
  practices: { practiceKey: string; title: string }[]
  members: PracticeAssignment[]
  /** Regras que a resposta não organizou de forma válida — continuam sem prática (as consultas usam a própria linha) e voltam na próxima vez. */
  unassigned: { lineKey: string; reason: "MISSING" | "DUPLICATE" | "UNKNOWN_PRACTICE" | "NEW_WITHOUT_TITLE" }[]
}

/** Chave da prática NOVA: derivada da primeira linha que a criou (determinística — duas execuções concorrentes chegam à mesma chave). */
export const newPracticeKeyOf = (firstLineKey: string) => `KP-${createHash("sha256").update(`PRACTICE|${firstLineKey}`).digest("hex").slice(0, 12)}`

/** Lote máximo de regras por pedido (cada parte vê as práticas que as anteriores criaram). 120 foi cortado na carga do dev (05/10:
 * 78 regras num pedido, JSON inválido); uma análise de chamada costuma trazer bem menos de 40 regras novas. */
export const PRACTICE_LINES_PER_REQUEST = 40

export const PRACTICE_IDENTITY_SYSTEM_PROMPT = `Você organiza as regras dos procedimentos e argumentários de uma operação de atendimento em PRÁTICAS. Uma prática é UMA conduta que se espera do operador numa situação do atendimento. É por prática que a liderança acompanha quem cumpre e quem não cumpre, e é por prática que o feedback lembra o que já aconteceu antes com a pessoa. Por isso:
- a mesma conduta escrita de jeitos diferentes — em outra seção, em outro documento, num checklist, numa pergunta de autoverificação ("Forneci o protocolo?"), num argumentário ou numa versão nova do texto — fica na MESMA prática;
- condutas diferentes nunca ficam juntas.

Para cada regra R-n, decida pelo SENTIDO:
- uma prática já conhecida (P-n), quando a regra pede a mesma conduta: a mesma ação do operador, sobre a mesma coisa, na mesma situação. Redação, numeração, título de seção, documento e formato não mudam a prática; um valor que só detalha a conduta (o número de dias de um prazo, o canal citado) também não;
- uma prática nova (N-n), quando nenhuma conhecida pede a mesma conduta. Dê a ela um título curto que diga a conduta (o que fazer, sobre o quê e, quando importar, em que situação). Várias regras desta lista podem ir para a mesma prática nova;
- NONE, quando a regra não pede conduta do operador: contexto, objetivo, definição, explicação de como algo funciona, informação sobre sistema ou sobre o cliente, exemplo de fala.

São práticas DIFERENTES: ações diferentes (informar, registrar, perguntar, conferir, transferir); a mesma ação sobre coisas diferentes (o prazo da análise e o prazo do estorno); situações diferentes que mudam quando a conduta vale (conta já paga e conta em aberto); uma proibição e uma obrigação que não pedem a mesma conduta (não prometer devolução imediata e informar o prazo).
Item de lista: leia a lista inteira (a abertura em "listOpening"; numa regra que ABRE uma lista, os itens em "itemsOfThisList"). Se ela descreve UMA conduta feita em partes (uma recapitulação com conta, valor, prazo e protocolo), os itens vão para a prática dessa conduta. Se ela enumera condutas independentes (um checklist de encerramento), cada item vai para a prática da sua própria conduta.
Regra composta ("severalLines": true): várias linhas que foram avaliadas juntas como UMA obrigação. Decida pela conduta que ela pede como um todo: uma prática conhecida só quando a obrigação inteira pede exatamente essa conduta; quando ela junta condutas diferentes (um checklist inteiro, uma sequência de etapas), uma prática nova cujo título nomeie esse conjunto; NONE só quando nenhuma das linhas pede conduta do operador.
Na dúvida entre juntar e separar, separe.

Responda só o JSON pedido. Cada regra R-n aparece exatamente uma vez em "assignments". Toda prática N-n usada precisa estar em "newPractices" com o título.`

/**
 * Esquema da resposta com LISTAS FECHADAS: a regra é uma das R-n apresentadas e a prática é uma das P-n conhecidas, uma N-n nova ou
 * NONE — o modelo escolhe, o código só confere a escolha exata (nenhuma leitura de texto livre).
 */
export function practiceIdentitySchemaFor(catalogSize: number, lineCount: number): Record<string, unknown> {
  const rules = Array.from({ length: lineCount }, (_, index) => `R${index + 1}`)
  const fresh = Array.from({ length: lineCount }, (_, index) => `N${index + 1}`)
  const known = Array.from({ length: catalogSize }, (_, index) => `P${index + 1}`)
  return {
    type: "object",
    properties: {
      assignments: { type: "array", items: { type: "object", properties: { rule: { type: "string", enum: rules }, practice: { type: "string", enum: [...known, ...fresh, "NONE"] } }, required: ["rule", "practice"] } },
      newPractices: { type: "array", items: { type: "object", properties: { ref: { type: "string", enum: fresh }, title: { type: "string" } }, required: ["ref", "title"] } },
    },
    required: ["assignments", "newPractices"],
  }
}

const sourceLabel = (line: PracticeLine) => `${line.sourceKind === "ARGUMENT_SCRIPT" ? "Argumentário" : "Base"}: ${line.sourceTitle}${line.heading ? ` · ${line.heading}` : ""}`

/** Pedido do usuário: práticas conhecidas (P-n) e regras a organizar (R-n, na ordem do documento). Determinístico para a mesma entrada. */
export function renderPracticeIdentityTurn(catalog: readonly CatalogPractice[], lines: readonly PracticeLine[]): string {
  const known = catalog.map((practice, index) => ({ ref: `P${index + 1}`, title: practice.title, examples: practice.examples.map((example) => `${example.sourceTitle}${example.heading ? ` · ${example.heading}` : ""}: ${example.text}`) }))
  const rules = lines.map((line, index) => ({ ref: `R${index + 1}`, source: sourceLabel(line), ...(line.leadIn ? { listOpening: line.leadIn } : {}), rule: line.text, ...(line.listItems && line.listItems.length > 0 ? { itemsOfThisList: line.listItems } : {}), ...(line.combined ? { severalLines: true } : {}) }))
  return [
    `PRÁTICAS JÁ CONHECIDAS (${known.length}):`,
    known.length > 0 ? JSON.stringify(known, null, 1) : "(nenhuma ainda)",
    "",
    `REGRAS A ORGANIZAR (${rules.length}):`,
    JSON.stringify(rules, null, 1),
  ].join("\n")
}

const responseSchema = z.object({
  assignments: z.array(z.unknown()).catch([]),
  newPractices: z.array(z.unknown()).catch([]),
})
const assignmentSchema = z.object({ rule: z.string().trim().min(1), practice: z.string().trim().min(1) })
const newPracticeSchema = z.object({ ref: z.string().trim().min(1), title: z.string() })
const cleanTitle = (value: string) => value.split(/\s+/).filter(Boolean).join(" ").slice(0, 140)

/**
 * Lê a resposta e confere SÓ a forma: cada regra uma vez, prática conhecida existente, prática nova declarada com título. O que não
 * passa fica sem prática (e volta na próxima vez) — nunca é "consertado" por semelhança de texto.
 */
export function parsePracticeIdentity(text: string, catalog: readonly CatalogPractice[], lines: readonly PracticeLine[]): { ok: true; result: PracticeIdentityResult } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: "INVALID_JSON" }
  }
  const parsed = responseSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: "INVALID_SHAPE" }
  // Códigos válidos DESTE pedido: correspondência exata (sem espaços nas pontas, maiúsculas) — nunca interpretação.
  const ruleIndex = new Map(lines.map((_, index) => [`R${index + 1}`, index]))
  const knownByRef = new Map(catalog.map((practice, index) => [`P${index + 1}`, practice]))
  const freshRefs = new Set(lines.map((_, index) => `N${index + 1}`))
  const code = (value: string) => value.trim().toUpperCase()
  const titles = new Map<string, string>()
  for (const entry of parsed.data.newPractices) {
    const item = newPracticeSchema.safeParse(entry)
    if (!item.success) continue
    const ref = code(item.data.ref)
    const title = cleanTitle(item.data.title)
    if (freshRefs.has(ref) && title.length > 0 && !titles.has(ref)) titles.set(ref, title)
  }
  const chosen = new Map<number, string[]>()
  for (const entry of parsed.data.assignments) {
    const item = assignmentSchema.safeParse(entry)
    if (!item.success) continue
    const index = ruleIndex.get(code(item.data.rule))
    if (index === undefined) continue
    chosen.set(index, [...(chosen.get(index) ?? []), code(item.data.practice)])
  }
  const result: PracticeIdentityResult = { practices: [], members: [], unassigned: [] }
  const created = new Map<string, string>()
  lines.forEach((line, index) => {
    const answers = [...new Set(chosen.get(index) ?? [])]
    if (answers.length === 0) return result.unassigned.push({ lineKey: line.lineKey, reason: "MISSING" })
    if (answers.length > 1) return result.unassigned.push({ lineKey: line.lineKey, reason: "DUPLICATE" })
    const answer = answers[0]!
    if (answer === "NONE") return result.members.push({ line, practiceKey: null, basis: "NO_CONDUCT" })
    const known = knownByRef.get(answer)
    if (known) return result.members.push({ line, practiceKey: known.practiceKey, basis: "SAME_AS_EXISTING" })
    if (!freshRefs.has(answer)) return result.unassigned.push({ lineKey: line.lineKey, reason: "UNKNOWN_PRACTICE" })
    const title = titles.get(answer)
    if (!title) return result.unassigned.push({ lineKey: line.lineKey, reason: "NEW_WITHOUT_TITLE" })
    let practiceKey = created.get(answer)
    if (!practiceKey) {
      practiceKey = newPracticeKeyOf(line.lineKey)
      created.set(answer, practiceKey)
      result.practices.push({ practiceKey, title })
    }
    return result.members.push({ line, practiceKey, basis: "NEW_PRACTICE" })
  })
  return { ok: true, result }
}

/**
 * Linhas a organizar de um contexto de procedimento (documentos da base e argumentários), na ordem do documento — SÓ as que `only`
 * pede (as linhas-âncora das regras que foram avaliadas). Organizar o documento inteiro custaria centenas de linhas que nunca são
 * cobradas; a prática nasce quando a regra é avaliada pela primeira vez.
 */
export function practiceLinesOf(context: Pick<ProcedureContext, "documents" | "lines">, only: ReadonlySet<string>): PracticeLine[] {
  const documents = new Map(context.documents.map((document) => [document.handle, document]))
  const all = [...context.lines.values()]
  return all.flatMap((line): PracticeLine[] => {
    if (!only.has(line.lineKey)) return []
    const document = documents.get(line.documentHandle)
    if (!document) return []
    // Itens que esta linha abre (mesma seção, abertura igual ao texto desta linha) — estrutura do documento, não leitura.
    const items = all.filter((other) => other.sectionHandle === line.sectionHandle && other.leadIn !== null && other.leadIn === line.text.trim()).map((other) => other.text).slice(0, 8)
    return [{
      lineKey: line.lineKey,
      sourceKind: document.kind === "ARGUMENT_SCRIPT" ? "ARGUMENT_SCRIPT" : "KNOWLEDGE",
      sourceId: line.documentId,
      sourceVersion: document.version,
      sourceTitle: document.title,
      heading: line.heading,
      leadIn: line.leadIn,
      text: line.text,
      ...(items.length > 0 ? { listItems: items } : {}),
    }]
  })
}

/**
 * Linhas das regras avaliadas: a âncora de cada obrigação (a chave da linha antes do '#') e as linhas de origem dela. A abertura de
 * uma lista não pede conduta sozinha — o item pede; a prática da obrigação é a da primeira linha que tem uma.
 */
export const anchorLineKeysOf = (criteria: readonly { lineKey: string; sources?: readonly { lineKey: string }[] }[]) =>
  new Set(criteria.flatMap((criterion) => [criterion.lineKey.split("#")[0]!, ...(criterion.sources ?? []).map((source) => source.lineKey)]))

/**
 * Obrigações de VÁRIAS linhas (chave com '#') cujas linhas JÁ foram organizadas e nenhuma pede conduta (abertura de lista, objetivo,
 * contexto): viram uma regra COMPOSTA, organizada como um todo pela chave da obrigação. Linha ainda sem decisão = espera (a obrigação
 * pode ganhar prática pela própria linha). Obrigação de uma linha só nunca vira composta: a decisão da linha vale.
 */
export function combinedObligationLinesOf(
  obligations: readonly { lineKey: string; lineKeys: readonly string[]; text: string; heading: string | null; source: Pick<PracticeLine, "sourceKind" | "sourceId" | "sourceVersion" | "sourceTitle"> | null }[],
  memberships: ReadonlyMap<string, { practiceKey: string | null }>,
): PracticeLine[] {
  const seen = new Set<string>()
  return obligations.flatMap((obligation): PracticeLine[] => {
    if (!obligation.lineKey.includes("#") || !obligation.source || seen.has(obligation.lineKey) || memberships.has(obligation.lineKey)) return []
    const decided = obligation.lineKeys.map((lineKey) => memberships.get(lineKey))
    if (decided.length === 0 || decided.some((entry) => entry === undefined || entry.practiceKey !== null)) return []
    seen.add(obligation.lineKey)
    return [{ lineKey: obligation.lineKey, ...obligation.source, heading: obligation.heading, leadIn: null, text: obligation.text, combined: true }]
  })
}
