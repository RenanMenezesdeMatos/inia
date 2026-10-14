/**
 * Endereço de um arquivo de `public/` com a versão do conteúdo (`?v=<hash>`, calculada no build — ver
 * public-asset-versions.ts). Versionados saem com `Cache-Control: immutable` de 1 ano (next.config.ts); sem versão conhecida
 * (desenvolvimento sem o arquivo, testes), o endereço puro — que sai com cache curto.
 */
function parseVersions(raw: string | undefined): Record<string, string> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

const versions = parseVersions(process.env.NEXT_PUBLIC_INIA_ASSET_VERSIONS)

export function publicAsset(path: string, known: Record<string, string> = versions): string {
  const version = known[path]
  return version ? `${path}?v=${version}` : path
}
