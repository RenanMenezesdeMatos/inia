import { z } from "zod"

/**
 * CARGO da organização (migration 252): o nome que a base do cliente usa é DADO (`job_positions` + `job_position_terms`), nunca lista
 * no código. O código conhece só os PERFIS — o nível da hierarquia que o cargo representa (`people.role`). Vários cargos podem ter o
 * mesmo perfil: "Assistente de Relacionamento" é OPERATOR e aparece com o próprio nome. Cargo nunca concede acesso ao INIA.
 */
export const JOB_POSITION_LEVELS = ["OPERATOR", "SUPERVISOR", "COORDINATOR", "MANAGER", "SENIOR_MANAGER", "DIRECTOR", "STAFF"] as const
export type JobPositionLevel = (typeof JOB_POSITION_LEVELS)[number]

export const JOB_POSITION_LEVEL_LABELS: Record<JobPositionLevel, string> = {
  OPERATOR: "Operador",
  SUPERVISOR: "Supervisor",
  COORDINATOR: "Coordenador",
  MANAGER: "Gerente",
  SENIOR_MANAGER: "Gerente Sênior",
  DIRECTOR: "Diretor",
  STAFF: "Apoio",
}

export function isJobPositionLevel(value: string): value is JobPositionLevel {
  return (JOB_POSITION_LEVELS as readonly string[]).includes(value)
}

/** Termo → chave de comparação: sem acento, maiúsculo, pontuação vira um espaço só ("Gerente Sr." e "GERENTE  SR" são o mesmo termo). */
export function jobPositionKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
}

const MAX_KEY_LENGTH = 120
/** Normalizar pode crescer ("ß" → "SS"): o que vai para o banco é a chave. */
const usableKey = (value: string) => jobPositionKey(value).length > 0 && jobPositionKey(value).length <= MAX_KEY_LENGTH
const termSchema = z.string().trim().min(1).max(MAX_KEY_LENGTH).refine(usableKey, "Use letras ou números, com até 120 caracteres.")

export const jobPositionInputSchema = z
  .object({
    name: z.string().trim().min(2, "Informe o nome do cargo.").max(80).refine(usableKey, "Use letras ou números no nome do cargo."),
    level: z.enum(JOB_POSITION_LEVELS),
    /** Outros nomes que a base usa para o mesmo cargo. O próprio nome entra sempre. */
    terms: z.array(termSchema).max(50).default([]),
    active: z.boolean().default(true),
  })
  .strict()
export type JobPositionInput = z.infer<typeof jobPositionInputSchema>
export const jobPositionPatchSchema = z
  .object({ name: jobPositionInputSchema.shape.name.optional(), level: z.enum(JOB_POSITION_LEVELS).optional(), terms: z.array(termSchema).max(50).optional(), active: z.boolean().optional() })
  .strict()

/** Termos gravados: o nome primeiro, sem repetir a mesma chave. */
export function termsOf(name: string, terms: readonly string[]): { key: string; term: string }[] {
  const byKey = new Map<string, string>()
  for (const term of [name, ...terms]) {
    const key = jobPositionKey(term)
    if (key && !byKey.has(key)) byKey.set(key, term.trim())
  }
  return [...byKey].map(([key, term]) => ({ key, term }))
}

export type ResolvedJobPosition = { id: string | null; name: string | null; level: JobPositionLevel }
export type JobPositionCatalog = ReadonlyMap<string, { id: string; name: string; level: JobPositionLevel; active: boolean }>

export type JobPositionResolution = { ok: true; position: ResolvedJobPosition } | { ok: false; reason: "UNKNOWN" | "INACTIVE" }

/**
 * Termo igual ao código de um nível (SUPERVISOR, "Senior Manager") só pode ser de um cargo desse nível: o código é contrato com a base e
 * nenhum cadastro muda o que ele significa.
 */
export function reservedLevelOf(key: string): JobPositionLevel | null {
  return JOB_POSITION_LEVELS.find((level) => jobPositionKey(level) === key) ?? null
}

/** Valor da base (nome do cargo ou código do nível) → cargo/perfil. O cadastro vem primeiro; desconhecido ou desativado nunca vira "operador por palpite". */
export function resolveJobPosition(catalog: JobPositionCatalog, raw: string): JobPositionResolution {
  const entry = catalog.get(jobPositionKey(raw))
  if (entry) return entry.active ? { ok: true, position: { id: entry.id, name: entry.name, level: entry.level } } : { ok: false, reason: "INACTIVE" }
  const code = raw.trim().toUpperCase()
  if (isJobPositionLevel(code)) return { ok: true, position: { id: null, name: null, level: code } }
  return { ok: false, reason: "UNKNOWN" }
}

/** Mensagem da quarentena; a tela de Cargos lê o termo de volta por `UNKNOWN_JOB_POSITION_PATTERN` (mesma frase, um lugar só). */
export const unknownJobPositionMessage = (raw: string, reason: "UNKNOWN" | "INACTIVE") =>
  `Cargo "${raw}" ${reason === "INACTIVE" ? "está desativado" : "não está cadastrado"}. ${reason === "INACTIVE" ? "Ative" : "Cadastre"} em Central de Dados › Cargos e carregue de novo.`
export const UNKNOWN_JOB_POSITION_PATTERN = '^Cargo "(.*)" (?:não está cadastrado|está desativado)\\.'
