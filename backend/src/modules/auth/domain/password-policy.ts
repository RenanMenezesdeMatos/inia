/**
 * POLÍTICA DE SENHA da plataforma — regra pura, a MESMA para a senha que a pessoa cria no primeiro acesso (espelhada no
 * frontend só para o checklist ao vivo; quem decide é o backend).
 *
 * O teto é em BYTES, não em caracteres: o bcrypt usa só os primeiros 72 bytes da senha e ignoraria o resto em silêncio.
 */
export const PASSWORD_POLICY = { minLength: 8, maxBytes: 72 } as const

export type PasswordPolicyViolation = "TOO_SHORT" | "TOO_LONG" | "MISSING_LETTER" | "MISSING_DIGIT" | "CONTAINS_LOGIN"

export const PASSWORD_POLICY_MESSAGES: Record<PasswordPolicyViolation, string> = {
  TOO_SHORT: `Use pelo menos ${PASSWORD_POLICY.minLength} caracteres.`,
  TOO_LONG: "A senha é longa demais (máximo de 72 bytes).",
  MISSING_LETTER: "Inclua pelo menos uma letra.",
  MISSING_DIGIT: "Inclua pelo menos um número.",
  CONTAINS_LOGIN: "A senha não pode conter o seu e-mail de login.",
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
  return violations
}
