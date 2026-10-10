import { z } from "zod"
import { BUSINESS_DOMAIN_CODE_PATTERN, describeBusinessDomain, resolveDomainRef, type BusinessDomainRef } from "../../business-domains/domain/business-domain.js"

/**
 * Taxonomia de ESPECIALIDADE do Agent (migration 057) — responde "QUE TIPO de especialista este
 * Agent é":
 *
 * - DOMAIN: um assunto de negócio — QUAL assunto é o Domínio de negócio (catálogo administrável,
 *   migration 060: `agents.business_domain_id`). Entende O QUE deveria acontecer.
 * - CROSS_CUTTING: uma dimensão que atravessa domínios (Qualidade, Experiência, Eficiência). Aplica
 *   a mesma competência em qualquer assunto — NÃO "sabe de tudo".
 * - PERFORMANCE: números oficiais de um colaborador (Performance, PRV, Reconhecimento,
 *   Disponibilidade). Chamado direto pelo Workflow.
 * - SYNTHESIS: recebe resultados JÁ produzidos (pós "Consolidar resultados") e sintetiza. Não
 *   roteia entre especialistas — quem coordena é o Orquestrador; quem sintetiza é o Agent.
 *
 * Este arquivo conhece só os TIPOS. Domínios concretos (Faturamento, Logística…) são DADOS do
 * catálogo — nunca enum aqui.
 *
 * Dual-read: a forma persistida nova (`specialty_kind` + `business_domain_id` [+ join do catálogo]
 * + `capability` + `consolidated_input`) tem precedência; sem ela, `domain` (código legado) e, por
 * último, a coluna legada `specialty` (código do domínio/CROSS_CUTTING/PERFORMANCE/SYNTHESIS) são
 * interpretados. Dual-write: `legacySpecialtyFor` devolve o valor legado equivalente para continuar
 * preenchendo `specialty` (e o router preenche `domain` com o código) — removível quando nenhum
 * leitor (runtime, catálogo, frontend) depender mais dessas colunas.
 */
export const specialtyKindSchema = z.enum(["DOMAIN", "CROSS_CUTTING", "PERFORMANCE", "SYNTHESIS"])
export type SpecialtyKind = z.infer<typeof specialtyKindSchema>

/** Coluna legada `agents.specialty` (053) — código de domínio OU um dos três tipos sem domínio.
 * Mantida e escrita durante a transição; o formato é o mesmo do código do catálogo. */
export const legacySpecialtySchema = z.string().regex(BUSINESS_DOMAIN_CODE_PATTERN)
export type LegacySpecialty = z.infer<typeof legacySpecialtySchema>

export type AgentSpecialty = {
  kind: SpecialtyKind | null
  /** Só quando kind = DOMAIN: referência ao domínio de negócio (id do catálogo quando resolvido; código sempre). */
  domain: BusinessDomainRef | null
  /** Rótulo livre da competência (ex.: "Qualidade") — só informativo, kind = CROSS_CUTTING. */
  capability: string | null
  /** Aceita o resultado consolidado de N colaboradores (pós-JOIN). SYNTHESIS sempre aceita. */
  acceptsConsolidated: boolean
}

export type AgentSpecialtyRow = {
  specialty?: string | null | undefined
  specialty_kind?: string | null | undefined
  domain?: string | null | undefined
  business_domain_id?: string | null | undefined
  business_domain_code?: string | null | undefined
  business_domain_name?: string | null | undefined
  business_domain_active?: boolean | null | undefined
  capability?: string | null | undefined
  consolidated_input?: boolean | null | undefined
}

/** Forma persistida (nova OU legada) → especialidade tipada. Novo primeiro; fallback legado. */
export function resolveAgentSpecialty(row: AgentSpecialtyRow): AgentSpecialty {
  const kind = specialtyKindSchema.safeParse(row.specialty_kind)
  if (kind.success) {
    return {
      kind: kind.data,
      domain: kind.data === "DOMAIN" ? resolveDomainRef(row) : null,
      capability: kind.data === "CROSS_CUTTING" && row.capability ? row.capability : null,
      acceptsConsolidated: kind.data === "SYNTHESIS" || Boolean(row.consolidated_input),
    }
  }
  const legacy = legacySpecialtySchema.safeParse(row.specialty)
  if (!legacy.success) return { kind: null, domain: null, capability: null, acceptsConsolidated: Boolean(row.consolidated_input) }
  if (legacy.data === "SYNTHESIS") return { kind: "SYNTHESIS", domain: null, capability: null, acceptsConsolidated: true }
  if (legacy.data === "CROSS_CUTTING" || legacy.data === "PERFORMANCE") return { kind: legacy.data, domain: null, capability: null, acceptsConsolidated: Boolean(row.consolidated_input) }
  // Qualquer outro código legado é um domínio de negócio (o catálogo dá o nome quando houver join).
  return { kind: "DOMAIN", domain: resolveDomainRef({ ...row, domain: row.domain ?? legacy.data }), capability: null, acceptsConsolidated: Boolean(row.consolidated_input) }
}

/** Valor legado de `specialty` equivalente (dual-write). DOMAIN sem domínio não existe: retorna null. */
export function legacySpecialtyFor(specialty: Pick<AgentSpecialty, "kind" | "domain">): LegacySpecialty | null {
  switch (specialty.kind) {
    case null:
      return null
    case "DOMAIN":
      return specialty.domain?.code ?? null
    case "CROSS_CUTTING":
    case "PERFORMANCE":
    case "SYNTHESIS":
      return specialty.kind
  }
}

/** Coerência da especialidade declarada (mesma regra da constraint 057, com mensagem de negócio). */
export function describeSpecialtyProblem(specialty: AgentSpecialty): string | null {
  if (specialty.kind === "DOMAIN" && !specialty.domain) return "Um especialista de domínio precisa declarar o domínio de negócio."
  if (specialty.kind !== "DOMAIN" && specialty.domain) return "Só um especialista de domínio declara domínio de negócio."
  if (specialty.kind === "SYNTHESIS" && !specialty.acceptsConsolidated) return "Um Agent de síntese recebe o resultado consolidado — precisa aceitar esse contexto."
  return null
}

export const SPECIALTY_KIND_LABELS: Record<SpecialtyKind, string> = {
  DOMAIN: "Especialista de domínio",
  CROSS_CUTTING: "Especialista transversal",
  PERFORMANCE: "Performance (indicadores, PRV, reconhecimento)",
  SYNTHESIS: "Síntese (resultados consolidados)",
}

/** Texto curto da especialidade para listas/motivos ("Faturamento", "Transversal · Qualidade"…). */
export function describeSpecialty(specialty: AgentSpecialty): string {
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
