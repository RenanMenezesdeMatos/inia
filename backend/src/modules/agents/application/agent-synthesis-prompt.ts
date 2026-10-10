import { assemblePrompt, promptProfile, type AssembledPrompt, type PromptComponent, type PromptPhase, type PromptProfile } from "../../../shared/application/prompting/prompt-components.js"
import { buildSupportMaterialsFreeTextPromptSection, buildSupportMaterialsOutputField, buildSupportMaterialsPromptSection, type SupportMaterialCandidate } from "../../feedbacks/domain/support-material.js"
import { renderSynthesisContract, renderSynthesisContractRules, renderSynthesisRefsLine, type ClaimSupportOptions } from "../../investigation/domain/evidence-gating.js"
import type { ClaimCandidate } from "../../investigation/domain/claim-candidates.js"
import { renderTextEvidenceInstructions, renderTextEvidenceRefsLine, renderTextEvidenceRules } from "../../investigation/application/text-evidence-gating.js"
import type { SystemPromptParts } from "./build-system-prompt.js"

/**
 * COMPONENTES DO PROMPT DE SÍNTESE do Agent/especialista (V1.3 — §14/15). Duas montagens:
 * - CURRENT: byte a byte o que a V1.2 enviava (prompt do Agent + contrato de saída + materiais +
 *   contrato de evidência, tudo no sistema);
 * - COMPACT: sistema = identidade/expectativas/restrições + contrato de saída + regras de evidência
 *   (estático, cacheável); turno do usuário = KB recuperada (DADOS), materiais candidatos, refs
 *   válidas desta execução, e então a tarefa (entrada + dossiê).
 * Nenhuma regra de evidência/saída foi cortada — só mudou ONDE cada parte entra.
 */
export type SynthesisPromptInput = {
  systemPrompt: string
  parts: SystemPromptParts | null
  /** Contrato de saída estruturada (STRUCTURED_OUTPUT_INSTRUCTIONS*) — null em texto livre. */
  outputContract: string | null
  candidates: SupportMaterialCandidate[]
  /** Refs válidas do ledger (F-n, TRANSCRICAO) — vazio = sem investigação (sem contrato de evidência). */
  evidenceRefs: string[]
  /** V1.4.2: enum dinâmico de suportes de claim (SP-n/SF-n existentes no ledger) — entra na linha dinâmica de refs. */
  claimSupports?: ClaimSupportOptions | undefined
  /** V1.4.4: candidatos de afirmação (CC-n) projetados por código — substituem os suportes no contexto do modelo. */
  claimCandidates?: ClaimCandidate[] | undefined
  transcriptRef?: string | undefined
  investigated: boolean
}

export type SynthesisPromptMode = "STRUCTURED" | "FREE_TEXT"

export function agentSynthesisComponents(mode: SynthesisPromptMode, input: SynthesisPromptInput, profile: PromptProfile = promptProfile()): PromptComponent[] {
  const phase: PromptPhase = mode === "STRUCTURED" ? "AGENT_SYNTHESIS" : "FREE_TEXT"
  const transcript = input.transcriptRef ? { transcriptRef: input.transcriptRef } : undefined
  if (profile === "CURRENT" || !input.parts) {
    if (mode === "STRUCTURED") {
      const contract = input.candidates.length === 0 ? (input.outputContract ?? "") : `${input.outputContract ?? ""}\n${buildSupportMaterialsOutputField(input.candidates)}\n\n${buildSupportMaterialsPromptSection(input.candidates)}`
      return [
        { id: "agent.prompt.legacy", version: 1, phases: [phase], static: false, content: input.systemPrompt },
        { id: "synthesis.contract.legacy", version: 1, phases: [phase], static: false, content: contract },
        ...(input.investigated ? [{ id: "evidence.contract.legacy", version: 1, phases: [phase], static: false, content: renderSynthesisContract(input.evidenceRefs, transcript) } satisfies PromptComponent] : []),
      ]
    }
    return [
      { id: "agent.prompt.legacy", version: 1, phases: [phase], static: false, content: input.systemPrompt },
      ...(input.candidates.length > 0 ? [{ id: "materials.free-text.legacy", version: 1, phases: [phase], static: false, content: buildSupportMaterialsFreeTextPromptSection(input.candidates) } satisfies PromptComponent] : []),
      ...(input.investigated ? [{ id: "evidence.text.legacy", version: 1, phases: [phase], static: false, content: renderTextEvidenceInstructions(input.evidenceRefs, transcript) } satisfies PromptComponent] : []),
    ]
  }
  const base: PromptComponent[] = [
    { id: "agent.identity", version: 1, phases: [phase], static: true, content: input.parts.identity },
    { id: "agent.expectations", version: 1, phases: [phase], static: true, content: input.parts.expectations },
    { id: "agent.restrictions", version: 1, phases: [phase], static: true, content: input.parts.restrictions },
  ]
  if (mode === "STRUCTURED") {
    const rules = renderSynthesisContractRules(transcript)
    return [
      ...base,
      { id: "synthesis.contract", version: 1, phases: [phase], static: true, content: input.outputContract ?? "" },
      ...(input.candidates.length > 0 ? [{ id: "materials.output-field", version: 1, phases: [phase], static: true, content: buildSupportMaterialsOutputField(input.candidates) } satisfies PromptComponent] : []),
      ...(input.investigated ? [{ id: "evidence.fields", version: 2, phases: [phase], static: true, content: rules.fields } satisfies PromptComponent, { id: "evidence.rules", version: 2, phases: [phase], static: true, content: rules.rules } satisfies PromptComponent] : []),
      // --- dinâmico (turno do usuário) ---
      { id: "knowledge.retrieved", version: 1, phases: [phase], static: false, content: input.parts.knowledge },
      ...(input.candidates.length > 0 ? [{ id: "materials.candidates", version: 1, phases: [phase], static: false, content: buildSupportMaterialsPromptSection(input.candidates) } satisfies PromptComponent] : []),
      ...(input.investigated ? [{ id: "evidence.refs", version: 1, phases: [phase], static: false, content: renderSynthesisRefsLine(input.evidenceRefs, input.claimSupports, input.claimCandidates) } satisfies PromptComponent] : []),
    ]
  }
  return [
    ...base,
    ...(input.investigated ? [{ id: "evidence.text.rules", version: 2, phases: [phase], static: true, content: renderTextEvidenceRules() } satisfies PromptComponent] : []),
    { id: "knowledge.retrieved", version: 1, phases: [phase], static: false, content: input.parts.knowledge },
    ...(input.candidates.length > 0 ? [{ id: "materials.free-text", version: 1, phases: [phase], static: false, content: buildSupportMaterialsFreeTextPromptSection(input.candidates) } satisfies PromptComponent] : []),
    ...(input.investigated ? [{ id: "evidence.text.refs", version: 1, phases: [phase], static: false, content: renderTextEvidenceRefsLine(input.evidenceRefs, { ...transcript, supports: input.claimSupports, candidates: input.claimCandidates }) } satisfies PromptComponent] : []),
  ]
}

export function assembleAgentSynthesisPrompt(mode: SynthesisPromptMode, input: SynthesisPromptInput, profile: PromptProfile = promptProfile()): AssembledPrompt {
  // Sem as partes do prompt (chamadores legados/testes) só existe a composição da V1.2 — tudo no sistema.
  const effective: PromptProfile = input.parts ? profile : "CURRENT"
  return assemblePrompt(mode === "STRUCTURED" ? "AGENT_SYNTHESIS" : "FREE_TEXT", agentSynthesisComponents(mode, input, effective), effective)
}
