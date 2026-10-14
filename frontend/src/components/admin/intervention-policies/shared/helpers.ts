import { AdminApiError } from "@/lib/admin/admin-api"
import type { CapabilityCatalog, ConfigIssue, InterventionCapability, InterventionTypeDefinition, InterventionTypeView, PolicyView } from "@/schemas/admin/intervention-policy.schema"

/** Chave estável (tipos, políticas, regras, competências): letras maiúsculas, números e _, 2 a 40, começando por letra. */
export const STABLE_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,39}$/
export const STABLE_KEY_HINT = "Letras maiúsculas, números e _ (2 a 40 caracteres, começando por letra). Não muda depois de criada."

export function normalizeStableKey(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^[_0-9]+/, "")
    .replace(/_+$/g, "")
    .slice(0, 40)
}

/** Pendências devolvidas pelo backend (422 com `details.issues`) — nunca se interpreta o texto da mensagem. */
export function issuesFromError(error: unknown): ConfigIssue[] {
  if (!(error instanceof AdminApiError)) return []
  const raw = (error.details as { issues?: unknown } | undefined)?.issues
  if (!Array.isArray(raw)) return []
  return raw
    .filter((issue): issue is Partial<ConfigIssue> & { message: string } => typeof issue === "object" && issue !== null && typeof (issue as { message?: unknown }).message === "string")
    .map((issue) => ({ path: typeof issue.path === "string" ? issue.path : "", code: typeof issue.code === "string" ? issue.code : "", message: issue.message }))
}

export const errorMessage = (error: unknown, fallback = "Não foi possível concluir a ação.") => (error instanceof Error && error.message ? error.message : fallback)
export const errorCode = (error: unknown) => (error instanceof AdminApiError ? error.code : null)

/** Versões chegam da mais nova para a mais antiga: a primeira publicada é a mais recente (em vigor ou agendada). */
export function latestPublishedVersion<V extends { status: "DRAFT" | "PUBLISHED" }>(versions: V[]): V | null {
  return versions.find((version) => version.status === "PUBLISHED") ?? null
}

export type PolicyVersion = PolicyView["versions"][number]
export function policyVersionStatus(policy: Pick<PolicyView, "inForce" | "scheduled">, version: PolicyVersion): "DRAFT" | "IN_FORCE" | "SCHEDULED" | "SUPERSEDED" {
  if (version.status === "DRAFT") return "DRAFT"
  if (policy.inForce?.id === version.id) return "IN_FORCE"
  if (policy.scheduled.some((item) => item.id === version.id)) return "SCHEDULED"
  return "SUPERSEDED"
}
export const POLICY_VERSION_STATUS_LABELS: Record<ReturnType<typeof policyVersionStatus>, string> = { DRAFT: "Rascunho", IN_FORCE: "Em vigor", SCHEDULED: "Agendada", SUPERSEDED: "Substituída" }

/** Nome exibido de um tipo: o da versão publicada (o que as políticas usam); sem publicação, o do rascunho. */
export function interventionTypeName(type: Pick<InterventionTypeView, "key" | "published" | "draft">): string {
  return type.published?.definition.name ?? type.draft?.definition.name ?? type.key
}

/** Capacidades efetivas (com as implicadas) a partir do catálogo técnico do backend. */
export function effectiveCapabilities(capabilities: readonly InterventionCapability[], catalog: CapabilityCatalog | undefined): InterventionCapability[] {
  const set = new Set<InterventionCapability>()
  for (const capability of capabilities) {
    set.add(capability)
    for (const implied of catalog?.capabilities.find((item) => item.key === capability)?.implies ?? []) set.add(implied as InterventionCapability)
  }
  return [...set]
}

export type TypeTraits = { allowedOnInconclusive: boolean; assertsSkillGap: boolean; sensitive: boolean }
/** Características de um tipo publicado para as dicas do editor de política (a validação de verdade é do backend). */
export function typeTraits(definition: Pick<InterventionTypeDefinition, "capabilities">, catalog: CapabilityCatalog | undefined): TypeTraits | null {
  if (!catalog) return null
  const effective = effectiveCapabilities(definition.capabilities, catalog)
  const meta = (key: InterventionCapability) => catalog.capabilities.find((item) => item.key === key)
  return {
    allowedOnInconclusive: effective.every((key) => meta(key)?.allowedOnInconclusive ?? false),
    assertsSkillGap: effective.some((key) => meta(key)?.assertsSkillGap ?? false),
    sensitive: definition.capabilities.includes("CONTINUITY_REVIEW"),
  }
}

/** "AAAA-MM-DDTHH:mm" (input datetime-local, horário de quem vê) → ISO; vazio = null. */
export function localDateTimeToIso(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Agora no formato do input datetime-local (para o `min`). */
export function nowAsLocalDateTime(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
}
