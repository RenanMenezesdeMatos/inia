

// Caminhos de conteúdo (`nodeOutputs.<nó>[.campo]`, `variables.<id>`) — sintaxe pura, sem resolver nada.

type ParsedSourcePath = { kind: "node"; nodeId: string; field: string } | { kind: "variable"; variableId: string }

/** Mesma convenção de `decodeSourcePath` no frontend, com o prefixo `variables.` a mais —
 * puramente sintático, não resolve nada; quem chama decide o que fazer com cada kind. */
export function parseSourcePath(path: string): ParsedSourcePath | null {
  if (path.startsWith("variables.")) {
    const variableId = path.slice("variables.".length)
    return variableId ? { kind: "variable", variableId } : null
  }
  if (path.startsWith("nodeOutputs.")) {
    const rest = path.slice("nodeOutputs.".length)
    if (!rest) return null
    const dotIndex = rest.indexOf(".")
    if (dotIndex === -1) return { kind: "node", nodeId: rest, field: "" }
    return { kind: "node", nodeId: rest.slice(0, dotIndex), field: rest.slice(dotIndex + 1) }
  }
  return null
}
