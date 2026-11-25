/**
 * LOGIN PELA REDE (AD por LDAPS) — regras puras.
 *
 * O AD só prova QUEM é a pessoa (matrícula de rede + senha); quem entra continua sendo decisão da INIA: a matrícula encontra a
 * pessoa (`people.matricula`) numa organização com o login pela rede ligado, e a conta dela precisa estar habilitada. Ter conta
 * de rede nunca dá acesso sozinho.
 *
 * BLOQUEIO DA CONTA DE REDE: o AD trava a conta depois de poucas senhas erradas (no AD da empresa, 10 em 15 min e só o suporte destrava) e
 * essa conta serve para tudo na empresa. Por isso a INIA para ANTES: no máximo `NETWORK_LOGIN_MAX_FAILURES` senhas recusadas por
 * matrícula na janela, contadas antes de chamar o AD e somando o login e a confirmação de ciência. Matrícula sem conta na INIA
 * nunca chega ao AD (ninguém usa a tela da INIA para bloquear a conta de rede de quem não usa a INIA).
 */
export const NETWORK_LOGIN_MAX_FAILURES = 3
/**
 * TETO POR CONTA DO AD: o máximo de senhas erradas que a INIA manda para UMA conta de rede numa mesma rodada do contador do AD, somando
 * tudo — qualquer matrícula digitada que leve a ela, qualquer navegador (o conhecido tem trava própria, por aparelho) e a ciência. Metade
 * do bloqueio da empresa (10): sobra folga para os erros da pessoa no Windows e em outros sistemas, que a INIA não enxerga.
 */
export const DIRECTORY_ACCOUNT_MAX_FAILURES = 5
/** Teto da segunda conferência AINDA NÃO PROVADA (login sem o último dígito): a conta pode ser de outra pessoa, então o limite é menor. */
export const SHORT_LOGIN_MAX_FAILURES = 3

/**
 * Janela de observação do AD: o contador de senhas erradas da conta de rede só volta a zero depois de 15 minutos SEM nenhuma
 * falha (política "Redefinir contador de bloqueios após"). Não é uma janela deslizante por falha — enquanto as falhas vierem a
 * menos de 15 minutos umas das outras, o contador do AD só cresce.
 */
export const DIRECTORY_OBSERVATION_MINUTES = 15
/**
 * Rodada como a INIA a conta: a janela do AD + 1 minuto de folga. A tentativa é datada antes de o AD receber a senha (e os relógios não
 * são iguais): sem a folga, uma tentativa no segundo em que a INIA libera ainda cairia na rodada anterior do AD.
 */
export const NETWORK_LOGIN_CHAIN_GAP_MINUTES = DIRECTORY_OBSERVATION_MINUTES + 1
/** Quanto do histórico a trava lê (com LIMIT): bem mais que a janela do AD, para enxergar a cadeia inteira. */
export const NETWORK_LOGIN_LOOKBACK_HOURS = 24
export const NETWORK_LOGIN_LOOKBACK_LIMIT = 50

export type NetworkLoginThrottle = { locked: false; chain: number } | { locked: true; chain: number; retryAt: Date }

/**
 * TRAVA DA MATRÍCULA imitando o contador do AD (achado SLR-01 da auditoria run-9). A partir da falha mais recente, conta a
 * CADEIA de falhas em que cada uma está a no máximo 16 minutos da anterior (a janela do AD + folga); a cadeia só vale se a mais recente
 * estiver a no máximo 16 minutos de agora (senão o AD já zerou). Com `maxFailures` na cadeia, trava até a última falha + 16 minutos —
 * sempre depois de o AD zerar. Assim a INIA nunca soma mais que `maxFailures` falhas a uma mesma rodada do contador do AD,
 * por mais espaçadas que venham as tentativas (uma a cada 5 minutos travava só pela janela deslizante e chegava às 10 do AD).
 * As falhas já chegam depois do último sucesso (um sucesso zera a cadeia).
 */
