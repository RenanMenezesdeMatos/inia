import { z } from "zod"
import { describeBusinessDomain, describeBusinessDomains, resolveDomainRefs, type BusinessDomainRef } from "../../business-domains/domain/business-domain.js"

/**
 * Política explícita de especialistas por Orquestrador (migration 053) — o que um Orquestrador
 * PODE coordenar, aplicado por código no backend (assistant-router.ts) e cobrado pelo teste do
 * catálogo oficial, nunca só pelo prompt do coordenador.
 *
 * - Especialista de DOMÍNIO (specialty_kind = DOMAIN + domínio de negócio do catálogo): o assunto
 *   da ligação. Só entra num Orquestrador cuja fronteira inclua aquele domínio.
 * - Especialista TRANSVERSAL (CROSS_CUTTING — Experiência, Qualidade, Eficiência): a condução, em
 *   qualquer assunto. Só entra se for EXPLICITAMENTE adicionado à lista do Orquestrador — nunca
 *   "todo transversal em todo orquestrador".
 * - PERFORMANCE (indicadores/PRV/reconhecimento): chamados direto pelo Workflow; não entram em
 *   Orquestrador de domínio/multidomínio.
 * - Orquestrador GERENCIAL não tem especialista nenhum (sintetiza resultados prontos pós-Join).
 * - ASSISTENTE INTERATIVO (INTERACTIVE — saneamento 2026-09-16): o orquestrador que atende o
 *   chat/voz do colaborador. É multiassunto por definição (indicadores, processos, RH…), então a
 *   autorização é a lista explícita de especialistas — sem fronteira de domínio; em troca só
 *   existe com `invocation_mode = INTERACTIVE` (nunca roda dentro de um Workflow).
 * - `policy_kind` NULL só é aceito em orquestrador INATIVO (legado desativado à espera de
 *   classificação — constraint da migration 054). Ativar exige política; a UI avisa.
 *
 * Domínios são DADOS (catálogo `business_domains`, migration 060): este arquivo compara
 * referências por CÓDIGO e mostra o NOME — nunca conhece um domínio concreto.
 */
export const orchestratorPolicyKindSchema = z.enum(["DOMAIN", "TRANSVERSAL", "MULTIDOMAIN", "MANAGERIAL", "INTERACTIVE", "OPEN"])
export type OrchestratorPolicyKind = z.infer<typeof orchestratorPolicyKindSchema>

export type OrchestratorPolicy = { kind: OrchestratorPolicyKind | null; domains: BusinessDomainRef[] }

export type OrchestratorPolicyRow = {
  policy_kind?: string | null | undefined
  policy_domains?: unknown
  routing_policy?: string | null | undefined
  routing_domains?: unknown
  /** Relação nova (`assistant_orchestrator_domains` + catálogo), como json `[{id, code, name, active}]`. */
  business_domains?: unknown
}

/** Forma legada persistida → política tipada (um `policy_kind` desconhecido vira null). Os domínios
 * vêm da relação nova quando existe; senão dos códigos legados de `policy_domains`. */
export function parseOrchestratorPolicy(row: OrchestratorPolicyRow): OrchestratorPolicy {
  const kind = orchestratorPolicyKindSchema.safeParse(row.policy_kind)
  return { kind: kind.success ? kind.data : null, domains: resolveDomainRefs(row, "policy_domains") }
}

export const POLICY_REQUIRED_MESSAGE = "Defina a política de especialistas antes de ativar este Orquestrador — um Orquestrador ativo nunca fica sem política."

/** Coerência da própria política: DOMAIN exige exatamente um domínio; MULTIDOMAIN pelo menos um;
 * TRANSVERSAL/MANAGERIAL/INTERACTIVE não têm domínio. Com `usage` informado, também cobra o que
 * a política exige do registro: ativo ⇒ política definida; assistente interativo ⇒ só chat/voz. */
export function describePolicyProblem(policy: OrchestratorPolicy, usage?: { active: boolean; invocationMode: string }): string | null {
  if (usage && usage.active && policy.kind === null) return POLICY_REQUIRED_MESSAGE
  if (usage && policy.kind === "INTERACTIVE" && usage.invocationMode !== "INTERACTIVE") {
    return 'Um Assistente interativo atende só o chat/voz — use "Somente chat/voz" como modo de acionamento, ou classifique o Orquestrador por domínio para usá-lo em Workflows.'
  }
  switch (policy.kind) {
    case null:
      return null
    case "DOMAIN":
      return policy.domains.length === 1 ? null : "Um Orquestrador de domínio precisa de exatamente um domínio principal."
    case "MULTIDOMAIN":
      return policy.domains.length >= 1 ? null : "Um Orquestrador multidomínio precisa de pelo menos um domínio autorizado."
    case "TRANSVERSAL":
    case "MANAGERIAL":
      return policy.domains.length === 0 ? null : "Orquestrador transversal/gerencial não declara domínio de negócio."
    case "INTERACTIVE":
    case "OPEN":
      return policy.domains.length === 0 ? null : "Um Orquestrador aberto não declara domínio de negócio — a autorização é a lista de especialistas."
  }
}

