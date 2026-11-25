import { decodeBytes, detectDelimiter, splitCsv } from "../../data-hub/domain/csv-parser.js"
import { normalizeNetworkLogin } from "../../auth/domain/network-login.js"
import { isEmail } from "./network-access.js"

/**
 * CSV DE HABILITAÇÃO EM MASSA PELA REDE — leitura pura. Contrato do modelo: coluna `matricula` (obrigatória) e `email` (opcional).
 * Aceita o que o Excel brasileiro salva: separador `;`, `,`, tab ou `|`, BOM, aspas, UTF-8 ou Windows-1252, e uma coluna só sem
 * cabeçalho. Coluna desconhecida é ignorada (e avisada) — nunca interpretada: o arquivo não concede papel nem muda cadastro.
 */
export const NETWORK_ENABLE_CSV_MAX_ROWS = 5_000
export const NETWORK_ENABLE_CSV_MAX_BYTES = 700_000
/** Linha de exemplo do modelo: ignorada na leitura, para ninguém habilitar (nem receber erro de) um exemplo esquecido. */
export const NETWORK_ENABLE_EXAMPLE_PREFIX = "EXEMPLO"
export const NETWORK_ENABLE_TEMPLATE_FILE = "modelo-habilitar-acesso-pela-rede.csv"

export type NetworkEnableCsvRow = { line: number; matricula: string; networkLogin: string | null; email: string | null; emailInvalid: boolean }
export type NetworkEnableCsv = { ok: true; rows: NetworkEnableCsvRow[]; ignoredColumns: string[] } | { ok: false; error: "EMPTY" | "NO_MATRICULA_COLUMN" | "TOO_MANY_ROWS" | "NOT_CSV" }

const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "")
const MATRICULA_HEADERS = new Set(["matricula", "login", "loginderede", "matriculaderede", "usuario", "usuarioderede", "re"])
const EMAIL_HEADERS = new Set(["email", "emailcorporativo", "correio"])

/** Modelo para baixar: BOM + `;` (abre em colunas no Excel brasileiro). */
export function networkEnableTemplate(): string {
  return `\ufeffmatricula;email\r\n${NETWORK_ENABLE_EXAMPLE_PREFIX}-G0000000;nome@empresa.com.br\r\n`
}

/** Bytes do arquivo → texto: UTF-8 válido, ou Windows-1252 (o "CSV" do Excel), ou UTF-16 com BOM ("Texto Unicode"). */
export function decodeCsv(bytes: Uint8Array): string | null {
  // Planilha (.xlsx/.xls) renomeada ou escolhida por engano.
  if ((bytes[0] === 0x50 && bytes[1] === 0x4b) || (bytes[0] === 0xd0 && bytes[1] === 0xcf)) return null
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2))
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return text.includes("\u0000") ? null : text.replace(/^\ufeff/, "")
  } catch {
    const text = decodeBytes(bytes, "windows-1252")
    return text.includes("\u0000") ? null : text
  }
}

export function readNetworkEnableCsv(bytes: Uint8Array): NetworkEnableCsv {
  const text = decodeCsv(bytes)
  if (text === null) return { ok: false, error: "NOT_CSV" }
  // `splitCsv` pula linhas vazias: o número da linha que a pessoa vê no Excel vem da contagem das quebras até ela.
  const table = splitWithLines(text)
  if (table.length === 0) return { ok: false, error: "EMPTY" }
  const header = table[0]!.cells.map(fold)
  const matriculaIndex = header.findIndex((name) => MATRICULA_HEADERS.has(name))
  const emailIndex = header.findIndex((name) => EMAIL_HEADERS.has(name))
  // Sem cabeçalho só quando o arquivo é uma lista de matrículas (uma coluna) — nunca adivinha qual coluna é qual.
  const headerless = matriculaIndex < 0 && table.every((row) => row.cells.filter((cell) => cell.trim() !== "").length <= 1) && /\d/.test(table[0]!.cells[0] ?? "")
  if (matriculaIndex < 0 && !headerless) return { ok: false, error: "NO_MATRICULA_COLUMN" }
  const body = (headerless ? table : table.slice(1)).filter((row) => !(row.cells[headerless ? 0 : matriculaIndex] ?? "").trim().toUpperCase().startsWith(NETWORK_ENABLE_EXAMPLE_PREFIX))
  const rows = body
    .map(({ line, cells }): NetworkEnableCsvRow => {
      const matricula = (cells[headerless ? 0 : matriculaIndex] ?? "").trim()
      const email = emailIndex >= 0 ? (cells[emailIndex] ?? "").trim().toLowerCase() : ""
      return { line, matricula: matricula.slice(0, 80), networkLogin: normalizeNetworkLogin(matricula), email: email || null, emailInvalid: email !== "" && !isEmail(email) }
    })
    // Linha só com separadores (o Excel deixa dezenas no fim) não é erro.
    .filter((row) => row.matricula !== "" || row.email !== null)
  if (rows.length === 0) return { ok: false, error: "EMPTY" }
  if (rows.length > NETWORK_ENABLE_CSV_MAX_ROWS) return { ok: false, error: "TOO_MANY_ROWS" }
  const ignoredColumns = headerless ? [] : table[0]!.cells.map((cell) => cell.trim()).filter((cell, index) => cell !== "" && index !== matriculaIndex && index !== emailIndex).map((cell) => cell.slice(0, 60))
  return { ok: true, rows, ignoredColumns: ignoredColumns.slice(0, 20) }
}

/** Linhas não vazias com o número que elas têm no arquivo (quebra de linha dentro de aspas conta como linhas do arquivo). */
function splitWithLines(text: string): { line: number; cells: string[] }[] {
  const delimiter = detectDelimiter(text)
  const rows: { line: number; cells: string[] }[] = []
  let start = 0
  let line = 1
  let inQuotes = false
  const push = (end: number) => {
    const cells = splitCsv(text.slice(start, end), delimiter)[0]
    if (cells) rows.push({ line, cells })
  }
  let breaks = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') inQuotes = !inQuotes
    const newline = char === "\n" || (char === "\r" && text[index + 1] !== "\n")
    if (!newline) continue
    breaks += 1
    if (inQuotes) continue
    push(char === "\n" && text[index - 1] === "\r" ? index - 1 : index)
    start = index + 1
    line = breaks + 1
  }
  if (start < text.length) push(text.length)
  return rows
}
