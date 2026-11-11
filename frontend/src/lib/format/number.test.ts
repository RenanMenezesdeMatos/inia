import { describe, expect, it } from "vitest"

import { formatPercent, formatSeconds } from "./number"

describe("números para leitura", () => {
  it("porcentagem no formato brasileiro, até uma casa", () => {
    expect(formatPercent(0.15384)).toBe("15,4%")
    expect(formatPercent(0)).toBe("0%")
    expect(formatPercent(1)).toBe("100%")
  })

  it("segundos: menos de 1 s, uma casa até 1 min, depois minutos e horas", () => {
    expect(formatSeconds(0.4)).toBe("menos de 1 s")
    expect(formatSeconds(17.816)).toBe("17,8 s")
    expect(formatSeconds(59.96)).toBe("60 s")
    expect(formatSeconds(65)).toBe("1 min 5 s")
    expect(formatSeconds(120)).toBe("2 min")
    expect(formatSeconds(3725)).toBe("1 h 2 min")
  })
})
