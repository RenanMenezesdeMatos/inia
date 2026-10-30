import http from "node:http"
import { createRequire } from "node:module"
import net from "node:net"

/**
 * SUPERTEST COM O LOOPBACK RESERVADO — o alias `supertest` do `backend/vitest.config.ts` aponta para este arquivo; os testes
 * continuam escrevendo `import request from "supertest"`.
 *
 * O supertest abre o servidor do teste com `listen(0)`, em TODAS as interfaces, e conecta em 127.0.0.1. No macOS, outro
 * programa que abra 127.0.0.1 nessa mesma porta (encaminhador de porta do colima/ssh, servidor local que reabre uma porta)
 * consegue o bind mesmo com o servidor do teste ativo e passa a atender 127.0.0.1: o teste recebe bytes de outro serviço e
 * falha com "Parse Error: Expected HTTP/, RTSP/ or ICE/" (instabilidade vista em testes de rota). No Linux o kernel já recusa
 * esse bind (EADDRINUSE), por isso o CI nunca teve o problema.
 *
 * Aqui, logo depois do `listen(0)` (síncrono, como o supertest exige para ler a porta), 127.0.0.1 na mesma porta também é
 * aberto por este servidor, que repassa as conexões ao mesmo app: quem chegar em 127.0.0.1 é atendido pelo teste, e o outro
 * programa recebe EADDRINUSE. Onde o kernel recusa (Linux), a reserva é descartada — o curinga já protege.
 * Mesmo contrato do supertest: `request(app)` e `request.agent(app)`; servidor já criado, URL e http2 passam direto.
 */
type Supertest = typeof import("supertest")
type App = Parameters<Supertest>[0]
type Options = Parameters<Supertest>[1]

// `require` nativo: um `import "supertest"` aqui seria resolvido pelo alias de volta para este arquivo.
const supertest = createRequire(import.meta.url)("supertest") as Supertest

function withLoopbackReserved(app: App, options: Options): App {
  if (typeof app !== "function" || options?.http2) return app
  const server = http.createServer(app as http.RequestListener)
  const listen = server.listen.bind(server)
  const close = server.close.bind(server)
  let reservation: net.Server | null = null
  server.listen = ((port: number) => {
    listen(port)
    reservation = net.createServer((socket) => server.emit("connection", socket))
    reservation.on("error", () => undefined)
    reservation.listen((server.address() as net.AddressInfo).port, "127.0.0.1")
    return server
  }) as typeof server.listen
  server.close = ((callback?: (error?: Error) => void) => {
    reservation?.close(() => undefined)
    reservation = null
    return close(callback)
  }) as typeof server.close
  return server
}

const request = ((app: App, options?: Options) => supertest(withLoopbackReserved(app, options), options)) as Supertest
request.Test = supertest.Test
request.agent = ((app?: App, options?: Options) => supertest.agent(app === undefined ? app : withLoopbackReserved(app, options), options)) as Supertest["agent"]

export default request
