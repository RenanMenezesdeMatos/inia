import { describe, expect, it } from "vitest"
import { addDaysToDate, EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_STATUSES, employmentStatusOn, findOverlap, isOperationallyEligibleStatus, LEGACY_EMPLOYMENT_STATUS_MAP, NON_ELIGIBLE_EMPLOYMENT_STATUSES, normalizeEmploymentStatus, resolveStatusBasis, toCanonicalEmploymentStatus } from "./employment-status.js"

describe("situação funcional — domínio (nove situações reais)", () => {
  it("as nove situações existem com rótulos em pt-BR", () => {
    expect(EMPLOYMENT_STATUSES).toEqual(["EM_PRODUCAO", "TRANSFERIDO", "FERIAS", "INSS", "PILOTO", "MATERNIDADE", "PATERNIDADE", "APOSENTADO", "ATIVIDADE_OFF"])
    expect(Object.values(EMPLOYMENT_STATUS_LABELS)).toEqual(["EM PRODUÇÃO", "TRANSFERIDO", "FÉRIAS", "INSS", "PILOTO", "MATERNIDADE", "PATERNIDADE", "APOSENTADO", "ATIVIDADE OFF"])
  })

  it("REGRA POSITIVA: só EM_PRODUCAO é operacionalmente elegível; todos os demais (e os legados não produtivos) alimentam o SQL como não elegíveis", () => {
    expect(isOperationallyEligibleStatus("EM_PRODUCAO")).toBe(true)
    for (const status of EMPLOYMENT_STATUSES.filter((s) => s !== "EM_PRODUCAO")) expect(isOperationallyEligibleStatus(status)).toBe(false)
    expect(NON_ELIGIBLE_EMPLOYMENT_STATUSES).toEqual(["TRANSFERIDO", "FERIAS", "INSS", "PILOTO", "MATERNIDADE", "PATERNIDADE", "APOSENTADO", "ATIVIDADE_OFF", "VACATION", "LEAVE", "INACTIVE"])
    expect(isOperationallyEligibleStatus("ACTIVE")).toBe(true) // legado canonizado
    expect(isOperationallyEligibleStatus("LEAVE")).toBe(false)
  })

  it("compatibilidade legada: ACTIVE→EM_PRODUCAO, VACATION→FERIAS, LEAVE/INACTIVE→ATIVIDADE_OFF (nunca INSS/APOSENTADO por palpite); desconhecido = null", () => {
    expect(LEGACY_EMPLOYMENT_STATUS_MAP).toEqual({ ACTIVE: "EM_PRODUCAO", VACATION: "FERIAS", LEAVE: "ATIVIDADE_OFF", INACTIVE: "ATIVIDADE_OFF" })
    expect(toCanonicalEmploymentStatus("LEAVE")).toBe("ATIVIDADE_OFF")
    expect(toCanonicalEmploymentStatus("INSS")).toBe("INSS")
    expect(toCanonicalEmploymentStatus("QUALQUER")).toBeNull()
  })

  it("status bruto → real: só mapeamentos explícitos (código, rótulo com/sem acento, ACTIVE/VACATION); 'ATIVO', 'AFASTADO', 'LICENÇA' NÃO viram nada sem 'Mapear códigos'", () => {
    for (const raw of ["EM PRODUÇÃO", "EM PRODUCAO", "em_producao", " Em produção "]) expect(normalizeEmploymentStatus(raw)).toBe("EM_PRODUCAO")
    for (const raw of ["FÉRIAS", "FERIAS", "férias ", "VACATION"]) expect(normalizeEmploymentStatus(raw)).toBe("FERIAS")
    expect(normalizeEmploymentStatus("INSS")).toBe("INSS")
    expect(normalizeEmploymentStatus("Piloto")).toBe("PILOTO")
    expect(normalizeEmploymentStatus("Licença maternidade")).toBe("MATERNIDADE")
    expect(normalizeEmploymentStatus("PATERNIDADE")).toBe("PATERNIDADE")
    expect(normalizeEmploymentStatus("Aposentada")).toBe("APOSENTADO")
    expect(normalizeEmploymentStatus("ATIVIDADE OFF")).toBe("ATIVIDADE_OFF")
    expect(normalizeEmploymentStatus("TRANSFERIDO")).toBe("TRANSFERIDO")
    expect(normalizeEmploymentStatus("ACTIVE")).toBe("EM_PRODUCAO")
    for (const raw of ["ATIVO", "A", "AFASTADO", "LICENCA_MEDICA", "DESLIGADO", "LEAVE", "INACTIVE", "FR", "PROD", "sabático", ""]) expect(normalizeEmploymentStatus(raw)).toBeNull()
    expect(normalizeEmploymentStatus(null)).toBeNull()
  })

  it("situação numa data: período cobre a data; sem período = EM PRODUÇÃO presumido (nunca retroage); legado no período é canonizado", () => {
    const periods = [
      { status: "FERIAS" as const, effectiveFrom: "2026-09-09", effectiveTo: "2026-09-20" },
      { status: "EM_PRODUCAO" as const, effectiveFrom: "2026-09-21", effectiveTo: null },
    ]
    expect(employmentStatusOn(periods, "2026-09-10")).toBe("FERIAS")
    expect(employmentStatusOn(periods, "2026-09-25")).toBe("EM_PRODUCAO")
    expect(employmentStatusOn(periods, "2026-09-01")).toBe("EM_PRODUCAO")
    expect(resolveStatusBasis([{ status: "VACATION" as never, effectiveFrom: "2026-09-09", effectiveTo: "2026-09-20", effectiveFromInferred: false, effectiveToExplicit: true }], "2026-09-10")).toMatchObject({ status: "FERIAS", basis: "EXPLICIT_PERIOD" })
    expect(resolveStatusBasis([], "2026-09-10")).toMatchObject({ status: "EM_PRODUCAO", basis: "PRESUMED_NO_HISTORY", confirmed: false })
  })

  it("sobreposição é detectada em memória (mesma regra da exclusion constraint)", () => {
    expect(findOverlap([{ effectiveFrom: "2026-09-01", effectiveTo: "2026-09-08" }, { effectiveFrom: "2026-09-09", effectiveTo: null }])).toBeNull()
    expect(findOverlap([{ effectiveFrom: "2026-09-01", effectiveTo: null }, { effectiveFrom: "2026-09-09", effectiveTo: null }])).toEqual([0, 1])
    expect(addDaysToDate("2026-09-30", 1)).toBe("2026-10-01")
    expect(addDaysToDate("2026-09-01", -1)).toBe("2026-08-31")
  })
})
