import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * ISOLAMENTO NO NAVEGADOR (design_draft.md seção 10): a sala de apoio e a área do Anjo nunca usam a voz nem o avatar da INIA — nada
 * em `components/human-support/**` importa `lib/realtime/**` nem `lib/avatar/**` (o campo da sala não tem microfone).
 */
const ROOT = __dirname
const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
})

describe("isolamento do Apoio com Anjo no navegador", () => {
  it("components/human-support/** não importa lib/realtime nem lib/avatar", () => {
    const offenders = files(ROOT).flatMap((path) => [...readFileSync(path, "utf8").matchAll(/from\s+["']([^"']+)["']/g)].filter((match) => /(^|\/)lib\/(realtime|avatar)\//.test(match[1]!)).map((match) => `${relative(ROOT, path)} → ${match[1]}`))
    expect(offenders).toEqual([])
  })

  it("o campo da sala não tem microfone", () => {
    const composer = readFileSync(join(ROOT, "operator", "support-composer.tsx"), "utf8")
    expect(composer).not.toMatch(/import[^\n]*\bMic(Off)?\b|getUserMedia|SpeechRecognition|MediaRecorder/)
  })
})
