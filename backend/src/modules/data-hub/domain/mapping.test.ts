import { describe, expect, it } from "vitest"
import { EMPLOYEES_CONTRACT } from "./contracts/master-data-contracts.js"
import { INDICATOR_MEASUREMENTS_CONTRACT } from "./contracts/performance-contracts.js"
import { INTERACTIONS_CONTRACT } from "./contracts/interaction-contracts.js"
import { applyTransforms, extractPath, mapRecord, parseDateWithFormat, parseDecimalAuto, suggestMapping, validateMapping, zonedLocalToIso } from "./mapping.js"

const TZ = "America/Fortaleza"

describe("mapping — extração e transformações determinísticas", () => {
  it("lê coluna simples e dot path com índice de array", () => {
    const record = { matricula: "OP-1", data: { items: [{ id: "a" }, { id: "b" }] }, "nome.completo": "Ana" }
    expect(extractPath(record, "matricula")).toBe("OP-1")
    expect(extractPath(record, "data.items[1].id")).toBe("b")
    expect(extractPath(record, "nome.completo")).toBe("Ana")
    expect(extractPath(record, "data.missing.x")).toBeUndefined()
  })

  it("interpreta datas nos formatos brasileiros e decimais com vírgula", () => {
    expect(parseDateWithFormat("15/09/2026", "dd/MM/yyyy")).toBe("2026-09-15")
    expect(parseDateWithFormat("15/09/2026 14:02:10", "dd/MM/yyyy HH:mm:ss")).toBe("2026-09-15T14:02:10")
    expect(parseDateWithFormat("20260915", "yyyyMMdd")).toBe("2026-09-15")
    expect(parseDateWithFormat("31/02/2026x", "dd/MM/yyyy")).toBeNull()
    expect(parseDecimalAuto("123,45")).toBe(123.45)
    expect(parseDecimalAuto("1.234,56")).toBe(1234.56)
    expect(parseDecimalAuto("1,234.56")).toBe(1234.56)
    expect(parseDecimalAuto("123.45")).toBe(123.45)
    expect(parseDecimalAuto("abc")).toBeNull()
  })

  it("aplica transformações em ordem, sem executar nada além do declarado", () => {
    expect(applyTransforms("  ana  ", [{ kind: "TRIM" }, { kind: "UPPERCASE" }]).value).toBe("ANA")
    expect(applyTransforms("", [{ kind: "DEFAULT", value: "OPERATOR" }]).value).toBe("OPERATOR")
    expect(applyTransforms("x", [{ kind: "CONSTANT", value: "VOICE" }]).value).toBe("VOICE")
    expect(applyTransforms("Sim", [{ kind: "BOOLEAN_MAP", trueValues: ["sim"], falseValues: ["nao"] }]).value).toBe(true)
    expect(applyTransforms("Talvez", [{ kind: "BOOLEAN_MAP", trueValues: ["sim"], falseValues: ["nao"] }]).error).toMatch(/verdadeiro\/falso/)
    expect(applyTransforms("Atendente", [{ kind: "CODE_MAP", map: { Atendente: "OPERATOR" }, otherwise: "KEEP" }]).value).toBe("OPERATOR")
    expect(applyTransforms("Outro", [{ kind: "CODE_MAP", map: { Atendente: "OPERATOR" }, otherwise: "EMPTY" }]).value).toBeNull()
    expect(applyTransforms("15/09/2026", [{ kind: "PARSE_DATE", format: "dd/MM/yyyy" }]).value).toBe("2026-09-15")
    expect(applyTransforms("1.234,5", [{ kind: "PARSE_DECIMAL", decimalSeparator: "," }]).value).toBe(1234.5)
  })

  it("converte data/hora local sem offset usando o fuso da organização", () => {
    expect(zonedLocalToIso("2026-09-15T14:02:10", TZ)).toBe("2026-09-15T17:02:10.000Z")
    expect(zonedLocalToIso("2026-09-15", TZ)).toBe("2026-09-15T03:00:00.000Z")
  })
})

