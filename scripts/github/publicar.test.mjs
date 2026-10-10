// Testes do `npm run github:publish` (node --test scripts/github): montagem do snapshot com exclusões e exceções num
// repositório git descartável e as conferências de segredo. As chaves "falsas" são montadas em tempo de execução para
// que este arquivo não case com os próprios padrões quando for publicado.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, before, describe, test } from "node:test"
import {
  buildSnapshot,
  findEnvFiles,
  findKeyPatterns,
  findValuesInTree,
  fingerprint,
  formatBytes,
  git,
  globToRegExp,
  matchesPattern,
  MIN_SECRET_LENGTH,
  parseAllowedPatternHits,
  parseEnv,
  parseExclusions,
  secretValues,
  sensitiveFiles,
} from "./publicar.mjs"

const FAKE_GOOGLE_KEY = ["AI", "za", "Q".repeat(35)].join("")
const FAKE_OPENAI_KEY = ["sk", "-teste-", "x".repeat(24)].join("")
const FAKE_SECRET = ["valor", "secreto", "de", "teste", "123"].join("-")

const EXCLUSIONS = `
# comentário
assets/**
docs/manuais
docs/CHAMADAS - *.rtf
scripts/poc/**
!scripts/poc/ground-truth/**
!scripts/poc/smoke/SMOKE-0[1-2].json
scripts/fe/**/results/**
!scripts/fe/**/results/**/*-freeze.json
scripts/dev/cenario/results/**
nada/casa/**
`

describe("parseExclusions", () => {
  test("separa regras e exceções e ignora comentários", () => {
    const { rules, exceptions } = parseExclusions(EXCLUSIONS)
    assert.deepEqual(rules, ["assets/**", "docs/manuais", "docs/CHAMADAS - *.rtf", "scripts/poc/**", "scripts/fe/**/results/**", "scripts/dev/cenario/results/**", "nada/casa/**"])
    assert.deepEqual(exceptions, ["scripts/poc/ground-truth/**", "scripts/poc/smoke/SMOKE-0[1-2].json", "scripts/fe/**/results/**/*-freeze.json"])
  })

  test("recusa caminho absoluto, pathspec mágico, '..' e lista só de exceções", () => {
    assert.throws(() => parseExclusions("/assets/**"))
    assert.throws(() => parseExclusions(":(exclude)assets"))
    assert.throws(() => parseExclusions("docs/../segredo"))
    assert.throws(() => parseExclusions("!scripts/poc/ground-truth/**"), /nenhuma regra/)
  })
})

describe("padrões", () => {
  const matches = (pattern, path) => matchesPattern(globToRegExp(pattern), path)

  test("* fica numa pasta, ** atravessa pastas e **/ aceita zero pastas", () => {
    assert.ok(matches("docs/CHAMADAS - *.rtf", "docs/CHAMADAS - ANA LIMA.rtf"))
    assert.ok(!matches("docs/*.rtf", "docs/sub/a.rtf"))
    assert.ok(matches("a/**", "a/b/c/d.json"))
    assert.ok(matches("a/**/results/**", "a/results/x.json"))
    assert.ok(matches("a/**/results/**", "a/b/c/results/d/x.json"))
    assert.ok(!matches("a/**/results/**", "a/b/resultsx/x.json"))
    assert.ok(matches("a/**/results/**/*-freeze.json", "a/b/results/round-v11-freeze.json"))
  })

  test("pasta sem ** tira tudo de dentro; ?, faixas e pontos literais", () => {
    assert.ok(matches("docs/manuais", "docs/manuais/IT-INIA-001.pdf"))
    assert.ok(!matches("docs/manuais", "docs/manuais-antigos/x.pdf"))
    assert.ok(matches("raw/SMOKE-0[1-4].json", "raw/SMOKE-04.json"))
    assert.ok(!matches("raw/SMOKE-0[1-4].json", "raw/SMOKE-05.json"))
    assert.ok(!matches("raw/SMOKE-0[!1-4].json", "raw/SMOKE-04.json"))
    assert.ok(matches("raw/SMOKE-0?.json", "raw/SMOKE-09.json"))
    assert.ok(!matches("a.json", "aXjson"))
    assert.ok(matches(".claude/**", ".claude/launch.json"))
  })
})

