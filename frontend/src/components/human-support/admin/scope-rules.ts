import type { ScopeNode, ScopeState } from "@/schemas/human-support/admin.schema"

/**
 * REGRA DO ESCOPO DO ANJO, NA LINGUAGEM DA TELA. Espelha `backend/src/modules/human-support/domain/enablement.ts` (o servidor é a
 * autoridade; aqui só se explica e se prevê o resultado antes de salvar):
 *
 *   Organização (chave geral, aba Configuração) → libera ou bloqueia tudo; ligada, NÃO habilita nenhum Grupo sozinha.
 *   Grupo     → "Habilitar" / "Desabilitar" próprios; sem configuração própria = desabilitado.
 *   Subgrupo  → "Habilitar" / "Desabilitar" próprios vencem o Grupo; "Herdar do escopo superior" segue o Grupo.
 *
 * Por isso "Herdar do escopo superior" só existe no Subgrupo: no Grupo, a mesma gravação (`INHERIT`) quer dizer "sem configuração
 * própria" e o resultado é sempre desabilitado.
 */
export type Source = ScopeNode["effectiveSource"]
export type Effective = { effective: boolean; source: Source }

/** O efetivo de um nó para um estado gravado (a mesma conta do servidor). */
export function effectiveFor(input: { type: ScopeNode["type"]; state: ScopeState; masterOn: boolean; groupState: ScopeState | null }): Effective {
  if (!input.masterOn) return { effective: false, source: "MASTER_OFF" }
  if (input.state !== "INHERIT") return { effective: input.state === "ON", source: "OWN" }
  if (input.type === "SUBGROUP" && input.groupState && input.groupState !== "INHERIT") return { effective: input.groupState === "ON", source: "GROUP" }
  return { effective: false, source: "DEFAULT_OFF" }
}

export const OPTION_LABELS = {
  INHERIT_SUBGROUP: "Herdar do escopo superior",
  INHERIT_GROUP: "Sem configuração própria",
  ON: "Habilitar neste escopo",
  OFF: "Desabilitar neste escopo",
} as const

export function optionLabel(type: ScopeNode["type"], state: ScopeState): string {
  if (state === "INHERIT") return type === "GROUP" ? OPTION_LABELS.INHERIT_GROUP : OPTION_LABELS.INHERIT_SUBGROUP
  return OPTION_LABELS[state]
}

const enabledWord = (on: boolean) => (on ? "habilitado" : "desabilitado")

/** Uma frase com o efeito de cada opção, no contexto do nó (nome do Grupo, quantos Subgrupos herdam). */
export function optionEffect(node: ScopeNode, parent: ScopeNode | null, state: ScopeState): string {
  if (node.type === "GROUP") {
    const inheriting = (node.children ?? []).filter((child) => child.state === "INHERIT").length
    const followers = inheriting === 0 ? "" : inheriting === 1 ? " e no Subgrupo que herda dele" : ` e nos ${inheriting} Subgrupos que herdam dele`
    if (state === "ON") return `Os operadores deste Grupo${followers} passam a ter o Anjo. Subgrupos com opção própria não mudam.`
    if (state === "OFF") return `Os operadores deste Grupo${followers} deixam de ter o Anjo. Subgrupos com opção própria não mudam.`
    return `A organização não habilita Grupos sozinha: sem opção própria, o Anjo fica desabilitado aqui${followers}.`
  }
  const group = parent?.name ?? "o Grupo"
  if (state === "ON") return `Habilita o Anjo para os operadores deste Subgrupo, mesmo que ${group} esteja desabilitado.`
  if (state === "OFF") return `Desabilita o Anjo para os operadores deste Subgrupo, mesmo que ${group} esteja habilitado.`
  return `Segue ${group}, que hoje está ${enabledWord(parent?.effective ?? false)}${parent?.state === "INHERIT" ? " (sem opção própria)" : ""}. Se ${group} mudar, este Subgrupo muda junto.`
}

/** Título do estado em vigor ("Anjo habilitado em X1"). */
export const headline = (node: Pick<ScopeNode, "name" | "effective">) => `Anjo ${enabledWord(node.effective)} em ${node.name}`

