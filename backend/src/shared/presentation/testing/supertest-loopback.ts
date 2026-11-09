import http from "node:http"
import { createRequire } from "node:module"

/**
 * SUPERTEST PRESO A 127.0.0.1 — o alias `supertest` do `backend/vitest.config.ts` aponta para este arquivo; os testes
 * continuam escrevendo `import request from "supertest"`.
 *
 * O supertest abre o servidor do teste com `listen(0)`, em TODAS as interfaces, e conecta em 127.0.0.1. No macOS, com
 * SO_REUSEADDR, o kernel só recusa porta com endereço idêntico: entrega ao curinga uma porta que outro programa já escuta em
 * 127.0.0.1, e o endereço específico é quem recebe a conexão. O teste passa a falar com esse programa e falha com
 * "Parse Error: Expected HTTP/" (limactl), 401 ou 404 sem o corpo do app (Notion), ou até recebe um 200 que não é do app. As
 * portas saem em sequência, para a máquina inteira, e a suíte consome cerca de 3 mil por rodada: cruzar uma dessas portas fixas
 * é rotina, e por isso um teste de rota diferente falhava a cada 3 ou 4 rodadas. No Linux o kernel recusa essa combinação, por
 * isso o CI nunca teve o problema.
 *
 * Aqui o servidor escuta só em 127.0.0.1. O kernel não entrega porta já aberta nesse endereço e recusa quem tentar abri-la
 * depois (EADDRINUSE), então o pedido do teste só pode chegar ao app do teste.
 *
 * `_listen2` porque o supertest lê a porta na linha seguinte ao `listen`, e `listen(0, "127.0.0.1")` só abre depois de um
 * `dns.lookup`, assíncrono. É o mesmo método que o `listen` do Node chama por dentro, e o Node mantém esse nome para não quebrar
 * quem o usa. Se sumir numa versão futura, todo teste de rota quebra na hora, com erro claro; não volta a ser intermitente.
 *
 * Mesmo contrato do supertest: `request(app)` e `request.agent(app)`; servidor já criado, URL e http2 passam direto.
 */
type Supertest = typeof import("supertest")
type App = Parameters<Supertest>[0]
type Options = Parameters<Supertest>[1]
type SynchronousListen = { _listen2(address: string, port: number, addressType: 4): void }

// `require` nativo: um `import "supertest"` aqui seria resolvido pelo alias de volta para este arquivo.
const supertest = createRequire(import.meta.url)("supertest") as Supertest

function listeningOnlyOnLoopback(app: App, options: Options): App {
  if (typeof app !== "function" || options?.http2) return app
  const server = http.createServer(app as http.RequestListener)
  server.listen = ((port: number) => {
    ;(server as unknown as SynchronousListen)._listen2("127.0.0.1", port, 4)
    return server
  }) as typeof server.listen
  return server
}

const request = ((app: App, options?: Options) => supertest(listeningOnlyOnLoopback(app, options), options)) as Supertest
request.Test = supertest.Test
request.agent = ((app?: App, options?: Options) => supertest.agent(app === undefined ? app : listeningOnlyOnLoopback(app, options), options)) as Supertest["agent"]

export default request