/** O que a política precisa saber de um candidato a especialista — a MESMA forma para a regra
 * legada e a alvo (o tipo vem de `resolveAgentSpecialty`). */
export type SpecialistCandidate = {
  name: string
  specialty: { kind: "DOMAIN" | "CROSS_CUTTING" | "PERFORMANCE" | "SYNTHESIS" | null; domain: BusinessDomainRef | null }
}
export type SpecialistVerdict = { allowed: true } | { allowed: false; reason: string }

function domainAllowed(domains: readonly BusinessDomainRef[], domain: BusinessDomainRef | null): boolean {
  return domain !== null && domains.some((allowed) => allowed.code === domain.code)
}

/** A regra LEGADA em um lugar só — usada pelo dual-read de TRANSVERSAL/MANAGERIAL e pelo teste
 * de catálogo (a forma alvo é `checkSpecialistAgainstRouting`). */
export function checkSpecialistAgainstPolicy(policy: OrchestratorPolicy, specialist: SpecialistCandidate): SpecialistVerdict {
  const { kind, domain } = specialist.specialty
  if (policy.kind === null) return { allowed: true }
  // Aberto (chat/voz e casos realmente abertos): a lista explícita é a autorização.
  if (policy.kind === "INTERACTIVE" || policy.kind === "OPEN") return { allowed: true }
  if (policy.kind === "MANAGERIAL") return { allowed: false, reason: "Um Orquestrador gerencial não aciona especialistas — ele sintetiza resultados já consolidados." }
  if (!kind) {
    return { allowed: false, reason: `"${specialist.name}" não tem especialidade definida — classifique o agente em Agentes antes de vinculá-lo a um Orquestrador com política.` }
  }
  if (kind === "PERFORMANCE") {
    return { allowed: false, reason: `"${specialist.name}" é um especialista de performance — é chamado direto pelo Workflow, não por um Orquestrador de atendimento.` }
  }
  if (kind === "SYNTHESIS") {
    return { allowed: false, reason: `"${specialist.name}" é um Agent de síntese — é chamado direto pelo Workflow depois de "Consolidar resultados", não por um Orquestrador.` }
  }
  if (kind === "CROSS_CUTTING") return { allowed: true }
  if (policy.kind === "TRANSVERSAL") {
    return { allowed: false, reason: `"${specialist.name}" pertence ao domínio ${domain ? describeBusinessDomain(domain) : "?"} — um Orquestrador transversal só coordena especialistas de condução.` }
  }
  if (domainAllowed(policy.domains, domain)) return { allowed: true }
  const scope = policy.kind === "DOMAIN" ? `este Orquestrador é do domínio ${policy.domains[0] ? describeBusinessDomain(policy.domains[0]) : "?"}` : `os domínios autorizados são ${describeBusinessDomains(policy.domains)}`
  return { allowed: false, reason: `"${specialist.name}" pertence a outro domínio (${domain ? describeBusinessDomain(domain) : "?"}) — ${scope}.` }
}

// ---------------------------------------------------------------------------------------------
// Política de ROTEAMENTO (migration 057) — a forma alvo, com dual-read do `policy_kind` legado.
// ---------------------------------------------------------------------------------------------

/**
 * `routing_policy` responde UMA pergunta: "entre quais especialistas este Orquestrador pode
 * escolher?" — DOMAINS (1..N domínios de negócio do catálogo; 1 domínio = o antigo DOMAIN, vários
 * = o antigo MULTIDOMAIN) ou OPEN (sem fronteira de domínio — a lista explícita continua sendo a
 * autorização; chat/voz é OPEN + invocation_mode INTERACTIVE). ONDE é acionado continua em
 * `invocation_mode`.
 *
 * Dual-read: `routing_policy` persistido tem precedência; os domínios vêm da relação nova
 * (`assistant_orchestrator_domains`, migration 060) e, sem ela, dos códigos legados de
 * `routing_domains`. Sem `routing_policy`, o `policy_kind` legado é traduzido (DOMAIN/MULTIDOMAIN
 * → DOMAINS, INTERACTIVE → OPEN). TRANSVERSAL e MANAGERIAL não têm tradução — continuam como
 * `LEGACY` até os Workflows pós-JOIN migrarem para o Agent de síntese (aí o registro é
 * reclassificado ou desativado), e a regra legada continua valendo para eles.
 */
