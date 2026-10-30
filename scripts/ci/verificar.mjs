#!/usr/bin/env node
// `npm run verificar` — a mesma verificação do CI (.github/workflows/ci.yml), rodando na máquina: para usar antes de cada
// entrega e para plugar em qualquer pipeline (o da Vivo inclusive) com um comando só. Não altera nada no repositório.
//
//   npm run verificar                    tipos, lint e testes do backend e do frontend, catraca de tipagem estrita e build
//   npm run verificar -- --sem-build     sem o `next build` (mais rápido)
//   npm run verificar -- --provas        também as provas contra o banco de teste (INIA_DB_PROOF=1; exige o PostgreSQL de
//                                        teste com as migrations em dia — `npm --prefix backend run db:migrate:test`)
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..")
const args = process.argv.slice(2)
const withBuild = !args.includes("--sem-build")
const withProofs = args.includes("--provas")

const steps = [
  { name: "backend · tipos", cwd: "backend", command: ["npx", "tsc", "-p", "tsconfig.json", "--noEmit"] },
  { name: "backend · tipos dos scripts", cwd: "backend", command: ["npm", "run", "-s", "typecheck:scripts"] },
  { name: "backend · lint", cwd: "backend", command: ["npx", "eslint", "."] },
  { name: "backend · testes", cwd: "backend", command: ["npx", "vitest", "run", "--reporter=dot"] },
  ...(withProofs ? [{ name: "backend · provas de banco", cwd: "backend", command: ["npx", "vitest", "run", "--reporter=dot", "--no-file-parallelism", "--exclude", "scripts/poc-tools/**", "proof"], env: { INIA_DB_PROOF: "1" } }] : []),
  { name: "frontend · tipos", cwd: "frontend", command: ["npx", "tsc", "--noEmit"] },
  { name: "frontend · tipagem estrita (catraca)", cwd: "frontend", command: ["node", "scripts/typecheck-strict.mjs"] },
  { name: "frontend · lint", cwd: "frontend", command: ["npx", "eslint"] },
  { name: "frontend · testes", cwd: "frontend", command: ["npx", "vitest", "run", "--reporter=dot"] },
  ...(withBuild ? [{ name: "frontend · build", cwd: "frontend", command: ["npx", "next", "build"] }] : []),
]

const results = []
for (const step of steps) {
  console.log(`\n▶ ${step.name}`)
  const startedAt = Date.now()
  const run = spawnSync(step.command[0], step.command.slice(1), { cwd: join(ROOT, step.cwd), stdio: "inherit", env: { ...process.env, ...step.env }, shell: process.platform === "win32" })
  results.push({ name: step.name, ok: run.status === 0, seconds: Math.round((Date.now() - startedAt) / 1000) })
}

console.log("\nResumo")
for (const result of results) console.log(`  ${result.ok ? "✓" : "✗"} ${result.name} (${result.seconds} s)`)
const failed = results.filter((result) => !result.ok)
if (failed.length > 0) {
  console.log(`\nFalhou: ${failed.map((result) => result.name).join(", ")}.`)
  process.exit(1)
}
console.log("\nTudo verde.")