describe("snapshot num repositório descartável", () => {
  let repo
  let head
  const files = {
    "src/app.ts": "export const ok = true\n",
    "src/config.ts": `export const leaked = "${FAKE_SECRET}"\n`,
    "src/keys.ts": `export const key = "${FAKE_GOOGLE_KEY}"\nexport const other = "${FAKE_OPENAI_KEY}"\n`,
    ".env.example": "JWT_SECRET=troque\n",
    "assets/avatar/inia.blend": "binário\n",
    "docs/CHAMADAS - FULANA.rtf": "transcrição\n",
    "docs/manuais/IT-001.pdf": "manual\n",
    "docs/guia.md": "# guia\n",
    "scripts/poc/ground-truth/gabarito.json": "{}\n",
    "scripts/poc/benchmark/saida.json": "{}\n",
    "scripts/poc/smoke/SMOKE-01.json": "{}\n",
    "scripts/poc/smoke/SMOKE-03.json": "{}\n",
    "scripts/fe/eval/larissa/results/round-freeze.json": "{}\n",
    "scripts/fe/eval/larissa/results/round-paga.json": "{}\n",
    "scripts/fe/eval/results/outra.json": "{}\n",
    // Regra e exceção com prefixo comum ("scripts/"): o caso em que o pathspec do git devolvia vazio.
    "scripts/dev/cenario/results/saida.json": "{}\n",
    "scripts/dev/cenario/roteiro.ts": "export {}\n",
  }

  before(() => {
    repo = mkdtempSync(join(tmpdir(), "inia-publicar-teste-"))
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(repo, path)), { recursive: true })
      writeFileSync(join(repo, path), content)
    }
    const identity = { GIT_AUTHOR_NAME: "Teste", GIT_AUTHOR_EMAIL: "teste@example.com", GIT_COMMITTER_NAME: "Teste", GIT_COMMITTER_EMAIL: "teste@example.com" }
    git(repo, ["init", "--quiet", "--initial-branch=main"])
    git(repo, ["add", "-A"])
    git(repo, ["commit", "--quiet", "-m", "inicial"], { env: identity })
    head = git(repo, ["rev-parse", "HEAD"]).stdout.trim()
  })

  after(() => rmSync(repo, { recursive: true, force: true }))

  test("tira as regras, mantém as exceções e não mexe no índice do repositório", () => {
    const snapshot = buildSnapshot(repo, head, parseExclusions(EXCLUSIONS))
    assert.deepEqual(snapshot.files.map(({ path }) => path).sort(), [
      ".env.example",
      "docs/guia.md",
      "scripts/dev/cenario/roteiro.ts",
      "scripts/fe/eval/larissa/results/round-freeze.json",
      "scripts/poc/ground-truth/gabarito.json",
      "scripts/poc/smoke/SMOKE-01.json",
      "src/app.ts",
      "src/config.ts",
      "src/keys.ts",
    ])
    assert.equal(snapshot.removed, 8)
    assert.deepEqual(
      snapshot.perRule.map(({ pattern, files: count }) => [pattern, count]),
      [
        ["assets/**", 1],
        ["docs/manuais", 1],
        ["docs/CHAMADAS - *.rtf", 1],
        ["scripts/poc/**", 2],
        ["scripts/fe/**/results/**", 2],
        ["scripts/dev/cenario/results/**", 1],
        ["nada/casa/**", 0],
      ],
    )
    assert.deepEqual(
      snapshot.perException.map(({ pattern, files: count }) => [pattern, count]),
      [
        ["!scripts/poc/ground-truth/**", 1],
        ["!scripts/poc/smoke/SMOKE-0[1-2].json", 1],
        ["!scripts/fe/**/results/**/*-freeze.json", 1],
      ],
    )
    assert.equal(git(repo, ["status", "--porcelain"]).stdout, "")
    assert.equal(git(repo, ["ls-files"]).stdout.trim().split("\n").length, Object.keys(files).length)
  })

  test("acha o valor de um .env sem devolvê-lo e só aponta a origem e o arquivo", () => {
    const snapshot = buildSnapshot(repo, head, parseExclusions(EXCLUSIONS))
    const found = findValuesInTree(repo, snapshot.tree, [
      { key: "JWT_SECRET", value: FAKE_SECRET, source: "backend/.env" },
      { key: "GEMINI_API_KEY", value: "nao-aparece-em-lugar-nenhum", source: "backend/.env" },
    ])
    assert.deepEqual(found, [{ sources: ["JWT_SECRET (backend/.env)"], paths: ["src/config.ts"] }])
    assert.ok(!JSON.stringify(found).includes(FAKE_SECRET))
    assert.deepEqual(findValuesInTree(repo, snapshot.tree, []), [])
  })

  test("acha padrões de chave sem devolver a chave e libera só a ocorrência registrada", () => {
    const snapshot = buildSnapshot(repo, head, parseExclusions(EXCLUSIONS))
    const hit = `src/keys.ts ${fingerprint(FAKE_GOOGLE_KEY)}`
    const found = findKeyPatterns(repo, snapshot.tree)
    assert.deepEqual(
      found.map(({ name, hits }) => [name, hits]),
      [
        ["chave de API do Google (AIza…)", [hit]],
        ["chave de API no formato sk-… (OpenAI, Anthropic)", [`src/keys.ts ${fingerprint(FAKE_OPENAI_KEY)}`]],
      ],
    )
    assert.ok(!JSON.stringify(found).includes(FAKE_GOOGLE_KEY))
    const allowed = parseAllowedPatternHits(`# fixtures de teste\n${hit}\nsrc/keys.ts ${fingerprint(FAKE_OPENAI_KEY)}\n`)
    assert.deepEqual(findKeyPatterns(repo, snapshot.tree, allowed), [])
    // Liberar o arquivo inteiro não basta: a liberação é por trecho.
    assert.equal(findKeyPatterns(repo, snapshot.tree, parseAllowedPatternHits("src/keys.ts\n")).length, 2)
  })

  test("encontra os .env locais, inclusive em subpastas, e ignora os de exemplo e node_modules", () => {
    mkdirSync(join(repo, "backend"), { recursive: true })
    mkdirSync(join(repo, "node_modules/pacote"), { recursive: true })
    writeFileSync(join(repo, "backend/.env"), "A=1\n")
    writeFileSync(join(repo, "backend/.env.local"), "A=1\n")
    writeFileSync(join(repo, "node_modules/pacote/.env"), "A=1\n")
    const found = findEnvFiles(repo).map((file) => file.slice(repo.length + 1)).sort()
    assert.deepEqual(found, ["backend/.env", "backend/.env.local"])
  })
})

