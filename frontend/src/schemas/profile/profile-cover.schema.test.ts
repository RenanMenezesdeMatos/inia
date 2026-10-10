import { describe, expect, it } from "vitest"

import { PROFILE_COVER_MAX_BYTES, profileCoverFileSchema } from "./profile-cover.schema"

describe("profileCoverFileSchema", () => {
  it("accepts a supported image within the size limit", () => {
    const file = new File([new Uint8Array(32)], "cover.webp", { type: "image/webp" })
    expect(profileCoverFileSchema.safeParse(file).success).toBe(true)
  })

  it("rejects SVG files", () => {
    const file = new File(["<svg></svg>"], "cover.svg", { type: "image/svg+xml" })
    expect(profileCoverFileSchema.safeParse(file).success).toBe(false)
  })

  it("rejects images larger than the limit", () => {
    const file = new File([new Uint8Array(PROFILE_COVER_MAX_BYTES + 1)], "cover.png", { type: "image/png" })
    expect(profileCoverFileSchema.safeParse(file).success).toBe(false)
  })
})
