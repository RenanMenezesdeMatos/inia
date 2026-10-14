/**
 * Cursor do Acompanhamento (keyset): o instante canônico do item (`coalesce(published_at, created_at)`) + id, na MESMA ordem do
 * feed (mais recente primeiro, desempate por id). Opaco para o cliente. O instante vai em UTC com microssegundos, como o
 * PostgreSQL guarda — com milissegundos dois itens do mesmo milissegundo podiam ser pulados ou repetidos entre páginas.
 */
export type FollowUpCursor = { at: string; id: string }

/** Expressão SQL que produz `at` no formato do cursor a partir de um timestamptz. */
export function followUpCursorAtSql(expression: string): string {
  return `to_char((${expression}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
}

const AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const encodeFollowUpCursor = (cursor: FollowUpCursor) => Buffer.from(`${cursor.at}|${cursor.id}`, "utf8").toString("base64url")

/** Ausente ou inválido (adulterado, formato antigo) = null — a rota distingue os dois e recusa o inválido (400). */
export function decodeFollowUpCursor(value: string | null | undefined): FollowUpCursor | null {
  if (!value) return null
  const [at, id] = Buffer.from(value, "base64url").toString("utf8").split("|")
  if (!at || !id || !AT_PATTERN.test(at) || !ID_PATTERN.test(id)) return null
  return { at, id }
}
