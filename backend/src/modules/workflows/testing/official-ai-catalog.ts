import { readFileSync } from "node:fs"
import type { OrchestratorPolicyKind } from "../../assistant/domain/orchestrator-policy.js"

/**
 * Catálogo oficial de IA (Especialistas + Orquestradores) EXATAMENTE como está persistido em
 * `agents`/`assistant_orchestrators`/`assistant_orchestrator_specialists` — exportação literal do
 * banco de referência (ver docs/dev/workflows-modelo.md pra reexportar), fixture dos testes que
 * cobram (1) as referências dos Workflows-modelo e (2) a FRONTEIRA DE DOMÍNIO dos Orquestradores.
 *
 * A fronteira de domínio (rodada de hardening 2026-09-16) é persistida no banco e aplicada pelo
 * backend — ver `assistant/domain/orchestrator-policy.ts`; aqui fica só o que o catálogo OFICIAL
 * espera de cada um.
 *
 * - Orquestrador de DOMÍNIO coordena só o especialista do próprio domínio de processo + os
 *   especialistas TRANSVERSAIS (Experiência do Cliente, Qualidade, Eficiência — falam de COMO o
 *   atendimento foi feito, em qualquer domínio). Nunca outro domínio de processo: "Orquestrador ·
 *   Faturamento" com Retenção dentro vira "orquestrador de tudo" disfarçado.
 * - Orquestrador MULTIDOMÍNIO é o único que cruza domínios de processo, e só os explicitamente
 *   autorizados na lista abaixo (o coordenador escolhe, por interação, quais acionar).
 * - Orquestrador GERENCIAL (pós-Join) não tem especialista nenhum: sintetiza resultados prontos.
 */
export type OfficialAgent = {
  id: string
  name: string
  agentType: string
  active: boolean
  scopeType: string
  /** Legado (053) — dual-write mantém igual à forma nova. */
  specialty: string | null
  /** Forma alvo (057). */
  specialtyKind: string | null
  domain: string | null
  capability: string | null
  consolidatedInput: boolean
}
export type OfficialOrchestrator = {
  id: string
  name: string
  invocationMode: string
  active: boolean
  scopeType: string
  coordinatorAgentId: string
  /** Legado (053/054) — mantido durante a transição. */
  policyKind: string | null
  policyDomains: string[]
  /** Forma alvo (057): DOMAINS + domínios ou OPEN; null = legado ainda não traduzido (TRANSVERSAL/MANAGERIAL). */
  routingPolicy: string | null
  routingDomains: string[]
  specialistAgentIds: string[]
}
export type OfficialAiCatalog = { orchestrators: OfficialOrchestrator[]; agents: OfficialAgent[] }

export function loadOfficialAiCatalog(): OfficialAiCatalog {
  const raw = readFileSync(new URL("./official-ai-catalog.json", import.meta.url), "utf8")
  return JSON.parse(raw) as OfficialAiCatalog
}

/**
 * A fronteira NÃO é declarada aqui por nome: vive no banco (`agents.specialty`,
 * `assistant_orchestrators.policy_kind/policy_domains`, migration 053) e a regra é a de produção
 * (`assistant/domain/orchestrator-policy.ts`, a mesma que o backend aplica ao vincular um
 * especialista). O que este módulo acrescenta é o CONTRATO DO CATÁLOGO OFICIAL: quais
 * classificações cada orquestrador/especialista oficial precisa ter — se alguém "desclassificar"
 * um deles pela UI, o teste do catálogo acusa.
 */
/** Política legada esperada por orquestrador oficial — domínios por CÓDIGO do catálogo (fixture). */
export const EXPECTED_ORCHESTRATOR_POLICIES: Record<string, { kind: OrchestratorPolicyKind; domains: string[] }> = {
  "Orquestrador · Faturamento": { kind: "DOMAIN", domains: ["FATURAMENTO"] },
  "Orquestrador · Retenção e Cancelamento": { kind: "DOMAIN", domains: ["RETENCAO"] },
  "Orquestrador · Suporte Técnico": { kind: "DOMAIN", domains: ["SUPORTE"] },
  "Orquestrador · Cadastro e Titularidade": { kind: "DOMAIN", domains: ["CADASTRO"] },
  "Orquestrador · Qualidade e Experiência": { kind: "TRANSVERSAL", domains: [] },
  "Orquestrador · Atendimento multidomínio": { kind: "MULTIDOMAIN", domains: ["FATURAMENTO", "RETENCAO", "SUPORTE", "CADASTRO"] },
  "Orquestrador · Gerencial (consolidado)": { kind: "MANAGERIAL", domains: [] },
}

