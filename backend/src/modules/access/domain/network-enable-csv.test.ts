import { describe, expect, it } from "vitest"
import { networkAccessIssueOf, networkAccountIdentifier, networkLoginOf } from "./network-access.js"
import { NETWORK_ENABLE_CSV_MAX_ROWS, networkEnableTemplate, readNetworkEnableCsv } from "./network-enable-csv.js"

const read = (text: string) => readNetworkEnableCsv(Buffer.from(text, "utf8"))
const logins = (text: string) => {
  const result = read(text)
  return result.ok ? result.rows.map((row) => row.networkLogin) : result.error
}

describe("CSV de habilitação pela rede", () => {
  it("o modelo é lido sem erro de formato e a linha de exemplo nunca conta", () => {
    expect(networkEnableTemplate().startsWith("\ufeffmatricula;email")).toBe(true)
    expect(read(networkEnableTemplate())).toEqual({ ok: false, error: "EMPTY" })
    expect(logins(`${networkEnableTemplate()}G0055350;\r\n`)).toEqual(["G0055350"])
  })
  it("aceita o que o Excel salva: `;` `,` tab `|`, BOM, aspas, CRLF, CR e linhas vazias no fim", () => {
    for (const delimiter of [";", ",", "\t", "|"]) expect(logins(`\ufeffMatrícula${delimiter}E-mail\r\ng0055350${delimiter}a@b.co\r\n"R0055351"${delimiter}\r\n${delimiter}\r\n${delimiter}\r\n`)).toEqual(["G0055350", "R0055351"])
    expect(logins("matricula\rG0055350\rG0055351")).toEqual(["G0055350", "G0055351"])
  })
  it("Windows-1252 (o CSV do Excel) e UTF-16: o cabeçalho com acento é reconhecido", () => {
    const latin = readNetworkEnableCsv(Buffer.from("Matrícula;Email\r\nG0055350;\r\n", "latin1"))
    expect(latin).toMatchObject({ ok: true, rows: [{ networkLogin: "G0055350" }] })
    const utf16 = readNetworkEnableCsv(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("matricula\temail\r\nG0055350\t\r\n", "utf16le")]))
    expect(utf16).toMatchObject({ ok: true, rows: [{ networkLogin: "G0055350" }] })
  })
  it("lista de matrículas sem cabeçalho (uma coluna) vale; várias colunas sem cabeçalho, não — nunca adivinha", () => {
    expect(logins("G0055350\nG0055351\n")).toEqual(["G0055350", "G0055351"])
    expect(logins("G0055350;Fulano\nG0055351;Beltrano\n")).toBe("NO_MATRICULA_COLUMN")
    expect(logins("nome\nFulano\n")).toBe("NO_MATRICULA_COLUMN")
  })
  it("número da linha é o do arquivo, mesmo com linhas vazias e quebra dentro de aspas", () => {
    const result = read('matricula;email;obs\n\nG1111111;;"duas\nlinhas"\n\nG2222222;;\n')
    expect(result).toMatchObject({ ok: true, rows: [{ line: 3, networkLogin: "G1111111" }, { line: 6, networkLogin: "G2222222" }], ignoredColumns: ["obs"] })
  })
  it("matrícula inválida e e-mail inválido ficam na linha, sem derrubar o arquivo", () => {
    const result = read("matricula;email\nG00 55;\n;a@b.co\nG0055350;sem-arroba\nREDE\\g0055351;X@Y.co\n=cmd|calc;\n")
    expect(result).toMatchObject({ ok: true, rows: [
      { networkLogin: null }, { matricula: "", networkLogin: null, email: "a@b.co" }, { networkLogin: "G0055350", emailInvalid: true },
      { networkLogin: "G0055351", email: "x@y.co", emailInvalid: false }, { networkLogin: null },
    ] })
  })
  it("planilha, arquivo binário, vazio e grande demais têm erro próprio", () => {
    expect(readNetworkEnableCsv(Buffer.from([0x50, 0x4b, 3, 4]))).toEqual({ ok: false, error: "NOT_CSV" })
    expect(readNetworkEnableCsv(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))).toEqual({ ok: false, error: "NOT_CSV" })
    expect(readNetworkEnableCsv(Buffer.from([0x01, 0x00, 0x02, 0xff]))).toEqual({ ok: false, error: "NOT_CSV" })
    expect(read("")).toEqual({ ok: false, error: "EMPTY" })
    expect(read("matricula;email\n")).toEqual({ ok: false, error: "EMPTY" })
    const many = (count: number) => `matricula\n${Array.from({ length: count }, (_, index) => `G${index}00`).join("\n")}`
    expect(read(many(NETWORK_ENABLE_CSV_MAX_ROWS))).toMatchObject({ ok: true })
    expect(read(many(NETWORK_ENABLE_CSV_MAX_ROWS + 1))).toEqual({ ok: false, error: "TOO_MANY_ROWS" })
  })
})

describe("acesso pela rede — regras", () => {
  it("login de rede do cadastro: só o que o login encontraria (sem as tolerâncias da digitação)", () => {
    expect(networkLoginOf(" g0055350 ")).toBe("G0055350")
    for (const value of [null, "", "  ", "G00 55", "G0055350@empresa.local", "REDE\\G0055350", "\u200bG0055350", "G0055350\u00a0", "\tG0055350"]) expect(networkLoginOf(value)).toBeNull()
  })
  it("o que impede a entrada, na ordem", () => {
    const base = { personActive: true, matricula: "G0055350", duplicated: false }
    expect(networkAccessIssueOf(base)).toBeNull()
    expect(networkAccessIssueOf({ ...base, personActive: false, matricula: null })).toBe("PERSON_INACTIVE")
    expect(networkAccessIssueOf({ ...base, matricula: " " })).toBe("MATRICULA_MISSING")
    expect(networkAccessIssueOf({ ...base, matricula: "G 1" })).toBe("MATRICULA_INVALID")
    expect(networkAccessIssueOf({ ...base, duplicated: true })).toBe("MATRICULA_DUPLICATED")
  })
  it("conta sem e-mail é identificada pelo nome do AD; domínio ausente ou sem ponto pede o e-mail", () => {
    expect(networkAccountIdentifier("G0055350", "Empresa.Local")).toBe("g0055350@empresa.local")
    expect(networkAccountIdentifier("G0055350", null)).toBeNull()
    expect(networkAccountIdentifier("G0055350", "REDE")).toBeNull()
  })
})
