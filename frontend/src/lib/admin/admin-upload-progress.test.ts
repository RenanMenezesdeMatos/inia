import { afterEach, describe, expect, it, vi } from "vitest"

import { AdminApiError, adminUploadWithProgress, type UploadTransfer } from "./admin-api"

/** XMLHttpRequest falso: guarda o que foi pedido e deixa o teste disparar o andamento e a resposta. */
class FakeXhr {
  static last: FakeXhr | null = null
  method = ""
  url = ""
  withCredentials = false
  responseType = ""
  status = 0
  responseText = ""
  body: unknown = null
  upload: { onprogress: ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  constructor() {
    FakeXhr.last = this
  }
  open(method: string, url: string) {
    this.method = method
    this.url = url
  }
  send(body: unknown) {
    this.body = body
  }
  getResponseHeader() {
    return "application/json"
  }
  respond(status: number, payload: unknown) {
    this.status = status
    this.responseText = JSON.stringify(payload)
    this.onload?.()
  }
}

afterEach(() => vi.unstubAllGlobals())

describe("envio com o andamento dos bytes", () => {
  it("informa os bytes enviados, com cookie de sessão, e devolve o `data` da resposta", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr)
    const seen: UploadTransfer[] = []
    const form = new FormData()
    const pending = adminUploadWithProgress<{ id: string }>("/api/v1/admin/knowledge", form, { onProgress: (transfer) => seen.push(transfer) })
    const xhr = FakeXhr.last!
    expect(xhr.method).toBe("POST")
    expect(xhr.url).toMatch(/\/api\/v1\/admin\/knowledge$/)
    expect(xhr.withCredentials).toBe(true)
    expect(xhr.body).toBe(form)
    xhr.upload.onprogress!({ loaded: 512, total: 2048, lengthComputable: true })
    xhr.upload.onprogress!({ loaded: 100, total: 0, lengthComputable: false })
    expect(seen).toEqual([{ loaded: 512, total: 2048 }, { loaded: 100, total: null }])
    xhr.respond(201, { data: { id: "kb-1" } })
    await expect(pending).resolves.toEqual({ id: "kb-1" })
  })

  it("erro da API chega com código e mensagem; conexão caída tem mensagem clara", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr)
    const refused = adminUploadWithProgress("/x", new FormData())
    FakeXhr.last!.respond(422, { error: { code: "KNOWLEDGE_FILE_TYPE_MISMATCH", message: "O conteúdo do arquivo não corresponde ao tipo informado." } })
    await expect(refused).rejects.toMatchObject({ code: "KNOWLEDGE_FILE_TYPE_MISMATCH", message: "O conteúdo do arquivo não corresponde ao tipo informado." })

    const dropped = adminUploadWithProgress("/x", new FormData())
    FakeXhr.last!.onerror!()
    await expect(dropped).rejects.toBeInstanceOf(AdminApiError)
    await expect(dropped).rejects.toMatchObject({ code: "UPLOAD_NETWORK_ERROR" })
  })
})
