/**
 * POLÍTICA DE SENHA da plataforma — regra pura, a MESMA para a senha que a pessoa cria no primeiro acesso (espelhada no
 * frontend só para o checklist ao vivo; quem decide é o backend).
 *
 * O teto é em BYTES, não em caracteres: o bcrypt usa só os primeiros 72 bytes da senha e ignoraria o resto em silêncio.
 */
export const PASSWORD_POLICY = { minLength: 8, maxBytes: 72 } as const

export type PasswordPolicyViolation = "TOO_SHORT" | "TOO_LONG" | "MISSING_LETTER" | "MISSING_DIGIT" | "CONTAINS_LOGIN" | "COMMON_PASSWORD"

export const PASSWORD_POLICY_MESSAGES: Record<PasswordPolicyViolation, string> = {
  TOO_SHORT: `Use pelo menos ${PASSWORD_POLICY.minLength} caracteres.`,
  TOO_LONG: "A senha é longa demais (máximo de 72 bytes).",
  MISSING_LETTER: "Inclua pelo menos uma letra.",
  MISSING_DIGIT: "Inclua pelo menos um número.",
  CONTAINS_LOGIN: "A senha não pode conter o seu e-mail de login.",
  COMMON_PASSWORD: "Senha fácil de adivinhar (palavra comum, nome da empresa, mês ou estação com números). Use uma combinação sua.",
}

/**
 * Palavras-base das senhas que se tenta primeiro numa conta (listas públicas de senhas vazadas, em português, e termos da
 * operação): "palavra + números/símbolos" — Senha123, Vivo2026, Mudar@123, Primavera2026 — é recusado (achado AUTH-12 da
 * auditoria de 17/10/2026). Espelhada em frontend/src/schemas/auth/password-policy.ts para o checklist ao vivo.
 */
export const PREDICTABLE_PASSWORD_WORDS: readonly string[] = [
  "senha", "password", "passw", "pass", "mudar", "trocar", "alterar", "nova", "novasenha", "minhasenha", "acesso", "login", "entrar", "bemvindo", "bemvinda", "welcome",
  "inia", "vivo", "telefonica", "claro", "tim", "oi", "empresa", "atendimento", "operador", "operadora", "supervisor", "supervisora", "gerente", "diretor", "admin", "administrador", "usuario", "user", "teste", "test", "temp", "provisoria",
  "qwerty", "qwert", "asdf", "asdfgh", "zxcvbn", "abc", "abcd", "abcde", "abcdef", "aaaa", "xpto",
  "brasil", "amor", "deus", "jesus", "familia", "flamengo", "corinthians", "palmeiras", "santos", "vasco", "gremio", "cruzeiro",
  "janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
  "primavera", "verao", "outono", "inverno",
]

/** As letras da senha, sem acento: como digitadas e com os disfarces mais comuns de letra ("@" = a, "$" = s). */
function letterReadings(password: string): string[] {
  const plain = password.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
  const onlyLetters = (text: string) => text.replace(/[^\p{L}]/gu, "")
  return [...new Set([onlyLetters(plain), onlyLetters(plain.replace(/@/g, "a").replace(/\$/g, "s"))])]
}

/** "Palavra comum (repetida ou não) + números/símbolos", ou letras quase todas iguais. */
export function isPredictablePassword(password: string): boolean {
  return letterReadings(password).some((letters) => {
    if (letters.length === 0) return false
    if (new Set(letters).size < 3) return true
    return PREDICTABLE_PASSWORD_WORDS.some((word) => letters === word || (letters.length % word.length === 0 && letters === word.repeat(letters.length / word.length)))
  })
}

/** Violações da política (vazio = senha aceita). `login` = e-mail da conta: nem ele nem o usuário antes do @ podem aparecer. */
export function passwordPolicyViolations(password: string, context: { login: string }): PasswordPolicyViolation[] {
  const violations: PasswordPolicyViolation[] = []
  if ([...password].length < PASSWORD_POLICY.minLength) violations.push("TOO_SHORT")
  if (new TextEncoder().encode(password).length > PASSWORD_POLICY.maxBytes) violations.push("TOO_LONG")
  if (!/\p{L}/u.test(password)) violations.push("MISSING_LETTER")
  if (!/\p{Nd}/u.test(password)) violations.push("MISSING_DIGIT")
  const lowered = password.toLowerCase()
  const login = context.login.trim().toLowerCase()
  const localPart = login.split("@")[0] ?? ""
  if ((login && lowered.includes(login)) || (localPart.length >= 3 && lowered.includes(localPart))) violations.push("CONTAINS_LOGIN")
  if (isPredictablePassword(password)) violations.push("COMMON_PASSWORD")
  return violations
}
