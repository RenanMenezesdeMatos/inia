import { describe, expect, it } from "vitest"
import { checkSlot, findSlotOverlap, localMinuteIn, nextImageChange, parseClock, resolveImageAt, uncoveredRanges } from "./scene-time-slots"

const slot = (start: string, end: string) => ({ start: parseClock(start)!, end: parseClock(end)! })

/** Espelho do backend: os mesmos casos de `backend/.../scene-time-slots.test.ts` que o editor usa para antecipar. */
describe("faixas de horário (editor)", () => {
  it("início inclusivo, fim exclusivo, atravessa a meia-noite", () => {
    const images = [{ id: "dia", isPrimary: true, slot: slot("06:00", "18:00") }, { id: "noite", isPrimary: false, slot: slot("18:00", "06:00") }]
    expect(resolveImageAt(images, parseClock("17:59")!)?.image.id).toBe("dia")
    expect(resolveImageAt(images, parseClock("18:00")!)?.image.id).toBe("noite")
    expect(resolveImageAt(images, parseClock("00:00")!)?.image.id).toBe("noite")
    expect(resolveImageAt(images, parseClock("06:00")!)?.image.id).toBe("dia")
    expect(nextImageChange(images, parseClock("20:00")!)).toMatchObject({ minute: 360, nextDay: true, image: { id: "dia" } })
  })

  it("sobreposição no círculo das 24 h; trechos sem faixa juntam a volta da meia-noite", () => {
    expect(findSlotOverlap([{ key: "dia", slot: slot("06:00", "18:00") }, { key: "noite", slot: slot("18:00", "06:00") }])).toBeNull()
    expect(findSlotOverlap([{ key: "noite", slot: slot("18:00", "06:00") }, { key: "madrugada", slot: slot("02:00", "04:00") }])).toMatchObject({ overlap: slot("02:00", "04:00") })
    expect(uncoveredRanges([slot("06:00", "18:00")])).toEqual([slot("18:00", "06:00")])
    expect(uncoveredRanges([slot("06:00", "18:00"), slot("18:00", "06:00")])).toEqual([])
    expect(uncoveredRanges([slot("08:00", "12:00"), slot("14:00", "18:00")])).toEqual([slot("12:00", "14:00"), slot("18:00", "08:00")])
    expect(uncoveredRanges([])).toEqual([])
  })

  it("validação e hora local da organização (não a do navegador)", () => {
    expect(checkSlot("", "")).toEqual({ ok: true, slot: null })
    expect(checkSlot("06:00", "")).toMatchObject({ ok: false })
    expect(checkSlot("06:00", "06:00")).toMatchObject({ ok: false })
    expect(localMinuteIn("America/Fortaleza", new Date("2026-10-07T21:00:00Z"))).toBe(18 * 60)
    expect(localMinuteIn("America/Fortaleza", new Date("2026-10-08T02:59:00Z"))).toBe(23 * 60 + 59)
  })
})
