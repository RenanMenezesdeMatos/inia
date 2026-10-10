import { describe, expect, it } from "vitest"
import { findSlotOverlap, formatClock, nextImageChange, parseClock, resolveImageAt, slotCovers, slotIntersection, validateSlot, type SlottedImage, type TimeSlot } from "./scene-time-slots.js"

const at = (clock: string) => parseClock(clock)!
const slot = (start: string, end: string): TimeSlot => ({ start: at(start), end: at(end) })
const image = (id: string, range: [string, string] | null, isPrimary = false): SlottedImage => ({ id, isPrimary, slot: range ? slot(range[0], range[1]) : null })

describe("faixas de horário — leitura e validação", () => {
  it("HH:MM de 00:00 a 23:59; formata de volta", () => {
    expect(parseClock("06:00")).toBe(360)
    expect(parseClock("00:00")).toBe(0)
    expect(parseClock("23:59")).toBe(1439)
    expect(parseClock("24:00")).toBeNull()
    expect(parseClock("6:00")).toBeNull()
    expect(parseClock("18:60")).toBeNull()
    expect(formatClock(1080)).toBe("18:00")
    expect(formatClock(5)).toBe("00:05")
  })

  it("os dois ou nenhum; início ≠ fim", () => {
    expect(validateSlot(null, "")).toEqual({ ok: true, slot: null })
    expect(validateSlot("06:00", "18:00")).toEqual({ ok: true, slot: { start: 360, end: 1080 } })
    expect(validateSlot("18:00", "06:00")).toEqual({ ok: true, slot: { start: 1080, end: 360 } })
    expect(validateSlot("06:00", null)).toEqual({ ok: false, code: "SCENE_SLOT_INCOMPLETE" })
    expect(validateSlot("6h", "18:00")).toEqual({ ok: false, code: "SCENE_SLOT_INVALID" })
    expect(validateSlot("06:00", "06:00")).toEqual({ ok: false, code: "SCENE_SLOT_EMPTY" })
  })
})

describe("faixas de horário — cobertura (início inclusivo, fim exclusivo, meia-noite)", () => {
  const day = slot("06:00", "18:00")
  const night = slot("18:00", "06:00")

  it("06:00–18:00: vale às 06:00 e às 17:59, não às 18:00 nem às 05:59", () => {
    expect(slotCovers(day, at("06:00"))).toBe(true)
    expect(slotCovers(day, at("17:59"))).toBe(true)
    expect(slotCovers(day, at("18:00"))).toBe(false)
    expect(slotCovers(day, at("05:59"))).toBe(false)
  })

  it("18:00–06:00 atravessa a meia-noite: vale às 18:00, 23:59, 00:00 e 05:59; não às 06:00", () => {
    for (const clock of ["18:00", "23:59", "00:00", "05:59"]) expect(slotCovers(night, at(clock))).toBe(true)
    expect(slotCovers(night, at("06:00"))).toBe(false)
    expect(slotCovers(night, at("12:00"))).toBe(false)
  })

  it("faixa que termina à meia-noite (22:00–00:00) vale até 23:59", () => {
    const late = slot("22:00", "00:00")
    expect(slotCovers(late, at("23:59"))).toBe(true)
    expect(slotCovers(late, at("00:00"))).toBe(false)
  })
})

describe("faixas de horário — sobreposição no círculo das 24 h", () => {
  it("dia e noite que se encostam não se sobrepõem; avançar um minuto já sobrepõe", () => {
    expect(slotIntersection(slot("06:00", "18:00"), slot("18:00", "06:00"))).toBeNull()
    expect(slotIntersection(slot("06:00", "18:00"), slot("17:00", "06:00"))).toEqual({ start: at("17:00"), end: at("18:00") })
    expect(slotIntersection(slot("06:00", "18:00"), slot("18:00", "06:01"))).toEqual({ start: at("06:00"), end: at("06:01") })
  })

  it("duas faixas que atravessam a meia-noite sempre se sobrepõem (as duas contêm a meia-noite)", () => {
    expect(slotIntersection(slot("22:00", "02:00"), slot("23:30", "01:00"))).not.toBeNull()
    expect(slotIntersection(slot("23:00", "01:00"), slot("00:30", "00:45"))).toEqual({ start: at("00:30"), end: at("00:45") })
  })

  it("aponta o primeiro par em conflito; faixas sem horário ficam de fora", () => {
    const overlap = findSlotOverlap([
      { key: "dia", slot: slot("06:00", "18:00") },
      { key: "principal", slot: null },
      { key: "tarde", slot: slot("17:00", "19:00") },
    ])
    expect(overlap).toEqual({ a: "dia", b: "tarde", overlap: { start: at("17:00"), end: at("18:00") } })
    expect(findSlotOverlap([{ key: "dia", slot: slot("06:00", "18:00") }, { key: "noite", slot: slot("18:00", "06:00") }])).toBeNull()
  })
})

describe("faixas de horário — qual imagem vale e quando troca", () => {
  const dayNight = [image("dia", ["06:00", "18:00"], true), image("noite", ["18:00", "06:00"])]

  it("dia/noite: às 18:00 já vale a noite; às 06:00 já vale o dia; à meia-noite continua a noite", () => {
    expect(resolveImageAt(dayNight, at("17:59"))?.image.id).toBe("dia")
    expect(resolveImageAt(dayNight, at("18:00"))?.image.id).toBe("noite")
    expect(resolveImageAt(dayNight, at("00:00"))?.image.id).toBe("noite")
    expect(resolveImageAt(dayNight, at("05:59"))?.image.id).toBe("noite")
    expect(resolveImageAt(dayNight, at("06:00"))).toEqual({ image: dayNight[0], reason: "SLOT" })
  })

  it("horário sem faixa = a principal; cenário antigo (uma imagem, sem faixa) vale o dia inteiro", () => {
    const partial = [image("principal", null, true), image("manha", ["08:00", "12:00"])]
    expect(resolveImageAt(partial, at("09:00"))?.image.id).toBe("manha")
    expect(resolveImageAt(partial, at("12:00"))).toEqual({ image: partial[0], reason: "PRIMARY" })
    const legacy = [image("unica", null, true)]
    for (const clock of ["00:00", "06:00", "18:00", "23:59"]) expect(resolveImageAt(legacy, at(clock))).toEqual({ image: legacy[0], reason: "PRIMARY" })
    expect(nextImageChange(legacy, at("10:00"))).toBeNull()
  })

  it("mais de duas imagens: manhã, tarde e noite, em ordem de horário", () => {
    const three = [image("noite", ["18:00", "06:00"]), image("manha", ["06:00", "12:00"], true), image("tarde", ["12:00", "18:00"])]
    expect(resolveImageAt(three, at("11:59"))?.image.id).toBe("manha")
    expect(resolveImageAt(three, at("12:00"))?.image.id).toBe("tarde")
    expect(nextImageChange(three, at("13:00"))).toMatchObject({ minute: at("18:00"), nextDay: false, image: { id: "noite" } })
  })

  it("próxima troca: das 17:00 para 18:00 (noite); das 20:00 para 06:00 do dia seguinte (dia)", () => {
    expect(nextImageChange(dayNight, at("17:00"))).toMatchObject({ minute: at("18:00"), nextDay: false, image: { id: "noite" } })
    expect(nextImageChange(dayNight, at("20:00"))).toMatchObject({ minute: at("06:00"), nextDay: true, image: { id: "dia" } })
    expect(nextImageChange(dayNight, at("03:00"))).toMatchObject({ minute: at("06:00"), nextDay: false, image: { id: "dia" } })
  })
})
