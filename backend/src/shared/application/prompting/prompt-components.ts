import { createHash } from "node:crypto"
import { env } from "../../../config/env.js"

/**
 * PROMPT COMPONENT REGISTRY (V1.3 — §15): um prompt não é uma string gigante; é uma composição
 * explícita de componentes com id, versão, fases em que se aplicam e a marca ESTÁTICO (seguro
 * para cache do provider e igual entre colaboradores) × DINÂMICO (sujeito, KB recuperada,
 * ledger, materiais, pergunta). A montagem decide onde cada componente entra:
 *
 * - perfil CURRENT (V1.2): tudo no prompt de sistema, na ordem histórica — texto idêntico ao
 *   que a V1.2 enviava (é o braço de controle do A/B);
 * - perfil COMPACT: só componentes ESTÁTICOS no prompt de sistema (prefixo cacheável, sem dado
 *   de colaborador — §26); os DINÂMICOS entram no turno do usuário, antes da tarefa.
 *
 * `cacheKeyVersion` = hash dos componentes estáticos (ids + versões + conteúdo): qualquer mudança
 * de prompt invalida o cache automaticamente (§25). Nunca contém dado dinâmico.
 */
export type PromptProfile = "CURRENT" | "COMPACT"

export type PromptPhase =
  | "PLANNING"
  | "INVESTIGATION_NOTES"
  | "SEMANTIC_ANALYSIS"
  | "AGENT_SYNTHESIS"
  | "SPECIALIST_SYNTHESIS"
  | "ORCHESTRATOR_ROUTING"
  | "ORCHESTRATOR_SYNTHESIS"
  | "POST_JOIN_SYNTHESIS"
  | "GATING_CORRECTION"
  | "FREE_TEXT"

export type PromptComponent = {
  /** Identificador estável (ex.: "agent.identity", "investigation.policy"). */
  id: string
  version: number
  /** Fases em que o componente entra; "ALL" = sempre. */
  phases: PromptPhase[] | "ALL"
  /** true = igual entre colaboradores/execuções (cacheável); false = dinâmico (nunca em cache compartilhado). */
  static: boolean
  content: string
}

export type PromptComponentUsage = { id: string; version: number; chars: number; static: boolean; placement: "SYSTEM" | "USER" }

export type AssembledPrompt = {
  /** Prompt de sistema (perfil COMPACT: só estático). */
  system: string
  /** Preâmbulo dinâmico para o turno do usuário (perfil COMPACT); vazio no CURRENT. */
  userPreamble: string
  components: PromptComponentUsage[]
  /** Hash curto dos componentes ESTÁTICOS — versão de cache (§25). */
  cacheKeyVersion: string
  profile: PromptProfile
  staticChars: number
  dynamicChars: number
}

export function promptProfile(): PromptProfile {
  return env.INIA_PROMPT_PROFILE ?? "CURRENT"
}

function applies(component: PromptComponent, phase: PromptPhase): boolean {
  return component.phases === "ALL" || component.phases.includes(phase)
}

export function staticCacheKeyVersion(components: PromptComponent[]): string {
  const hash = createHash("sha256")
  for (const component of components.filter((item) => item.static)) hash.update(`${component.id}@${component.version}\n${component.content}\n`)
  return hash.digest("hex").slice(0, 12)
}

/** Monta o prompt da fase a partir dos componentes (os que não se aplicam à fase ficam de fora e não contam). */
export function assemblePrompt(phase: PromptPhase, components: PromptComponent[], profile: PromptProfile = promptProfile()): AssembledPrompt {
  const applicable = components.filter((component) => applies(component, phase) && component.content.trim().length > 0)
  const system: string[] = []
  const user: string[] = []
  const usage: PromptComponentUsage[] = []
  for (const component of applicable) {
    const placement: PromptComponentUsage["placement"] = profile === "CURRENT" || component.static ? "SYSTEM" : "USER"
    ;(placement === "SYSTEM" ? system : user).push(component.content)
    usage.push({ id: component.id, version: component.version, chars: component.content.length, static: component.static, placement })
  }
  return {
    system: system.join("\n\n"),
    userPreamble: user.join("\n\n"),
    components: usage,
    cacheKeyVersion: staticCacheKeyVersion(applicable),
    profile,
    staticChars: usage.filter((item) => item.static).reduce((sum, item) => sum + item.chars, 0),
    dynamicChars: usage.filter((item) => !item.static).reduce((sum, item) => sum + item.chars, 0),
  }
}

/** Texto final do turno do usuário: preâmbulo dinâmico (quando houver) + a tarefa. */
export function composeUserTurn(assembled: AssembledPrompt, task: string): string {
  return assembled.userPreamble ? `${assembled.userPreamble}\n\n${task}` : task
}
