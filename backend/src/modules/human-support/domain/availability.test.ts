import { describe, expect, it } from "vitest"
import { availabilityOf, canRequestWith } from "./availability.js"

describe("disponibilidade — a primeira regra que valer", () => {
  it("desligado; ninguém em serviço; recebe agora; todos ocupados; todos em pausa", () => {
    expect(availabilityOf({ enabled: false, inService: 3, canReceiveNow: 3, availableInService: 3 })).toBe("DISABLED")
    expect(availabilityOf({ enabled: true, inService: 0, canReceiveNow: 0, availableInService: 0 })).toBe("NONE_IN_SERVICE")
    expect(availabilityOf({ enabled: true, inService: 2, canReceiveNow: 1, availableInService: 2 })).toBe("AVAILABLE_NOW")
    expect(availabilityOf({ enabled: true, inService: 2, canReceiveNow: 0, availableInService: 1 })).toBe("ALL_BUSY")
    expect(availabilityOf({ enabled: true, inService: 2, canReceiveNow: 0, availableInService: 0 })).toBe("NONE_AVAILABLE")
    expect([canRequestWith("DISABLED"), canRequestWith("NONE_IN_SERVICE"), canRequestWith("ALL_BUSY"), canRequestWith("NONE_AVAILABLE")]).toEqual([false, false, true, true])
  })
})
