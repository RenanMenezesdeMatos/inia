import { z } from "zod"

/** Espelho de pending-actions/domain/review-presentation.ts (HUMAN REVIEW CONTEXT — V1.2). */
export const reviewPresentationSchema = z.object({
  kind: z.enum(["indicator", "monitoring", "orchestrator", "text", "other"]),
  title: z.string().nullable(),
  summary: z.string().nullable(),
  indicator: z.object({ name: z.string(), evidence: z.string().nullable(), observed: z.string().nullable() }).nullable(),
  fields: z.array(z.object({ label: z.string(), text: z.string() })),
  evolution: z.string().nullable(),
  comparison: z.string().nullable(),
  keyEvidence: z.array(z.string()),
  limitations: z.array(z.string()),
  supportedHypotheses: z.array(z.string()),
  unsupportedHypotheses: z.array(z.string()),
  behavioralClaims: z.array(z.object({ text: z.string(), scope: z.string().nullable(), evidenceRefs: z.array(z.string()) })),
  recommendationSupport: z.array(z.object({ text: z.string(), basis: z.string(), evidenceRefs: z.array(z.string()) })),
  representativeness: z.array(z.object({ ref: z.string(), analyzed: z.number(), universe: z.number().nullable(), level: z.string(), operationalUniverse: z.number().nullable().optional(), operationalCoverage: z.number().nullable().optional(), universeRelationship: z.string().nullable().optional() })),
  materials: z.array(z.object({ title: z.string(), reason: z.string() })),
  toolSummary: z.object({ executed: z.number(), preflight: z.number().nullable(), investigation: z.number().nullable(), budget: z.number().nullable(), outcome: z.string().nullable(), rejectedClaims: z.number(), corrected: z.boolean().nullable() }).nullable(),
  /** V1.3: status do gating fail-closed (ausente em Feedbacks anteriores). */
  gating: z.object({ status: z.enum(["PASSED", "CORRECTED", "FALLBACK", "DISCARDED"]), envelopePresent: z.boolean().nullable(), fallbackReason: z.string().nullable() }).nullable().optional(),
})
export type ReviewPresentation = z.infer<typeof reviewPresentationSchema>
