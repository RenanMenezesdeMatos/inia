import { createHash } from "node:crypto"
import { z } from "zod"

/**
 * TEMAS DAS PRÁTICAS (`PRACTICE_THEMES_V1`) — como a liderança LÊ os pontos do processo.
 *
 * Uma prática é uma conduta ("Informar o prazo da análise da contestação exibido na ferramenta"); uma operação tem dezenas. O
 * Diagnóstico mostra primeiro os TEMAS (o momento ou o assunto do atendimento em que as condutas acontecem) e, dentro de cada um, os
 * pontos pelo NOME CURTO; o título da conduta continua sendo a descrição completa do ponto.
 *
 * Quem decide o tema e o nome curto é a LEITURA do modelo — nunca palavra, regex ou uma lista fixa de temas (os temas são dados da
 * organização e crescem com ela). O código só confere a forma (cada prática uma vez, tema existente ou novo com nome, nome curto
 * presente e curto) e registra. Uma vez por prática; ninguém aprova. Tema é agrupamento de LEITURA: nunca entra em contagem de
 * reincidência, firmeza ou padrão — esses continuam pela prática.
 */
export const PRACTICE_THEMES_VERSION = "PRACTICE_THEMES_V1" as const
export const PRACTICE_THEMES_PROMPT_VERSION = "PRACTICE_THEMES_PROMPT_V1" as const

/** Tema já registrado, com os pontos que já estão nele (o que o modelo precisa para reconhecer o mesmo momento ou assunto). */
export type CatalogTheme = { themeKey: string; title: string; points: string[] }
/** Prática a agrupar: o título da conduta e até duas regras de onde ela vem. */
export type PracticeToTheme = { practiceKey: string; title: string; examples: { sourceTitle: string; heading: string | null; text: string }[] }
export type PracticeThemeAssignment = { practiceKey: string; themeKey: string; shortTitle: string; basis: "EXISTING_THEME" | "NEW_THEME" }
export type PracticeThemeResult = {
  themes: { themeKey: string; title: string }[]
  assignments: PracticeThemeAssignment[]
  /** Práticas que a resposta não agrupou de forma válida — continuam sem tema e voltam na próxima vez. */
  unassigned: { practiceKey: string; reason: "MISSING" | "DUPLICATE" | "UNKNOWN_THEME" | "NEW_WITHOUT_TITLE" | "SHORT_TITLE_INVALID" }[]
}

/** Chave do tema NOVO: derivada da primeira prática que o criou (determinística — execuções concorrentes chegam à mesma chave). */
export const newThemeKeyOf = (firstPracticeKey: string) => `KT-${createHash("sha256").update(`THEME|${firstPracticeKey}`).digest("hex").slice(0, 12)}`

/** Práticas por pedido (cada pedido vê os temas que os anteriores criaram). Uma prática pesa bem menos que uma regra com a lista. */
export const PRACTICES_PER_THEME_REQUEST = 60
/** Limites de FORMA do que vira rótulo de tela (nome curto do ponto e nome do tema). Fora disso a prática fica sem tema e volta. */
export const SHORT_TITLE_MAX_CHARS = 60
export const THEME_TITLE_MAX_CHARS = 48

export const PRACTICE_THEMES_SYSTEM_PROMPT = `Você organiza as PRÁTICAS de uma operação de atendimento em TEMAS, para a liderança ler o diagnóstico da equipe. Uma prática é uma conduta que se espera do operador. Um TEMA é o momento ou o assunto do atendimento em que um grupo de práticas acontece, do jeito que um supervisor separaria os assuntos numa conversa com a equipe.

Para cada prática P-n:
1. Escolha o tema pelo SENTIDO da conduta:
   - um tema já conhecido (T-n), quando a prática acontece naquele momento ou trata daquele assunto;
   - um tema novo (N-n), só quando nenhum conhecido serve. Dê a ele um nome de 1 a 4 palavras. Várias práticas desta lista podem ir para o mesmo tema novo.
   Um tema junta VÁRIAS práticas: evite um tema para uma prática só quando ela cabe num tema maior. Evite também um tema tão amplo que junte momentos diferentes do atendimento (um tema "Atendimento" ou "Procedimentos" não ajuda ninguém).
2. Escreva um NOME CURTO para a prática (2 a 6 palavras), que a identifique numa lista dentro do tema — por exemplo, na forma de "Prazo da análise". O nome curto nunca muda a conduta: não acrescente nem tire condição, objeto ou proibição; numa proibição, deixe claro que é algo a evitar. Não repita o nome do tema.

Responda só o JSON pedido. Cada prática P-n aparece exatamente uma vez em "assignments". Todo tema N-n usado precisa estar em "newThemes" com o nome.`

/**
 * Esquema da resposta com LISTAS FECHADAS: a prática é uma das P-n apresentadas e o tema é um dos T-n conhecidos ou um N-n novo — o
 * modelo escolhe, o código só confere a escolha exata.
 */