export const routingPolicyKindSchema = z.enum(["DOMAINS", "OPEN"])

export type RoutingPolicy =
  | { kind: "DOMAINS"; domains: BusinessDomainRef[] }
  | { kind: "OPEN" }
  | { kind: "LEGACY"; legacy: OrchestratorPolicy }
  | { kind: null }

export function resolveRoutingPolicy(row: OrchestratorPolicyRow): RoutingPolicy {
  const routing = routingPolicyKindSchema.safeParse(row.routing_policy)
  if (routing.success) {
    if (routing.data === "OPEN") return { kind: "OPEN" }
    return { kind: "DOMAINS", domains: resolveDomainRefs(row, "routing_domains") }
  }
  const legacy = parseOrchestratorPolicy(row)
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

/** Valores legados equivalentes (dual-write): continuam gravados em `policy_kind/policy_domains`
 * para o runtime/frontend antigo e para a constraint da 054 ("ativo ⇒ política"). Removível
 * quando nenhum leitor depender mais de `policy_kind`. */
export function legacyPolicyFor(routing: RoutingPolicy, invocationMode: string): OrchestratorPolicy {
  switch (routing.kind) {
    case null:
      return { kind: null, domains: [] }
    case "LEGACY":
      return routing.legacy
    case "OPEN":
      return { kind: invocationMode === "INTERACTIVE" ? "INTERACTIVE" : "OPEN", domains: [] }
    case "DOMAINS":
      return { kind: routing.domains.length === 1 ? "DOMAIN" : "MULTIDOMAIN", domains: routing.domains }
  }
}

/** Coerência da política de roteamento + do registro (ativo ⇒ política; INTERACTIVE legado ⇒ só chat). */
export function describeRoutingProblem(routing: RoutingPolicy, usage?: { active: boolean; invocationMode: string }): string | null {
  if (routing.kind === "LEGACY") return describePolicyProblem(routing.legacy, usage)
  if (usage && usage.active && routing.kind === null) return POLICY_REQUIRED_MESSAGE
  if (routing.kind === "DOMAINS" && routing.domains.length === 0) return "Um Orquestrador por domínios precisa de pelo menos um domínio autorizado."
  return null
}

export type RoutingSpecialistCandidate = SpecialistCandidate

/**
 * A regra alvo, em um lugar só (backend na gravação; catálogo; UI espelha o motivo):
 * - DOMAINS: Agent DOMAIN ⇒ domínio ∈ domains (por código); CROSS_CUTTING ⇒ permitido se listado;
 *   PERFORMANCE ⇒ não (é chamado direto pelo Workflow); sem especialidade ⇒ classifique antes.
 * - OPEN: qualquer especialidade, desde que explicitamente listada (inclusive legados sem
 *   especialidade — o chat/voz depende deles).
 * - SYNTHESIS nunca é tool de Orquestrador: quem sintetiza é o Agent pós-JOIN, não um roteador.
 * - LEGACY (TRANSVERSAL/MANAGERIAL): regra legada, inalterada.
 */
export function checkSpecialistAgainstRouting(routing: RoutingPolicy, specialist: RoutingSpecialistCandidate): SpecialistVerdict {
  const { kind, domain } = specialist.specialty
  if (kind === "SYNTHESIS") {
    return { allowed: false, reason: `"${specialist.name}" é um Agent de síntese — é chamado direto pelo Workflow depois de "Consolidar resultados", não por um Orquestrador.` }
  }
  switch (routing.kind) {
    case null:
    case "OPEN":
      return { allowed: true }
    case "LEGACY":
      return checkSpecialistAgainstPolicy(routing.legacy, specialist)
    case "DOMAINS": {
      if (!kind) {
        return { allowed: false, reason: `"${specialist.name}" não tem especialidade definida — classifique o agente em Agentes antes de vinculá-lo a um Orquestrador por domínios.` }
      }
      if (kind === "PERFORMANCE") {
        return { allowed: false, reason: `"${specialist.name}" é um especialista de performance — é chamado direto pelo Workflow, não por um Orquestrador de atendimento.` }
      }
      if (kind === "CROSS_CUTTING") return { allowed: true }
      if (domainAllowed(routing.domains, domain)) return { allowed: true }
      const scope = routing.domains.length === 1 ? `este Orquestrador é do domínio ${describeBusinessDomain(routing.domains[0]!)}` : `os domínios autorizados são ${describeBusinessDomains(routing.domains)}`
      return { allowed: false, reason: `"${specialist.name}" pertence ao domínio ${domain ? describeBusinessDomain(domain) : "?"}, que não está autorizado neste Orquestrador — ${scope}.` }
    }
  }
}