export function networkLoginThrottle(failures: readonly Date[], now: Date, maxFailures: number = NETWORK_LOGIN_MAX_FAILURES): NetworkLoginThrottle {
  const gapMs = NETWORK_LOGIN_CHAIN_GAP_MINUTES * 60_000
  // Falha datada no futuro (relógio corrigido para trás, outro servidor adiantado) conta como de AGORA — ignorá-la abriria outra rodada.
  const times = failures.map((at) => Math.min(at.getTime(), now.getTime())).sort((a, b) => b - a)
  const latest = times[0]
  if (latest === undefined || now.getTime() - latest > gapMs) return { locked: false, chain: 0 }
  let chain = 1
  for (let index = 1; index < times.length && times[index - 1]! - times[index]! <= gapMs; index += 1) chain += 1
  return chain >= maxFailures ? { locked: true, chain, retryAt: new Date(latest + gapMs) } : { locked: false, chain }
}

/** Login de rede como a pessoa digita: `G0055350`, `sp0055350`, `DOMINIO\G0055350` ou `G0055350@dominio` → `G0055350`. */
const NETWORK_LOGIN_PATTERN = /^[A-Z0-9][A-Z0-9._-]{1,63}$/
/** Caracteres invisíveis que vêm de copiar e colar (planilha, Teams, PDF): a pessoa não os vê e não tem como apagar. */
const INVISIBLE_CHARACTERS = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g
/** Sufixo `@dominio` (UPN): só letras, números, ponto e hífen. O domínio usado no bind é sempre o da instalação. */
const DOMAIN_SUFFIX = /@[A-Z0-9.-]+$/

/**
 * Normaliza o login de rede (maiúsculas, sem o prefixo `DOMINIO\` nem o sufixo `@dominio`, sem caracteres invisíveis). Recusa
 * (null) qualquer coisa fora de letras, números, ponto, hífen e sublinhado — o valor vai no bind do LDAP e nunca pode carregar
 * `@`, espaço, vírgula ou caracteres de controle.
 */
export function normalizeNetworkLogin(raw: string): string | null {
  let value = raw.replace(INVISIBLE_CHARACTERS, "").trim()
  const slash = value.lastIndexOf("\\")
  if (slash >= 0) value = value.slice(slash + 1)
  value = value.toUpperCase().replace(DOMAIN_SUFFIX, "")
  return NETWORK_LOGIN_PATTERN.test(value) ? value : null
}

/**
 * FORMATO EM QUE O LOGIN DO AD PERDEU O ÚLTIMO DÍGITO da matrícula (ex.: matrícula `R4567891`, login `R456789`): prefixo e tamanho
 * total da matrícula, definidos na instalação (`AD_LOGIN_WITHOUT_LAST_DIGIT`). Nem toda matrícula do formato é assim — parte existe
 * inteira no AD —, por isso o login inteiro é SEMPRE tentado primeiro.
 */
export type ShortLoginFormat = { prefix: string; length: number }

/** `R:8,X:9` → formatos. Texto fora do padrão é recusado na subida (config/env.ts). */
export function parseShortLoginFormats(value: string | undefined): ShortLoginFormat[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean).map((item) => {
    const [prefix, length] = item.split(":")
    return { prefix: prefix!.toUpperCase(), length: Number(length) }
  })
}

/** Login sem o último dígito, só quando a matrícula é do formato (prefixo + dígitos, no tamanho exato); senão null. */
export function shortNetworkLoginOf(normalized: string, formats: readonly ShortLoginFormat[]): string | null {
  const format = formats.find((entry) => normalized.length === entry.length && normalized.startsWith(entry.prefix) && /^\d{2,}$/.test(normalized.slice(entry.prefix.length)))
  return format ? normalized.slice(0, -1) : null
}

/**
 * Matrículas inteiras que, sem o último dígito, dariam ESTE login (`R456789` → `R4567890`…`R4567899`); vazio = não é um login cortado
 * possível. Serve para perceber que o login digitado pode ser, no AD, o de outra pessoa do cadastro.
 */