export function practiceThemesSchemaFor(catalogSize: number, practiceCount: number): Record<string, unknown> {
  const practices = Array.from({ length: practiceCount }, (_, index) => `P${index + 1}`)
  const fresh = Array.from({ length: practiceCount }, (_, index) => `N${index + 1}`)
  const known = Array.from({ length: catalogSize }, (_, index) => `T${index + 1}`)
  return {
    type: "object",
    properties: {
      assignments: { type: "array", items: { type: "object", properties: { practice: { type: "string", enum: practices }, theme: { type: "string", enum: [...known, ...fresh] }, shortTitle: { type: "string" } }, required: ["practice", "theme", "shortTitle"] } },
      newThemes: { type: "array", items: { type: "object", properties: { ref: { type: "string", enum: fresh }, title: { type: "string" } }, required: ["ref", "title"] } },
    },
    required: ["assignments", "newThemes"],
  }
}

/** Pedido do usuário: temas conhecidos (T-n, com os pontos que já têm) e práticas a agrupar (P-n). Determinístico para a mesma entrada. */
export function renderPracticeThemesTurn(catalog: readonly CatalogTheme[], practices: readonly PracticeToTheme[]): string {
  const known = catalog.map((theme, index) => ({ ref: `T${index + 1}`, theme: theme.title, points: theme.points }))
  const items = practices.map((practice, index) => ({ ref: `P${index + 1}`, conduct: practice.title, rules: practice.examples.map((example) => `${example.sourceTitle}${example.heading ? ` · ${example.heading}` : ""}: ${example.text}`) }))
  return [
    `TEMAS JÁ CONHECIDOS (${known.length}):`,
    known.length > 0 ? JSON.stringify(known, null, 1) : "(nenhum ainda)",
    "",
    `PRÁTICAS A AGRUPAR (${items.length}):`,
    JSON.stringify(items, null, 1),
  ].join("\n")
}

const responseSchema = z.object({
  assignments: z.array(z.unknown()).catch([]),
  newThemes: z.array(z.unknown()).catch([]),
})
const assignmentSchema = z.object({ practice: z.string().trim().min(1), theme: z.string().trim().min(1), shortTitle: z.string() })
const newThemeSchema = z.object({ ref: z.string().trim().min(1), title: z.string() })
const clean = (value: string) => value.split(/\s+/).filter(Boolean).join(" ")

/**
 * Lê a resposta e confere SÓ a forma: cada prática uma vez, tema conhecido existente ou novo declarado com nome, nome curto presente e
 * dentro do limite. O que não passa fica sem tema (e volta na próxima vez) — nunca é "consertado" (nem cortado) pelo código.
 */
export function parsePracticeThemes(text: string, catalog: readonly CatalogTheme[], practices: readonly PracticeToTheme[]): { ok: true; result: PracticeThemeResult } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: "INVALID_JSON" }
  }
  const parsed = responseSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: "INVALID_SHAPE" }
  const practiceIndex = new Map(practices.map((_, index) => [`P${index + 1}`, index]))
  const knownByRef = new Map(catalog.map((theme, index) => [`T${index + 1}`, theme]))
  const freshRefs = new Set(practices.map((_, index) => `N${index + 1}`))
  const code = (value: string) => value.trim().toUpperCase()
  const titles = new Map<string, string>()
  for (const entry of parsed.data.newThemes) {
    const item = newThemeSchema.safeParse(entry)
    if (!item.success) continue
    const ref = code(item.data.ref)
    const title = clean(item.data.title)
    if (freshRefs.has(ref) && title.length > 0 && title.length <= THEME_TITLE_MAX_CHARS && !titles.has(ref)) titles.set(ref, title)
  }
  const chosen = new Map<number, { theme: string; shortTitle: string }[]>()
  for (const entry of parsed.data.assignments) {
    const item = assignmentSchema.safeParse(entry)
    if (!item.success) continue
    const index = practiceIndex.get(code(item.data.practice))
    if (index === undefined) continue
    chosen.set(index, [...(chosen.get(index) ?? []), { theme: code(item.data.theme), shortTitle: clean(item.data.shortTitle) }])
  }
  const result: PracticeThemeResult = { themes: [], assignments: [], unassigned: [] }
  const created = new Map<string, string>()
  practices.forEach((practice, index) => {
    const answers = chosen.get(index) ?? []
    if (answers.length === 0) return result.unassigned.push({ practiceKey: practice.practiceKey, reason: "MISSING" })
    if (answers.length > 1) return result.unassigned.push({ practiceKey: practice.practiceKey, reason: "DUPLICATE" })
    const answer = answers[0]!
    if (answer.shortTitle.length === 0 || answer.shortTitle.length > SHORT_TITLE_MAX_CHARS) return result.unassigned.push({ practiceKey: practice.practiceKey, reason: "SHORT_TITLE_INVALID" })
    const known = knownByRef.get(answer.theme)
    if (known) return result.assignments.push({ practiceKey: practice.practiceKey, themeKey: known.themeKey, shortTitle: answer.shortTitle, basis: "EXISTING_THEME" })
    if (!freshRefs.has(answer.theme)) return result.unassigned.push({ practiceKey: practice.practiceKey, reason: "UNKNOWN_THEME" })
    const title = titles.get(answer.theme)
    if (!title) return result.unassigned.push({ practiceKey: practice.practiceKey, reason: "NEW_WITHOUT_TITLE" })
    let themeKey = created.get(answer.theme)
    if (!themeKey) {
      themeKey = newThemeKeyOf(practice.practiceKey)
      created.set(answer.theme, themeKey)
      result.themes.push({ themeKey, title })
    }
    return result.assignments.push({ practiceKey: practice.practiceKey, themeKey, shortTitle: answer.shortTitle, basis: "NEW_THEME" })
  })
  return { ok: true, result }
}
