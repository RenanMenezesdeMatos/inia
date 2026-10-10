import { describe, expect, it } from "vitest"
import { checkSpecialistAgainstPolicy, checkSpecialistAgainstRouting, describePolicyProblem, describeRoutingProblem, legacyPolicyFor, parseOrchestratorPolicy, POLICY_REQUIRED_MESSAGE, resolveRoutingPolicy } from "./orchestrator-policy.js"

// Domínios são DADOS do catálogo — os fixtures abaixo incluem um domínio "novo" (LOGISTICA) que
// nunca existiu em enum algum: a regra precisa valer para ele exatamente como para os demais.
const FATURAMENTO = { id: "11111111-1111-4111-8111-111111111111", code: "FATURAMENTO", name: "Faturamento", active: true }
const RETENCAO = { id: "22222222-2222-4222-8222-222222222222", code: "RETENCAO", name: "Retenção e Cancelamento", active: true }
const SUPORTE = { id: "33333333-3333-4333-8333-333333333333", code: "SUPORTE", name: "Suporte Técnico", active: true }
const LOGISTICA = { id: "44444444-4444-4444-8444-444444444444", code: "LOGISTICA", name: "Logística", active: true }

const domainAgent = (name: string, domain: typeof FATURAMENTO) => ({ name, specialty: { kind: "DOMAIN" as const, domain } })
const faturamento = domainAgent("Especialista de Faturamento", FATURAMENTO)
const retencao = domainAgent("Especialista de Retenção e Cancelamento", RETENCAO)
const suporte = domainAgent("Especialista de Suporte Técnico", SUPORTE)
const entregas = domainAgent("Agent · Entregas", LOGISTICA)
const experiencia = { name: "Especialista de Experiência do Cliente", specialty: { kind: "CROSS_CUTTING" as const, domain: null } }
const performance = { name: "Especialista de Performance Individual", specialty: { kind: "PERFORMANCE" as const, domain: null } }
const sintese = { name: "Especialista de Síntese Gerencial", specialty: { kind: "SYNTHESIS" as const, domain: null } }
const semEspecialidade = { name: "Agente de Processos", specialty: { kind: null, domain: null } }

