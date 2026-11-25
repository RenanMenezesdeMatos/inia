import { describe, expect, it } from "vitest"

import { keepSameList } from "./keep-same-list"

const from = (queryKey: readonly unknown[]) => ({ queryKey })

describe("keepSameList", () => {
  it("mantém o resultado anterior só enquanto muda o termo, onde quer que a consulta guarde o recorte", () => {
    const keep = keepSameList({ universe: "B2C", search: "nova" })
    expect(keep("antes", from(["org-units", "list", { universe: "B2C", search: "ve" }]))).toBe("antes")
    expect(keep("antes", from(["admin", "knowledge", "options", { universe: "B2C", search: undefined }]))).toBe("antes")
  })

  it("outro recorte recomeça vazio", () => {
    const keep = keepSameList({ universe: "B2B", search: undefined })
    expect(keep("antes", from(["admin", "knowledge", "options", { universe: "B2C", search: undefined }]))).toBeUndefined()
    expect(keep("antes", undefined)).toBeUndefined()
  })
})
