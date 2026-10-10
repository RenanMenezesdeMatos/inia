import { describe, expect, it } from "vitest"
import { compareScenesForListing, instantOf, localDateOf, localMomentOf, nextSceneChange, normalizeBlur, normalizeDim, normalizeImageLabel, normalizeSceneName, overlaps, resolveCurrentScene, resolveSceneAt, sceneStatusOf, validateImagePlan, validatePeriod, validateSceneImage } from "./inia-scene.js"
import { parseClock, type SlottedImage } from "./scene-time-slots.js"

/** PNG mínimo: assinatura + chunk IHDR com largura/altura (o resto não é lido). */
function png(width: number, height: number): Buffer {
  const data = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data, 0)
  data.writeUInt32BE(13, 8)
  data.write("IHDR", 12, "latin1")
  data.writeUInt32BE(width, 16)
  data.writeUInt32BE(height, 20)
  return data
}

const scene = (id: string, period: { start: string; end: string } | null, updatedAt = "2026-09-01T00:00:00Z") => ({ id, period, updatedAt: new Date(updatedAt) })

describe("cenário da INIA — imagem", () => {
  it("aceita paisagem a partir de 1280×640 e recusa retrato, pequena, vazia e formato desconhecido (pelo conteúdo)", () => {
    expect(validateSceneImage(png(1920, 1080))).toEqual({ ok: true, image: { mimeType: "image/png", width: 1920, height: 1080 } })
    expect(validateSceneImage(png(1280, 640)).ok).toBe(true)
    expect(validateSceneImage(png(1080, 1920))).toEqual({ ok: false, code: "SCENE_IMAGE_NOT_LANDSCAPE" })
    expect(validateSceneImage(png(1000, 600))).toEqual({ ok: false, code: "SCENE_IMAGE_TOO_SMALL" })
    expect(validateSceneImage(png(9000, 4000))).toEqual({ ok: false, code: "SCENE_IMAGE_DIMENSIONS_TOO_LARGE" })
    expect(validateSceneImage(Buffer.alloc(0))).toEqual({ ok: false, code: "SCENE_IMAGE_EMPTY" })
    expect(validateSceneImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toEqual({ ok: false, code: "SCENE_IMAGE_UNSUPPORTED_TYPE" })
  })

  it("desfoque: 0 a 3 px, em centésimos (aceita vírgula); fora disso ou texto = inválido", () => {
    expect(normalizeBlur("0.5")).toBe(0.5)
    expect(normalizeBlur("0,5")).toBe(0.5)
    expect(normalizeBlur(0)).toBe(0)
    expect(normalizeBlur("1.27")).toBe(1.27)
    expect(normalizeBlur("1,374")).toBe(1.37)
    expect(normalizeBlur(0.375)).toBe(0.38)
    expect(normalizeBlur(0.1 + 0.2)).toBe(0.3)
    expect(normalizeBlur("3")).toBe(3)
    expect(normalizeBlur("3.5")).toBeNull()
    expect(normalizeBlur("-0.1")).toBeNull()
    expect(normalizeBlur("abc")).toBeNull()
    expect(normalizeBlur("")).toBeNull()
  })

  it("nome: espaços normalizados, vazio e longo demais são inválidos", () => {
    expect(normalizeSceneName("  Natal   2026 ")).toBe("Natal 2026")
    expect(normalizeSceneName("   ")).toBeNull()
    expect(normalizeSceneName("x".repeat(81))).toBeNull()
  })
})

describe("cenário da INIA — período", () => {
  it("os dois ou nenhum; datas reais; fim no mesmo dia ou depois do início", () => {
    expect(validatePeriod(undefined, "")).toEqual({ ok: true, period: null })
    expect(validatePeriod("2026-12-01", "2026-12-26")).toEqual({ ok: true, period: { start: "2026-12-01", end: "2026-12-26" } })
    expect(validatePeriod("2026-12-01", "2026-12-01").ok).toBe(true)
    expect(validatePeriod("2026-12-01", undefined)).toEqual({ ok: false, code: "SCENE_PERIOD_INCOMPLETE" })
    expect(validatePeriod("2026-02-30", "2026-03-02")).toEqual({ ok: false, code: "SCENE_PERIOD_INVALID" })
    expect(validatePeriod("2026-12-26", "2026-12-01")).toEqual({ ok: false, code: "SCENE_PERIOD_INVERTED" })
  })

  it("sobreposição inclui as bordas (um dia em comum já é conflito)", () => {
    expect(overlaps({ start: "2026-10-01", end: "2026-10-31" }, { start: "2026-10-31", end: "2026-11-02" })).toBe(true)
    expect(overlaps({ start: "2026-10-01", end: "2026-10-31" }, { start: "2026-11-01", end: "2026-11-02" })).toBe(false)
  })

  it("'hoje' é a data LOCAL da organização, não a de UTC", () => {
    // 01/12 às 01:30 em UTC ainda é 30/11 em Fortaleza (UTC−3).
    expect(localDateOf(new Date("2026-12-01T01:30:00Z"), "America/Fortaleza")).toBe("2026-11-30")
    expect(localDateOf(new Date("2026-12-01T03:30:00Z"), "America/Fortaleza")).toBe("2026-12-01")
  })
})

describe("cenário da INIA — qual vale hoje", () => {
  const callCenter = scene("call-center", null)
  const natal = scene("natal", { start: "2026-12-01", end: "2026-12-26" })
  const outubroRosa = scene("outubro-rosa", { start: "2026-10-01", end: "2026-10-31" })
  const all = [callCenter, natal, outubroRosa]

  it("agendado no período vence o padrão; fora do período volta sozinho ao padrão; sem padrão = nenhum", () => {
    expect(resolveCurrentScene(all, "call-center", "2026-10-15")).toEqual({ scene: outubroRosa, reason: "SCHEDULED" })
    expect(resolveCurrentScene(all, "call-center", "2026-12-26")).toEqual({ scene: natal, reason: "SCHEDULED" })
    expect(resolveCurrentScene(all, "call-center", "2026-12-27")).toEqual({ scene: callCenter, reason: "DEFAULT" })
    expect(resolveCurrentScene(all, null, "2026-11-10")).toBeNull()
    // Padrão apontando para cenário que não existe mais = nenhum (nunca um cenário "qualquer").
    expect(resolveCurrentScene(all, "apagado", "2026-11-10")).toBeNull()
  })

  it("dado antigo sobreposto: vale o período que começou por último", () => {
    const semana = scene("semana", { start: "2026-12-20", end: "2026-12-24" })
    expect(resolveCurrentScene([natal, semana], null, "2026-12-22")?.scene.id).toBe("semana")
  })

  it("situação na tela: no ar, próximo, encerrado, disponível", () => {
    const current = resolveCurrentScene(all, "call-center", "2026-10-15")!.scene
    expect(sceneStatusOf(outubroRosa, current, "2026-10-15")).toBe("LIVE")
    expect(sceneStatusOf(natal, current, "2026-10-15")).toBe("UPCOMING")
    expect(sceneStatusOf(callCenter, current, "2026-10-15")).toBe("STANDBY")
    expect(sceneStatusOf(outubroRosa, null, "2026-11-15")).toBe("ENDED")
  })
})

describe("cenário da INIA — escurecimento", () => {
  it("0 a 100 %, inteiro (aceita '%' e vírgula); fora disso ou texto = inválido", () => {
    expect(normalizeDim("0")).toBe(0)
    expect(normalizeDim("35")).toBe(35)
    expect(normalizeDim("35%")).toBe(35)
    expect(normalizeDim("35,6")).toBe(36)
    expect(normalizeDim(100)).toBe(100)
    expect(normalizeDim("101")).toBeNull()
    expect(normalizeDim("-1")).toBeNull()
    expect(normalizeDim("muito")).toBeNull()
    expect(normalizeDim("")).toBeNull()
  })
})

describe("cenário da INIA — conjunto de imagens", () => {
  const entry = (key: string, label: string, isPrimary: boolean, range: [string, string] | null) => ({ key, label, isPrimary, slot: range ? { start: parseClock(range[0])!, end: parseClock(range[1])! } : null })

  it("dia/noite válidos; uma imagem só (sem faixa) também", () => {
    expect(validateImagePlan([entry("0", "Dia", true, ["06:00", "18:00"]), entry("1", "Noite", false, ["18:00", "06:00"])])).toBeNull()
    expect(validateImagePlan([entry("0", "Principal", true, null)])).toBeNull()
  })

  it("sobreposição — inclusive depois da meia-noite — é recusada com as duas imagens e o trecho em comum", () => {
    const error = validateImagePlan([entry("0", "Dia", true, ["06:00", "18:00"]), entry("1", "Noite", false, ["17:00", "06:00"])])
    expect(error).toMatchObject({ code: "INIA_SCENE_IMAGE_SLOT_OVERLAP", keys: ["0", "1"], overlap: { start: "17:00", end: "18:00" } })
    expect(error?.message).toBe('Os horários de "Dia" e "Noite" se sobrepõem das 17:00 às 18:00. Ajuste as faixas para não coincidirem.')
    const afterMidnight = validateImagePlan([entry("0", "Noite", true, ["18:00", "06:00"]), entry("1", "Madrugada", false, ["02:00", "04:00"])])
    expect(afterMidnight).toMatchObject({ code: "INIA_SCENE_IMAGE_SLOT_OVERLAP", overlap: { start: "02:00", end: "04:00" } })
  })

  it("exatamente uma principal; identificação única e preenchida; de 1 a 8 imagens", () => {
    expect(validateImagePlan([entry("0", "Dia", false, ["06:00", "18:00"]), entry("1", "Noite", false, ["18:00", "06:00"])])?.code).toBe("INIA_SCENE_PRIMARY_IMAGE_REQUIRED")
    expect(validateImagePlan([entry("0", "Dia", true, null), entry("1", "Noite", true, null)])?.code).toBe("INIA_SCENE_PRIMARY_IMAGE_REQUIRED")
    expect(validateImagePlan([entry("0", "Dia", true, null), entry("1", "DIA", false, ["18:00", "06:00"])])).toMatchObject({ code: "INIA_SCENE_IMAGE_LABEL_TAKEN", key: "1" })
    expect(validateImagePlan([entry("0", "  ", true, null)])?.code).toBe("INIA_SCENE_IMAGE_LABEL_INVALID")
    expect(validateImagePlan([])?.code).toBe("INIA_SCENE_IMAGES_COUNT")
    expect(validateImagePlan(Array.from({ length: 9 }, (_, index) => entry(String(index), `Imagem ${index}`, index === 0, null)))?.code).toBe("INIA_SCENE_IMAGES_COUNT")
    expect(normalizeImageLabel("  Noite   de festa ")).toBe("Noite de festa")
  })
})

describe("cenário da INIA — cenário pela data, imagem pelo horário (America/Fortaleza)", () => {
  const TZ = "America/Fortaleza"
  type Scene = { id: string; name: string; period: { start: string; end: string } | null; updatedAt: Date; images: SlottedImage[] }
  const dayNight = (prefix: string): SlottedImage[] => [
    { id: `${prefix}-dia`, isPrimary: true, slot: { start: parseClock("06:00")!, end: parseClock("18:00")! } },
    { id: `${prefix}-noite`, isPrimary: false, slot: { start: parseClock("18:00")!, end: parseClock("06:00")! } },
  ]
  const make = (id: string, period: Scene["period"], images: SlottedImage[]): Scene => ({ id, name: id, period, updatedAt: new Date("2026-10-01T00:00:00Z"), images })
  const padrao = make("padrao", null, dayNight("padrao"))
  const rosa = make("rosa", { start: "2026-10-05", end: "2026-10-11" }, dayNight("rosa"))
  const natal = make("natal", { start: "2026-12-01", end: "2026-12-26" }, dayNight("natal"))
  const virada = make("virada", { start: "2026-12-27", end: "2027-01-03" }, dayNight("virada"))
  const scenes = [padrao, rosa, natal, virada]
  // Hora local de Fortaleza (UTC−3, sem horário de verão) → instante.
  const local = (date: string, clock: string) => new Date(`${date}T${clock}:00-03:00`)
  const shown = (instant: Date) => {
    const resolved = resolveSceneAt(scenes, "padrao", localMomentOf(instant, TZ))
    return resolved ? resolved.image.id : null
  }

  it("data e minuto locais vêm do fuso da organização; o caminho inverso dá o mesmo instante", () => {
    expect(localMomentOf(new Date("2026-10-05T21:00:00Z"), TZ)).toEqual({ date: "2026-10-05", minute: 18 * 60 })
    expect(instantOf({ date: "2026-10-12", minute: 0 }, TZ).toISOString()).toBe("2026-10-12T03:00:00.000Z")
  })

  it("trocas às 06:00 e às 18:00 dentro da campanha", () => {
    expect(shown(local("2026-10-07", "05:59"))).toBe("rosa-noite")
    expect(shown(local("2026-10-07", "06:00"))).toBe("rosa-dia")
    expect(shown(local("2026-10-07", "17:59"))).toBe("rosa-dia")
    expect(shown(local("2026-10-07", "18:00"))).toBe("rosa-noite")
    expect(shown(local("2026-10-08", "00:00"))).toBe("rosa-noite")
  })

  it("limites da campanha: a madrugada do 1º dia já é da campanha; a noite do último dia não passa da meia-noite", () => {
    expect(shown(local("2026-10-04", "23:59"))).toBe("padrao-noite")
    expect(shown(local("2026-10-05", "00:00"))).toBe("rosa-noite")
    expect(shown(local("2026-10-11", "23:59"))).toBe("rosa-noite")
    expect(shown(local("2026-10-12", "00:00"))).toBe("padrao-noite")
    expect(shown(local("2026-10-12", "06:00"))).toBe("padrao-dia")
  })

  it("virada 2026/2027 com o cenário próprio, de um ano para o outro", () => {
    expect(shown(local("2026-12-26", "23:59"))).toBe("natal-noite")
    expect(shown(local("2026-12-27", "00:00"))).toBe("virada-noite")
    expect(shown(local("2027-01-01", "10:00"))).toBe("virada-dia")
    expect(shown(local("2027-01-03", "23:59"))).toBe("virada-noite")
    expect(shown(local("2027-01-04", "00:00"))).toBe("padrao-noite")
  })

  it("próxima troca: o limite de faixa seguinte, a meia-noite em que a campanha começa/termina ou o próximo agendado", () => {
    const next = (instant: Date, list: Scene[] = scenes, defaultId: string | null = "padrao") => {
      const change = nextSceneChange(list, defaultId, instant, TZ)
      return change ? { at: change.at.toISOString(), image: change.resolved?.image.id ?? null } : null
    }
    expect(next(local("2026-10-07", "17:00"))).toEqual({ at: "2026-10-07T21:00:00.000Z", image: "rosa-noite" })
    expect(next(local("2026-10-07", "18:00"))).toEqual({ at: "2026-10-08T09:00:00.000Z", image: "rosa-dia" })
    // Na última noite da campanha, a próxima troca é a meia-noite (padrão), não as 06:00.
    expect(next(local("2026-10-11", "20:00"))).toEqual({ at: "2026-10-12T03:00:00.000Z", image: "padrao-noite" })
    // Na véspera, a próxima troca é a meia-noite em que a campanha começa.
    expect(next(local("2026-10-04", "20:00"))).toEqual({ at: "2026-10-05T03:00:00.000Z", image: "rosa-noite" })
    // Padrão antigo (uma imagem o dia inteiro): a próxima troca é o início do próximo agendado; sem nada, null.
    const legacy = make("legado", null, [{ id: "legado-unica", isPrimary: true, slot: null }])
    expect(next(local("2026-10-20", "10:00"), [legacy, natal], "legado")).toEqual({ at: "2026-12-01T03:00:00.000Z", image: "natal-noite" })
    expect(next(local("2026-10-20", "10:00"), [legacy], "legado")).toBeNull()
    expect(next(local("2026-10-20", "10:00"), [], null)).toBeNull()
  })
})

describe("cenário da INIA — ordem da listagem", () => {
  it("agendados pela data de início no ano completo (2025 → 2026 → 2027), empate por fim, nome e id; sem período depois", () => {
    const item = (id: string, name: string, period: [string, string] | null) => ({ id, name, period: period ? { start: period[0], end: period[1] } : null })
    const scenes = [
      item("d", "Default", null),
      item("n27", "Natal 2027", ["2027-12-01", "2027-12-26"]),
      item("c26", "Carnaval 2026", ["2026-02-16", "2026-02-22"]),
      item("a26", "Ano-Novo 2026", ["2025-12-29", "2026-01-04"]),
      item("v", "Ano-Novo 2027 — Feliz 2027", ["2026-12-27", "2027-01-03"]),
      item("x2", "Empate B", ["2026-05-01", "2026-05-02"]),
      item("x1", "Empate A", ["2026-05-01", "2026-05-02"]),
      item("x0", "Empate curto", ["2026-05-01", "2026-05-01"]),
      item("call", "Call center", null),
    ]
    expect([...scenes].sort(compareScenesForListing).map((scene) => scene.id)).toEqual(["a26", "c26", "x0", "x1", "x2", "v", "n27", "call", "d"])
  })
})