describe("orchestrator-policy (legado 053) — o que um Orquestrador pode coordenar", () => {
  it("DOMAIN: só o especialista do domínio + transversais explicitamente adicionados; outro domínio, performance e sem especialidade são recusados com motivo", () => {
    const policy = parseOrchestratorPolicy({ policy_kind: "DOMAIN", policy_domains: ["FATURAMENTO"], business_domains: [FATURAMENTO] })
    expect(checkSpecialistAgainstPolicy(policy, faturamento)).toEqual({ allowed: true })
    expect(checkSpecialistAgainstPolicy(policy, experiencia)).toEqual({ allowed: true })
    const other = checkSpecialistAgainstPolicy(policy, retencao)
    expect(other).toMatchObject({ allowed: false })
    if (!other.allowed) expect(other.reason).toBe('"Especialista de Retenção e Cancelamento" pertence a outro domínio (Retenção e Cancelamento) — este Orquestrador é do domínio Faturamento.')
    expect(checkSpecialistAgainstPolicy(policy, performance).allowed).toBe(false)
    expect(checkSpecialistAgainstPolicy(policy, semEspecialidade).allowed).toBe(false)
  })

  it("MULTIDOMAIN: os domínios explicitamente autorizados + transversais; um domínio fora da lista é recusado", () => {
    const policy = parseOrchestratorPolicy({ policy_kind: "MULTIDOMAIN", policy_domains: ["FATURAMENTO", "RETENCAO"], business_domains: [FATURAMENTO, RETENCAO] })
    expect(checkSpecialistAgainstPolicy(policy, faturamento).allowed).toBe(true)
    expect(checkSpecialistAgainstPolicy(policy, retencao).allowed).toBe(true)
    expect(checkSpecialistAgainstPolicy(policy, experiencia).allowed).toBe(true)
    const verdict = checkSpecialistAgainstPolicy(policy, suporte)
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) expect(verdict.reason).toContain("os domínios autorizados são Faturamento, Retenção e Cancelamento")
  })

  it("dual-read dos domínios legados: só códigos (`policy_domains`) viram referências sem id com nome = código; a relação nova prevalece quando existe", () => {
    expect(parseOrchestratorPolicy({ policy_kind: "DOMAIN", policy_domains: ["FATURAMENTO"] }).domains).toEqual([{ id: null, code: "FATURAMENTO", name: "FATURAMENTO", active: true }])
    expect(parseOrchestratorPolicy({ policy_kind: "MULTIDOMAIN", policy_domains: ["FATURAMENTO", "RETENCAO"], business_domains: [RETENCAO] }).domains.map((domain) => domain.code)).toEqual(["RETENCAO", "FATURAMENTO"])
  })

  it("INTERACTIVE (assistente do chat/voz): a lista explícita é a autorização — qualquer especialidade, inclusive performance e sem especialidade", () => {
    const interactive = parseOrchestratorPolicy({ policy_kind: "INTERACTIVE", policy_domains: [] })
    for (const candidate of [faturamento, retencao, experiencia, performance, semEspecialidade]) expect(checkSpecialistAgainstPolicy(interactive, candidate)).toEqual({ allowed: true })
    expect(describePolicyProblem(interactive, { active: true, invocationMode: "INTERACTIVE" })).toBeNull()
    expect(describePolicyProblem(interactive, { active: true, invocationMode: "BOTH" })).toContain("Somente chat/voz")
    expect(describePolicyProblem(parseOrchestratorPolicy({ policy_kind: "INTERACTIVE", policy_domains: ["FATURAMENTO"] }))).toContain("não declara domínio")
  })

  it("ativo ⇒ política obrigatória (migration 054); inativo sem política é o único estado legítimo do legado", () => {
    const legacy = parseOrchestratorPolicy({ policy_kind: null, policy_domains: [] })
    expect(describePolicyProblem(legacy, { active: true, invocationMode: "BOTH" })).toBe(POLICY_REQUIRED_MESSAGE)
    expect(describePolicyProblem(legacy, { active: false, invocationMode: "BOTH" })).toBeNull()
    expect(describePolicyProblem(parseOrchestratorPolicy({ policy_kind: "DOMAIN", policy_domains: ["SUPORTE"] }), { active: true, invocationMode: "WORKFLOW" })).toBeNull()
  })

  it("TRANSVERSAL: só transversais; MANAGERIAL: ninguém; sem classificação (legado inativo): sem restrição", () => {
    const transversal = parseOrchestratorPolicy({ policy_kind: "TRANSVERSAL", policy_domains: [] })
    expect(checkSpecialistAgainstPolicy(transversal, experiencia).allowed).toBe(true)
    expect(checkSpecialistAgainstPolicy(transversal, faturamento).allowed).toBe(false)
    const managerial = parseOrchestratorPolicy({ policy_kind: "MANAGERIAL", policy_domains: [] })
    expect(checkSpecialistAgainstPolicy(managerial, experiencia).allowed).toBe(false)
    const legacy = parseOrchestratorPolicy({ policy_kind: null, policy_domains: [] })
    expect(checkSpecialistAgainstPolicy(legacy, retencao).allowed).toBe(true)
    expect(checkSpecialistAgainstPolicy(legacy, semEspecialidade).allowed).toBe(true)
  })

  it("coerência da política: DOMAIN exige exatamente um domínio; MULTIDOMAIN pelo menos um; transversal/gerencial nenhum; valor desconhecido vira 'sem classificação'", () => {
    expect(describePolicyProblem(parseOrchestratorPolicy({ policy_kind: "DOMAIN", policy_domains: [] }))).toContain("exatamente um domínio")
    expect(describePolicyProblem(parseOrchestratorPolicy({ policy_kind: "DOMAIN", policy_domains: ["FATURAMENTO", "RETENCAO"] }))).toContain("exatamente um domínio")
    expect(describePolicyProblem(parseOrchestratorPolicy({ policy_kind: "MULTIDOMAIN", policy_domains: [] }))).toContain("pelo menos um")
    expect(describePolicyProblem(parseOrchestratorPolicy({ policy_kind: "MANAGERIAL", policy_domains: ["FATURAMENTO"] }))).toContain("não declara domínio")
    expect(describePolicyProblem(parseOrchestratorPolicy({ policy_kind: "TRANSVERSAL", policy_domains: [] }))).toBeNull()
    expect(parseOrchestratorPolicy({ policy_kind: "QUALQUER", policy_domains: ["não-é-código"] })).toEqual({ kind: null, domains: [] })
  })
})

