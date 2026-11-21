import { z } from "zod"
import { DomainError } from "../../../shared/domain/domain-error.js"

/**
 * UNIVERSO DE ATUAÇÃO (domínio puro) — B2B, B2C ou B2X: o público que a operação atende. B2X é um universo PRÓPRIO: nenhuma regra
 * o associa a B2B ou B2C (não existe regra de negócio que sustente essa associação). Universo ≠ abrangência de acesso:
 *  - o universo de um COLABORADOR diz onde ele atua (vem do cadastro, `people.operating_universe`; nulo = pendente);
 *  - o universo de um RECURSO (base de conhecimento, workflow, produto) diz a que público ele serve (nulo = pendente);
 *  - a ABRANGÊNCIA diz quais universos uma conta pode consultar: o próprio universo, ou todos com a permissão explícita
 *    `operating_universes.all` no escopo dela (`universeAccessFor`). Pergunta do operador e parâmetro do frontend nunca ampliam isso.
 *
 * O filtro só vale com a ATIVAÇÃO da organização (`organizations.operating_universe_enforced_at`): antes dela nada é filtrado e o
 * cadastro é opcional (fase de classificação do legado). Depois dela: cadastro novo exige universo (backend), recurso pendente sai das
 * consultas operacionais e colaborador pendente fica sem conteúdo segmentado até ser classificado.
 */
export const OPERATING_UNIVERSES = ["B2B", "B2C", "B2X"] as const
export type OperatingUniverse = (typeof OPERATING_UNIVERSES)[number]

export const OPERATING_UNIVERSE_LABELS: Record<OperatingUniverse, string> = {
  B2B: "B2B — empresas",
  B2C: "B2C — consumidor",
  B2X: "B2X",
}

export const operatingUniverseSchema = z.enum(OPERATING_UNIVERSES)
/** Entrada de cadastro: universo, ou nulo/ausente (pendente — só aceito enquanto a organização não ativou a exigência). */
export const optionalOperatingUniverseSchema = operatingUniverseSchema.nullish().transform((value) => value ?? null)

export const isOperatingUniverse = (value: unknown): value is OperatingUniverse => typeof value === "string" && (OPERATING_UNIVERSES as readonly string[]).includes(value)

/** Valor gravado → universo; desconhecido ou vazio = pendente (null). */
export const asOperatingUniverse = (value: string | null | undefined): OperatingUniverse | null => (isOperatingUniverse(value) ? value : null)

/** Texto livre de uma carga (Central de Dados): aceita o código com qualquer caixa/espaços; outro valor = inválido (nunca adivinhado). */
export function parseOperatingUniverse(raw: unknown): OperatingUniverse | null | "INVALID" {
  if (raw === null || raw === undefined) return null
  const text = String(raw).trim().toUpperCase().replace(/\s+/g, "")
  if (text === "") return null
  return isOperatingUniverse(text) ? text : "INVALID"
}

/**
 * Abrangência de universos de uma conta num fluxo. `enforced = false` = organização ainda não ativou (nada é filtrado).
 * `all` = permissão explícita para todos os universos (a abrangência ORGANIZACIONAL continua sendo a do escopo da permissão,
 * aplicada por quem chama). Senão, só o universo do próprio cadastro; sem universo = nenhum (pendente).
 */
export type UniverseAccess =
  | { enforced: false; own: OperatingUniverse | null }
  | { enforced: true; own: OperatingUniverse | null; all: boolean; universes: readonly OperatingUniverse[] }

export function universeAccessFor(input: { enforced: boolean; own: OperatingUniverse | null; allUniverses: boolean }): UniverseAccess {
  if (!input.enforced) return { enforced: false, own: input.own }
  if (input.allUniverses) return { enforced: true, own: input.own, all: true, universes: OPERATING_UNIVERSES }
  return { enforced: true, own: input.own, all: false, universes: input.own ? [input.own] : [] }
}

/**
 * Universos consultáveis depois do filtro da TELA: a seleção opera DENTRO da abrangência. Pedir um universo fora dela é tentativa de
 * ampliar acesso → 403 (nunca resultado vazio silencioso, para não parecer "sem dados"). Sem seleção = todos os permitidos.
 * Retorna `null` quando nada deve ser filtrado (organização sem ativação e sem seleção).
 */
export function narrowUniverses(access: UniverseAccess, requested: readonly OperatingUniverse[] | null | undefined): readonly OperatingUniverse[] | null {
  const wanted = requested && requested.length > 0 ? [...new Set(requested)] : null
  if (!access.enforced) return wanted
  if (!wanted) return access.universes
  const outside = wanted.filter((universe) => !access.universes.includes(universe))
  if (outside.length > 0) throw new DomainError("Você não tem acesso a este universo de atuação.", "OPERATING_UNIVERSE_FORBIDDEN", 403, { universes: outside })
  return wanted
}

/** Um recurso (base, workflow, produto) pode ser usado na OPERAÇÃO por quem tem esta abrangência? Pendente nunca entra com a ativação. */
export function resourceUsableIn(access: UniverseAccess, resourceUniverse: OperatingUniverse | null): boolean {
  if (!access.enforced) return true
  return resourceUniverse !== null && access.universes.includes(resourceUniverse)
}

/** Dois recursos vinculados (base × produto, base × agente): universos iguais (pendente de qualquer lado não é conflito declarado — é pendência a classificar). */
export function universesCompatible(resource: OperatingUniverse | null, product: OperatingUniverse | null): boolean {
  return resource === null || product === null || resource === product
}

/** Cadastro novo/edição depois da ativação: universo obrigatório. */
export function assertUniverseProvided(enforced: boolean, universe: OperatingUniverse | null, what: string): void {
  if (enforced && universe === null) throw new DomainError(`Escolha o universo de atuação (B2B, B2C ou B2X) ${what}.`, "OPERATING_UNIVERSE_REQUIRED", 422)
}
