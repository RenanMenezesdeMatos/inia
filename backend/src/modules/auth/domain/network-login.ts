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
 * Janela de observação do AD: o contador de senhas erradas da conta de rede só volta a zero depois de 15 minutos SEM nenhuma
 * falha (política "Redefinir contador de bloqueios após"). Não é uma janela deslizante por falha — enquanto as falhas vierem a
 * menos de 15 minutos umas das outras, o contador do AD só cresce.
 */
export const NETWORK_LOGIN_CHAIN_GAP_MINUTES = 15
/** Quanto do histórico a trava lê (com LIMIT): bem mais que a janela do AD, para enxergar a cadeia inteira. */
export const NETWORK_LOGIN_LOOKBACK_HOURS = 24
export const NETWORK_LOGIN_LOOKBACK_LIMIT = 50

export type NetworkLoginThrottle = { locked: false; chain: number } | { locked: true; chain: number; retryAt: Date }

/**
 * TRAVA DA MATRÍCULA imitando o contador do AD (achado SLR-01 da auditoria run-9). A partir da falha mais recente, conta a
 * CADEIA de falhas em que cada uma está a no máximo 15 minutos da anterior; a cadeia só vale se a mais recente estiver a no
 * máximo 15 minutos de agora (senão o AD já zerou). Com `maxFailures` na cadeia, trava até a última falha + 15 minutos — o
 * mesmo instante em que o AD zera. Assim a INIA nunca soma mais que `maxFailures` falhas a uma mesma rodada do contador do AD,
 * por mais espaçadas que venham as tentativas (uma a cada 5 minutos travava só pela janela deslizante e chegava às 10 do AD).
 * As falhas já chegam depois do último sucesso (um sucesso zera a cadeia).
 */
export function networkLoginThrottle(failures: readonly Date[], now: Date, maxFailures: number = NETWORK_LOGIN_MAX_FAILURES): NetworkLoginThrottle {
  const gapMs = NETWORK_LOGIN_CHAIN_GAP_MINUTES * 60_000
  const times = failures.map((at) => at.getTime()).filter((at) => at <= now.getTime()).sort((a, b) => b - a)
  const latest = times[0]
  if (latest === undefined || now.getTime() - latest > gapMs) return { locked: false, chain: 0 }
  let chain = 1
  for (let index = 1; index < times.length && times[index - 1]! - times[index]! <= gapMs; index += 1) chain += 1
  return chain >= maxFailures ? { locked: true, chain, retryAt: new Date(latest + gapMs) } : { locked: false, chain }
}

/** Login de rede como a pessoa digita: `G0055350`, `sp0055350` ou `DOMINIO\G0055350` → `G0055350`. */
const NETWORK_LOGIN_PATTERN = /^[A-Z0-9][A-Z0-9._-]{1,63}$/

/**
 * Normaliza o login de rede (maiúsculas, sem o prefixo `DOMINIO\`). Recusa (null) qualquer coisa fora de letras, números, ponto,
 * hífen e sublinhado — o valor vai no bind do LDAP e nunca pode carregar `@`, espaço, vírgula ou caracteres de controle.
 */
export function normalizeNetworkLogin(raw: string): string | null {
  let value = raw.trim()
  const slash = value.lastIndexOf("\\")
  if (slash >= 0) value = value.slice(slash + 1)
  value = value.toUpperCase()
  return NETWORK_LOGIN_PATTERN.test(value) ? value : null
}

/** A matrícula digitada é a da própria pessoa (comparação normalizada; matrícula ausente nunca confere). */
export function networkLoginMatches(typed: string, matricula: string | null | undefined): boolean {
  if (!matricula) return false
  const left = normalizeNetworkLogin(typed)
  return left !== null && left === normalizeNetworkLogin(matricula)
}

/** Resultado da conferência da senha no AD. */
export type DirectoryVerdict =
  | { kind: "OK" }
  | { kind: "INVALID" }
  | { kind: "PASSWORD_EXPIRED" }
  | { kind: "ACCOUNT_LOCKED" }
  | { kind: "ACCOUNT_DISABLED" }
  /**
   * Sem resposta do AD. `passwordSent`: a senha CHEGOU a ser enviada (o servidor caiu ou demorou depois do pedido) — o AD pode
   * ter contado uma senha errada sem a INIA saber, então a trava conta a tentativa como falha e nenhum outro servidor é tentado.
   */
  | { kind: "UNAVAILABLE"; reason: string; passwordSent?: boolean }

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
      return { kind: "PASSWORD_EXPIRED" }
    case "775":
      return { kind: "ACCOUNT_LOCKED" }
    case "530":
    case "531":
    case "533":
    case "701":
      return { kind: "ACCOUNT_DISABLED" }
    default:
      return { kind: "INVALID" }
  }
}