describe("orchestrator-policy (forma alvo 057/060) — roteamento por domínios do catálogo", () => {
  it("DOMAINS: Agent DOMAIN entra se o CÓDIGO do seu domínio está na fronteira — vale para um domínio criado pelo catálogo (LOGISTICA), sem código novo", () => {
    const routing = resolveRoutingPolicy({ routing_policy: "DOMAINS", routing_domains: ["LOGISTICA"], business_domains: [LOGISTICA] })
    expect(routing).toEqual({ kind: "DOMAINS", domains: [LOGISTICA] })
    expect(checkSpecialistAgainstRouting(routing, entregas)).toEqual({ allowed: true })
    expect(checkSpecialistAgainstRouting(routing, experiencia)).toEqual({ allowed: true })
    const blocked = checkSpecialistAgainstRouting(routing, faturamento)
    expect(blocked.allowed).toBe(false)
    if (!blocked.allowed) expect(blocked.reason).toBe('"Especialista de Faturamento" pertence ao domínio Faturamento, que não está autorizado neste Orquestrador — este Orquestrador é do domínio Logística.')
    // Depois de adicionar FATURAMENTO ao mesmo Orquestrador, o especialista passa a ser permitido.
    const widened = resolveRoutingPolicy({ routing_policy: "DOMAINS", routing_domains: ["LOGISTICA", "FATURAMENTO"], business_domains: [LOGISTICA, FATURAMENTO] })
    expect(checkSpecialistAgainstRouting(widened, faturamento)).toEqual({ allowed: true })
    const stillBlocked = checkSpecialistAgainstRouting(widened, retencao)
    if (!stillBlocked.allowed) expect(stillBlocked.reason).toContain("os domínios autorizados são Logística, Faturamento")
  })

  it("DOMAINS: performance, síntese e sem especialidade nunca entram; OPEN aceita tudo menos síntese", () => {
    const routing = resolveRoutingPolicy({ routing_policy: "DOMAINS", routing_domains: ["FATURAMENTO"], business_domains: [FATURAMENTO] })
    expect(checkSpecialistAgainstRouting(routing, performance).allowed).toBe(false)
    expect(checkSpecialistAgainstRouting(routing, sintese).allowed).toBe(false)
    expect(checkSpecialistAgainstRouting(routing, semEspecialidade).allowed).toBe(false)
    const open = resolveRoutingPolicy({ routing_policy: "OPEN" })
    for (const candidate of [faturamento, entregas, experiencia, performance, semEspecialidade]) expect(checkSpecialistAgainstRouting(open, candidate)).toEqual({ allowed: true })
    expect(checkSpecialistAgainstRouting(open, sintese).allowed).toBe(false)
  })

  it("dual-read: sem `routing_policy`, o legado DOMAIN/MULTIDOMAIN vira DOMAINS e INTERACTIVE vira OPEN; TRANSVERSAL/MANAGERIAL ficam LEGACY; a relação nova dá id e nome aos códigos legados", () => {
    expect(resolveRoutingPolicy({ policy_kind: "DOMAIN", policy_domains: ["FATURAMENTO"] })).toEqual({ kind: "DOMAINS", domains: [{ id: null, code: "FATURAMENTO", name: "FATURAMENTO", active: true }] })
    expect(resolveRoutingPolicy({ policy_kind: "MULTIDOMAIN", policy_domains: ["FATURAMENTO", "RETENCAO"], business_domains: [FATURAMENTO, RETENCAO] })).toEqual({ kind: "DOMAINS", domains: [FATURAMENTO, RETENCAO] })
    expect(resolveRoutingPolicy({ policy_kind: "INTERACTIVE" })).toEqual({ kind: "OPEN" })
    expect(resolveRoutingPolicy({ policy_kind: "MANAGERIAL" })).toMatchObject({ kind: "LEGACY" })
    expect(resolveRoutingPolicy({ routing_policy: "DOMAINS", routing_domains: ["SUPORTE"], business_domains: [SUPORTE] })).toEqual({ kind: "DOMAINS", domains: [SUPORTE] })
    // Domínio desativado continua na fronteira do registro existente — desativar nunca quebra o runtime.
    const inactive = { ...LOGISTICA, active: false }
    expect(checkSpecialistAgainstRouting(resolveRoutingPolicy({ routing_policy: "DOMAINS", routing_domains: ["LOGISTICA"], business_domains: [inactive] }), entregas)).toEqual({ allowed: true })
  })

  it("dual-write: DOMAINS com 1 domínio → DOMAIN, com vários → MULTIDOMAIN; OPEN → INTERACTIVE só no chat; DOMAINS sem domínio é incoerente", () => {
    expect(legacyPolicyFor({ kind: "DOMAINS", domains: [LOGISTICA] }, "WORKFLOW")).toEqual({ kind: "DOMAIN", domains: [LOGISTICA] })
    expect(legacyPolicyFor({ kind: "DOMAINS", domains: [LOGISTICA, FATURAMENTO] }, "WORKFLOW")).toEqual({ kind: "MULTIDOMAIN", domains: [LOGISTICA, FATURAMENTO] })
    expect(legacyPolicyFor({ kind: "OPEN" }, "INTERACTIVE")).toEqual({ kind: "INTERACTIVE", domains: [] })
    expect(legacyPolicyFor({ kind: "OPEN" }, "BOTH")).toEqual({ kind: "OPEN", domains: [] })
    expect(describeRoutingProblem({ kind: "DOMAINS", domains: [] })).toContain("pelo menos um domínio")
    expect(describeRoutingProblem({ kind: "OPEN" }, { active: true, invocationMode: "BOTH" })).toBeNull()
    expect(describeRoutingProblem({ kind: null }, { active: true, invocationMode: "BOTH" })).toBe(POLICY_REQUIRED_MESSAGE)
  })
})