/** De onde veio o estado em vigor, com o nome do escopo que decidiu. */
export function originText(node: Pick<ScopeNode, "type" | "state" | "effective" | "effectiveSource">, parent: Pick<ScopeNode, "name" | "state"> | null): { short: string; sentence: string } {
  switch (node.effectiveSource) {
    case "MASTER_OFF":
      return {
        short: "Bloqueado pela organização",
        sentence: "A chave geral do Apoio com Anjo está desligada na organização. Enquanto ela estiver desligada, nenhum Grupo ou Subgrupo tem o Anjo, seja qual for a opção salva em cada um.",
      }
    case "OWN":
      return { short: "Definido neste escopo", sentence: `Definido aqui: a opção “${optionLabel(node.type, node.state)}” está salva neste ${node.type === "GROUP" ? "Grupo" : "Subgrupo"}.` }
    case "GROUP":
      return {
        short: `Herdado de ${parent?.name ?? "o Grupo"}`,
        sentence: `Herdado: este Subgrupo usa “${OPTION_LABELS.INHERIT_SUBGROUP}”, e ${parent?.name ?? "o Grupo"} está com “${optionLabel("GROUP", parent?.state ?? "INHERIT")}”. Por isso o Anjo está ${enabledWord(node.effective)} aqui pela configuração de ${parent?.name ?? "o Grupo"}.`,
      }
    case "DEFAULT_OFF":
      return node.type === "GROUP"
        ? { short: "Nenhuma opção habilita", sentence: "Este Grupo não tem opção própria, e a organização não habilita Grupos sozinha. Por isso o Anjo está desabilitado aqui." }
        : {
            short: "Nenhuma opção habilita",
            sentence: `Este Subgrupo herda do escopo superior, e ${parent?.name ?? "o Grupo"} também não tem opção própria. Nenhum nível habilita o Anjo, então ele está desabilitado aqui.`,
          }
  }
}

/** Resumo de uma linha do estado em vigor ("Anjo habilitado pela configuração de Grupo X"), usado na prévia e na confirmação. */
export function resultSummary(node: Pick<ScopeNode, "type" | "name" | "effective" | "effectiveSource">, parentName: string | null): string {
  if (node.effectiveSource === "MASTER_OFF") return "Anjo desabilitado: a chave geral da organização está desligada"
  if (node.effectiveSource === "GROUP") return `Anjo ${enabledWord(node.effective)} pela configuração de ${parentName ?? "o Grupo"}`
  if (node.effectiveSource === "DEFAULT_OFF") return "Anjo desabilitado: nenhum nível habilita"
  return `Anjo ${enabledWord(node.effective)} pela configuração deste ${node.type === "GROUP" ? "Grupo" : "Subgrupo"}`
}

export type ChildImpact = { id: string; name: string; before: boolean; after: boolean }
export type Projection = { after: Effective; children: ChildImpact[] }

/** O que muda se o nó passar para `state`: o próprio efetivo e, num Grupo, os Subgrupos que herdam dele. */
export function project(node: ScopeNode, parent: ScopeNode | null, state: ScopeState, masterOn: boolean): Projection {
  const after = effectiveFor({ type: node.type, state, masterOn, groupState: parent?.state ?? null })
  const children =
    node.type === "GROUP"
      ? (node.children ?? [])
          .filter((child) => child.state === "INHERIT")
          .map((child) => ({ id: child.id, name: child.name, before: child.effective, after: effectiveFor({ type: "SUBGROUP", state: "INHERIT", masterOn, groupState: state }).effective }))
      : []
  return { after, children }
}

/** O nó e o Grupo dele, pelo id (a árvore chega de novo a cada salvamento). */
export function findNode(tree: readonly ScopeNode[], id: string | null): { node: ScopeNode; parent: ScopeNode | null } | null {
  if (!id) return null
  for (const group of tree) {
    if (group.id === id) return { node: group, parent: null }
    const child = (group.children ?? []).find((entry) => entry.id === id)
    if (child) return { node: child, parent: group }
  }
  return null
}