export function fullLoginsBehind(normalized: string, formats: readonly ShortLoginFormat[]): string[] {
  const possible = formats.some((entry) => normalized.length === entry.length - 1 && normalized.startsWith(entry.prefix) && /^\d+$/.test(normalized.slice(entry.prefix.length)))
  return possible ? Array.from({ length: 10 }, (_, digit) => `${normalized}${digit}`) : []
}

/**
 * A ID funcional da conta do AD é a da matrícula digitada? Compara os números sem zeros à esquerda (`04567891` = `R4567891`).
 * Obrigatória no login sem o último dígito: dez matrículas viram o mesmo login, e a senha sozinha não diz de qual delas é a pessoa.
 */
export function employeeIdMatches(normalized: string, employeeId: string | null | undefined): boolean {
  const digits = (value: string) => value.replace(/\D/g, "").replace(/^0+/, "")
  const id = (employeeId ?? "").trim()
  return /^\d+$/.test(id) && digits(id) !== "" && digits(id) === digits(normalized)
}

/**
 * CONFERÊNCIA DE IDENTIDADE pedida depois da senha certa. `REFUSE` = sem ler a ID não entra; `ALLOW` = entra como antes (só onde a senha já
 * bastava). Vale só para "não consegui ler": ficha que não prova quem entrou recusa nos dois.
 */
export type IdentityCheck = {
  /** Matrícula cuja ID funcional a conta precisa ter. */
  employeeIdOf?: string
  /** Matrículas de OUTRAS pessoas do cadastro: se a ID é de uma delas, a conta é dela. */
  notEmployeeIdOf?: readonly string[]
  whenUnreadable: "REFUSE" | "ALLOW"
}

/**
 * O que se soube da conta que entrou: a ID lida (`ownLogin`: o login da ficha é o usado no bind; senão ela foi achada pelo nome completo),
 * não deu para ler (sem permissão, sem o atributo, falha de rede) ou não dá para provar qual conta entrou (mais de uma ficha).
 */
export type AccountIdentity = { kind: "READ"; employeeId: string; ownLogin: boolean } | { kind: "UNREADABLE" } | { kind: "NOT_PROVABLE" }

/** DECISÃO DE IDENTIDADE — de quem é a conta cuja senha o AD aceitou. Única: o adaptador só lê a ID, a varredura usa esta mesma função. */
export function identityVerdict(check: IdentityCheck, identity: AccountIdentity): DirectoryVerdict {
  if (identity.kind === "UNREADABLE" && check.whenUnreadable === "ALLOW") return { kind: "OK" }
  // Ficha de outro login só prova alguma coisa se a ID for a da matrícula digitada.
  if (identity.kind !== "READ" || (check.employeeIdOf === undefined && !identity.ownLogin)) return { kind: "UNAVAILABLE", reason: identity.kind === "UNREADABLE" ? "IDENTITY_UNREADABLE" : "IDENTITY_NOT_PROVABLE", identityUnreadable: true }
  const mine = check.employeeIdOf === undefined || employeeIdMatches(check.employeeIdOf, identity.employeeId)
  const someoneElses = (check.notEmployeeIdOf ?? []).some((matricula) => employeeIdMatches(matricula, identity.employeeId))
  return mine && !someoneElses ? { kind: "OK" } : { kind: "INVALID", identityMismatch: true }
}

/** Soma dos erros destas contas do AD (contadores `ad:<login>`): ao chegar em `max`, nada mais é enviado. */
export type DirectoryLimit = { logins: readonly string[]; max: number }

/**
 * LIMITES DA CONTA DO AD de uma matrícula — os mesmos para o portão e para o resumo da tela de Acessos. `whole` = envio pelo login inteiro;
 * `cut` = pelo login sem o último dígito; null = esse login não recebe (mais) senha. `provenLogin`: por onde a conta já entrou (valor de
 * outra matrícula não vale). No AD o inteiro e o cortado podem ser a MESMA conta (login e nome completo): o teto vale para a SOMA. Digitado
 * direto, o cortado soma as matrículas inteiras que podem ser essa conta (`fullLogins`; quem não tem conta na INIA nunca gastou nada).
 */