describe("mapping — mapRecord contra o contrato", () => {
  it("mapeia um colaborador completo com erros por campo quando inválido", () => {
    const mapping = {
      fields: [
        { target: "externalEmployeeId", source: "matricula", transforms: [{ kind: "TRIM" as const }] },
        { target: "name", source: "nome_colaborador", transforms: [] },
        { target: "role", source: "perfil", transforms: [{ kind: "CODE_MAP" as const, map: { Atendente: "OPERATOR" }, otherwise: "KEEP" as const }] },
        { target: "hiredAt", source: "admissao", transforms: [{ kind: "PARSE_DATE" as const, format: "dd/MM/yyyy" as const }] },
        { target: "active", source: "ativo", transforms: [] },
      ],
    }
    const ok = mapRecord(EMPLOYEES_CONTRACT, mapping, { matricula: " OP-1 ", nome_colaborador: "Ana", perfil: "Atendente", admissao: "11/03/2024", ativo: "sim" }, { timeZone: TZ })
    expect(ok.errors).toEqual([])
    expect(ok.record).toMatchObject({ externalEmployeeId: "OP-1", name: "Ana", role: "OPERATOR", hiredAt: "2024-03-11", active: true, jobTitle: null })

    const bad = mapRecord(EMPLOYEES_CONTRACT, mapping, { matricula: "", nome_colaborador: "Ana", perfil: "Gerente Geral", admissao: "2024-13-99", ativo: "talvez" }, { timeZone: TZ })
    const codes = bad.errors.map((error) => `${error.field}:${error.code}`)
    expect(codes).toContain("externalEmployeeId:DATA_REQUIRED_FIELD_MISSING")
    expect(codes).toContain("role:DATA_INVALID_ENUM")
    expect(codes).toContain("hiredAt:DATA_INVALID_DATE")
    expect(codes).toContain("active:DATA_TYPE_INVALID")
  })

  it("V1.5.7 — a carga de colaboradores traz NÍVEL hierárquico, nunca acesso: 'ADMIN' não é aceito (vai para a quarentena)", () => {
    const mapping = { fields: [{ target: "externalEmployeeId", source: "m", transforms: [] }, { target: "name", source: "n", transforms: [] }, { target: "role", source: "r", transforms: [] }] }
    expect(mapRecord(EMPLOYEES_CONTRACT, mapping, { m: "OP-1", n: "Ana", r: "ADMIN" }, { timeZone: TZ }).errors.map((error) => `${error.field}:${error.code}`)).toEqual(["role:DATA_INVALID_ENUM"])
    expect(mapRecord(EMPLOYEES_CONTRACT, mapping, { m: "OP-1", n: "Ana", r: "SUPERVISOR" }, { timeZone: TZ }).errors).toEqual([])
    expect(EMPLOYEES_CONTRACT.fields.find((field) => field.key === "role")).toMatchObject({ label: "Nível hierárquico" })
  })

  it("exige ao menos um de date/periodStart nas medições e valida coerência do período", () => {
    const mapping = { fields: [{ target: "externalEmployeeId", source: "m", transforms: [] }, { target: "indicatorCode", source: "i", transforms: [] }, { target: "value", source: "v", transforms: [] }] }
    const missing = mapRecord(INDICATOR_MEASUREMENTS_CONTRACT, mapping, { m: "OP-1", i: "TMA", v: "475" }, { timeZone: TZ })
    expect(missing.errors.map((error) => error.code)).toContain("DATA_REQUIRED_FIELD_MISSING")

    const withPeriod = mapRecord(
      INDICATOR_MEASUREMENTS_CONTRACT,
      { fields: [...mapping.fields, { target: "periodStart", source: "ps", transforms: [] }, { target: "periodEnd", source: "pe", transforms: [] }] },
      { m: "OP-1", i: "TMA", v: "475", ps: "2026-09-02T00:00:00-03:00", pe: "2026-09-01T00:00:00-03:00" },
      { timeZone: TZ },
    )
    expect(withPeriod.errors.map((error) => `${error.field}:${error.code}`)).toContain("periodEnd:DATA_CONTRACT_VIOLATION")
  })

  it("normaliza DATETIME para ISO UTC e rejeita fim antes do início na interação", () => {
    const mapping = {
      fields: [
        { target: "externalInteractionId", source: "id", transforms: [] },
        { target: "externalEmployeeId", source: "op", transforms: [] },
        { target: "reason", source: "motivo", transforms: [] },
        { target: "startedAt", source: "inicio", transforms: [{ kind: "PARSE_DATE" as const, format: "dd/MM/yyyy HH:mm:ss" as const }] },
        { target: "endedAt", source: "fim", transforms: [{ kind: "PARSE_DATE" as const, format: "dd/MM/yyyy HH:mm:ss" as const }] },
      ],
    }
    const ok = mapRecord(INTERACTIONS_CONTRACT, mapping, { id: "C1", op: "OP-1", motivo: "Cancelamento", inicio: "15/09/2026 14:00:00", fim: "15/09/2026 14:10:00" }, { timeZone: TZ })
    expect(ok.errors).toEqual([])
    expect(ok.record.startedAt).toBe("2026-09-15T17:00:00.000Z")
    const bad = mapRecord(INTERACTIONS_CONTRACT, mapping, { id: "C1", op: "OP-1", motivo: "x", inicio: "15/09/2026 14:10:00", fim: "15/09/2026 14:00:00" }, { timeZone: TZ })
    expect(bad.errors[0]?.code).toBe("DATA_CONTRACT_VIOLATION")
  })

  it("INTERACTIONS@2: submotivo opcional — sugerido pela coluna \"Submotivo\", vazio vira nulo, acima de 200 caracteres é tipo inválido", () => {
    const columns = ["Protocolo", "Matrícula", "Motivo", "Submotivo", "Início", "Fim"]
    const suggestion = Object.fromEntries(suggestMapping(INTERACTIONS_CONTRACT, columns).fields.map((field) => [field.target, field.source]))
    expect(suggestion.reason).toBe("Motivo")
    expect(suggestion.subReason).toBe("Submotivo")
    const mapping = { fields: (["externalInteractionId", "externalEmployeeId", "reason", "subReason", "startedAt", "endedAt"] as const).map((target) => ({ target, source: target, transforms: [] })) }
    const base = { externalInteractionId: "C1", externalEmployeeId: "OP-1", reason: "Fatura", startedAt: "2026-09-15T14:00:00-03:00", endedAt: "2026-09-15T14:10:00-03:00" }
    const full = mapRecord(INTERACTIONS_CONTRACT, mapping, { ...base, subReason: " Segunda via " }, { timeZone: TZ })
    expect(full.errors).toEqual([])
    expect(full.record.subReason).toBe("Segunda via")
    const empty = mapRecord(INTERACTIONS_CONTRACT, mapping, { ...base, subReason: "" }, { timeZone: TZ })
    expect(empty.errors).toEqual([])
    expect(empty.record.subReason ?? null).toBeNull()
    const long = mapRecord(INTERACTIONS_CONTRACT, mapping, { ...base, subReason: "x".repeat(201) }, { timeZone: TZ })
    expect(long.errors.map((error) => [error.code, error.field])).toEqual([["DATA_TYPE_INVALID", "subReason"]])
  })

  it("validateMapping aponta obrigatórios sem origem e alvos inexistentes", () => {
    const problems = validateMapping(EMPLOYEES_CONTRACT, { fields: [{ target: "nope", source: "x", transforms: [] }, { target: "name", source: null, transforms: [] }] })
    expect(problems.join(" ")).toMatch(/"nope" não existe/)
    expect(problems.join(" ")).toMatch(/"name" sem origem/)
    expect(problems.join(" ")).toMatch(/externalEmployeeId/)
  })

  it("sugere mapping por nome/sinônimo (determinístico, sem IA) e não repete coluna", () => {
    const suggestion = suggestMapping(EMPLOYEES_CONTRACT, ["Matrícula", "Nome Colaborador", "gestor_matricula", "Cargo", "Data Admissão", "Ativo"])
    const byTarget = Object.fromEntries(suggestion.fields.map((field) => [field.target, field.source]))
    expect(byTarget.externalEmployeeId).toBe("Matrícula")
    expect(byTarget.name).toBe("Nome Colaborador")
    expect(byTarget.reportsToExternalId).toBe("gestor_matricula")
    expect(byTarget.jobTitle).toBe("Cargo")
    expect(byTarget.hiredAt).toBe("Data Admissão")
    expect(byTarget.active).toBe("Ativo")
    const sources = suggestion.fields.map((field) => field.source)
    expect(new Set(sources).size).toBe(sources.length)
  })
})

