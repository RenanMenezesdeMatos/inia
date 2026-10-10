import { createReadStream, existsSync } from "node:fs"
import { stat } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"

import { parseLabFixtureFile } from "@/lib/avatar/lab/fixture-catalog"

/**
 * Serve as capturas reais do Gemini Live ao laboratório do avatar (SÓ em desenvolvimento). Lista
 * branca exata (`parseLabFixtureFile`): nenhum pedaço da URL vira caminho no disco além de um id do
 * catálogo + extensão conhecida. Fora da árvore autenticada do proxy (`/dev/*` não passa por login).
 */

const FIXTURE_SUBDIR = path.join("src", "lib", "avatar", "lipsync", "__fixtures__", "gemini-live")

const CONTENT_TYPE = { json: "application/json; charset=utf-8", wav: "audio/wav" } as const

// `next dev` roda a partir de `frontend/`; aceita também a raiz do repositório.
function fixtureDir(): string | null {
  for (const base of [process.cwd(), path.join(process.cwd(), "frontend")]) {
    const dir = path.join(base, FIXTURE_SUBDIR)
    if (existsSync(dir)) return dir
  }
  return null
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 })
  const { file } = await params
  const parsed = parseLabFixtureFile(file)
  const dir = fixtureDir()
  if (!parsed || !dir) return new Response("Not found", { status: 404 })
  const filePath = path.join(dir, `${parsed.id}.${parsed.kind}`)
  let size: number
  try {
    size = (await stat(filePath)).size
  } catch {
    return new Response("Not found", { status: 404 })
  }
  const body = Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream<Uint8Array>
  return new Response(body, {
    headers: {
      "Content-Type": CONTENT_TYPE[parsed.kind],
      "Content-Length": String(size),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
