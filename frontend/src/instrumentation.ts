import type { Instrumentation } from "next"

/**
 * Erro ao renderizar no SERVIDOR da interface (`next start`, serviço INIA-Interface): o navegador só recebe o `digest`, que a tela
 * de erro mostra como referência. Aqui gravamos UMA linha JSON com esse digest no log do serviço (stdout → `logs\INIA-Interface*.log`
 * na VM), com código do catálogo, rota, horário UTC e um resumo SEM dados da requisição (cabeçalhos, cookies e query nunca saem).
 */
const REDACT: [RegExp, string][] = [
  [/([a-z][a-z0-9+.-]*:\/\/)([^:/\s@]+):([^@\s]+)@/gi, "$1$2:***@"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***"],
  [/\b(password|senha|secret|token|api[_-]?key|key|authorization|cookie)(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, "$1$2***"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "***@***"],
  [/\b\d{8,}\b/g, "***num***"],
]

function redact(text: string): string {
  return REDACT.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text).slice(0, 500)
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const digest = typeof error === "object" && error !== null && "digest" in error ? String((error as { digest: unknown }).digest) : null
  const err = error instanceof Error ? { name: error.name, message: redact(error.message), stack: error.stack?.split("\n").slice(1, 7).map((line) => redact(line.trim())) } : { message: redact(String(error)) }
  const line = {
    time: new Date().toISOString(),
    level: "error",
    service: "inia-interface",
    event: "interface_error",
    code: "INIA-INTERFACE-SERVIDOR",
    reference: digest,
    method: request.method,
    route: context.routePath,
    routeType: context.routeType,
    err,
  }
  console.error(JSON.stringify(line))
}
