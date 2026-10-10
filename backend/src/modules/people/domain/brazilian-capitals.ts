/**
 * CAPITAIS BRASILEIRAS — reference data (26 capitais estaduais + Brasília/DF). Espelho em código da
 * tabela `brazilian_capitals` (migration 065): o motor deriva a UF daqui; a empresa informa só a
 * capital operacional do colaborador (nunca UF separada, nunca endereço, nunca município livre).
 * "Capital operacional" = capital cuja jurisdição de feriados vale para a pessoa — não é onde mora
 * nem onde está fisicamente. Códigos IBGE conferidos na API de localidades do IBGE.
 */
export type BrazilianCapital = { code: string; name: string; stateCode: string; ibgeCode: string }

export const BRAZILIAN_CAPITALS: readonly BrazilianCapital[] = [
  { code: "RIO_BRANCO", name: "Rio Branco", stateCode: "AC", ibgeCode: "1200401" },
  { code: "MACEIO", name: "Maceió", stateCode: "AL", ibgeCode: "2704302" },
  { code: "MACAPA", name: "Macapá", stateCode: "AP", ibgeCode: "1600303" },
  { code: "MANAUS", name: "Manaus", stateCode: "AM", ibgeCode: "1302603" },
  { code: "SALVADOR", name: "Salvador", stateCode: "BA", ibgeCode: "2927408" },
  { code: "FORTALEZA", name: "Fortaleza", stateCode: "CE", ibgeCode: "2304400" },
  { code: "BRASILIA", name: "Brasília", stateCode: "DF", ibgeCode: "5300108" },
  { code: "VITORIA", name: "Vitória", stateCode: "ES", ibgeCode: "3205309" },
  { code: "GOIANIA", name: "Goiânia", stateCode: "GO", ibgeCode: "5208707" },
  { code: "SAO_LUIS", name: "São Luís", stateCode: "MA", ibgeCode: "2111300" },
  { code: "CUIABA", name: "Cuiabá", stateCode: "MT", ibgeCode: "5103403" },
  { code: "CAMPO_GRANDE", name: "Campo Grande", stateCode: "MS", ibgeCode: "5002704" },
  { code: "BELO_HORIZONTE", name: "Belo Horizonte", stateCode: "MG", ibgeCode: "3106200" },
  { code: "BELEM", name: "Belém", stateCode: "PA", ibgeCode: "1501402" },
  { code: "JOAO_PESSOA", name: "João Pessoa", stateCode: "PB", ibgeCode: "2507507" },
  { code: "CURITIBA", name: "Curitiba", stateCode: "PR", ibgeCode: "4106902" },
  { code: "RECIFE", name: "Recife", stateCode: "PE", ibgeCode: "2611606" },
  { code: "TERESINA", name: "Teresina", stateCode: "PI", ibgeCode: "2211001" },
  { code: "RIO_DE_JANEIRO", name: "Rio de Janeiro", stateCode: "RJ", ibgeCode: "3304557" },
  { code: "NATAL", name: "Natal", stateCode: "RN", ibgeCode: "2408102" },
  { code: "PORTO_ALEGRE", name: "Porto Alegre", stateCode: "RS", ibgeCode: "4314902" },
  { code: "PORTO_VELHO", name: "Porto Velho", stateCode: "RO", ibgeCode: "1100205" },
  { code: "BOA_VISTA", name: "Boa Vista", stateCode: "RR", ibgeCode: "1400100" },
  { code: "FLORIANOPOLIS", name: "Florianópolis", stateCode: "SC", ibgeCode: "4205407" },
  { code: "SAO_PAULO", name: "São Paulo", stateCode: "SP", ibgeCode: "3550308" },
  { code: "ARACAJU", name: "Aracaju", stateCode: "SE", ibgeCode: "2800308" },
  { code: "PALMAS", name: "Palmas", stateCode: "TO", ibgeCode: "1721000" },
]

export const BRAZILIAN_CAPITAL_CODES = BRAZILIAN_CAPITALS.map((capital) => capital.code)
export const BRAZILIAN_STATE_CODES = [...new Set(BRAZILIAN_CAPITALS.map((capital) => capital.stateCode))].sort()

const byCode = new Map(BRAZILIAN_CAPITALS.map((capital) => [capital.code, capital]))

export function findBrazilianCapital(code: string | null | undefined): BrazilianCapital | null {
  return code ? (byCode.get(code) ?? null) : null
}

export function isBrazilianCapitalCode(value: unknown): value is string {
  return typeof value === "string" && byCode.has(value)
}

/** UF derivada da capital operacional — a empresa nunca precisa enviar a UF. */
export function stateCodeOfCapital(code: string | null | undefined): string | null {
  return findBrazilianCapital(code)?.stateCode ?? null
}

/** "Fortaleza / CE" — rótulo único de UI. */
export function capitalLabel(code: string | null | undefined): string | null {
  const capital = findBrazilianCapital(code)
  return capital ? `${capital.name} / ${capital.stateCode}` : null
}

/**
 * Texto da fonte → código. Só o próprio código (qualquer caixa, com espaço/hífen) ou o nome oficial
 * sem acento ("Sao Paulo" → SAO_PAULO). Abreviações da empresa ("FOR", "CE-FOR") entram por
 * "Mapear códigos" na Central — nunca por heurística.
 */
export function normalizeCapitalCode(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  const key = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_")
  return byCode.has(key) ? key : null
}
