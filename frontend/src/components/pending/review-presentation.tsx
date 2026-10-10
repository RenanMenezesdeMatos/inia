"use client"

import { ChevronDown } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { RichContent } from "@/components/rich-content/rich-content"
import { CLAIM_SCOPE_LABELS, RECOMMENDATION_BASIS_LABELS, REPRESENTATIVENESS_LABELS, type ClaimScope, type RecommendationBasis } from "@/schemas/admin/investigation.schema"
import type { ReviewPresentation } from "@/schemas/pending-actions/review-presentation.schema"

/**
 * HUMAN REVIEW CONTEXT (V1.2): o que o revisor lê — resultado, evolução, comparação, evidências,
 * limitações, base de cada recomendação, materiais e resumo das ferramentas. Nunca JSON técnico
 * como conteúdo principal: o payload completo fica em "Ver detalhes técnicos" (Collapsible).
 */
const TOOL_OUTCOME_LABELS: Record<string, string> = { ANSWERED: "respondida", BUDGET_EXHAUSTED: "orçamento esgotado", NO_TOOLS: "sem ferramentas", TIMEOUT: "tempo esgotado" }

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>
      {children}
    </div>
  )
}

export function ReviewPresentationView({ presentation, technicalDetails }: { presentation: ReviewPresentation; technicalDetails?: React.ReactNode }) {
  const scopeLabel = (scope: string | null) => (scope && scope in CLAIM_SCOPE_LABELS ? CLAIM_SCOPE_LABELS[scope as ClaimScope] : null)
  const basisLabel = (basis: string) => (basis in RECOMMENDATION_BASIS_LABELS ? RECOMMENDATION_BASIS_LABELS[basis as RecommendationBasis] : basis)
  const levelLabel = (level: string) => (level in REPRESENTATIVENESS_LABELS ? REPRESENTATIVENESS_LABELS[level as keyof typeof REPRESENTATIVENESS_LABELS] : level)
  return (
    <div className="space-y-4" data-testid="review-presentation">
      {presentation.title ? <p className="text-base font-semibold">{presentation.title}</p> : null}
      {presentation.summary ? <RichContent text={presentation.summary} className="text-sm" /> : null}
      {presentation.indicator ? (
        <Block title="Indicador">
          <p className="text-sm font-medium">{presentation.indicator.name}</p>
          {presentation.indicator.evidence ? <p className="text-sm text-muted-foreground">{presentation.indicator.evidence}</p> : null}
        </Block>
      ) : null}
      {presentation.fields.map((field) => (
        <Block key={field.label} title={field.label}>
          <RichContent text={field.text} className="text-sm" />
        </Block>
      ))}
      {presentation.evolution || presentation.comparison ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {presentation.evolution ? (
            <Block title="Evolução">
              <p className="text-sm">{presentation.evolution}</p>
            </Block>
          ) : null}
          {presentation.comparison ? (
            <Block title="Comparação">
              <p className="text-sm">{presentation.comparison}</p>
            </Block>
          ) : null}
        </div>
      ) : null}
      {presentation.keyEvidence.length > 0 ? (
        <Block title="Principais evidências">
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {presentation.keyEvidence.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </Block>
      ) : null}
      {presentation.behavioralClaims.length > 0 ? (
        <Block title="Afirmações sobre comportamento">
          <ul className="space-y-1 text-sm">
            {presentation.behavioralClaims.map((claim, index) => (
              <li key={index} className="flex flex-wrap items-baseline gap-1.5">
                <span>{claim.text}</span>
                {scopeLabel(claim.scope) ? <Badge variant="outline" className="text-[10px]">{scopeLabel(claim.scope)}</Badge> : null}
                {claim.evidenceRefs.length > 0 ? <span className="font-mono text-[11px] text-muted-foreground">[{claim.evidenceRefs.join(", ")}]</span> : null}
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
      {presentation.representativeness.length > 0 ? (
        <Block title="Representatividade da evidência">
          <ul className="space-y-0.5 text-sm">
            {presentation.representativeness.map((item) => (
              <li key={item.ref}>
                <span className="font-mono text-[11px]">{item.ref}</span> · {item.analyzed} analisada(s){item.universe !== null ? ` de ${item.universe} registrada(s) no período` : ""} · <Badge variant={item.level === "REPRESENTATIVE" ? "secondary" : "outline"} className="text-[10px]">{levelLabel(item.level)}</Badge>
                {item.operationalUniverse !== undefined && item.operationalUniverse !== null ? (
                  <span className="text-muted-foreground"> · {item.operationalUniverse} contatos no indicador — cobertura operacional {item.operationalCoverage === null || item.operationalCoverage === undefined ? "não determinada" : `${Math.round(item.operationalCoverage * 100)}%`}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
      {presentation.gating ? (
        <p className="text-xs text-muted-foreground" data-testid="review-gating">
          Validação de evidência: {presentation.gating.status === "PASSED" ? "aprovada sem correção" : presentation.gating.status === "CORRECTED" ? "corrigida em uma re-request" : presentation.gating.status === "FALLBACK" ? "resposta factual (fallback)" : "descartada"}
          {presentation.gating.envelopePresent === false ? " · envelope de evidência ausente" : ""}
        </p>
      ) : null}
      {presentation.limitations.length > 0 ? (
        <Block title="Limitações">
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
            {presentation.limitations.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </Block>
      ) : null}
      {presentation.recommendationSupport.length > 0 ? (
        <Block title="Base de cada recomendação">
          <ul className="space-y-1 text-sm">
            {presentation.recommendationSupport.map((item, index) => (
              <li key={index}>
                {item.text} — <span className="font-medium">{basisLabel(item.basis)}</span>
                {item.evidenceRefs.length > 0 ? <span className="font-mono text-[11px] text-muted-foreground"> [{item.evidenceRefs.join(", ")}]</span> : null}
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
      {presentation.materials.length > 0 ? (
        <Block title="Materiais de apoio">
          <ul className="space-y-0.5 text-sm">
            {presentation.materials.map((material) => (
              <li key={material.title}>
                <span className="font-medium">{material.title}</span> — {material.reason}
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
      {presentation.toolSummary ? (
        <p className="text-xs text-muted-foreground" data-testid="review-tool-summary">
          Ferramentas: {presentation.toolSummary.executed} chamada(s)
          {presentation.toolSummary.preflight !== null ? ` · ${presentation.toolSummary.preflight} no preflight` : ""}
          {presentation.toolSummary.investigation !== null ? ` · ${presentation.toolSummary.investigation} escolhida(s) pelo Agent${presentation.toolSummary.budget !== null ? ` de ${presentation.toolSummary.budget}` : ""}` : ""}
          {presentation.toolSummary.outcome ? ` · ${TOOL_OUTCOME_LABELS[presentation.toolSummary.outcome] ?? presentation.toolSummary.outcome}` : ""}
          {presentation.toolSummary.rejectedClaims > 0 ? ` · ${presentation.toolSummary.rejectedClaims} afirmação(ões) sem evidência ${presentation.toolSummary.corrected ? "corrigida(s)" : "rejeitada(s)"}` : ""}
        </p>
      ) : null}
      {technicalDetails ? (
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid="review-technical-details">
            <ChevronDown className="size-3.5" /> Ver detalhes técnicos
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">{technicalDetails}</CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  )
}
