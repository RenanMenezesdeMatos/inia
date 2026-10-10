/**
 * VISÃO DOS RESULTADOS DAS FERRAMENTAS PARA O PLANEJADOR (`TOOL_RESULT_VIEW_V2`, domínio puro).
 *
 * Antes da V1, o resultado da rodada anterior ia ao planejador como `JSON.stringify` cortado em 3.000 caracteres — o corte caía no meio
 * de uma lista. A V1 passou a encurtar listas por ITEM inteiro e a declarar o que faltou, mas textos longos eram cortados em 300
 * caracteres sem caminho para o resto: pedir o campo de novo devolvia os mesmos 300 (defeito reproduzido em 02/10). Na V2:
 *   - cada resultado vai INTEIRO quando cabe na parte dele do orçamento da rodada; senão listas encurtadas por item inteiro e textos
 *     encurtados — e TUDO o que ficou de fora é declarado (`omitted`: caminho navegável, tipo ITEMS/CHARS, quanto foi mostrado, total);
 *   - o restante de qualquer resultado já obtido (F-n) sai por `inspect_result`, em PÁGINAS: numa lista, a partir do item pedido, só os
 *     itens que couberam (a continuação começa exatamente no primeiro que não foi mostrado); num texto, a partir do caractere pedido, até
 *     6.000 por página, com a continuação exata — nenhum trecho fica inacessível. Sem nova consulta aos dados e sem custo de IA;
 *   - o ESTADO de cada consulta é explícito e distinto: ok, sem dados, dado insuficiente, recusada, falhou, não executada por orçamento;
 *     e o de cada página também: completa, parcial (há continuação), vazia, campo inexistente.
 */
export const TOOL_RESULT_VIEW_VERSION = "TOOL_RESULT_VIEW_V2" as const
/** Orçamento de caracteres dos resultados de UMA rodada enviados ao planejador (repartido entre eles; cada um tem um piso). */
export const RESULTS_ROUND_BUDGET_CHARS = 12_000
export const RESULT_MIN_CHARS = 2_000
/** Teto de uma página de detalhe (`inspect_result`). */
export const DETAIL_MAX_CHARS = 6_000
export const DETAIL_MAX_ITEMS = 40
/** Página padrão: 20 itens numa lista; 4.000 caracteres num texto. */
export const DETAIL_DEFAULT_ITEMS = 20
export const DETAIL_DEFAULT_TEXT_CHARS = 4_000
const STRING_MAX_CHARS = 300
const ARRAY_CAPS = [40, 20, 10, 6, 3] as const
const ROOT = "(raiz)"

export type ToolOutcome = "OK" | "NO_DATA" | "INSUFFICIENT" | "NOT_SUPPORTED" | "REFUSED" | "FAILED" | "NOT_RUN_BUDGET"
/** Rótulo do estado como o planejador o lê: só OK é uma resposta; os outros dizem por que NÃO respondem. */
export const TOOL_OUTCOME_LABEL: Record<ToolOutcome, string> = {
  OK: "ok",
  NO_DATA: "sem dados — não responde a pergunta",
  INSUFFICIENT: "dado insuficiente — não sustenta conclusão",
  NOT_SUPPORTED: "não suportada para este indicador — não respondeu nada",
  REFUSED: "recusada — não respondeu nada",
  FAILED: "falhou — não respondeu nada",
  NOT_RUN_BUDGET: "não executada (orçamento da execução) — não respondeu nada",
}
export function toolOutcomeOf(entry: { status: "OK" | "REJECTED" | "FAILED" | "BUDGET"; quality: { status: string } }): ToolOutcome {
  if (entry.status === "REJECTED") return "REFUSED"
  if (entry.status === "FAILED") return "FAILED"
  if (entry.status === "BUDGET") return "NOT_RUN_BUDGET"
  if (entry.quality.status === "SUFFICIENT") return "OK"
  if (entry.quality.status === "NO_DATA") return "NO_DATA"
  if (entry.quality.status === "NOT_SUPPORTED") return "NOT_SUPPORTED"
  return "INSUFFICIENT"
}

/** Parte que ficou de fora: `path` navegável por `inspect_result` (chaves e índices separados por ponto; "(raiz)" = o próprio resultado). */
export type OmittedPart = { path: string; kind: "ITEMS" | "CHARS"; shown: number; total: number }
export type CompactView = { value: unknown; omitted: OmittedPart[]; truncatedText: number; complete: boolean }

const sizeOf = (value: unknown) => JSON.stringify(value ?? null).length
const join = (base: string, part: string | number) => (base ? `${base}.${part}` : String(part))

