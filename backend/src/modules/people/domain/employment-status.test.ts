import { describe, expect, it } from "vitest"
import { addDaysToDate, EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_STATUSES, employmentStatusOn, findOverlap, isOperationallyEligibleStatus, LEGACY_EMPLOYMENT_STATUS_MAP, NON_ELIGIBLE_EMPLOYMENT_STATUSES, normalizeEmploymentStatus, planStatusPeriodCancellation, resolveStatusBasis, toCanonicalEmploymentStatus, type StatusPeriod } from "./employment-status.js"

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

describe("cancelamento de período pela fonte — o que volta a valer nos dias liberados", () => {
  let next = 0
  const period = (status: StatusPeriod["status"], effectiveFrom: string, effectiveTo: string | null, extra: Partial<StatusPeriod> = {}): StatusPeriod => ({
    id: `p${(next += 1)}`,
    personId: "pessoa",
    status,
    rawStatus: null,
    legacyStatus: null,
    effectiveFrom,
    effectiveTo,
    effectiveFromInferred: false,
    effectiveToExplicit: false,
    authoritative: true,
    observedAt: "2026-09-01 12:00:00+00",
    sourceUpdatedAt: null,
    source: "rh",
    sourceReference: "OP-1",
    ...extra,
  })
  const summary = (plan: ReturnType<typeof planStatusPeriodCancellation>) => ({
    removed: plan.remove.map((entry) => entry.id),
    restore: plan.restore ? { id: plan.restore.period.id, effectiveTo: plan.restore.effectiveTo, mergedWith: plan.restore.mergedWith?.id ?? null } : null,
  })

  it("férias que dividiram o EM PRODUÇÃO do cadastro: cancelar junta as duas metades (como se as férias nunca tivessem chegado)", () => {
    const before = period("EM_PRODUCAO", "2026-01-05", "2026-10-04")
    const vacation = period("FERIAS", "2026-10-05", "2026-10-14", { effectiveToExplicit: true, source: "rh-ausencias", observedAt: "2026-09-30 12:00:00+00" })
    const after = period("EM_PRODUCAO", "2026-10-15", null)
    expect(summary(planStatusPeriodCancellation([before, vacation, after], vacation))).toEqual({ removed: [vacation.id, after.id], restore: { id: before.id, effectiveTo: null, mergedWith: after.id } })
  })

  it("metade posterior renovada por snapshot depois (outra observação) também volta a ser uma só quando o fim anterior não veio da fonte", () => {
    const before = period("EM_PRODUCAO", "2026-01-05", "2026-10-04")
    const vacation = period("FERIAS", "2026-10-05", "2026-10-14", { effectiveToExplicit: true })
    const after = period("EM_PRODUCAO", "2026-10-15", null, { observedAt: "2026-10-16 12:00:00+00" })
    expect(summary(planStatusPeriodCancellation([before, vacation, after], vacation)).removed).toEqual([vacation.id, after.id])
  })

  it("ausência em aberto: o período anterior, fechado só porque ela começou, volta a ficar em aberto", () => {
    const before = period("EM_PRODUCAO", "2026-01-05", "2026-10-04")
    const leave = period("INSS", "2026-10-05", null, { effectiveFromInferred: false })
    expect(summary(planStatusPeriodCancellation([before, leave], leave))).toEqual({ removed: [leave.id], restore: { id: before.id, effectiveTo: null, mergedWith: null } })
  })

  it("situação diferente depois da ausência: o anterior vale até a véspera da próxima situação registrada — o início dela nunca é antecipado", () => {
    const before = period("EM_PRODUCAO", "2026-01-05", "2026-10-04")
    const vacation = period("FERIAS", "2026-10-05", "2026-10-14", { effectiveToExplicit: true })
    const transfer = period("TRANSFERIDO", "2026-10-20", null)
    expect(summary(planStatusPeriodCancellation([transfer, vacation, before], vacation))).toEqual({ removed: [vacation.id], restore: { id: before.id, effectiveTo: "2026-10-19", mergedWith: null } })
  })

  it("fim informado pela fonte é respeitado: anterior explícito não cresce, e os dias ficam presumidos (EM PRODUÇÃO, não confirmado)", () => {
    const leave = period("INSS", "2026-08-01", "2026-10-04", { effectiveToExplicit: true, observedAt: "2026-07-30 12:00:00+00" })
    const vacation = period("FERIAS", "2026-10-05", "2026-10-14", { effectiveToExplicit: true })
    const plan = planStatusPeriodCancellation([leave, vacation], vacation)
    expect(summary(plan)).toEqual({ removed: [vacation.id], restore: null })
    expect(resolveStatusBasis([leave], "2026-10-07")).toMatchObject({ status: "EM_PRODUCAO", basis: "PRESUMED_AFTER_PERIOD", confirmed: false })
  })

  it("período explícito dividido pela ausência volta inteiro só quando a metade posterior é a cópia (mesma evidência); dois registros explícitos diferentes nunca se fundem", () => {
    const first = period("INSS", "2026-08-01", "2026-10-04", { effectiveToExplicit: true })
    const vacation = period("FERIAS", "2026-10-05", "2026-10-14", { effectiveToExplicit: true })
    const copy = period("INSS", "2026-10-15", "2026-12-31", { effectiveToExplicit: true })
    expect(summary(planStatusPeriodCancellation([first, vacation, copy], vacation))).toEqual({ removed: [vacation.id, copy.id], restore: { id: first.id, effectiveTo: "2026-12-31", mergedWith: copy.id } })
    const otherRecord = period("INSS", "2026-10-15", "2026-12-31", { effectiveToExplicit: true, observedAt: "2026-10-01 12:00:00+00" })
    expect(summary(planStatusPeriodCancellation([first, vacation, otherRecord], vacation))).toEqual({ removed: [vacation.id], restore: null })
  })

  it("nada antes da ausência: só ela sai, e o posterior continua começando onde estava", () => {
    const vacation = period("FERIAS", "2026-10-05", "2026-10-14", { effectiveToExplicit: true })
    const after = period("EM_PRODUCAO", "2026-10-15", null)
    expect(summary(planStatusPeriodCancellation([vacation, after], vacation))).toEqual({ removed: [vacation.id], restore: null })
  })

  it("mesma situação de outra fonte depois da lacuna não é a outra metade: o anterior só preenche a lacuna", () => {
    const before = period("EM_PRODUCAO", "2026-01-05", "2026-10-04")
    const vacation = period("FERIAS", "2026-10-05", "2026-10-14", { effectiveToExplicit: true })
    const manual = period("EM_PRODUCAO", "2026-10-15", null, { source: "MANUAL" })
    expect(summary(planStatusPeriodCancellation([before, vacation, manual], vacation))).toEqual({ removed: [vacation.id], restore: { id: before.id, effectiveTo: "2026-10-14", mergedWith: null } })
  })
})
