/**
 * Posição (keyset) do seletor de bases do Agent: a lista anda em ordem de título sem acento e caixa, com o id desempatando. O cursor é
 * opaco para a tela (base64url de `[chaveDoTítulo, id]`); cursor que não decodifica é recusado (400), nunca vira "começo da lista".
 */
export type KnowledgeOptionsCursor = { key: string; id: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function encodeKnowledgeOptionsCursor(cursor: KnowledgeOptionsCursor): string {
  return Buffer.from(JSON.stringify([cursor.key, cursor.id]), "utf8").toString("base64url")
}

export function decodeKnowledgeOptionsCursor(raw: string): KnowledgeOptionsCursor | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
    if (!Array.isArray(value) || value.length !== 2) return null
    const [key, id] = value as unknown[]
    if (typeof key !== "string" || key.length > 1000 || typeof id !== "string" || !UUID.test(id)) return null
    return { key, id }
  } catch {
    return null
  }
}

/** Termo da busca na mesma forma da chave do SQL (`foldSql`): minúsculas e sem acento. */
export function foldSearchTerm(term: string): string {
  return term.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim()
}

const ACCENTED = "áàâãäåéèêëíìîïóòôõöúùûüçñ"
const PLAIN = "aaaaaaeeeeiiiiooooouuuucn"

/** Expressão SQL que dobra um texto para comparação: minúsculas e sem acento (sem depender da extensão unaccent). */
export const foldSql = (expression: string) => `translate(lower(${expression}), '${ACCENTED}', '${PLAIN}')`