describe("leitura dos .env", () => {
  test("entende export, aspas e comentário no fim da linha", () => {
    const entries = parseEnv('# topo\nexport A=1\nB="com espaço # não é comentário"\nC=valor # comentário\nD=\'simples\'\nlixo\n')
    assert.deepEqual(entries, [
      { key: "A", value: "1" },
      { key: "B", value: "com espaço # não é comentário" },
      { key: "C", value: "valor" },
      { key: "D", value: "simples" },
    ])
  })

  test("procura só valores de nome secreto e a senha embutida em URLs", () => {
    const secrets = secretValues(
      parseEnv(
        [
          "PORT=3333",
          "CORS_ORIGIN=http://localhost:3000",
          "GEMINI_API_KEY=chave-longa-de-teste",
          "JWT_SECRET=segredo-longo",
          "DATA_HUB_SECRET_KEY=outra-chave",
          "INIA_DEMO_PASSWORD=senha-demo",
          "DATABASE_URL=postgresql://inia:s%40nha-do-banco@localhost:5432/inia",
          "EMPTY_TOKEN=",
        ].join("\n"),
      ),
    )
    assert.deepEqual(
      secrets.map(({ key, value }) => [key, value]),
      [
        ["GEMINI_API_KEY", "chave-longa-de-teste"],
        ["JWT_SECRET", "segredo-longo"],
        ["DATA_HUB_SECRET_KEY", "outra-chave"],
        ["INIA_DEMO_PASSWORD", "senha-demo"],
        ["DATABASE_URL (senha da URL)", "s@nha-do-banco"],
        ["DATABASE_URL (senha da URL)", "s%40nha-do-banco"],
      ],
    )
    assert.ok(MIN_SECRET_LENGTH >= 8)
  })
})

test("barra arquivos de segredo pelo nome e deixa passar os de exemplo", () => {
  const blocked = sensitiveFiles([
    ".env",
    "backend/.env",
    "frontend/.env.local",
    ".env.example",
    "backend/.env.example",
    "deploy/certificado.pem",
    "deploy/servidor.key",
    "home/id_ed25519",
    "home/id_ed25519.pub",
    ".npmrc",
    "config/service-account-prod.json",
    "src/modules/data-hub/application/secret-binding.test.ts",
  ])
  assert.deepEqual(
    blocked.map(({ path }) => path),
    [".env", "backend/.env", "frontend/.env.local", "deploy/certificado.pem", "deploy/servidor.key", "home/id_ed25519", ".npmrc", "config/service-account-prod.json"],
  )
})

test("formata tamanhos em pt-BR", () => {
  assert.equal(formatBytes(512), "512 B")
  assert.equal(formatBytes(1536), "1,5 KB")
  assert.equal(formatBytes(53.3 * 1024 * 1024), "53,3 MB")
})
