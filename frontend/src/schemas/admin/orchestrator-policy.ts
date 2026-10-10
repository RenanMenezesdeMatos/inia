import { z } from "zod"

import { BUSINESS_DOMAIN_CODE_PATTERN, describeBusinessDomain, describeBusinessDomains, domainRefFromCode, resolveDomainRef, resolveDomainRefs, type BusinessDomainRef } from "./business-domain.schema"

/**
 * Espelho (só leitura de UI) da política de especialistas do backend
 * (`backend/src/modules/assistant/domain/orchestrator-policy.ts`) — a regra é aplicada de
 * verdade lá, na gravação; aqui ela só serve pra mostrar o especialista incompatível como
 * desabilitado com o MESMO motivo, antes do 422. Manter os dois em sincronia.
 *
 * Domínios são DADOS do catálogo (`business-domain.schema.ts`): este arquivo compara referências
 * por CÓDIGO e mostra o NOME — nunca conhece um domínio concreto.
 */

/** Legado (053) — `agents.specialty`: código de domínio OU CROSS_CUTTING/PERFORMANCE/SYNTHESIS. */
export const agentSpecialtySchema = z.string().regex(BUSINESS_DOMAIN_CODE_PATTERN)
export type AgentSpecialty = z.infer<typeof agentSpecialtySchema>

/** Forma alvo (057): o que o Agent sabe/analisa. */
export const specialtyKindSchema = z.enum(["DOMAIN", "CROSS_CUTTING", "PERFORMANCE", "SYNTHESIS"])
export type SpecialtyKind = z.infer<typeof specialtyKindSchema>

export const SPECIALTY_KIND_LABELS: Record<SpecialtyKind, string> = {
  DOMAIN: "Especialista de domínio",
  CROSS_CUTTING: "Especialista transversal",
  PERFORMANCE: "Performance",
  SYNTHESIS: "Síntese",
}

export const SPECIALTY_KIND_HELP: Record<SpecialtyKind, string> = {
  DOMAIN: "Sabe O QUE deveria acontecer num assunto de negócio. Escolha o Domínio de negócio (catálogo administrável em Domínios de negócio).",
  CROSS_CUTTING: "Aplica a mesma competência em qualquer assunto — COMO o atendimento foi conduzido (Qualidade, Experiência, Eficiência). Não é \"sabe de tudo\".",
  PERFORMANCE: "Explica números oficiais de um colaborador (indicadores, PRV, reconhecimento, disponibilidade). Chamado direto pelo Workflow.",
  SYNTHESIS: "Recebe resultados consolidados (depois de \"Consolidar resultados\") e produz uma síntese. Não executa roteamento entre especialistas.",
}

export type ResolvedAgentSpecialty = { kind: SpecialtyKind | null; domain: BusinessDomainRef | null; capability: string | null; acceptsConsolidated: boolean }

/** Dual-read (espelho do backend): forma nova primeiro (FK/objeto do catálogo, depois o código
 * legado `domain`); sem ela, o legado `specialty`. */
export function resolveAgentSpecialty(agent: { specialty?: string | null; specialtyKind?: string | null; domain?: string | null; businessDomainId?: string | null; businessDomain?: unknown; capability?: string | null; consolidatedInput?: boolean | null }): ResolvedAgentSpecialty {
  const kind = specialtyKindSchema.safeParse(agent.specialtyKind)
  if (kind.success) {
    return { kind: kind.data, domain: kind.data === "DOMAIN" ? resolveDomainRef(agent) : null, capability: kind.data === "CROSS_CUTTING" ? (agent.capability ?? null) : null, acceptsConsolidated: kind.data === "SYNTHESIS" || Boolean(agent.consolidatedInput) }
  }
  const legacy = agentSpecialtySchema.safeParse(agent.specialty)
  if (!legacy.success) return { kind: null, domain: null, capability: null, acceptsConsolidated: Boolean(agent.consolidatedInput) }
  if (legacy.data === "SYNTHESIS") return { kind: "SYNTHESIS", domain: null, capability: null, acceptsConsolidated: true }
  if (legacy.data === "CROSS_CUTTING" || legacy.data === "PERFORMANCE") return { kind: legacy.data, domain: null, capability: null, acceptsConsolidated: Boolean(agent.consolidatedInput) }
  return { kind: "DOMAIN", domain: resolveDomainRef({ ...agent, domain: agent.domain ?? legacy.data }), capability: null, acceptsConsolidated: Boolean(agent.consolidatedInput) }
}

export function describeSpecialty(specialty: ResolvedAgentSpecialty): string {
  switch (specialty.kind) {
    case null:
      return "sem especialidade"
    case "DOMAIN":
      return specialty.domain ? describeBusinessDomain(specialty.domain) : "domínio não informado"
    case "CROSS_CUTTING":
      return specialty.capability ? `Transversal · ${specialty.capability}` : "Transversal"
    case "PERFORMANCE":
      return "Performance"
    case "SYNTHESIS":
      return "Síntese"
  }
}