function trim(value: unknown, cap: number, path: string, omitted: OmittedPart[], counter: { text: number }): unknown {
  if (typeof value === "string") {
    if (value.length <= STRING_MAX_CHARS) return value
    counter.text += 1
    omitted.push({ path: path || ROOT, kind: "CHARS", shown: STRING_MAX_CHARS - 1, total: value.length })
    return `${value.slice(0, STRING_MAX_CHARS - 1)}…`
  }
  if (Array.isArray(value)) {
    if (value.length > cap) omitted.push({ path: path || ROOT, kind: "ITEMS", shown: cap, total: value.length })
    return value.slice(0, cap).map((item, index) => trim(item, cap, join(path, index), omitted, counter))
  }
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, trim(child, cap, join(path, key), omitted, counter)]))
  return value
}

/**
 * Resultado no tamanho que cabe, sem quebrar a estrutura: inteiro quando cabe; senão listas encurtadas por item inteiro (40, 20, 10, 6,
 * 3) e textos longos encurtados — declarando CADA parte que ficou de fora com o caminho para buscá-la. Último recurso: só os campos
 * simples do topo, com cada lista/objeto/texto omitido declarado.
 */
export function compactForModel(value: unknown, budget: number, basePath = ""): CompactView {
  if (sizeOf(value) <= budget) return { value, omitted: [], truncatedText: 0, complete: true }
  for (const cap of ARRAY_CAPS) {
    const omitted: OmittedPart[] = []
    const counter = { text: 0 }
    const trimmed = trim(value, cap, basePath, omitted, counter)
    if (sizeOf(trimmed) <= budget) return { value: trimmed, omitted, truncatedText: counter.text, complete: false }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const shallow: Record<string, unknown> = {}
    const omitted: OmittedPart[] = []
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (Array.isArray(child)) omitted.push({ path: join(basePath, key), kind: "ITEMS", shown: 0, total: child.length })
      else if (child && typeof child === "object") omitted.push({ path: join(basePath, key), kind: "ITEMS", shown: 0, total: Object.keys(child).length })
      else if (typeof child === "string" && child.length > STRING_MAX_CHARS) {
        omitted.push({ path: join(basePath, key), kind: "CHARS", shown: STRING_MAX_CHARS - 1, total: child.length })
        shallow[key] = `${child.slice(0, STRING_MAX_CHARS - 1)}…`
      } else shallow[key] = child
    }
    return { value: shallow, omitted, truncatedText: 0, complete: false }
  }
  if (typeof value === "string") return { value: `${value.slice(0, Math.max(0, Math.min(STRING_MAX_CHARS, budget) - 1))}…`, omitted: [{ path: basePath || ROOT, kind: "CHARS", shown: Math.max(0, Math.min(STRING_MAX_CHARS, budget) - 1), total: value.length }], truncatedText: 1, complete: false }
  return { value: Array.isArray(value) ? [] : null, omitted: [{ path: basePath || ROOT, kind: "ITEMS", shown: 0, total: Array.isArray(value) ? value.length : 1 }], truncatedText: 0, complete: false }
}

/** Parte de cada resultado no orçamento da rodada (cada um com um piso — um resultado grande não cala os outros). */
export const perResultBudget = (count: number) => (count <= 0 ? RESULTS_ROUND_BUDGET_CHARS : Math.max(RESULT_MIN_CHARS, Math.floor(RESULTS_ROUND_BUDGET_CHARS / count)))

/** Caminho "buckets", "data.anomalies", "interactions.3.note" (também aceita "interactions[3]") — só navegação por chave/índice. */
function at(value: unknown, path: string | null): { found: boolean; value: unknown } {
  if (!path || path === ROOT) return { found: true, value }
  let current: unknown = value
  for (const part of path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean)) {
    if (Array.isArray(current) && /^\d+$/.test(part)) current = current[Number(part)]
    else if (current && typeof current === "object" && !Array.isArray(current) && part in (current as Record<string, unknown>)) current = (current as Record<string, unknown>)[part]
    else return { found: false, value: null }
  }
  return { found: current !== undefined, value: current }
}

/** Uma PÁGINA de detalhe. `status`: COMPLETE (o que foi pedido coube inteiro), PARTIAL (há continuação: `next` ou `omitted`), EMPTY
 * (lista/texto vazio), NOT_FOUND (o caminho não existe — `fields` diz o que existe). */
