"use client"

import { CLAIM_SCOPE_LABELS, readInvestigationSummary, readToolTrace, RECOMMENDATION_BASIS_LABELS, REPRESENTATIVENESS_LABELS, STOP_REASON_LABELS, TOOL_QUALITY_STATUS_LABELS } from "@/schemas/admin/investigation.schema"
import { Badge } from "@/components/ui/badge"

/** Materiais de apoio no resultado de um node de IA (Agent direto ou síntese do Orquestrador):
 * candidatos agregados × recomendados — ao lado do rastro de conhecimento, nunca dentro do
 * resultado estruturado. Nada é renderizado quando o resultado não carrega o conceito. */
/**
 * "Ferramentas utilizadas" — prova de que o Agent realmente INVESTIGOU: lista numerada das Tools
 * (rótulo amigável), argumentos resumidos, resultado resumido e qualidade/proveniência. Vem do
 * trace seguro (nunca prompt nem raciocínio). Agent direto = topo do resultado; Orquestrador =
 * trace de cada especialista.
 */
export function StepToolTrace({ output }: { output: unknown }) {
  const trace = readToolTrace(output)
  if (trace.length === 0) return null
  const summary = readInvestigationSummary(output)
  return (
    <div className="space-y-2 rounded-md border border-border/60 p-3 text-sm" data-testid="qa-tool-trace">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Ferramentas utilizadas</p>
        {summary ? (
          <p className="text-xs text-muted-foreground">
            {summary.investigationToolCalls !== undefined ? `${summary.investigationToolCalls} escolhida(s) pelo Agent de ${summary.budget} · ${summary.preflightCalls ?? 0} no preflight · ${summary.toolCalls} no total` : `${summary.toolCalls ?? trace.length} chamada(s)${summary.budget ? ` de ${summary.budget}` : ""}${summary.preflightCalls ? ` · ${summary.preflightCalls} no preflight` : ""}`}
            {summary.planningRounds !== undefined ? ` · ${summary.planningRounds} rodada(s)${summary.maxPlanningRounds ? ` de ${summary.maxPlanningRounds}` : ""}` : ""}
            {summary.parallelWaves ? ` · ${summary.parallelWaves} onda(s) em paralelo` : ""}
            {summary.cachedCalls ? ` · ${summary.cachedCalls} do cache` : ""}
            {summary.rejectedCalls ? ` · ${summary.rejectedCalls} recusada(s)` : ""}
            {summary.outcome === "BUDGET_EXHAUSTED" ? " · orçamento esgotado" : summary.outcome === "TIMEOUT" ? " · tempo esgotado" : ""}
          </p>
        ) : null}
      </div>
      <ol className="space-y-1.5">
        {trace.map((item) => {
          const args = Object.entries(item.argumentsSummary).filter(([, value]) => value !== undefined && value !== null)
          const quality = item.quality && item.quality.status !== "SUFFICIENT" ? TOOL_QUALITY_STATUS_LABELS[item.quality.status] ?? item.quality.status : null
          return (
            <li key={`${item.sequence}-${item.tool}`} className="space-y-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">
                  {item.sequence}. {item.label}
                </span>
                {item.ledgerRef ? <Badge variant="secondary" className="font-mono text-[10px]">{item.ledgerRef}</Badge> : null}
                {item.round === 0 ? <Badge variant="outline" className="text-[10px]">preflight</Badge> : item.round !== undefined ? <Badge variant="outline" className="text-[10px]">rodada {item.round}</Badge> : null}
                {item.concurrency && item.concurrency > 1 ? <Badge variant="outline" className="text-[10px]">paralelo ×{item.concurrency}</Badge> : null}
                <span className="font-mono text-[11px] text-muted-foreground">{item.tool}</span>
                {args.length > 0 ? <span className="font-mono text-[11px] text-muted-foreground">{args.map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`).join(" ")}</span> : null}
                {item.modelArguments && JSON.stringify(item.modelArguments) !== JSON.stringify(item.argumentsSummary) ? (
                  <span className="font-mono text-[11px] text-muted-foreground" title="Como o modelo pediu (handles); os ids reais acima são o contexto de auditoria">
                    pedido como {Object.entries(item.modelArguments).map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`).join(" ")}
                  </span>
                ) : null}
                {item.status !== "COMPLETED" ? <Badge variant={item.status === "CACHED" ? "secondary" : "destructive"}>{item.status === "CACHED" ? "cache" : item.status === "REJECTED" ? "recusada" : item.status === "BUDGET_EXCEEDED" ? "orçamento" : "falhou"}</Badge> : null}
                {quality ? <Badge variant="outline">{quality}</Badge> : null}
              </div>
              <p className="text-xs text-muted-foreground">{item.resultSummary}</p>
              {item.provenance ? (
                <p className="text-[11px] text-muted-foreground">
                  {[item.provenance.period?.label ? `período ${item.provenance.period.label}` : null, item.provenance.population, item.provenance.dataSource].filter(Boolean).join(" · ")}
                </p>
              ) : null}
            </li>
          )
        })}
      </ol>
      {summary?.synthesis || summary?.evidenceGating ? <StepEvidenceGating summary={summary} /> : null}
    </div>
  )
}