export const orchestratorPolicyKindSchema = z.enum(["DOMAIN", "TRANSVERSAL", "MULTIDOMAIN", "MANAGERIAL", "INTERACTIVE", "OPEN"])
export type OrchestratorPolicyKind = z.infer<typeof orchestratorPolicyKindSchema>

export type OrchestratorPolicy = { kind: OrchestratorPolicyKind | null; domains: BusinessDomainRef[] }

export const ORCHESTRATOR_POLICY_KIND_LABELS: Record<OrchestratorPolicyKind, string> = {
  DOMAIN: "De domínio — o especialista do domínio + transversais autorizados",
  TRANSVERSAL: "Transversal — só especialistas de condução",
  MULTIDOMAIN: "Multidomínio — domínios explicitamente autorizados",
  MANAGERIAL: "Gerencial (pós-Join) — sem especialistas",
  INTERACTIVE: "Assistente interativo (chat/voz) — a lista de especialistas é a autorização",
  OPEN: "Qualquer assunto autorizado — a lista de especialistas é a autorização",
}

/** Versão curta pra card/tabela da lista. */
export const ORCHESTRATOR_POLICY_KIND_SHORT_LABELS: Record<OrchestratorPolicyKind, string> = {
  DOMAIN: "De domínio",
  TRANSVERSAL: "Transversal",
  MULTIDOMAIN: "Multidomínio",
  MANAGERIAL: "Gerencial",
  INTERACTIVE: "Assistente interativo",
  OPEN: "Qualquer assunto",
}

/** Mesmo texto do backend (ORCHESTRATOR_POLICY_REQUIRED): ativo ⇒ política definida (migration 054). */
export const POLICY_REQUIRED_MESSAGE = "Defina a política de especialistas antes de ativar este Orquestrador — um Orquestrador ativo nunca fica sem política."

/** Espelho de `describePolicyProblem(policy, usage)` do backend — só pra desabilitar o botão e
 * explicar antes do 422; a regra vale de verdade no servidor e na constraint do banco. */
export function describePolicyProblem(policy: OrchestratorPolicy, usage?: { active: boolean; invocationMode: string }): string | null {
  if (usage && usage.active && policy.kind === null) return POLICY_REQUIRED_MESSAGE
  if (usage && policy.kind === "INTERACTIVE" && usage.invocationMode !== "INTERACTIVE") return 'Um Assistente interativo atende só o chat/voz — use "Só chat/voz" como acionamento.'
  switch (policy.kind) {
    case null:
      return null
    case "DOMAIN":
      return policy.domains.length === 1 ? null : "Um Orquestrador de domínio precisa de exatamente um domínio principal."
    case "MULTIDOMAIN":
      return policy.domains.length >= 1 ? null : "Um Orquestrador multidomínio precisa de pelo menos um domínio autorizado."
    default:
      return policy.domains.length === 0 ? null : "Esta política não declara domínio de negócio."
  }
}

export type SpecialistCandidate = { name: string; specialty: { kind: SpecialtyKind | null; domain: BusinessDomainRef | null } }

function domainAllowed(domains: BusinessDomainRef[], domain: BusinessDomainRef | null): boolean {
  return domain !== null && domains.some((allowed) => allowed.code === domain.code)
}

export function checkSpecialistAgainstPolicy(policy: OrchestratorPolicy, specialist: SpecialistCandidate): { allowed: true } | { allowed: false; reason: string } {
  const { kind, domain } = specialist.specialty
  if (policy.kind === null || policy.kind === "INTERACTIVE" || policy.kind === "OPEN") return { allowed: true }
  if (policy.kind === "MANAGERIAL") return { allowed: false, reason: "Um Orquestrador gerencial não aciona especialistas — ele sintetiza resultados já consolidados." }
  if (!kind) return { allowed: false, reason: "Este agente não tem especialidade definida — classifique-o em Agentes antes de vinculá-lo." }
  if (kind === "PERFORMANCE") return { allowed: false, reason: "Este especialista é de performance — é chamado direto pelo Workflow, não por um Orquestrador de atendimento." }
  if (kind === "SYNTHESIS") return { allowed: false, reason: 'Este é um Agent de síntese — é chamado direto pelo Workflow depois de "Consolidar resultados", não por um Orquestrador.' }
  if (kind === "CROSS_CUTTING") return { allowed: true }
  if (policy.kind === "TRANSVERSAL") return { allowed: false, reason: "Este especialista pertence a um domínio de negócio — um Orquestrador transversal só coordena especialistas de condução." }
  if (domainAllowed(policy.domains, domain)) return { allowed: true }
  return { allowed: false, reason: `Este especialista pertence ao domínio ${domain ? describeBusinessDomain(domain) : "?"}, que não está autorizado neste Orquestrador.` }
}

// ---------------------------------------------------------------------------------------------
// Política de ROTEAMENTO (forma alvo, 057/060) — espelho de `resolveRoutingPolicy`/`checkSpecialistAgainstRouting`.
// ---------------------------------------------------------------------------------------------

