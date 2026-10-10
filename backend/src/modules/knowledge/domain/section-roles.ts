/**
 * V1.7.1d — PAPEL ESTRUTURAL DE UMA SEÇÃO da base (pelo TÍTULO da seção — ou do documento, quando ele não tem seções), nunca
 * pelo conteúdo da chamada. Serve ao PLANO DE COBERTURA: quando a chamada chega à fase de fechamento, as seções que avaliam essa
 * fase (checklist, recapitulação, confirmação de entendimento, encerramento) precisam estar diante do especialista, e o ranking
 * lexical sozinho não garante isso (nada na fala coincide com "Recapitulei as ações?").
 */
export const CLOSING_SECTION_ROLES = ["CHECKLIST", "RECAP", "UNDERSTANDING_CHECK", "CLOSING"] as const
export type ClosingSectionRole = (typeof CLOSING_SECTION_ROLES)[number]

const ROLE_PATTERNS: readonly [ClosingSectionRole, RegExp][] = [
  ["CHECKLIST", /(?<!\p{L})check-?list(?!\p{L})/iu],
  ["RECAP", /(?<!\p{L})recapitula\p{L}*/iu],
  ["UNDERSTANDING_CHECK", /(?<!\p{L})confirma[çc][ãa]o\s+(?:de|do|da)\s+(?:entendimento|resolu[çc][ãa]o|compreens[ãa]o)/iu],
  ["CLOSING", /(?<!\p{L})encerramento(?!\p{L})/iu],
]

export function closingSectionRoleOf(heading: string, documentTitle: string): ClosingSectionRole | null {
  const target = heading.trim().length > 0 ? heading : documentTitle
  for (const [role, pattern] of ROLE_PATTERNS) if (pattern.test(target)) return role
  return null
}

/**
 * V1.7.1l — PAPEL DE PROCESSO DA SEÇÃO (`SECTION_PROCESS_ROLE_V1`, domínio puro, sem LLM, derivado do documento PUBLICADO).
 *
 * O tipo do CONTEÚDO de um trecho (regra × exemplo × evitar — `knowledge-segments.ts`) não responde se ele é uma ETAPA que o
 * operador executa. No smoke V1.7.1k a lista de "1. Objetivo" ("Identificação correta da cobrança…; Informação sobre valores,
 * prazos e canais…") virou etapa avaliada — e memória analítica falsa. Esta é a segunda dimensão, pelo TÍTULO da seção (e dos
 * títulos acima dela: "3.1 Contestação" herda "3. Conceitos"; documento sem seções usa o próprio título):
 *
 *   não executáveis   OBJECTIVE (objetivo, finalidade) · SCOPE (abrangência, escopo, público) · CONTEXT (conceitos, definições,
 *                     glossário, introdução) · RESULT_EXPECTATION (resultado esperado) · REFERENCE (referências, anexos,
 *                     indicadores, histórico de versões) · EXAMPLE_SECTION (exemplos, frases/perguntas recomendadas, modelo
 *                     completo, frases de condução);
 *   executáveis       PROCEDURE_STEP · CHECKLIST · DECISION_RULE · CONDITION · WARNING (evitar, proibido, falhas críticas);
 *   UNKNOWN           título sem papel reconhecido — continua elegível (comportamento anterior; nunca descarta em silêncio).
 *
 * É derivável de forma estável do documento publicado: não é persistido.
 */
export const SECTION_PROCESS_ROLE_VERSION = "SECTION_PROCESS_ROLE_V1" as const
export const SECTION_PROCESS_ROLES = ["OBJECTIVE", "SCOPE", "CONTEXT", "PROCEDURE_STEP", "CHECKLIST", "DECISION_RULE", "CONDITION", "WARNING", "RESULT_EXPECTATION", "REFERENCE", "EXAMPLE_SECTION", "UNKNOWN"] as const
export type SectionProcessRole = (typeof SECTION_PROCESS_ROLES)[number]
/** Seções cujo conteúdo explica o processo mas nunca é uma etapa que o operador executa. */
export const NON_EXECUTABLE_SECTION_ROLES: readonly SectionProcessRole[] = ["OBJECTIVE", "SCOPE", "CONTEXT", "RESULT_EXPECTATION", "REFERENCE", "EXAMPLE_SECTION"]
export const isExecutableSectionRole = (role: SectionProcessRole) => !NON_EXECUTABLE_SECTION_ROLES.includes(role)

const foldHeading = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/^\s*\d+(?:\.\d+)*\.?\s+/u, "").replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim()

