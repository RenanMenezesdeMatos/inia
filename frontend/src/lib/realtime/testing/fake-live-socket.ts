import type { WebSocketLike } from "../gemini-realtime-transport"

// WebSocket falso (apoio de TESTE): o teste decide quando abre, o que o "servidor" manda e quando
// fecha. Só o subconjunto `WebSocketLike` que o transporte usa.
export class FakeLiveSocket extends EventTarget {
  readyState = 0
  readonly sent: Array<Record<string, unknown>> = []
  constructor(readonly url: string) {
    super()
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>)
  }
  close() {
    if (this.readyState === 3) return
    this.readyState = 3
    this.dispatchEvent(new Event("close"))
  }
  open() {
    this.readyState = 1
    this.dispatchEvent(new Event("open"))
  }
  receive(message: unknown, asBlob = false) {
    const text = JSON.stringify(message)
    this.dispatchEvent(new MessageEvent("message", { data: asBlob ? new Blob([text]) : text }))
  }
  asWebSocket(): WebSocketLike {
    return this as unknown as WebSocketLike
  }
}