/** Síntese auditável (V1.1): hipóteses, limitações, afirmações comportamentais com refs e a base de cada recomendação — e o que o gating rejeitou. */
function StepEvidenceGating({ summary }: { summary: NonNullable<ReturnType<typeof readInvestigationSummary>> }) {
  const synthesis = summary.synthesis
  const gating = summary.evidenceGating
  return (
    <div className="space-y-2 border-t border-border/60 pt-2" data-testid="qa-evidence-gating">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Evidência da síntese</p>
      {summary.stopReason ? (
        <p className="text-xs" data-testid="qa-stop-reason">
          <span className="font-medium">Investigação:</span> {summary.objective?.question ?? "objetivo não informado"} · parou por {STOP_REASON_LABELS[summary.stopReason] ?? summary.stopReason}
          {summary.objective?.requiredScope ? ` · escopo exigido ${CLAIM_SCOPE_LABELS[summary.objective.requiredScope]}` : ""}
        </p>
      ) : null}
      {gating && gating.envelopePresent !== undefined ? (
        <p className="text-xs" data-testid="qa-gating-fail-closed">
          <span className="font-medium">Gating fail-closed:</span> envelope {gating.envelopePresent ? "presente" : `ausente (${gating.parseStatus === "INVALID" ? "inválido" : "faltou"})`}
          {gating.correctionAttempted ? ` · correction retry ${gating.correctionSucceeded ? "aceito" : "não resolveu"}` : " · sem correção"}
          {gating.fallbackUsed ? <span className="text-amber-700 dark:text-amber-400"> · fallback factual usado{gating.fallbackReason === "ENVELOPE_MISSING" ? " (sem envelope)" : gating.fallbackReason === "CLAIMS_REJECTED" ? " (claims rejeitadas)" : ""}</span> : gating.correctionAttempted && !gating.correctionSucceeded ? <span className="text-amber-700 dark:text-amber-400"> · resposta descartada</span> : null}
        </p>
      ) : null}
      {gating ? (
        gating.rejectedClaims.length > 0 ? (
          <div className="space-y-1 text-xs">
            <p className="font-medium text-amber-700 dark:text-amber-400">
              {gating.rejectedClaims.length} afirmação(ões) sem evidência rejeitada(s) pela validação{gating.corrected ? " — corrigidas na re-request" : " — resposta descartada"}
            </p>
            <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
              {gating.rejectedClaims.map((claim, index) => (
                <li key={index}>
                  <span className="font-medium">{claim.kind === "BEHAVIORAL_CLAIM" ? "Afirmação" : claim.kind === "TEMPORAL_CLAIM" ? "Relação temporal" : claim.kind === "CRITICAL_FACT" ? "Fato crítico" : claim.kind === "PROCEDURAL_CLAIM" ? "Conclusão procedimental" : claim.kind === "CLAIM_BINDING" ? "Vínculo com pattern/finding" : "Recomendação"}:</span> &quot;{claim.text}&quot; — {claim.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Nenhuma afirmação comportamental ou recomendação sem evidência.</p>
        )
      ) : null}
      {synthesis ? (
        <div className="grid gap-2 text-xs sm:grid-cols-2">
          {synthesis.supportedHypotheses.length > 0 ? (
            <div>
              <p className="font-medium">Hipóteses sustentadas</p>
              <ul className="list-disc pl-4 text-muted-foreground">{synthesis.supportedHypotheses.map((item, index) => <li key={index}>{item}</li>)}</ul>
            </div>
          ) : null}
          {synthesis.unsupportedHypotheses.length > 0 ? (
            <div>
              <p className="font-medium">Hipóteses não sustentadas</p>
              <ul className="list-disc pl-4 text-muted-foreground">{synthesis.unsupportedHypotheses.map((item, index) => <li key={index}>{item}</li>)}</ul>
            </div>
          ) : null}
          {synthesis.limitations.length > 0 ? (
            <div>
              <p className="font-medium">Limitações</p>
              <ul className="list-disc pl-4 text-muted-foreground">{synthesis.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>
            </div>
          ) : null}
          {synthesis.behavioralClaims.length > 0 ? (
            <div>
              <p className="font-medium">Afirmações comportamentais</p>
              <ul className="list-disc pl-4 text-muted-foreground">
                {synthesis.behavioralClaims.map((item, index) => (
                  <li key={index}>
                    {item.text} <span className="font-mono">[{item.evidenceRefs.join(", ") || "sem ref"}]</span>
                    {item.scope ? <Badge variant="outline" className="ml-1 text-[10px]">{CLAIM_SCOPE_LABELS[item.scope]}</Badge> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {synthesis.evidenceRepresentativeness && synthesis.evidenceRepresentativeness.length > 0 ? (
            <div>
              <p className="font-medium">Representatividade da evidência</p>
              <ul className="list-disc pl-4 text-muted-foreground" data-testid="qa-representativeness">
                {synthesis.evidenceRepresentativeness.map((item) => (
                  <li key={item.ref}>
                    <span className="font-mono">{item.ref}</span> · {item.analyzed} analisada(s){item.universe !== null ? ` de ${item.universe} registrada(s)` : ""} · {REPRESENTATIVENESS_LABELS[item.classification ?? item.level]}
                    {item.operationalUniverseCount !== undefined ? ` · universo operacional ${item.operationalUniverseCount === null ? "não determinado" : item.operationalUniverseCount}${item.operationalCoverage === null || item.operationalCoverage === undefined ? " (cobertura operacional não determinada)" : ` (cobertura ${Math.round(item.operationalCoverage * 100)}%)`}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {synthesis.recommendationSupport.length > 0 ? (
            <div className="sm:col-span-2">
              <p className="font-medium">Base de cada recomendação</p>
              <ul className="list-disc pl-4 text-muted-foreground">
                {synthesis.recommendationSupport.map((item, index) => (
                  <li key={index}>
                    {item.text} — <span className="font-medium">{RECOMMENDATION_BASIS_LABELS[item.basis]}</span>
                    {item.evidenceRefs.length > 0 ? <span className="font-mono"> [{item.evidenceRefs.join(", ")}]</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function StepSupportMaterials({ output }: { output: unknown }) {
  if (!output || typeof output !== "object") return null
  const record = output as { supportMaterials?: unknown; supportMaterialCandidates?: unknown }
  const recommended = Array.isArray(record.supportMaterials) ? (record.supportMaterials as { materialId: string; title: string; reason: string }[]) : null
  const candidates = Array.isArray(record.supportMaterialCandidates) ? (record.supportMaterialCandidates as { materialId: string; title: string }[]) : null
  if (recommended === null && candidates === null) return null
  return (
    <div className="space-y-1 rounded-md border border-border/60 p-3 text-sm" data-testid="qa-support-materials">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Materiais de apoio</p>
      {candidates ? <p className="text-xs text-muted-foreground">{candidates.length === 0 ? "Nenhum material entrou como candidato (sem trechos de base nesta execução)." : `${candidates.length} candidato(s) vindo(s) do retrieval: ${candidates.map((candidate) => candidate.title).join(" · ")}`}</p> : null}
      {recommended && recommended.length > 0 ? (
        <ul className="space-y-1">
          {recommended.map((material) => (
            <li key={material.materialId}>
              <span className="font-medium">{material.title}</span> — {material.reason}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhum material recomendado nesta resposta.</p>
      )}
    </div>
  )
}
