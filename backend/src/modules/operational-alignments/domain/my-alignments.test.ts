import { describe, expect, it } from "vitest"
import { civilDateOf, myAlignmentStateOf, myAudienceLabelOf, pickMyAlignmentVersions, type MyAlignmentVersionRow } from "./my-alignments.js"

const OUV = "11111111-1111-4111-8111-111111111111"
const N2 = "22222222-2222-4222-8222-222222222222"
const OUTRO = "33333333-3333-4333-8333-333333333333"
const subject = { teamId: OUV, subteamId: N2, operatingUniverse: "B2C" as const, universeEnforced: true }
const at = (iso: string) => new Date(iso)
const row = (overrides: Partial<MyAlignmentVersionRow>): MyAlignmentVersionRow => ({
  alignmentId: "a1", versionId: "v1", version: 1, effectiveFrom: at("2026-11-10T03:00:00Z"), effectiveUntil: at("2026-12-01T03:00:00Z"), publishedAt: at("2026-11-09T12:00:00Z"),
  operatingUniverse: "B2C", scopeType: "GROUPS", links: [{ teamId: OUV, subteamId: null, teamName: "Ouvidoria", subteamName: null }], ...overrides,
})

describe("alinhamentos no Acompanhamento do operador (regra pura)", () => {
  it("estado pelo relógio: antes do início, em vigor (fim exclusivo), encerrado", () => {
    expect(myAlignmentStateOf(row({}), at("2026-11-10T02:59:59Z"))).toBe("UPCOMING")
    expect(myAlignmentStateOf(row({}), at("2026-11-10T03:00:00Z"))).toBe("IN_FORCE")
    expect(myAlignmentStateOf(row({}), at("2026-12-01T03:00:00Z"))).toBe("ENDED")
  })

  it("um item por alinhamento: a versão em vigor; sem ela, a próxima; sem as duas, a última que valeu; mais recente publicada primeiro", () => {
    const v1 = row({ versionId: "v1", effectiveUntil: at("2026-11-20T03:00:00Z") })
    const v2 = row({ versionId: "v2", version: 2, effectiveFrom: at("2026-11-20T03:00:00Z"), publishedAt: at("2026-11-15T12:00:00Z") })
    const other = row({ alignmentId: "a2", versionId: "w1", publishedAt: at("2026-11-12T12:00:00Z"), effectiveFrom: at("2026-11-25T03:00:00Z") })
    expect(pickMyAlignmentVersions([v1, v2, other], subject, at("2026-11-18T12:00:00Z")).map((entry) => entry.versionId)).toEqual(["w1", "v1"])
    expect(pickMyAlignmentVersions([v1, v2, other], subject, at("2026-11-22T12:00:00Z")).map((entry) => entry.versionId)).toEqual(["v2", "w1"])
    expect(pickMyAlignmentVersions([v1, v2], subject, at("2026-12-05T12:00:00Z")).map((entry) => entry.versionId)).toEqual(["v2"])
    expect(pickMyAlignmentVersions([v1], subject, at("2026-11-05T12:00:00Z")).map((entry) => entry.versionId)).toEqual(["v1"])
  })

  it("só o público de quem lê HOJE; versão sem intervalo (cancelada antes de começar) nunca entra", () => {
    const outroGrupo = row({ alignmentId: "a3", links: [{ teamId: OUTRO, subteamId: null, teamName: "Outro", subteamName: null }] })
    const b2b = row({ alignmentId: "a4", operatingUniverse: "B2B", scopeType: "UNIVERSE", links: [] })
    const empty = row({ alignmentId: "a5", effectiveUntil: at("2026-11-10T03:00:00Z") })
    expect(pickMyAlignmentVersions([outroGrupo, b2b, empty], subject, at("2026-11-18T12:00:00Z"))).toEqual([])
  })

  it("para quem, do ponto de vista de quem lê: o vínculo que o alcança (Subgrupo antes do Grupo) ou o universo inteiro", () => {
    const links = [{ teamId: OUTRO, subteamId: null, teamName: "Outro", subteamName: null }, { teamId: OUV, subteamId: null, teamName: "Ouvidoria", subteamName: null }, { teamId: OUV, subteamId: N2, teamName: "Ouvidoria", subteamName: "Nível 2" }]
    expect(myAudienceLabelOf(row({ links }), subject)).toBe("Ouvidoria › Nível 2")
    expect(myAudienceLabelOf(row({ links: links.slice(0, 2) }), subject)).toBe("Ouvidoria")
    expect(myAudienceLabelOf(row({ scopeType: "UNIVERSE", links: [] }), subject)).toBe("Todo o B2C")
  })

  it("data civil no fuso da organização", () => {
    expect(civilDateOf(at("2026-12-01T03:00:00Z"), "America/Sao_Paulo")).toBe("2026-12-01")
    expect(civilDateOf(at("2026-12-01T02:59:59Z"), "America/Sao_Paulo")).toBe("2026-11-30")
  })
})
