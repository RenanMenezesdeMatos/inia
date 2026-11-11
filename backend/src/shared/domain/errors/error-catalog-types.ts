/**
 * Tipos do CATÁLOGO DE ERROS da INIA (fonte de verdade: `error-catalog.ts`; versão em `ERROR_CATALOG_VERSION`).
 *
 * Três campos que nunca se confundem:
 * - status HTTP — descreve a RESPOSTA (quando há HTTP);
 * - código estável — descreve o TIPO de falha (o que este catálogo explica);
 * - referência — identifica UMA ocorrência (o `x-request-id` da API, o digest da interface, a referência de um job ou a gerada no
 *   navegador) e é o que se procura nos registros.
 */

export type ErrorSeverity = "info" | "warning" | "error" | "critical"

/** Onde a falha nasce. `INTERFACE` = servidor Next (renderização no servidor); `CLIENT` = navegador; `PROXY` = IIS/ARR. */
export type ErrorOrigin = "API" | "STREAM" | "JOB" | "PROCESS" | "INTERFACE" | "CLIENT" | "PROXY"

/** Hipótese de causa — nunca causa confirmada: o `signal` é o que, nos registros, confirma ESTA hipótese e afasta as outras. */
export type ProbableCause = { hypothesis: string; signal: string }

/** Onde buscar evidência na VM (Windows Server + IIS + serviços WinSW) — comando copiável ou local. */
export type EvidenceLocation = { where: string; command?: string }

export type ErrorCatalogEntry = {
  /** Código estável devolvido em `error.code`, gravado no log e na ocorrência. */
  code: string
  /** Outros nomes que levam a esta entrada (compatibilidade e nomes INIA-<MÓDULO>-<CAUSA>). Nunca devolvidos pela API. */
  aliases?: readonly string[]
  module: string
  origin: ErrorOrigin
  /** Condição de disparo, do ponto de vista do código. */
  trigger: string
  /** Status HTTP da resposta, quando há resposta HTTP (`null` = job, stream já aberto, processo ou navegador sem resposta). */
  httpStatus: number | null
  severity: ErrorSeverity
  /** Texto que a pessoa vê (seguro: sem detalhe interno). */
  publicMessage: string
  /** O que a pessoa pode fazer sem risco. */
  safeAction: string
  /** Para o administrador. */
  technicalDescription: string
  probableCauses: readonly ProbableCause[]
  /** Verificações em ordem (da mais barata/provável para a mais cara). */
  checks: readonly string[]
  evidence: readonly EvidenceLocation[]
  recovery: string
  escalation: string
  /** Arquivos do repositório (relativos à raiz) onde o código nasce ou é tratado — conferidos por teste. */
  codeRefs: readonly string[]
  /** Exemplo sanitizado de linha de log (sem dado pessoal nem segredo). */
  example?: string
}

/**
 * Família por status HTTP: o procedimento comum aos ~600 códigos de regra de negócio dos módulos (ex.: `BUSINESS_DOMAIN_NOT_FOUND`),
 * que são inventariados automaticamente (`domain-error-codes.generated.ts`) — a mensagem de cada um já diz a regra; a família diz
 * como investigar.
 */
export type ErrorFamily = {
  id: string
  /** Status que caem nesta família. */
  statuses: readonly number[]
  title: string
  severity: ErrorSeverity
  meaning: string
  probableCauses: readonly ProbableCause[]
  checks: readonly string[]
  evidence: readonly EvidenceLocation[]
  recovery: string
  escalation: string
}

/** Código de regra de negócio inventariado no código-fonte (gerado por `npm run errors:catalog`). */
export type InventoriedDomainCode = {
  code: string
  module: string
  statuses: readonly number[]
  messages: readonly string[]
  refs: readonly string[]
}
