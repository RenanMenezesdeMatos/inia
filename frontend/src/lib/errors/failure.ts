import { ApiError, type ReferenceScope } from "@/lib/api/api-client"
import { CLIENT_ERROR_CODES, newReference } from "@/lib/errors/client-error-codes"

/**
 * Tela pública de cada falha. Status HTTP (resposta) ≠ código (tipo de falha) ≠ referência (a ocorrência). A tela usa o status
 * para escolher a arte, o texto e a ação; mostra o código e a referência para o suporte.
 */
export type FailureKind = "400" | "401" | "403" | "404" | "500" | "offline"

export type Failure = {
  kind: FailureKind
  status: number | null
  code: string | null
  reference: string | null
  /** server = procurável no servidor; proxy = só no log do IIS; local = só neste navegador (ainda não enviada). */
  referenceScope: ReferenceScope | "interface"
  occurredAt: string
  /** A falha nasceu no navegador e ainda precisa ser registrada no servidor (`reportClientFailure`). */
  needsReport: boolean
  /** Mensagem técnica SÓ para o registro (nunca exibida): erros de renderização no navegador. */
  technicalMessage?: string
}

export type FailureCopy = { title: string; description: string; actionLabel: string; art: string }

/** Textos e artes aprovados (frontend/public/brand/error-states). Sem conexão alterna as duas artes (offline-art.ts). */
export const FAILURE_COPY: Record<Exclude<FailureKind, "offline">, FailureCopy> & { offline: Omit<FailureCopy, "art"> & { arts: readonly [string, string] } } = {
  "400": { title: "Algo não encaixou.", description: "Revise as informações e tente novamente.", actionLabel: "Voltar e corrigir", art: "/brand/error-states/inia-400-quebra-cabeca.webp" },
  "401": { title: "Entre para continuar.", description: "Faça login para acessar esta página.", actionLabel: "Fazer login", art: "/brand/error-states/inia-401-cracha.webp" },
  "403": { title: "Acesso restrito.", description: "Sua conta não tem permissão para abrir esta página.", actionLabel: "Voltar ao início", art: "/brand/error-states/inia-403-cancela.webp" },
  "404": { title: "Essa página sumiu do mapa.", description: "O endereço pode ter mudado ou não existe mais.", actionLabel: "Voltar ao início", art: "/brand/error-states/inia-404-cabo.webp" },
  "500": { title: "Algo deu errado por aqui.", description: "Ocorreu uma falha no sistema.", actionLabel: "Tentar novamente", art: "/brand/error-states/inia-500-servidor.webp" },
  offline: { title: "Opa, perdemos a conexão.", description: "Confira sua internet e tente novamente.", actionLabel: "Tentar novamente", arts: ["/brand/error-states/inia-offline-roteador.webp", "/brand/error-states/inia-offline-celular.webp"] },
}

export function kindForStatus(status: number | null): FailureKind {
  if (status === null || status === 0) return "500"
  if (status === 401) return "401"
  if (status === 403) return "403"
  if (status === 404 || status === 410) return "404"
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) return "400"
  return "500"
}

/** Falha a partir de qualquer erro capturado (fronteira de erro, consulta, envio). */
export function describeFailure(error: unknown, now: () => Date = () => new Date()): Failure {
  const occurredAt = now().toISOString()
  if (error instanceof ApiError) {
    const offline = error.code === CLIENT_ERROR_CODES.offline
    return {
      kind: offline ? "offline" : error.status === 0 ? "500" : kindForStatus(error.status),
      status: error.status || null,
      code: error.code,
      reference: error.reference,
      referenceScope: error.referenceScope,
      occurredAt,
      // Falha sem resposta da API (rede, proxy, resposta inválida): só o navegador sabe dela — registra.
      needsReport: error.referenceScope !== "server",
    }
  }
  const digest = typeof error === "object" && error !== null && typeof (error as { digest?: unknown }).digest === "string" ? (error as { digest: string }).digest : null
  if (digest) {
    // Erro de renderização no servidor da interface: o digest é a referência e está no log do serviço INIA-Interface.
    return { kind: "500", status: 500, code: CLIENT_ERROR_CODES.serverRender, reference: digest, referenceScope: "interface", occurredAt, needsReport: false }
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { kind: "offline", status: null, code: CLIENT_ERROR_CODES.offline, reference: newReference("web-"), referenceScope: "local", occurredAt, needsReport: true }
  }
  return {
    kind: "500",
    status: null,
    code: CLIENT_ERROR_CODES.render,
    reference: newReference("web-"),
    referenceScope: "local",
    occurredAt,
    needsReport: true,
    technicalMessage: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 900) : String(error).slice(0, 900),
  }
}

/** Texto copiado para o suporte: SÓ código, referência, horário e contexto público (rota sem parâmetros, versão). */
export function supportDetails(failure: Failure, context: { route: string; release?: string | null; recorded: boolean }): string {
  const where = failure.referenceScope === "server" ? "registrada no servidor" : failure.referenceScope === "interface" ? "registrada no servidor da interface" : failure.referenceScope === "proxy" ? (context.recorded ? "registrada no servidor" : "procurar no log do proxy (IIS)") : context.recorded ? "registrada no servidor" : "local (ainda não enviada ao servidor)"
  return [
    "INIA — detalhes para o suporte",
    `Código: ${failure.code ?? "—"}`,
    `Referência: ${failure.reference ?? "—"} (${where})`,
    `Horário (UTC): ${failure.occurredAt}`,
    `Status: ${failure.status ?? "—"}`,
    `Tela: ${context.route}`,
    ...(context.release ? [`Versão: ${context.release}`] : []),
  ].join("\n")
}

/** Rota pública e segura: só o caminho, sem query nem hash (podem ter dado pessoal), ids trocados por `:id`. */
export function publicRoute(pathname: string): string {
  return pathname.split(/[?#]/)[0]!.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id").slice(0, 200) || "/"
}