export type DetailPage = {
  status: "COMPLETE" | "PARTIAL" | "EMPTY" | "NOT_FOUND"
  kind: "ITEMS" | "TEXT" | "VALUE" | null
  path: string
  /** Lista: itens [from, to); texto: caracteres [from, to). `total` = itens ou caracteres do campo inteiro. */
  from: number
  to: number
  total: number | null
  /** Onde a próxima página começa (o primeiro item/caractere NÃO mostrado); null = acabou. */
  next: number | null
  value: unknown
  /** Partes de DENTRO desta página que ainda vieram resumidas (ex.: um texto longo dentro de um item) — caminho absoluto. */
  omitted: OmittedPart[]
  fields: string[]
}

/**
 * DETALHE de um resultado já obtido (`inspect_result`), em páginas. Nunca consulta os dados de novo.
 *   - texto: caracteres [offset, offset + limit) EXATOS — limite padrão 4.000, teto 6.000; `next` = offset + limit. Janelas exatas deixam
 *     o planejador pedir várias páginas na mesma rodada (offsets previsíveis); emendar as páginas reproduz o texto sem lacuna;
 *   - lista: a partir do item `offset`, até `limit` itens (teto 40) e 6.000 caracteres — só os que COUBERAM; `next` = o primeiro que não
 *     coube. Um item maior que a página vem resumido, com as partes dele declaradas em `omitted` (caminho absoluto);
 *   - objeto/valor: o campo inteiro se couber; senão resumido com o que faltou em `omitted`.
 */
export function detailOf(value: unknown, input: { path: string | null; offset: number; limit: number | null }): DetailPage {
  const located = at(value, input.path)
  const path = input.path && input.path !== ROOT ? input.path.replace(/\[(\d+)\]/g, ".$1") : ROOT
  const base = path === ROOT ? "" : path
  const fieldsOf = (target: unknown) => (target && typeof target === "object" && !Array.isArray(target) ? Object.keys(target as Record<string, unknown>) : [])
  if (!located.found) return { status: "NOT_FOUND", kind: null, path, from: 0, to: 0, total: null, next: null, value: null, omitted: [], fields: fieldsOf(value) }
  const target = located.value
  if (typeof target === "string") {
    const from = Math.max(0, Math.min(input.offset, target.length))
    const limit = Math.max(1, Math.min(input.limit ?? DETAIL_DEFAULT_TEXT_CHARS, DETAIL_MAX_CHARS))
    const to = Math.min(target.length, from + limit)
    return { status: target.length === 0 ? "EMPTY" : to < target.length ? "PARTIAL" : "COMPLETE", kind: "TEXT", path, from, to, total: target.length, next: to < target.length ? to : null, value: target.slice(from, to), omitted: [], fields: [] }
  }
  if (Array.isArray(target)) {
    const from = Math.max(0, Math.min(input.offset, target.length))
    const wanted = Math.max(1, Math.min(input.limit ?? DETAIL_DEFAULT_ITEMS, DETAIL_MAX_ITEMS))
    const items: unknown[] = []
    const omitted: OmittedPart[] = []
    let used = 2
    for (let index = from; index < target.length && items.length < wanted; index++) {
      const remaining = DETAIL_MAX_CHARS - used
      const whole = sizeOf(target[index]) + 1
      if (whole <= remaining) {
        items.push(target[index])
        used += whole
        continue
      }
      // Não coube inteiro: se já há itens na página, ele abre a PRÓXIMA página (nunca é pulado); se é o primeiro, vem resumido aqui.
      if (items.length > 0) break
      const view = compactForModel(target[index], Math.max(500, remaining), join(base, index))
      items.push(view.value)
      omitted.push(...view.omitted)
      used += sizeOf(view.value) + 1
      break
    }
    const to = from + items.length
    return { status: target.length === 0 ? "EMPTY" : to < target.length || omitted.length > 0 ? "PARTIAL" : "COMPLETE", kind: "ITEMS", path, from, to, total: target.length, next: to < target.length ? to : null, value: items, omitted, fields: [] }
  }
  const view = compactForModel(target, DETAIL_MAX_CHARS, base)
  return { status: view.complete ? "COMPLETE" : "PARTIAL", kind: "VALUE", path, from: 0, to: 0, total: null, next: null, value: view.value, omitted: view.omitted, fields: fieldsOf(target) }
}

/** Campos simples do topo do resultado original (ex.: base de comparação, padrão) — contexto para interpretar a página pedida. */
export function scalarContextOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, child]) => child === null || typeof child === "number" || typeof child === "boolean" || (typeof child === "string" && child.length <= 120)).slice(0, 12))
}