describe("sugestão de mapeamento conferida pela amostra", () => {
  it("não associa uma coluna cujos valores não cabem no tipo do campo (situação funcional ≠ sim/não)", async () => {
    const { requireDataContract } = await import("./contract-registry.js")
    const { suggestMapping } = await import("./mapping.js")
    const contract = requireDataContract("EMPLOYEES")
    const records = [{ matricula: "A1", nome: "Ana", situacao: "EM_PRODUCAO", admissao: "2024-01-15" }, { matricula: "A2", nome: "Bia", situacao: "FERIAS", admissao: "2024-02-01" }]
    const columns = ["matricula", "nome", "situacao", "admissao"]
    const byTarget = Object.fromEntries(suggestMapping(contract, columns, records).fields.map((field) => [field.target, field.source]))
    expect(byTarget.active).toBeUndefined()
    expect(byTarget.hiredAt).toBe("admissao")
    // Valores de sim/não legítimos continuam sugeridos.
    const yesNo = Object.fromEntries(suggestMapping(contract, ["matricula", "situacao"], [{ matricula: "A1", situacao: "ativo" }, { matricula: "A2", situacao: "inativo" }]).fields.map((field) => [field.target, field.source]))
    expect(yesNo.active).toBe("situacao")
    // Sem amostra (só nomes), o comportamento antigo continua.
    expect(Object.fromEntries(suggestMapping(contract, columns).fields.map((field) => [field.target, field.source])).active).toBe("situacao")
  })
})

