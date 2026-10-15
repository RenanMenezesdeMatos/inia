/**
 * QUEM CONTROLA cada campo da pessoa (`people`): a base do cliente, pela Central de Dados, ou a INIA.
 *
 * Regra do produto: o que vem da base vale sempre e NÃO é editado na INIA — a próxima carga sobrescreveria a edição em
 * silêncio. Um campo é "da base" para uma pessoa quando um feed ativo de Colaboradores (EMPLOYEES) ou de Estrutura
 * organizacional (ORGANIZATIONAL_STRUCTURE) escreve esse campo e já aplicou essa pessoa (linhagem). O que a base não manda
 * continua editável na INIA (ex.: e-mail ou capital operacional que o feed não mapeia). Acesso — papéis com escopo em
 * `access_role_assignments` — é sempre só da INIA e nunca entra aqui; a situação funcional tem regra própria de conflito
 * (`applyEmployeeStatusSnapshot`) e também fica de fora.
 */
export const PERSON_SOURCE_FIELDS = ["name", "role", "jobTitle", "teamId", "subteamId", "managerId", "hiredAt", "active", "email", "operationalCapitalCode"] as const
export type PersonSourceField = (typeof PERSON_SOURCE_FIELDS)[number]

export const PERSON_SOURCE_FIELD_LABELS: Record<PersonSourceField, string> = {
  name: "Nome",
  role: "Nível hierárquico",
  jobTitle: "Cargo",
  teamId: "Grupo",
  subteamId: "Subgrupo",
  managerId: "Gestor direto",
  hiredAt: "Data de admissão",
  active: "Ativo",
  email: "E-mail de acesso",
  operationalCapitalCode: "Capital operacional",
}

/**
 * O que cada writer de `master-data-writers.ts` escreve na pessoa, por campo do contrato. `whenMapped` = o campo da pessoa
 * só é escrito quando o mapeamento do feed tem um desses campos do contrato; `always` = o writer escreve mesmo sem
 * mapeamento (a Estrutura grava o gestor de todo registro: vazio = topo da cadeia). Grupo e Subgrupo andam juntos: o Grupo
 * vem do Subgrupo quando só ele chega, e um Grupo informado sem Subgrupo limpa o Subgrupo.
 */
type FieldRule = { field: PersonSourceField; whenMapped: readonly string[] } | { field: PersonSourceField; always: true }

const GROUP_FIELDS = ["groupExternalCode", "subgroupExternalCode"] as const

export const PERSON_FIELD_RULES: Readonly<Record<string, readonly FieldRule[]>> = {
  EMPLOYEES: [
    { field: "name", whenMapped: ["name"] },
    { field: "role", whenMapped: ["role"] },
    { field: "jobTitle", whenMapped: ["jobTitle"] },
    { field: "teamId", whenMapped: GROUP_FIELDS },
    { field: "subteamId", whenMapped: GROUP_FIELDS },
    { field: "managerId", whenMapped: ["reportsToExternalId"] },
    { field: "hiredAt", whenMapped: ["hiredAt"] },
    { field: "active", whenMapped: ["active"] },
    { field: "email", whenMapped: ["email"] },
    { field: "operationalCapitalCode", whenMapped: ["operationalCapitalCode"] },
  ],
  ORGANIZATIONAL_STRUCTURE: [
    { field: "managerId", always: true },
    { field: "teamId", whenMapped: GROUP_FIELDS },
    { field: "subteamId", whenMapped: GROUP_FIELDS },
  ],
}

/** Contratos que escrevem campos da pessoa. */
export const PERSON_CONTRACT_KEYS: readonly string[] = Object.keys(PERSON_FIELD_RULES)

/** Um feed que já aplicou a pessoa (linhagem), com o mapeamento atual dele. */
export type PersonFeedApplication = {
  feedId: string
  feedName: string
  sourceName: string
  contractKey: string
  authoritative: boolean
  /** `data_feeds.mapping` como está no banco (`{ fields: [{ target, source, transforms }] }`). */
  mapping: unknown
  /** Última vez que este feed escreveu a pessoa (ISO). */
  lastAppliedAt: string
}

export type SourceManager = { sourceName: string; feedName: string }
export type PersonFieldControl = Record<PersonSourceField, SourceManager | null>

export function emptyPersonFieldControl(): PersonFieldControl {
  return Object.fromEntries(PERSON_SOURCE_FIELDS.map((field) => [field, null])) as PersonFieldControl
}

function mappedTargets(mapping: unknown): Set<string> {
  const fields = (mapping as { fields?: unknown } | null)?.fields
  if (!Array.isArray(fields)) return new Set()
  return new Set(fields.map((entry) => (entry as { target?: unknown } | null)?.target).filter((target): target is string => typeof target === "string"))
}

/** Campos da pessoa que um feed escreve, pelo contrato e pelo mapeamento dele. */
export function personFieldsWrittenBy(contractKey: string, mapping: unknown): Set<PersonSourceField> {
  const targets = mappedTargets(mapping)
  const written = new Set<PersonSourceField>()
  for (const rule of PERSON_FIELD_RULES[contractKey] ?? []) {
    if ("always" in rule || rule.whenMapped.some((target) => targets.has(target))) written.add(rule.field)
  }
  return written
}

/**
 * Por campo, o feed que manda nele: entre os feeds que escrevem o campo e já aplicaram a pessoa, o autoritativo primeiro;
 * depois o que aplicou por último (empate: id do feed, para a resposta ser estável).
 */
export function resolvePersonFieldControl(applications: readonly PersonFeedApplication[]): PersonFieldControl {
  const control = emptyPersonFieldControl()
  const ordered = [...applications].sort((a, b) => Number(b.authoritative) - Number(a.authoritative) || b.lastAppliedAt.localeCompare(a.lastAppliedAt) || a.feedId.localeCompare(b.feedId))
  for (const application of ordered) {
    for (const field of personFieldsWrittenBy(application.contractKey, application.mapping)) {
      control[field] ??= { sourceName: application.sourceName, feedName: application.feedName }
    }
  }
  return control
}

export type ManagedFieldViolation = { field: PersonSourceField; label: string } & SourceManager

/** Dos campos que a edição muda de verdade, os que a base controla. */
export function managedFieldViolations(control: PersonFieldControl, changedFields: readonly PersonSourceField[]): ManagedFieldViolation[] {
  return changedFields.flatMap((field) => {
    const manager = control[field]
    return manager ? [{ field, label: PERSON_SOURCE_FIELD_LABELS[field], ...manager }] : []
  })
}

/** Mensagem única para a recusa: "Nome e Grupo vêm da base X · Y — altere na origem." */
export function describeManagedFieldViolations(violations: readonly ManagedFieldViolation[]): string {
  const bySource = new Map<string, string[]>()
  for (const violation of violations) {
    const key = `${violation.sourceName} · ${violation.feedName}`
    bySource.set(key, [...(bySource.get(key) ?? []), violation.label])
  }
  const parts = [...bySource.entries()].map(([source, labels]) => `${joinLabels(labels)} ${labels.length > 1 ? "vêm" : "vem"} da base ${source}`)
  return `${parts.join("; ")} — altere na origem.`
}

function joinLabels(labels: readonly string[]): string {
  return labels.length <= 1 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} e ${labels.at(-1)}`
}
