import { DomainError } from "../../../shared/domain/domain-error.js"
import type { FeedConnectorConfig, SourceConfig } from "./source-config.js"

/**
 * Cabeçalhos extras, parâmetros fixos e o que vem depois do "?" numa URL de API Pull são configuração comum, mas podem levar credencial:
 * quem tem o papel não deve ler sem ter informado a senha da fonte. As respostas da API saem com o valor escondido, e quem salva o valor
 * escondido de volta mantém o que já está gravado. Os nomes continuam visíveis.
 */
export const MASKED_VALUE = "••••••"

function splitOnce(value: string, separator: string): [string, string | undefined] {
  const index = value.indexOf(separator)
  return index < 0 ? [value, undefined] : [value.slice(0, index), value.slice(index + 1)]
}

export function maskUrl(url: string): string {
  const [beforeFragment, fragment] = splitOnce(url, "#")
  const [head, query] = splitOnce(beforeFragment, "?")
  // Usuário também: um token costuma vir no lugar dele (https://TOKEN@host). Parâmetro sem "=" é valor do mesmo jeito.
  const maskedHead = head.replace(/\/\/[^/@]*@/, `//${MASKED_VALUE}@`)
  const maskedPair = (pair: string) => (pair === "" ? "" : pair.includes("=") ? `${pair.slice(0, pair.indexOf("=") + 1)}${MASKED_VALUE}` : MASKED_VALUE)
  const maskedQuery = query === undefined ? "" : `?${query.split("&").map(maskedPair).join("&")}`
  return `${maskedHead}${maskedQuery}${fragment === undefined ? "" : `#${MASKED_VALUE}`}`
}

const maskValues = (values: Record<string, string> | undefined) => Object.fromEntries(Object.keys(values ?? {}).map((key) => [key, MASKED_VALUE]))

type Loose = Record<string, unknown>

function maskSourceConfig(config: Loose): Loose {
  const api = config.api as Loose | undefined
  if (config.kind !== "API_PULL" || !api) return config
  const auth = api.auth as Loose | undefined
  return {
    ...config,
    api: {
      ...api,
      baseUrl: typeof api.baseUrl === "string" ? maskUrl(api.baseUrl) : api.baseUrl,
      headers: maskValues(api.headers as Record<string, string> | undefined),
      ...(auth && typeof auth.tokenUrl === "string" ? { auth: { ...auth, tokenUrl: maskUrl(auth.tokenUrl) } } : {}),
    },
  }
}

function maskFeedConnector(connector: Loose): Loose {
  const api = connector.api as Loose | undefined
  if (connector.connector !== "API_PULL" || !api) return connector
  return { ...connector, api: { ...api, endpoint: typeof api.endpoint === "string" ? maskUrl(api.endpoint) : api.endpoint, headers: maskValues(api.headers as Record<string, string> | undefined), queryParams: maskValues(api.queryParams as Record<string, string> | undefined) } }
}

const isObject = (value: unknown): value is Loose => typeof value === "object" && value !== null && !Array.isArray(value)

function maskConfigs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskConfigs)
  if (!isObject(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (key === "config" && isObject(entry)) return [key, maskSourceConfig(entry)]
      if (key === "connectorConfig" && isObject(entry)) return [key, maskFeedConnector(entry)]
      return [key, maskConfigs(entry)]
    }),
  )
}

/**
 * Qualquer `config` de fonte ou `connectorConfig` de conjunto, em qualquer lugar da resposta, sai escondido. Percorre o JSON que vai sair de
 * fato, depois da serialização: objeto de classe, com `toJSON` ou sem protótipo não tem como passar sem ser visto.
 */
export function maskConfigsInResponse(body: unknown): unknown {
  return body === undefined ? body : maskConfigs(JSON.parse(JSON.stringify(body)))
}

/** O código vale para os dois casos; `reason` diz à tela que o motivo é o servidor novo, não a falta de valor guardado. */
export const ORIGIN_CHANGED = "ORIGIN_CHANGED"
/** `reason` da troca de credencial recusada: quem troca passaria a ver valores ocultos que nunca soube. */
export const CREDENTIAL_CHANGED = "CREDENTIAL_CHANGED"

function maskedValueError(field: string, originChanged = false): DomainError {
  if (originChanged) return new DomainError(`A Base URL agora aponta para outro servidor: digite de novo o valor de "${field}". O valor guardado só vale para o servidor em que foi digitado.`, "DATA_SOURCE_MASKED_VALUE", 422, { field, reason: ORIGIN_CHANGED })
  return new DomainError(`O valor de "${field}" está oculto e não dá para aproveitá-lo aqui: digite o valor de novo.`, "DATA_SOURCE_MASKED_VALUE", 422, { field })
}

/** Esquema + servidor + porta, como o navegador compara origens. Endereço que não dá para ler não tem origem. */
function originOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return null
  }
}

/** Os dois endereços chamam o mesmo servidor? Endereço ilegível nunca é a mesma origem de nada (falha fechada). */
export function sameApiOrigin(url: string, other: string): boolean {
  const origin = originOf(url)
  return origin !== null && origin === originOf(other)
}