describe("sugestão de mapeamento — Vigente? das Ausências", () => {
  it("'vigente' e 'ativo' viram Vigente? direto; 'cancelado' vira Vigente? com sim/não INVERTIDO (cancelado = S → vigente = não)", async () => {
    const { EMPLOYEE_ABSENCES_CONTRACT } = await import("./contracts/master-data-contracts.js")
    const records = [{ matricula: "A1", vigente: "S", ativo: "S", cancelado: "N" }, { matricula: "A2", vigente: "N", ativo: "N", cancelado: "S" }]
    const activeOf = (columns: string[]) => suggestMapping(EMPLOYEE_ABSENCES_CONTRACT, columns, records).fields.find((field) => field.target === "active")
    expect(activeOf(["matricula", "vigente"])).toEqual({ target: "active", source: "vigente", transforms: [] })
    expect(activeOf(["matricula", "ativo"])).toEqual({ target: "active", source: "ativo", transforms: [] })
    const inverted = activeOf(["matricula", "Cancelado"])!
    expect(inverted.source).toBe("Cancelado")
    expect(inverted.transforms).toEqual([expect.objectContaining({ kind: "BOOLEAN_MAP" })])
    expect(applyTransforms("S", inverted.transforms).value).toBe(false)
    expect(applyTransforms("não", inverted.transforms).value).toBe(true)
    // Coluna direta vence a invertida; valores que não são sim/não não viram Vigente?.
    expect(activeOf(["matricula", "cancelado", "vigente"])?.source).toBe("vigente")
    expect(suggestMapping(EMPLOYEE_ABSENCES_CONTRACT, ["cancelado"], [{ cancelado: "pelo RH em 30/09" }]).fields.find((field) => field.target === "active")).toBeUndefined()
  })

  it("o registro carregado pela sugestão invertida chega ao contrato como vigente = false", async () => {
    const { EMPLOYEE_ABSENCES_CONTRACT } = await import("./contracts/master-data-contracts.js")
    const mapping = suggestMapping(EMPLOYEE_ABSENCES_CONTRACT, ["externalEmployeeId", "type", "startDate", "cancelado"], [{ externalEmployeeId: "A1", type: "FERIAS", startDate: "2026-10-05", cancelado: "S" }])
    const { record, errors } = mapRecord(EMPLOYEE_ABSENCES_CONTRACT, mapping, { externalEmployeeId: "A1", type: "FERIAS", startDate: "2026-10-05", cancelado: "S" }, { timeZone: "America/Fortaleza" })
    expect(errors).toEqual([])
    expect(record).toMatchObject({ externalEmployeeId: "A1", type: "FERIAS", startDate: "2026-10-05", active: false })
  })
})