/** Coluna legada `specialty` esperada por especialista oficial (código do domínio ou tipo sem domínio). */
export const EXPECTED_SPECIALTIES: Record<string, string> = {
  "Especialista de Faturamento": "FATURAMENTO",
  "Especialista de Retenção e Cancelamento": "RETENCAO",
  "Especialista de Suporte Técnico": "SUPORTE",
  "Especialista de Cadastro e Titularidade": "CADASTRO",
  "Especialista de Experiência do Cliente": "CROSS_CUTTING",
  "Especialista de Qualidade de Atendimento": "CROSS_CUTTING",
  "Especialista de Eficiência Operacional": "CROSS_CUTTING",
  "Especialista de Performance Individual": "PERFORMANCE",
  "Especialista de PRV": "PERFORMANCE",
  "Especialista de Reconhecimento": "PERFORMANCE",
  "Especialista de Disponibilidade Operacional": "PERFORMANCE",
  "Especialista de Síntese Gerencial": "SYNTHESIS",
}

/** Forma alvo esperada por especialista oficial (057): tipo + domínio + aceita consolidado. */
export const EXPECTED_SPECIALTY_KINDS: Record<string, { kind: string; domain: string | null; consolidated: boolean }> = {
  "Especialista de Faturamento": { kind: "DOMAIN", domain: "FATURAMENTO", consolidated: false },
  "Especialista de Retenção e Cancelamento": { kind: "DOMAIN", domain: "RETENCAO", consolidated: false },
  "Especialista de Suporte Técnico": { kind: "DOMAIN", domain: "SUPORTE", consolidated: false },
  "Especialista de Cadastro e Titularidade": { kind: "DOMAIN", domain: "CADASTRO", consolidated: false },
  "Especialista de Experiência do Cliente": { kind: "CROSS_CUTTING", domain: null, consolidated: false },
  "Especialista de Qualidade de Atendimento": { kind: "CROSS_CUTTING", domain: null, consolidated: false },
  "Especialista de Eficiência Operacional": { kind: "CROSS_CUTTING", domain: null, consolidated: false },
  "Especialista de Performance Individual": { kind: "PERFORMANCE", domain: null, consolidated: false },
  "Especialista de PRV": { kind: "PERFORMANCE", domain: null, consolidated: false },
  "Especialista de Reconhecimento": { kind: "PERFORMANCE", domain: null, consolidated: false },
  "Especialista de Disponibilidade Operacional": { kind: "PERFORMANCE", domain: null, consolidated: false },
  "Especialista de Síntese Gerencial": { kind: "SYNTHESIS", domain: null, consolidated: true },
}

/** Política de roteamento esperada (forma alvo) — null = ainda legado (TRANSVERSAL/MANAGERIAL). */
export const EXPECTED_ROUTING: Record<string, { kind: "DOMAINS"; domains: string[] } | { kind: "OPEN" } | null> = {
  "Orquestrador · Faturamento": { kind: "DOMAINS", domains: ["FATURAMENTO"] },
  "Orquestrador · Retenção e Cancelamento": { kind: "DOMAINS", domains: ["RETENCAO"] },
  "Orquestrador · Suporte Técnico": { kind: "DOMAINS", domains: ["SUPORTE"] },
  "Orquestrador · Cadastro e Titularidade": { kind: "DOMAINS", domains: ["CADASTRO"] },
  "Orquestrador · Qualidade e Experiência": null,
  "Orquestrador · Atendimento multidomínio": { kind: "DOMAINS", domains: ["FATURAMENTO", "RETENCAO", "SUPORTE", "CADASTRO"] },
  "Orquestrador · Gerencial (consolidado)": null,
}

/** Transversais que cada orquestrador oficial autoriza EXPLICITAMENTE (a lista de especialistas é
 * a autorização; isto é o que o catálogo espera encontrar nela). */
export const EXPECTED_CROSS_CUTTING: Record<string, string[]> = {
  "Orquestrador · Faturamento": ["Especialista de Experiência do Cliente"],
  "Orquestrador · Retenção e Cancelamento": ["Especialista de Experiência do Cliente"],
  "Orquestrador · Suporte Técnico": ["Especialista de Experiência do Cliente"],
  "Orquestrador · Cadastro e Titularidade": ["Especialista de Experiência do Cliente"],
  "Orquestrador · Qualidade e Experiência": ["Especialista de Eficiência Operacional", "Especialista de Experiência do Cliente", "Especialista de Qualidade de Atendimento"],
  "Orquestrador · Atendimento multidomínio": ["Especialista de Experiência do Cliente"],
  "Orquestrador · Gerencial (consolidado)": [],
}