export function directoryLimits(input: { networkLogin: string; shortLogin: string | null; fullLogins: readonly string[]; provenLogin: string | null }): { whole: DirectoryLimit[] | null; cut: DirectoryLimit[] | null } {
  const { networkLogin, shortLogin, fullLogins, provenLogin } = input
  const account = { logins: shortLogin ? [networkLogin, shortLogin] : [networkLogin, ...fullLogins], max: DIRECTORY_ACCOUNT_MAX_FAILURES }
  if (!shortLogin || provenLogin === networkLogin) return { whole: [account], cut: null }
  // Provado (já entrou por ele): o teto cheio — quem digita errado a matrícula de um colega não segura o dono. Não provado: o menor.
  if (provenLogin === shortLogin) return { whole: null, cut: [account] }
  return { whole: [account], cut: [account, { logins: [shortLogin], max: SHORT_LOGIN_MAX_FAILURES }] }
}

/**
 * A matrícula digitada é a da própria pessoa. A do CADASTRO vale como o login a procura (`upper(btrim(matricula))`), sem as tolerâncias da
 * digitação: `DOMINIO\X` no cadastro nunca confere (a senha iria para a conta X).
 */
export function networkLoginMatches(typed: string, matricula: string | null | undefined): boolean {
  const login = normalizeNetworkLogin(typed)
  return login !== null && login === (matricula ?? "").replace(/^ +| +$/g, "").toUpperCase()
}

/** Resultado da conferência da senha no AD. */
export type DirectoryVerdict =
  | { kind: "OK" }
  /**
   * `code`: o código do AD (52e, 532, 775…), só para o registro da tentativa — nunca vai para quem tenta entrar. `identityMismatch`: o AD
   * aceitou a senha, mas a conta é de OUTRA ID funcional.
   */
  | { kind: "INVALID"; code?: string; identityMismatch?: boolean }
  | { kind: "PASSWORD_EXPIRED"; code?: string }
  | { kind: "ACCOUNT_LOCKED"; code?: string }
  | { kind: "ACCOUNT_DISABLED"; code?: string }
  /**
   * Sem resposta do AD. `passwordSent`: a senha CHEGOU a ser enviada (o servidor caiu ou demorou depois do pedido) — o AD pode
   * ter contado uma senha errada sem a INIA saber, então a trava conta a tentativa como falha e nenhum outro servidor é tentado.
   * `identityUnreadable`: a senha estava certa, mas não foi possível provar de quem é a conta.
   */
  | { kind: "UNAVAILABLE"; reason: string; passwordSent?: boolean; identityUnreadable?: boolean }

/**
 * Classifica a recusa do bind (resultado 49 do LDAP). O AD diz o motivo no texto (`... AcceptSecurityContext error, data 52e`):
 * 525/52e = usuário ou senha errados; 530/531 = fora do horário/estação permitida; 532/773 = senha vencida ou troca exigida;
 * 533 = conta desativada; 701 = conta expirada; 775 = conta bloqueada. Sem código reconhecido = senha recusada.
 */
export function classifyInvalidCredentials(message: string | undefined): Exclude<DirectoryVerdict, { kind: "OK" } | { kind: "UNAVAILABLE" }> {
  const code = /data\s+([0-9a-f]{3,4})/i.exec(message ?? "")?.[1]?.toLowerCase()
  switch (code) {
    case "532":
    case "773":
      return { kind: "PASSWORD_EXPIRED", code }
    case "775":
      return { kind: "ACCOUNT_LOCKED", code }
    case "530":
    case "531":
    case "533":
    case "701":
      return { kind: "ACCOUNT_DISABLED", code }
    default:
      return code ? { kind: "INVALID", code } : { kind: "INVALID" }
  }
}
