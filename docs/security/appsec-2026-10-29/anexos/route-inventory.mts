// Inventário de rotas: intercepta app.use/Router.use/Router[verbo] ANTES de montar o app real (createApp) e reconstrói
// "MÉTODO /caminho/completo" + middlewares de entrada (nomes). Sem banco, sem rede, sem .env.
import { createRequire } from "node:module"
const repo = process.argv[2]
const require = createRequire(`${repo}/backend/package.json`)
const express = require("express")
const RouterProto = Object.getPrototypeOf(Object.getPrototypeOf(express.Router()))
const VERBS = ["get", "post", "put", "patch", "delete"]
const mounts = new Map<unknown, { prefix: string; guards: string[] }[]>()
const routes: { owner: unknown; method: string; path: string; handlers: string[] }[] = []
const nameOf = (fn: unknown) => (typeof fn === "function" ? (fn as { name?: string }).name || "anon" : typeof fn)
function recordUse(owner: unknown, args: unknown[]) {
  let prefix = "/"
  let fns = args
  if (typeof args[0] === "string") { prefix = args[0] as string; fns = args.slice(1) }
  const flat = (fns as unknown[]).flat(Infinity)
  const guards: string[] = []
  for (const fn of flat) {
    if (typeof fn === "function" && (fn as { stack?: unknown }).stack && typeof (fn as { handle?: unknown }).handle === "function") {
      const list = mounts.get(fn) ?? []
      list.push({ prefix, guards: [...guards] })
      mounts.set(fn, Object.assign(list, { parent: owner }))
      ;(fn as { __parent?: unknown }).__parent = owner
    } else guards.push(nameOf(fn))
  }
}
const appUse = express.application.use
express.application.use = function (...args: unknown[]) { recordUse(this, args); return appUse.apply(this, args) }
const routerUse = RouterProto.use
RouterProto.use = function (...args: unknown[]) { recordUse(this, args); return routerUse.apply(this, args) }
for (const verb of VERBS) {
  const original = RouterProto[verb]
  RouterProto[verb] = function (path: unknown, ...handlers: unknown[]) {
    if (typeof path === "string") routes.push({ owner: this, method: verb.toUpperCase(), path, handlers: (handlers as unknown[]).flat(Infinity).map(nameOf) })
    return original.call(this, path, ...handlers)
  }
}
const appVerbs: Record<string, unknown> = {}
for (const verb of VERBS) {
  const original = express.application[verb]
  appVerbs[verb] = original
  express.application[verb] = function (path: unknown, ...handlers: unknown[]) {
    if (verb === "get" && handlers.length === 0) return original.call(this, path)
    if (typeof path === "string") routes.push({ owner: this, method: verb.toUpperCase(), path, handlers: (handlers as unknown[]).flat(Infinity).map(nameOf) })
    return original.call(this, path, ...handlers)
  }
}
const { createApp } = await import(`${repo}/backend/src/main/app.ts`)
const fakeDb = { query: async () => { throw new Error("sem banco") }, connect: async () => { throw new Error("sem banco") } }
const app = createApp(fakeDb as never, { rateLimits: false })
const join = (a: string, b: string) => (`${a}/${b}`).replace(/\/+/g, "/").replace(/(.)\/$/, "$1")
function prefixesOf(owner: unknown, depth = 0): { prefix: string; guards: string[] }[] {
  if (owner === app || depth > 6) return [{ prefix: "", guards: [] }]
  const list = mounts.get(owner)
  if (!list) return [{ prefix: "?", guards: [] }]
  const parent = (owner as { __parent?: unknown }).__parent
  return list.flatMap((m) => prefixesOf(parent, depth + 1).map((p) => ({ prefix: join(p.prefix, m.prefix), guards: [...p.guards, ...m.guards] })))
}
const out = []
for (const r of routes) for (const p of prefixesOf(r.owner)) out.push({ method: r.method, path: join(p.prefix, r.path), guards: p.guards, handlers: r.handlers })
const unique = [...new Map(out.map((r) => [`${r.method} ${r.path}`, r])).values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
console.log(JSON.stringify(unique))
process.exit(0)