export const routingPolicyKindSchema = z.enum(["DOMAINS", "OPEN"])
export type RoutingPolicyKind = z.infer<typeof routingPolicyKindSchema>
export type RoutingPolicy = { kind: "DOMAINS"; domains: BusinessDomainRef[] } | { kind: "OPEN" } | { kind: "LEGACY"; legacy: OrchestratorPolicy } | { kind: null }

export const ROUTING_POLICY_LABELS: Record<RoutingPolicyKind, string> = {
  DOMAINS: "Domínios específicos",
  OPEN: "Qualquer assunto autorizado",
}

export function resolveRoutingPolicy(row: { policyKind?: string | null; policyDomains?: string[] | null; routingPolicy?: string | null; routingDomains?: string[] | null; businessDomains?: unknown }): RoutingPolicy {
  const routing = routingPolicyKindSchema.safeParse(row.routingPolicy)
  if (routing.success) return routing.data === "OPEN" ? { kind: "OPEN" } : { kind: "DOMAINS", domains: resolveDomainRefs(row, "routingDomains") }
  const legacyKind = orchestratorPolicyKindSchema.safeParse(row.policyKind)
  const legacy: OrchestratorPolicy = { kind: legacyKind.success ? legacyKind.data : null, domains: resolveDomainRefs(row, "policyDomains") }
  switch (legacy.kind) {
    case null:
      return { kind: null }
    case "DOMAIN":
    case "MULTIDOMAIN":
      return { kind: "DOMAINS", domains: legacy.domains }
    case "INTERACTIVE":
    case "OPEN":
      return { kind: "OPEN" }
    case "TRANSVERSAL":
    case "MANAGERIAL":
      return { kind: "LEGACY", legacy }
  }
}

/** Como o legado é lido pelo formulário novo — "tradução" mostrada ao admin sem obrigá-lo a corrigir. */
export function describeRoutingPolicy(routing: RoutingPolicy): string {
  switch (routing.kind) {
    case null:
      return "Sem política (legado — classifique antes de ativar)"
    case "OPEN":
      return ROUTING_POLICY_LABELS.OPEN
    case "DOMAINS":
      return routing.domains.length === 0 ? "Domínios específicos (nenhum escolhido)" : `Domínios específicos: ${describeBusinessDomains(routing.domains)}`
    case "LEGACY":
      return `Legado: ${routing.legacy.kind ? ORCHESTRATOR_POLICY_KIND_SHORT_LABELS[routing.legacy.kind] : "sem política"} — ${routing.legacy.kind === "MANAGERIAL" ? "síntese pós-Join, hoje um Agent de síntese" : "transversal: só especialistas de condução"}`
  }
}

export function describeRoutingProblem(routing: RoutingPolicy, usage?: { active: boolean; invocationMode: string }): string | null {
  if (routing.kind === "LEGACY") return describePolicyProblem(routing.legacy, usage)
  if (usage && usage.active && routing.kind === null) return POLICY_REQUIRED_MESSAGE
  if (routing.kind === "DOMAINS" && routing.domains.length === 0) return "Um Orquestrador por domínios precisa de pelo menos um domínio autorizado."
  return null
}

export function checkSpecialistAgainstRouting(routing: RoutingPolicy, specialist: { name: string; specialty: ResolvedAgentSpecialty }): { allowed: true } | { allowed: false; reason: string } {
  const { kind, domain } = specialist.specialty
  if (kind === "SYNTHESIS") return { allowed: false, reason: 'Este é um Agent de síntese — é chamado direto pelo Workflow depois de "Consolidar resultados", não por um Orquestrador.' }
  switch (routing.kind) {
    case null:
    case "OPEN":
      return { allowed: true }
    case "LEGACY":
      return checkSpecialistAgainstPolicy(routing.legacy, specialist)
    case "DOMAINS": {
      if (!kind) return { allowed: false, reason: "Este agente não tem especialidade definida — classifique-o em Agentes antes de vinculá-lo." }
      if (kind === "PERFORMANCE") return { allowed: false, reason: "Este especialista é de performance — é chamado direto pelo Workflow, não por um Orquestrador de atendimento." }
      if (kind === "CROSS_CUTTING") return { allowed: true }
      if (domainAllowed(routing.domains, domain)) return { allowed: true }
      return { allowed: false, reason: `Este especialista pertence ao domínio ${domain ? describeBusinessDomain(domain) : "?"}, que não está autorizado neste Orquestrador.` }
    }
  }
}

/** Payload de gravação dos domínios: ids do catálogo (forma alvo) + códigos para referências ainda
 * sem id (legado não backfillado) — o backend resolve os dois contra o catálogo. */
export function routingDomainPayload(routing: RoutingPolicy): { routingDomainIds: string[]; routingDomains?: string[] } {
  if (routing.kind !== "DOMAINS") return { routingDomainIds: [] }
  const ids = routing.domains.map((domain) => domain.id).filter((id): id is string => Boolean(id))
  const codes = routing.domains.filter((domain) => !domain.id).map((domain) => domain.code)
  return codes.length > 0 ? { routingDomainIds: ids, routingDomains: codes } : { routingDomainIds: ids }
}

export { domainRefFromCode, type BusinessDomainRef }
