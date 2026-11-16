import { describe, expect, it } from "vitest"

import { hourTick, hourTicks } from "./charts"

describe("eixo do tempo online", () => {
  it("marca horas cheias (valores em minutos), de 1 em 1 h até 8 h e de 2 em 2 acima", () => {
    expect(hourTicks(184)).toEqual([0, 60, 120, 180, 240])
    expect(hourTicks(0)).toEqual([0, 60])
    expect(hourTicks(9 * 60 + 10)).toEqual([0, 120, 240, 360, 480, 600])
    expect(hourTick(180)).toBe("3 h")
  })
})
