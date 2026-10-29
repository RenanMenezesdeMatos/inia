// Prova mínima e não destrutiva (APPSEC-01): UMA requisição sem sessão, com corpo gzip válido + bytes extras, contra o app
// real (createApp) num processo descartável, sem banco e sem .env. Resultado em JSON na saída padrão.
import { gzipSync, deflateSync, brotliCompressSync } from "node:zlib"
import { randomBytes } from "node:crypto"
import { request } from "node:http"
const repo = process.argv[2]
const { createApp } = await import(`${repo}/backend/src/main/app.ts`)
const fakeDb = { query: async () => { throw new Error("sem banco nesta prova") }, connect: async () => { throw new Error("sem banco") } }
const app = createApp(fakeDb as never, { rateLimits: false })
const server = app.listen(0, "127.0.0.1")
await new Promise((resolve) => server.once("listening", resolve))
const port = (server.address() as { port: number }).port
let crashed: string | null = null
process.on("uncaughtException", (error) => {
  crashed = `${error.name}: ${error.message}`
  console.log(JSON.stringify({ port, uncaughtException: crashed, note: "em produção, process-lifecycle.ts encerra o processo com código 1" }))
  process.exit(1)
})
const variant = process.argv[3] ?? "gzip-text"
const frame = variant.startsWith("deflate") ? deflateSync(Buffer.from('{"probe":1}')) : variant.startsWith("br") ? brotliCompressSync(Buffer.from('{"probe":1}')) : gzipSync(Buffer.from('{"probe":1}'))
const trailing = variant.endsWith("magic") ? Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x01, 0x02]) : variant.endsWith("big") ? randomBytes(48 * 1024) : variant.endsWith("frame") ? deflateSync(Buffer.from("x")) : Buffer.from("trailing-bytes")
const body = Buffer.concat([frame, trailing])
const encoding = variant.startsWith("deflate") ? "deflate" : variant.startsWith("br") ? "br" : "gzip"
const split = variant.includes("split")
const status = await new Promise<number>((resolve, reject) => {
  const req = request({ host: "127.0.0.1", port, method: "POST", path: "/api/v1/rota-inexistente", headers: { "content-type": "application/json", "content-encoding": encoding, "content-length": body.length } }, (res) => { let text = ""; res.on("data", (c) => { text += c }); res.on("end", () => { console.log(JSON.stringify({ variant, responseBody: text.slice(0, 160) })); resolve(res.statusCode ?? 0) }) })
  req.on("error", reject)
  if (split) { req.write(frame); setTimeout(() => req.end(trailing), 300) } else req.end(body)
})
await new Promise((resolve) => setTimeout(resolve, 3000))
console.log(JSON.stringify({ port, responseStatus: status, uncaughtException: crashed, processAlive: true }))
server.close()
process.exit(0)
