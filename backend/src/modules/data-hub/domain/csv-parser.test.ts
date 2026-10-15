import { describe, expect, it } from "vitest"
import { detectDelimiter, parseCsv, splitCsv } from "./csv-parser.js"

describe("csv-parser", () => {
  it("autodetecta ; , tab e |", () => {
    expect(detectDelimiter("a;b;c\n1;2;3\n")).toBe(";")
    expect(detectDelimiter("a,b,c\n1,2,3\n")).toBe(",")
    expect(detectDelimiter("a\tb\tc\n1\t2\t3\n")).toBe("\t")
    expect(detectDelimiter("a|b|c\n1|2|3\n")).toBe("|")
    // Vírgula dentro de aspas não confunde a detecção.
    expect(detectDelimiter('nome;obs\n"Ana, Silva";x\n')).toBe(";")
  })

  it("campo entre aspas com vírgulas e quebras de linha não engana a detecção (transcrições da homologação)", () => {
    const transcript = [
      "id_interacao;matricula;transcricao",
      'INT-1;OP-1;"CLIENTE: Oi, tudo bem? Quero cancelar, por favor.',
      "AGENTE: Claro, posso ajudar.",
      'CLIENTE: Obrigado, até logo."',
      'INT-2;OP-2;"AGENTE: Bom dia, em que posso ajudar?',
      'CLIENTE: A fatura veio errada, de novo, e eu já liguei, duas vezes."',
      'INT-3;OP-1;"CLIENTE: Só uma dúvida, rápida."',
      "",
    ].join("\r\n")
    expect(detectDelimiter(transcript)).toBe(";")
    const table = parseCsv(new TextEncoder().encode(transcript), { encoding: "utf-8", delimiter: "auto", hasHeader: true, skipRows: 0 })
    expect(table.delimiter).toBe(";")
    expect(table.columns).toEqual(["id_interacao", "matricula", "transcricao"])
    expect(table.totalRows).toBe(3)
    expect(table.rows[0]).toEqual({ id_interacao: "INT-1", matricula: "OP-1", transcricao: "CLIENTE: Oi, tudo bem? Quero cancelar, por favor.\r\nAGENTE: Claro, posso ajudar.\r\nCLIENTE: Obrigado, até logo." })
    expect(table.rows[1]!.transcricao).toContain("de novo, e eu já liguei, duas vezes.")
    // O mesmo arquivo com vírgula de verdade continua sendo vírgula.
    expect(detectDelimiter(transcript.replaceAll(";", ","))).toBe(",")
  })

  it("respeita aspas, escape de aspas e quebra de linha dentro de aspas", () => {
    const rows = splitCsv('id;texto\n1;"linha 1\nlinha 2"\n2;"diz ""oi"""\n', ";")
    expect(rows).toEqual([
      ["id", "texto"],
      ["1", "linha 1\nlinha 2"],
      ["2", 'diz "oi"'],
    ])
  })

  it("lê UTF-8 com BOM e Windows-1252", () => {
    const utf8 = new TextEncoder().encode("﻿nome;cidade\nJoão;São Paulo\n")
    const table = parseCsv(utf8, { encoding: "utf-8", delimiter: "auto", hasHeader: true, skipRows: 0 })
    expect(table.columns).toEqual(["nome", "cidade"])
    expect(table.rows[0]).toEqual({ nome: "João", cidade: "São Paulo" })

    const latin = new Uint8Array([0x6e, 0x6f, 0x6d, 0x65, 0x0a, 0x4a, 0x6f, 0xe3, 0x6f, 0x0a]) // "nome\nJoão\n" em windows-1252
    const latinTable = parseCsv(latin, { encoding: "windows-1252", delimiter: "auto", hasHeader: true, skipRows: 0 })
    expect(latinTable.rows[0]).toEqual({ nome: "João" })
  })

  it("aplica limite de amostra sem perder o total, e nomeia colunas vazias", () => {
    const bytes = new TextEncoder().encode("a,,c\n1,2,3\n4,5,6\n7,8,9\n")
    const table = parseCsv(bytes, { encoding: "utf-8", delimiter: ",", hasHeader: true, skipRows: 0 }, 2)
    expect(table.columns).toEqual(["a", "coluna_2", "c"])
    expect(table.rows).toHaveLength(2)
    expect(table.totalRows).toBe(3)
  })

  it("arquivo vazio é DATA_FILE_INVALID", () => {
    expect(() => parseCsv(new Uint8Array(), { encoding: "utf-8", delimiter: "auto", hasHeader: true, skipRows: 0 })).toThrow(/vazio/)
  })
})