// Ordem importa: "Frases que devem ser evitadas" é WARNING antes de EXAMPLE_SECTION; "Resultado esperado" antes de DECISION_RULE.
const PROCESS_ROLE_PATTERNS: readonly [SectionProcessRole, RegExp][] = [
  ["WARNING", /(?<!\p{L})(?:evitad\p{L}*|evitar|proibid\p{L}*|vedad\p{L}*|falhas?\s+criticas?|nao\s+(?:dizer|fazer|deve|recomendad\p{L}*))(?!\p{L})/u],
  ["CHECKLIST", /(?<!\p{L})(?:check-?list|criterios?\s+de\s+(?:qualidade|avaliacao))(?!\p{L})/u],
  ["OBJECTIVE", /^(?:objetivos?|finalidade|proposito)(?!\p{L})/u],
  ["SCOPE", /^(?:abrangencia|escopo|aplicacao|publico(?:-alvo)?|quando\s+(?:se\s+)?aplica)(?!\p{L})/u],
  ["CONTEXT", /^(?:conceitos?|definicoes|definicao|glossario|introducao|contexto|visao\s+geral|termos)(?!\p{L})/u],
  ["RESULT_EXPECTATION", /(?<!\p{L})(?:resultados?\s+esperados?|expectativa\s+de\s+resultado)(?!\p{L})/u],
  ["REFERENCE", /^(?:referencias?|anexos?|documentos?\s+relacionados?|indicadores?|historico\s+de\s+versoes|controle\s+de\s+versoes|bibliografia)(?!\p{L})/u],
  ["EXAMPLE_SECTION", /(?<!\p{L})(?:exemplos?|modelos?(?:\s+recomendad\p{L}*)?$|modelo\s+completo|(?:frases|perguntas|falas|expressoes)\s+(?:recomendad\p{L}*|sugerid\p{L}*|de\s+conducao)|script|roteiro\s+sugerido)(?!\p{L})/u],
  ["DECISION_RULE", /^(?:determinacao|classificacao|criterios?|regras?|decisao|alcada|principios?|diretrizes?)(?!\p{L})/u],
  ["CONDITION", /^(?:quando|em\s+caso|casos?\s+de|situacoes?)(?!\p{L})/u],
  ["PROCEDURE_STEP", /(?<!\p{L})(?:procedimentos?|fluxo|passo\s+a\s+passo|etapas?|recapitula\p{L}*|confirmacao|encerramento|apresentacao|escuta|validacao|consulta|abertura|registro|transferencia|orientac\p{L}*|tratamento|atendimento)(?!\p{L})/u],
]

/** Papel de processo pelo TÍTULO de uma seção (sem hierarquia). */
export function sectionProcessRoleOf(heading: string | null | undefined): SectionProcessRole {
  const target = foldHeading(heading ?? "")
  if (target.length === 0) return "UNKNOWN"
  for (const [role, pattern] of PROCESS_ROLE_PATTERNS) if (pattern.test(target)) return role
  return "UNKNOWN"
}

const MARKDOWN_HEADING = /^\s*(#{1,6})\s+(.*)$/
/**
 * Papel de processo de uma seção NO DOCUMENTO publicado: o próprio título; UNKNOWN herda o do título-pai (nível menor, exceto o
 * título do documento); seção não encontrada = só o título; sem seção = o título do documento.
 */
export function sectionProcessRoleIn(content: string, heading: string | null | undefined, documentTitle: string): SectionProcessRole {
  if (!heading || heading.trim().length === 0) return sectionProcessRoleOf(documentTitle)
  const headings = content.split(/\r?\n/).flatMap((line) => { const match = MARKDOWN_HEADING.exec(line); return match ? [{ level: match[1]!.length, text: match[2]! }] : [] })
  // Título idêntico primeiro (com a numeração: "3.5 Conta ajustada" ≠ "32. Conta ajustada"); só depois sem a numeração.
  const exact = (text: string) => text.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim().toLowerCase()
  const exactIndex = headings.findIndex((entry) => exact(entry.text) === exact(heading))
  const index = exactIndex >= 0 ? exactIndex : headings.findIndex((entry) => foldHeading(entry.text) === foldHeading(heading))
  if (index < 0) return sectionProcessRoleOf(heading)
  let level = headings[index]!.level
  for (let position = index; position >= 0; position -= 1) {
    const entry = headings[position]!
    if (position !== index && entry.level >= level) continue
    if (entry.level <= 1 && position !== index) break
    const role = sectionProcessRoleOf(entry.text)
    if (role !== "UNKNOWN") return role
    level = entry.level
  }
  return "UNKNOWN"
}

/** Papel de cada seção de um documento (título limpo → papel), para marcar os trechos apresentados ao especialista. */
export function sectionProcessRolesOf(content: string, documentTitle: string): (heading: string | null | undefined) => SectionProcessRole {
  const cache = new Map<string, SectionProcessRole>()
  return (heading) => {
    const key = heading ?? ""
    if (!cache.has(key)) cache.set(key, sectionProcessRoleIn(content, heading, documentTitle))
    return cache.get(key)!
  }
}
