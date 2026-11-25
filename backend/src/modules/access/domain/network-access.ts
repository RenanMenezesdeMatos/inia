import { normalizeNetworkLogin } from "../../auth/domain/network-login.js"

/**
 * ACESSO PELA REDE (AD) — regras puras de quem administra acessos. Com o login pela rede ligado na organização, habilitar alguém é
 * só abrir a porta da INIA: a identidade e a senha são do AD, então NENHUMA senha é gerada, mostrada ou trocada pela INIA.
 */

/**
 * O que impede esta pessoa de entrar pela matrícula, do lado da INIA (o login só diz "não foi possível entrar"):
 *  - MATRICULA_MISSING: sem matrícula no cadastro, não há como achar a conta;
 *  - MATRICULA_INVALID: a matrícula do cadastro tem espaço ou símbolo que nenhum login de rede tem;
 *  - MATRICULA_DUPLICATED: outra conta que também pode entrar tem a mesma matrícula (ninguém entra por ela);
 *  - PERSON_INACTIVE: a pessoa está inativa no cadastro.
 */
export const NETWORK_ACCESS_ISSUES = ["PERSON_INACTIVE", "MATRICULA_MISSING", "MATRICULA_INVALID", "MATRICULA_DUPLICATED"] as const
export type NetworkAccessIssue = (typeof NETWORK_ACCESS_ISSUES)[number]

export function networkAccessIssueOf(person: { personActive: boolean; matricula: string | null; duplicated: boolean }): NetworkAccessIssue | null {
  if (!person.personActive) return "PERSON_INACTIVE"
  if (!person.matricula?.trim()) return "MATRICULA_MISSING"
  if (networkLoginOf(person.matricula) === null) return "MATRICULA_INVALID"
  return person.duplicated ? "MATRICULA_DUPLICATED" : null
}

/**
 * Login de rede da matrícula do CADASTRO: a mesma comparação do login (`upper(btrim(matricula))`), sem as tolerâncias da digitação —
 * um cadastro com `DOMINIO\G0055350` ou `G0055350@dominio` nunca seria encontrado, então é inválido.
 */
export function networkLoginOf(matricula: string | null): string | null {
  const value = matricula?.replace(/^ +| +$/g, "").toUpperCase() ?? ""
  return value !== "" && normalizeNetworkLogin(value) === value ? value : null
}

/**
 * QUAL LOGIN A PESSOA USA — para quem administra acessos orientar sem adivinhar. `typed` é o que ela digita na INIA; `directoryLogins`, o que a
 * INIA confere no AD (dois enquanto não se sabe se o login de lá tem ou não o último dígito; `proven` = já entrou por ele). Só mostra: a regra
 * do login é de auth/application/directory-gate.ts.
 */
export type LoginGuide = { kind: "NETWORK" | "EMAIL"; typed: string; directoryLogins: string[]; proven: boolean }

export function loginGuideOf(input: { byNetwork: boolean; matricula: string | null; email: string | null; issue: NetworkAccessIssue | null; directoryLogin: string | null; shortLogin: string | null; showDirectory: boolean }): LoginGuide | null {
  if (!input.byNetwork) return input.email ? { kind: "EMAIL", typed: input.email, directoryLogins: [], proven: false } : null
  const typed = networkLoginOf(input.matricula)
  // Com impedimento no cadastro não há login que funcione: a linha já diz o que corrigir.
  if (!typed || input.issue) return null
  const proven = input.directoryLogin !== null && (input.directoryLogin === typed || input.directoryLogin === input.shortLogin)
  const directoryLogins = !input.showDirectory ? [] : proven ? [input.directoryLogin!] : input.shortLogin ? [typed, input.shortLogin] : [typed]
  return { kind: "NETWORK", typed, directoryLogins, proven: input.showDirectory && proven }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const isEmail = (value: string) => value.length <= 160 && EMAIL.test(value)

/**
 * Identificador da conta que entra pela rede e não tem e-mail informado: o nome de usuário do próprio AD (`matricula@dominio`, o
 * mesmo que vai no bind). Só identifica a conta (`user_accounts.email` é único e obrigatório); a pessoa entra com a matrícula.
 * null = a instalação não tem o domínio configurado ou ele não forma um identificador válido (aí o e-mail é pedido).
 */
export function networkAccountIdentifier(networkLogin: string, domain: string | null): string | null {
  if (!domain) return null
  const value = `${networkLogin}@${domain}`.toLowerCase()
  return isEmail(value) ? value : null
}
