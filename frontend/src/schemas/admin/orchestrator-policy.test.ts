import { describe, expect, it } from "vitest"

import { checkSpecialistAgainstPolicy, checkSpecialistAgainstRouting, describePolicyProblem, POLICY_REQUIRED_MESSAGE, resolveAgentSpecialty, resolveRoutingPolicy, routingDomainPayload } from "./orchestrator-policy"

// Domínios são DADOS do catálogo — incluindo um que nunca existiu em enum (LOGISTICA).
const FATURAMENTO = { id: "d1", code: "FATURAMENTO", name: "Faturamento", active: true }
const RETENCAO = { id: "d2", code: "RETENCAO", name: "Retenção e Cancelamento", active: true }
const LOGISTICA = { id: "d5", code: "LOGISTICA", name: "Logística", active: true }

describe("orchestrator-policy (espelho de UI) — mesmo veredito do backend", () => {
  const faturamento = { name: "Especialista de Faturamento", specialty: { kind: "DOMAIN" as const, domain: FATURAMENTO } }
  const retencao = { name: "Especialista de Retenção e Cancelamento", specialty: { kind: "DOMAIN" as const, domain: RETENCAO } }
  const entregas = { name: "Agent · Entregas", specialty: { kind: "DOMAIN" as const, domain: LOGISTICA } }
  const experiencia = { name: "Especialista de Experiência do Cliente", specialty: { kind: "CROSS_CUTTING" as const, domain: null } }
  const semEspecialidade = { name: "Agente de Processos", specialty: { kind: null, domain: null } }

  it("de domínio: só o domínio + transversais; outro domínio é desabilitado com o motivo mostrado na UI", () => {
    const policy = { kind: "DOMAIN" as const, domains: [FATURAMENTO] }
    expect(checkSpecialistAgainstPolicy(policy, faturamento)).toEqual({ allowed: true })
    expect(checkSpecialistAgainstPolicy(policy, experiencia)).toEqual({ allowed: true })
    expect(checkSpecialistAgainstPolicy(policy, retencao)).toEqual({ allowed: false, reason: "Este especialista pertence ao domínio Retenção e Cancelamento, que não está autorizado neste Orquestrador." })
    expect(checkSpecialistAgainstPolicy(policy, { name: "Especialista de PRV", specialty: { kind: "PERFORMANCE", domain: null } }).allowed).toBe(false)
    expect(checkSpecialistAgainstPolicy(policy, semEspecialidade).allowed).toBe(false)
  })

  it("multidomínio autoriza só os domínios marcados; gerencial nenhum; sem classificação tudo", () => {
    expect(checkSpecialistAgainstPolicy({ kind: "MULTIDOMAIN", domains: [FATURAMENTO, RETENCAO] }, retencao).allowed).toBe(true)
    expect(checkSpecialistAgainstPolicy({ kind: "MULTIDOMAIN", domains: [FATURAMENTO] }, retencao).allowed).toBe(false)
    expect(checkSpecialistAgainstPolicy({ kind: "MANAGERIAL", domains: [] }, experiencia).allowed).toBe(false)
    expect(checkSpecialistAgainstPolicy({ kind: null, domains: [] }, retencao).allowed).toBe(true)
  })

  it("assistente interativo aceita qualquer especialista listado, mas só existe em 'Só chat/voz'; ativo sem política é barrado antes do 422", () => {
    expect(checkSpecialistAgainstPolicy({ kind: "INTERACTIVE", domains: [] }, semEspecialidade).allowed).toBe(true)
    expect(describePolicyProblem({ kind: "INTERACTIVE", domains: [] }, { active: true, invocationMode: "INTERACTIVE" })).toBeNull()
    expect(describePolicyProblem({ kind: "INTERACTIVE", domains: [] }, { active: true, invocationMode: "BOTH" })).toContain("Só chat/voz")
    expect(describePolicyProblem({ kind: null, domains: [] }, { active: true, invocationMode: "BOTH" })).toBe(POLICY_REQUIRED_MESSAGE)
    expect(describePolicyProblem({ kind: null, domains: [] }, { active: false, invocationMode: "BOTH" })).toBeNull()
    expect(describePolicyProblem({ kind: "DOMAIN", domains: [] })).toContain("exatamente um domínio")
  })

  it("forma alvo: um domínio criado no catálogo (LOGISTICA) restringe DOMAINS sem código novo; a UI mostra o motivo com o NOME do domínio", () => {
    const routing = resolveRoutingPolicy({ routingPolicy: "DOMAINS", routingDomains: ["LOGISTICA"], businessDomains: [LOGISTICA] })
    expect(routing).toEqual({ kind: "DOMAINS", domains: [LOGISTICA] })
    expect(checkSpecialistAgainstRouting(routing, { name: entregas.name, specialty: { ...entregas.specialty, capability: null, acceptsConsolidated: false } })).toEqual({ allowed: true })
    expect(checkSpecialistAgainstRouting(routing, { name: faturamento.name, specialty: { ...faturamento.specialty, capability: null, acceptsConsolidated: false } })).toEqual({ allowed: false, reason: "Este especialista pertence ao domínio Faturamento, que não está autorizado neste Orquestrador." })
    // Dual-read: só códigos legados viram referências sem id (nome = código); o payload de gravação manda ids e, para legado sem id, códigos.
    expect(resolveRoutingPolicy({ policyKind: "DOMAIN", policyDomains: ["FATURAMENTO"] })).toEqual({ kind: "DOMAINS", domains: [{ id: null, code: "FATURAMENTO", name: "FATURAMENTO", active: true }] })
    expect(routingDomainPayload({ kind: "DOMAINS", domains: [LOGISTICA, { id: null, code: "COBRANCA", name: "COBRANCA", active: true }] })).toEqual({ routingDomainIds: ["d5"], routingDomains: ["COBRANCA"] })
    expect(routingDomainPayload({ kind: "OPEN" })).toEqual({ routingDomainIds: [] })
  })

  it("resolveAgentSpecialty: objeto do catálogo prevalece; código legado vira referência sem id; domínio desativado continua legível", () => {
    expect(resolveAgentSpecialty({ specialtyKind: "DOMAIN", domain: "LOGISTICA", businessDomainId: "d5", businessDomain: LOGISTICA }).domain).toEqual(LOGISTICA)
    expect(resolveAgentSpecialty({ specialty: "FATURAMENTO" }).domain).toEqual({ id: null, code: "FATURAMENTO", name: "FATURAMENTO", active: true })
    expect(resolveAgentSpecialty({ specialtyKind: "DOMAIN", businessDomain: { ...LOGISTICA, active: false } }).domain?.active).toBe(false)
    expect(resolveAgentSpecialty({ specialtyKind: "CROSS_CUTTING", capability: "Qualidade" })).toMatchObject({ kind: "CROSS_CUTTING", domain: null, capability: "Qualidade" })
  })
})