function restoreUrl(incoming: string, current: string | null | undefined, field: string): string {
  if (!incoming.includes(MASKED_VALUE)) return incoming
  if (current && maskUrl(current) === incoming) return current
  throw maskedValueError(field)
}

function restoreValues(incoming: Record<string, string>, current: Record<string, string> | undefined, field: string, originChanged = false): Record<string, string> {
  return Object.fromEntries(
    Object.entries(incoming).map(([key, value]) => {
      if (value !== MASKED_VALUE) return [key, value]
      if (originChanged) throw maskedValueError(`${field}: ${key}`, true)
      const kept = current?.[key]
      if (kept === undefined) throw maskedValueError(`${field}: ${key}`)
      return [key, kept]
    }),
  )
}

/**
 * Valor escondido que volta numa gravação significa "manter o atual". Sem atual para manter, é recusado: nunca grava o marcador.
 * Só mantém no MESMO servidor: com a Base URL em outra origem, o valor iria para um endereço escolhido por quem salva sem nunca
 * tê-lo visto (numa fonte sem autenticação, ninguém o vê). Aí precisa ser digitado de novo.
 */
export function restoreMaskedSourceConfig(incoming: SourceConfig, current: SourceConfig | null): SourceConfig {
  if (incoming.kind !== "API_PULL") return incoming
  const previous = current?.kind === "API_PULL" ? current.api : null
  const auth = incoming.api.auth
  const previousAuth = previous?.auth
  const baseUrl = restoreUrl(incoming.api.baseUrl, previous?.baseUrl, "Base URL")
  const originChanged = previous !== null && !sameApiOrigin(baseUrl, previous.baseUrl)
  return {
    ...incoming,
    api: {
      ...incoming.api,
      baseUrl,
      headers: restoreValues(incoming.api.headers, previous?.headers, "Cabeçalho", originChanged),
      auth: auth.kind === "OAUTH2_CLIENT_CREDENTIALS" ? { ...auth, tokenUrl: restoreUrl(auth.tokenUrl, previousAuth?.kind === "OAUTH2_CLIENT_CREDENTIALS" ? previousAuth.tokenUrl : null, "URL do token") } : auth,
    },
  }
}

export function restoreMaskedFeedConnector(incoming: FeedConnectorConfig, current: FeedConnectorConfig | null): FeedConnectorConfig {
  if (incoming.connector !== "API_PULL") return incoming
  const previous = current?.connector === "API_PULL" ? current.api : null
  return {
    ...incoming,
    api: {
      ...incoming.api,
      endpoint: restoreUrl(incoming.api.endpoint, previous?.endpoint, "Endpoint"),
      headers: restoreValues(incoming.api.headers, previous?.headers, "Cabeçalho"),
      queryParams: restoreValues(incoming.api.queryParams, previous?.queryParams, "Parâmetro"),
    },
  }
}

const hasEntries = (value: unknown) => isObject(value) && Object.keys(value).length > 0
const hasHiddenPart = (url: unknown) => typeof url === "string" && maskUrl(url) !== url

/**
 * Valores da própria FONTE que saem escondidos (os mesmos de `maskSourceConfig`: cabeçalhos extras, usuário, "?" e "#" da Base URL e
 * da URL do token), pelo nome que a tela mostra. Com `keptFrom`, só os que continuam iguais aos guardados lá: valor digitado de novo
 * quem digitou conhece. Banco e SFTP não têm valor escondido além da credencial.
 */
export function sourceHiddenValues(config: SourceConfig, keptFrom: SourceConfig = config): string[] {
  if (config.kind !== "API_PULL" || keptFrom.kind !== "API_PULL") return []
  // Configuração antiga pode não ter os campos opcionais.
  const api = config.api as Loose
  const previous = keptFrom.api as Loose
  const headers = isObject(api.headers) ? api.headers : {}
  const previousHeaders = isObject(previous.headers) ? previous.headers : {}
  const tokenUrl = (isObject(api.auth) ? api.auth : {}).tokenUrl
  const previousTokenUrl = (isObject(previous.auth) ? previous.auth : {}).tokenUrl
  return [
    ...(hasHiddenPart(api.baseUrl) && api.baseUrl === previous.baseUrl ? ["Base URL"] : []),
    ...Object.entries(headers)
      .filter(([name, value]) => value === previousHeaders[name])
      .map(([name]) => `Cabeçalho: ${name}`),
    ...(hasHiddenPart(tokenUrl) && tokenUrl === previousTokenUrl ? ["URL do token"] : []),
  ]
}

/**
 * O conjunto guarda algum valor que sai escondido (cabeçalho, parâmetro fixo, usuário, "?" ou "#" no endpoint)? Esses valores vão
 * para o servidor da FONTE (`buildUrl` não aceita endpoint de outra origem), então dependem da Base URL dela.
 */
export function feedHasHiddenValues(connector: FeedConnectorConfig): boolean {
  if (connector.connector !== "API_PULL") return false
  // Configuração antiga pode não ter os campos opcionais.
  const api = connector.api as Loose
  return hasEntries(api.headers) || hasEntries(api.queryParams) || hasHiddenPart(api.endpoint)
}
