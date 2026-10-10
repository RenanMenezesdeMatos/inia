import { readFileSync } from "node:fs"
import type { EscalationRole } from "../domain/escalation-role-schema.js"
import type { OfficialModelWorkflow } from "./official-model-workflows.js"

/**
 * TEMPLATE × INSTÂNCIA (rodada de hardening 2026-09-16, Parte B).
 *
 * - TEMPLATE oficial = o modelo conceitual reutilizável: descreve o REQUISITO organizacional que
 *   qualquer implantação precisa satisfazer ("Todos os grupos", "um Grupo do domínio Retenção",
 *   "uma pessoa-âncora com o cargo Diretor"). Nunca carrega UUID, nome de Grupo ou pessoa de um
 *   ambiente específico — este JSON é a definição conceitual e o teste anti-acoplamento cobra isso.
 * - INSTÂNCIA = o Workflow real de UMA organização, com ids concretos (na massa demo, os 22
 *   rascunhos de official-model-workflows.json, resolvidos para a estrutura `de00…`). A instância
 *   precisa SATISFAZER o requisito do seu template — o teste de catálogo confere contra a
 *   estrutura demo regenerada em memória.
 *
 * Não existe (ainda) UX de "criar Workflow a partir de modelo": ao instalar num cliente, o
 * binding é feito à mão no editor (Abrangência/Estrutura Consolidada) seguindo o requisito
 * descrito na Wiki. Quando essa UX existir, é este requisito que ela deve pedir ao usuário.
 */
export type StructureRequirement =
  /** Roda em qualquer operação: Todos os grupos, avaliação individual — nada a escolher. */
  | { kind: "GENERIC" }
  /** Consolidado numa estrutura ancorada em pessoa: ao instalar, escolha a pessoa com este cargo. */
  | { kind: "PERSON_ANCHOR"; role: Extract<EscalationRole, "SUPERVISOR" | "MANAGER" | "DIRECTOR"> }
  /** Consolidado num Grupo de um domínio de negócio (Abrangência + Estrutura = o mesmo Grupo). O
   * domínio é um CÓDIGO do catálogo administrável (`business_domains`) + o nome de apresentação
   * que o template documenta — nunca um enum do código-fonte. */
  | { kind: "GROUP"; domain: string; domainName?: string }
  /** Individual, com Abrangência num Grupo de um domínio de negócio (o especialista/KB é do domínio). */
  | { kind: "GROUP_SCOPE"; domain: string; domainName?: string }

export type OfficialModelTemplate = { key: string; name: string; structureRequirement: StructureRequirement }

export function loadOfficialModelTemplates(): OfficialModelTemplate[] {
  const raw = readFileSync(new URL("./official-model-templates.json", import.meta.url), "utf8")
  return JSON.parse(raw) as OfficialModelTemplate[]
}

const ROLE_LABELS: Record<"SUPERVISOR" | "MANAGER" | "DIRECTOR", string> = { SUPERVISOR: "Supervisor", MANAGER: "Gerente", DIRECTOR: "Diretor" }

/** Texto de negócio do requisito — o que a Wiki mostra e o que um instalador deve pedir. Nunca um id. */
export function describeStructureRequirement(requirement: StructureRequirement): string {
  switch (requirement.kind) {
    case "GENERIC":
      return "Genérico — Todos os grupos, avaliação individual. Funciona em qualquer operação sem configuração adicional."
    case "PERSON_ANCHOR":
      return `Consolidado na estrutura de um(a) ${ROLE_LABELS[requirement.role]}. Ao instalar, escolha a pessoa com esse cargo na sua organização (Estrutura Consolidada); o Output de gestão é resolvido a partir dela.`
    case "GROUP":
      return `Requer um Grupo do domínio ${requirement.domainName ?? requirement.domain} com um único Gerente responsável pela hierarquia. Ao instalar, escolha o Grupo correspondente da sua organização (Abrangência e Estrutura Consolidada = o mesmo Grupo).`
    case "GROUP_SCOPE":
      return `Requer um Grupo do domínio ${requirement.domainName ?? requirement.domain}. Ao instalar, aponte a Abrangência para o Grupo correspondente da sua organização — o especialista e a base de conhecimento são desse domínio.`
  }
}

/** Como uma instância resolve o binding do template — `groupDomainOf` diz o domínio real de um
 * Grupo no ambiente (na demo, `GroupSpec.domain`; num cliente, o que o instalador escolheu). */
export function instanceSatisfiesRequirement(
  instance: OfficialModelWorkflow,
  requirement: StructureRequirement,
  groupDomainOf: (teamId: string) => string | null,
): { ok: true } | { ok: false; reason: string } {
  const structure = instance.consolidatedStructure
  switch (requirement.kind) {
    case "GENERIC":
      if (instance.scopeType !== "ALL_TEAMS") return { ok: false, reason: "modelo genérico precisa de Abrangência 'Todos os grupos'" }
      if (structure) return { ok: false, reason: "modelo genérico não tem Estrutura Consolidada" }
      return { ok: true }
    case "PERSON_ANCHOR": {
      const expectedKind = requirement.role === "DIRECTOR" ? "DIRECTOR_STRUCTURE" : requirement.role === "MANAGER" ? "MANAGER_STRUCTURE" : "SUPERVISOR_TEAM"
      if (structure?.kind !== expectedKind) return { ok: false, reason: `estrutura precisa ser ${expectedKind}` }
      return { ok: true }
    }
    case "GROUP": {
      if (instance.scopeType !== "TEAM" || !instance.teamId) return { ok: false, reason: "Abrangência precisa ser um Grupo" }
      if (structure?.kind !== "TEAM" || structure.teamId !== instance.teamId) return { ok: false, reason: "Estrutura Consolidada precisa ser o MESMO Grupo da Abrangência" }
      const domain = groupDomainOf(instance.teamId)
      if (domain !== requirement.domain) return { ok: false, reason: `Grupo é do domínio ${domain ?? "desconhecido"}, o modelo exige ${requirement.domain}` }
      return { ok: true }
    }
    case "GROUP_SCOPE": {
      if (instance.scopeType !== "TEAM" || !instance.teamId) return { ok: false, reason: "Abrangência precisa ser um Grupo" }
      if (structure) return { ok: false, reason: "modelo individual não tem Estrutura Consolidada" }
      const domain = groupDomainOf(instance.teamId)
      if (domain !== requirement.domain) return { ok: false, reason: `Grupo é do domínio ${domain ?? "desconhecido"}, o modelo exige ${requirement.domain}` }
      return { ok: true }
    }
  }
}
