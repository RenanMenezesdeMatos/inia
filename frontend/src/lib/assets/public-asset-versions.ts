import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

/**
 * VERSÃO DE CONTEÚDO dos arquivos de `public/` que saem com cache IMUTÁVEL (modelos 3D e imagens da raiz): hash do arquivo,
 * calculado no build pelo next.config.ts e embutido na interface (NEXT_PUBLIC_INIA_ASSET_VERSIONS). `publicAsset()` monta o
 * endereço com `?v=<hash>`: trocar o arquivo num deploy muda o endereço, então o navegador nunca fica com a versão velha.
 * Só roda no Node (build/dev) — nunca é importado por código do navegador.
 */
export const VERSIONED_IMAGE = /\.(?:png|jpe?g|webp|svg)$/i
export const VERSIONED_MODEL = /\.glb$/i

export function computePublicAssetVersions(publicDir: string): Record<string, string> {
  const versions: Record<string, string> = {}
  const add = (relative: string) => {
    versions[`/${relative.split(path.sep).join("/")}`] = createHash("sha256").update(readFileSync(path.join(publicDir, relative))).digest("hex").slice(0, 12)
  }
  const list = (dir: string) => {
    try {
      return readdirSync(path.join(publicDir, dir))
    } catch {
      return []
    }
  }
  for (const name of list("")) if (VERSIONED_IMAGE.test(name)) add(name)
  for (const name of list("models")) if (VERSIONED_MODEL.test(name)) add(path.join("models", name))
  return versions
}
