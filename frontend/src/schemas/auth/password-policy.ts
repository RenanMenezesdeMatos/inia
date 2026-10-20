/**
 * Espelho de backend/src/modules/auth/domain/password-policy.ts — só para o CHECKLIST AO VIVO da tela de criar senha. Quem
 * decide é o backend (que também confere se a nova senha é diferente da temporária, o que a tela não tem como saber).
 */
export const PASSWORD_POLICY = { minLength: 8, maxBytes: 72 } as const

export type PasswordRule = { code: "TOO_SHORT" | "TOO_LONG" | "MISSING_LETTER" | "MISSING_DIGIT" | "CONTAINS_LOGIN" | "COMMON_PASSWORD"; label: string; met: boolean }

/** Espelho de `PREDICTABLE_PASSWORD_WORDS` do backend (mesma lista, mesma regra): "palavra comum + números/símbolos" é recusada. */
const PREDICTABLE_PASSWORD_WORDS: readonly string[] = [
  "senha", "password", "passw", "pass", "mudar", "trocar", "alterar", "nova", "novasenha", "minhasenha", "acesso", "login", "entrar", "bemvindo", "bemvinda", "welcome",
  "inia", "vivo", "telefonica", "claro", "tim", "oi", "empresa", "atendimento", "operador", "operadora", "supervisor", "supervisora", "gerente", "diretor", "admin", "administrador", "usuario", "user", "teste", "test", "temp", "provisoria",
  "qwerty", "qwert", "asdf", "asdfgh", "zxcvbn", "abc", "abcd", "abcde", "abcdef", "aaaa", "xpto",
  "brasil", "amor", "deus", "jesus", "familia", "flamengo", "corinthians", "palmeiras", "santos", "vasco", "gremio", "cruzeiro",
  "janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
  "primavera", "verao", "outono", "inverno",
]

function isPredictablePassword(password: string): boolean {
  const plain = password.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
  const onlyLetters = (text: string) => text.replace(/[^\p{L}]/gu, "")
  return [onlyLetters(plain), onlyLetters(plain.replace(/@/g, "a").replace(/\$/g, "s"))].some((letters) => {
    if (letters.length === 0) return false
    if (new Set(letters).size < 3) return true
    return PREDICTABLE_PASSWORD_WORDS.some((word) => letters === word || (letters.length % word.length === 0 && letters === word.repeat(letters.length / word.length)))
  })
}

export function passwordRules(password: string, login: string): PasswordRule[] {
  const lowered = password.toLowerCase()
  const normalizedLogin = login.trim().toLowerCase()
  const localPart = normalizedLogin.split("@")[0] ?? ""
  const containsLogin = (normalizedLogin !== "" && lowered.includes(normalizedLogin)) || (localPart.length >= 3 && lowered.includes(localPart))
  const rules: PasswordRule[] = [
    { code: "TOO_SHORT", label: `Pelo menos ${PASSWORD_POLICY.minLength} caracteres`, met: [...password].length >= PASSWORD_POLICY.minLength },
    { code: "MISSING_LETTER", label: "Pelo menos uma letra", met: /\p{L}/u.test(password) },
    { code: "MISSING_DIGIT", label: "Pelo menos um número", met: /\p{Nd}/u.test(password) },
    { code: "CONTAINS_LOGIN", label: "Não contém o seu e-mail de login", met: password !== "" && !containsLogin },
    { code: "COMMON_PASSWORD", label: "Não é uma senha fácil de adivinhar (ex.: Senha123, Vivo2026)", met: password !== "" && !isPredictablePassword(password) },
  ]
  // O teto (limite do bcrypt) só aparece quando é ultrapassado — ninguém precisa ler "bytes" à toa.
  if (new TextEncoder().encode(password).length > PASSWORD_POLICY.maxBytes) rules.push({ code: "TOO_LONG", label: "Senha longa demais — encurte um pouco", met: false })
  return rules
}
