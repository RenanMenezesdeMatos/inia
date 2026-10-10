import type { ExecutionFailure } from "@/schemas/admin/execution-failure.schema"

/** V1.7.1c — detalhe da falha técnica de um nó (Execuções e Resultados); o formato vem de schemas/admin/execution-failure.schema.ts. */
const RETRY_REASON_LABELS: Record<string, string> = {
  TRANSIENT_PROVIDER_ERROR: "falha temporária do provedor",
  UNCLASSIFIED_LEGACY_RETRY: "erro não classificado",
  MAX_ATTEMPTS_REACHED: "limite de tentativas atingido",
  MODEL_OUTPUT_CONTRACT_INVALID_NO_SAFE_REPAIR: "resposta fora do contrato — repetir a mesma chamada não corrige",
  APPLICATION_INVARIANT_NOT_RETRYABLE: "configuração ou dado impede a execução — repetir não muda nada",
}

const time = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })

export function describeRetryDecision(failure: ExecutionFailure): string {
  const reason = failure.retryReason ? RETRY_REASON_LABELS[failure.retryReason] ?? failure.retryReason : null
  if (failure.willRetry) return `Nova tentativa${failure.nextRetryAt ? ` em ${time(failure.nextRetryAt)}` : ""}${reason ? ` (${reason})` : ""}.`
  return `Não será repetida${reason ? ` — ${reason}` : ""}.`
}

export function ExecutionFailureDetail({ failure }: { failure: ExecutionFailure }) {
  const shownFields = failure.contract?.fields.slice(0, 5) ?? []
  const hiddenFields = (failure.contract?.violationCount ?? 0) - shownFields.length
  return (
    <div className="space-y-0.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs" data-testid="execution-failure">
      <p className="font-medium text-destructive">{failure.label}</p>
      <p className="text-muted-foreground">
        {[failure.attempt !== null ? `Tentativa ${failure.attempt}` : null, failure.code ? `código ${failure.code}` : null, failure.model ? `modelo ${failure.model}` : null].filter(Boolean).join(" · ")}
      </p>
      {failure.contract ? (
        <p className="text-muted-foreground">
          Contrato {failure.contract.name}{failure.contract.version ? ` (${failure.contract.version})` : ""}: {shownFields.length > 0 ? shownFields.join("; ") : "sem campo identificado"}
          {hiddenFields > 0 ? ` e mais ${hiddenFields}` : ""}.
        </p>
      ) : null}
      <p className="text-muted-foreground">
        {describeRetryDecision(failure)}
        {failure.repairAttempt === false && failure.category === "MODEL_OUTPUT_CONTRACT_INVALID" ? " Sem tentativa de reparo." : ""}
        {failure.contract?.rawResponseStored ? " Resposta rejeitada guardada na execução do agente." : ""}
      </p>
    </div>
  )
}
