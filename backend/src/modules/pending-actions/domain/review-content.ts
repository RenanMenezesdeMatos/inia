import { readSupportMaterials, type SupportMaterialRecommendation } from "../../feedbacks/domain/support-material.js"
import type { ToolInvocationTrace } from "../../investigation/domain/tool-trace.js"

/**
 * Transforma o valor bruto do Execution Context em texto legível (Markdown) para o revisor. O
 * conteúdo pode ser: texto; a resposta de um Orchestrator (`{ text, results, ... }`); o resultado
 * de um Agent (`{ kind, input: { structured } }`); ou qualquer outro objeto — este último vira um
 * bloco JSON, nunca `[object Object]` nem uma string JSON colada no meio de uma frase.
 */
export function describeReviewContent(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === "string") return value.trim().length > 0 ? value : null
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (typeof value !== "object") return null

  const record = value as Record<string, unknown>
  // O revisor precisa ver TUDO que será entregue ao colaborador — inclusive os materiais de apoio
  // recomendados pela IA (título do material real + motivo), que viajam no TOPO do resultado
  // (Agent direto ou Orquestrador), nunca dentro do texto nem do resultado estruturado.
  const materials = describeSupportMaterials(readSupportMaterials(record))
  // E como a IA chegou lá: as ferramentas de investigação usadas (fatos/ações observáveis), pra
  // o revisor conferir que a conclusão foi investigada — nunca prompt nem raciocínio.
  const tools = describeToolTrace(readToolTrace(record))
  const tail = [materials, tools].filter((item): item is string => Boolean(item))
  if (typeof record.text === "string" && record.text.trim().length > 0) return tail.length > 0 ? [record.text, ...tail].join("\n\n") : record.text

  const structured = readStructured(record)
  if (structured) {
    const lines = Object.entries(structured)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
      .map(([key, text]) => `**${humanizeKey(key)}:** ${text}`)
    lines.push(...tail)
    if (lines.length > 0) return lines.join("\n\n")
  }

  return ["```json", JSON.stringify(value, null, 2), "```"].join("\n")
}

/** Trace no topo (Agent direto) ou nos especialistas (Orquestrador) — só leitura. */
export function readToolTrace(record: Record<string, unknown>): ToolInvocationTrace[] {
  if (Array.isArray(record.toolTrace)) return record.toolTrace as ToolInvocationTrace[]
  if (Array.isArray(record.results)) return (record.results as { toolTrace?: unknown }[]).flatMap((result) => (Array.isArray(result?.toolTrace) ? (result.toolTrace as ToolInvocationTrace[]) : []))
  return []
}

function describeToolTrace(trace: ToolInvocationTrace[]): string | null {
  const used = trace.filter((item) => item.status === "COMPLETED" || item.status === "CACHED")
  if (used.length === 0) return null
  return `**Ferramentas de investigação utilizadas:**\n${used.map((item, index) => `${index + 1}. ${item.label} — ${item.resultSummary}`).join("\n")}`
}

function describeSupportMaterials(list: SupportMaterialRecommendation[]): string | null {
  const items = list.map((item) => `- **${item.title}** — ${item.reason}`)
  if (items.length === 0) return null
  return `**${items.length === 1 ? "Material de apoio recomendado" : "Materiais de apoio recomendados"}:**\n${items.join("\n")}`
}

function readStructured(record: Record<string, unknown>): Record<string, unknown> | null {
  const input = record.input
  if (input && typeof input === "object") {
    const structured = (input as Record<string, unknown>).structured
    if (structured && typeof structured === "object") return structured as Record<string, unknown>
  }
  return null
}

const KEY_LABELS: Record<string, string> = {
  impactedIndicator: "Indicador impactado",
  evidenceFound: "Evidência encontrada",
  observedBehavior: "Comportamento observado",
  relatedProcedure: "Procedimento relacionado",
  recommendation: "Recomendação",
  suggestedApproach: "Abordagem sugerida",
  strengths: "Pontos fortes",
  improvementPoints: "Pontos de melhoria",
  bestPractices: "Boas práticas",
  summary: "Resumo",
}

function humanizeKey(key: string): string {
  return KEY_LABELS[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (first) => first.toUpperCase())
}
