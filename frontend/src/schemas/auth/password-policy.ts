/**
 * Espelho de backend/src/modules/auth/domain/password-policy.ts — só para o CHECKLIST AO VIVO da tela de criar senha. Quem
 * decide é o backend (que também confere se a nova senha é diferente da temporária, o que a tela não tem como saber).
 */
export const PASSWORD_POLICY = { minLength: 8, maxBytes: 72 } as const

export type PasswordRule = { code: "TOO_SHORT" | "TOO_LONG" | "MISSING_LETTER" | "MISSING_DIGIT" | "CONTAINS_LOGIN"; label: string; met: boolean }

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
  ]
  // O teto (limite do bcrypt) só aparece quando é ultrapassado — ninguém precisa ler "bytes" à toa.
  if (new TextEncoder().encode(password).length > PASSWORD_POLICY.maxBytes) rules.push({ code: "TOO_LONG", label: "Senha longa demais — encurte um pouco", met: false })
  return rules
}
