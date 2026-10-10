import { describe, expect, it } from "vitest"
import { evaluateAttainment } from "./evaluate-attainment.js"

describe("evaluateAttainment", () => {
  it("accepts values below a lower-is-better target", () => expect(evaluateAttainment(280, 300, "LOWER")).toBe(true))
  it("rejects values above a lower-is-better target", () => expect(evaluateAttainment(381, 300, "LOWER")).toBe(false))
  it("accepts values above a higher-is-better target", () => expect(evaluateAttainment(80, 70, "HIGHER")).toBe(true))
  it("does not classify measurements without a target", () => expect(evaluateAttainment(80, null, "HIGHER")).toBeNull())
})
