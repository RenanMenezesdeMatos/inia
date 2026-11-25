import { formatDateTime } from "@/lib/format/date"
import type { AccessDisabledReason, IdentifiedUser, NetworkAccessIssue, NetworkAttempts, NetworkEnableOutcome, NetworkEnableRefusal, NetworkEnableRow } from "@/schemas/access/access.schema"
import type { Tone } from "@/components/ui/surface"

/** Textos do acesso pela rede (AD) — um lugar só para a lista, a conferência de matrícula e o CSV. */
export const NETWORK_ISSUE_LABELS: Record<NetworkAccessIssue, { title: string; detail: string }> = {
  PERSON_INACTIVE: { title: "Inativa no cadastro", detail: "Não entra até voltar a ficar ativa no cadastro (a situação vem da base)." },
  MATRICULA_MISSING: { title: "Sem matrícula", detail: "É pela matrícula que se entra pela rede. Ela precisa vir no cadastro." },
  MATRICULA_INVALID: { title: "Matrícula inválida", detail: "A matrícula do cadastro tem espaço ou símbolo que não existe num login de rede. Corrija na base." },
  MATRICULA_DUPLICATED: { title: "Matrícula repetida", detail: "Outra conta habilitada tem a mesma matrícula: ninguém entra por ela até uma das duas ser desabilitada ou corrigida." },
}

export const DISABLED_REASON_LABELS: Record<AccessDisabledReason, string> = {
  PERSON_DEACTIVATED: "a pessoa foi inativada no cadastro",
  PERSON_DEACTIVATED_BY_SOURCE: "a base do cliente inativou a pessoa",
  LINKED_BY_SOURCE_NEW_PLACEMENT: "a base do cliente mudou o Grupo ou o nível de quem foi cadastrado à mão",
}

/** Código do AD que muda o que a pessoa precisa fazer. */
const DIRECTORY_CODE_DETAILS: Record<string, string> = {
  "530": "fora do horário permitido para a conta de rede",
  "531": "a conta de rede só pode entrar em estações específicas",
  "533": "conta de rede desativada",
  "701": "conta de rede expirada",
  "773": "o AD pede a troca da senha",
}

export type NetworkSignal = { key: string; tone: Tone; title: string; detail: string }

/**
 * O que a INIA sabe sobre o login pela rede desta pessoa: a trava temporária (libera sozinha) e a ÚLTIMA resposta do AD, com a hora.
 * Não é consulta ao vivo: se o suporte já desbloqueou a conta, isto muda na próxima tentativa da pessoa.
 */
export function networkSignals(attempts: NetworkAttempts | null, now: Date = new Date()): NetworkSignal[] {
  if (!attempts) return []
  const signals: NetworkSignal[] = []
  if (attempts.lockedUntil && new Date(attempts.lockedUntil).getTime() > now.getTime()) {
    signals.push({ key: "throttle", tone: "warning", title: `Bloqueio temporário até ${formatDateTime(attempts.lockedUntil)}`, detail: attempts.last?.reason === "NO_ACCOUNT" ? "A INIA pausou as tentativas depois de várias seguidas. Habilitar o acesso libera na hora." : "A INIA pausou as tentativas depois de várias seguidas, para não bloquear a conta de rede. Libera sozinho nesse horário." })
  }
  const last = attempts.last
  if (!last || last.outcome === "SUCCEEDED") return signals
  const at = formatDateTime(last.at)
  const code = last.directoryCode ? DIRECTORY_CODE_DETAILS[last.directoryCode] : undefined
  switch (last.reason) {
    case "NETWORK_ACCOUNT_LOCKED":
      signals.push({ key: "ad", tone: "danger", title: "Bloqueada no AD", detail: `O AD respondeu que a conta de rede está bloqueada (${at}). Só o suporte de TI desbloqueia.` })
      break
    case "NETWORK_ACCOUNT_DISABLED":
      signals.push({ key: "ad", tone: "danger", title: "Conta de rede sem permissão", detail: `Resposta do AD em ${at}: ${code ?? "conta de rede desativada ou restrita"}. Procure o suporte de TI.` })
      break
    case "NETWORK_PASSWORD_EXPIRED":
      signals.push({ key: "ad", tone: "warning", title: "Senha de rede vencida", detail: `Resposta do AD em ${at}: ${code ?? "senha vencida"}. A pessoa troca a senha de rede e tenta de novo.` })
      break
    case "NETWORK_INVALID":
      signals.push({ key: "ad", tone: "warning", title: "Senha recusada pelo AD", detail: `Na última tentativa (${at}) o AD recusou a matrícula ou a senha.` })
      break
    case "NETWORK_UNAVAILABLE":
    case "NETWORK_NO_ANSWER":
      signals.push({ key: "ad", tone: "warning", title: "AD sem resposta", detail: `Na última tentativa (${at}) o AD não respondeu. Confira os servidores em Login pela rede.` })
      break
    case "NETWORK_IDENTITY_MISMATCH":
      signals.push({ key: "ad", tone: "danger", title: "ID do AD é de outra matrícula", detail: `Em ${at} o AD aceitou a senha do login sem o último dígito, mas a ID funcional dessa conta não é a da matrícula. A INIA não deixou entrar.` })
      break
    case "NETWORK_IDENTITY_UNREADABLE":
      signals.push({ key: "ad", tone: "warning", title: "ID do AD não pôde ser lida", detail: `Em ${at} o AD aceitou a senha do login sem o último dígito, mas não deixou ler a ID funcional. Sem ela a INIA não deixa entrar.` })
      break
    case "NO_ACCOUNT":
      signals.push({ key: "inia", tone: "info", title: "Tentou entrar sem acesso", detail: `Em ${at} ainda não havia acesso habilitado com esta matrícula (o AD nem foi consultado).` })
      break
    case "INIA_ACCESS_DISABLED":
      signals.push({ key: "inia", tone: "info", title: "Tentou entrar com o acesso desabilitado", detail: `Em ${at} o AD confirmou a senha, mas o acesso à INIA estava desabilitado.` })
      break
    case "PERSON_INACTIVE":
      signals.push({ key: "inia", tone: "info", title: "Tentou entrar inativa no cadastro", detail: `Em ${at} o AD confirmou a senha, mas a pessoa estava inativa no cadastro.` })
      break
    case "BAD_FORMAT":
      signals.push({ key: "inia", tone: "warning", title: "Matrícula digitada errada", detail: `Em ${at} o que foi digitado não era um login de rede.` })
      break
    default:
      signals.push({ key: "ad", tone: "warning", title: "Última tentativa recusada", detail: `Em ${at}. O motivo não foi registrado.` })
  }
  return signals
}

/** Por que esta pessoa (não) entra pela rede, na ordem em que se resolve. */
export function networkVerdict(user: IdentifiedUser, now: Date = new Date()): { ok: boolean; signals: NetworkSignal[] } {
  const signals: NetworkSignal[] = []
  if (user.enableCredential === "LOCAL") return { ok: user.accessStatus !== "DISABLED", signals: [{ key: "local", tone: "info", title: "Entra com e-mail e senha da INIA", detail: "Esta conta não usa o login pela rede." }] }
  if (user.accessStatus === "DISABLED") signals.push({ key: "disabled", tone: "danger", title: "Acesso não habilitado", detail: user.account ? "A conta existe, mas está desabilitada. Habilite o acesso." : "A pessoa está no cadastro e ainda não tem acesso. Habilite o acesso." })
  if (user.networkIssue) signals.push({ key: "issue", tone: "danger", ...NETWORK_ISSUE_LABELS[user.networkIssue] })
  const login = networkSignals(user.networkAttempts, now)
  return { ok: signals.length === 0 && !login.some((signal) => signal.key === "throttle" || signal.tone === "danger"), signals: [...signals, ...login] }
}

export const NETWORK_ENABLE_OUTCOME_LABELS: Record<NetworkEnableOutcome, { preview: string; applied: string }> = {
  CREATE: { preview: "Vai habilitar", applied: "Habilitada" },
  REENABLE: { preview: "Vai reabilitar", applied: "Reabilitada" },
  ALREADY_ENABLED: { preview: "Já tem acesso", applied: "Já tinha acesso" },
  REFUSED: { preview: "Não vai habilitar", applied: "Não habilitada" },
}

export const NETWORK_ENABLE_REFUSAL_LABELS: Record<NetworkEnableRefusal, string> = {
  MATRICULA_REQUIRED: "Linha sem matrícula.",
  MATRICULA_INVALID: "Não é uma matrícula de rede (espaço ou símbolo).",
  DUPLICATE_IN_FILE: "Matrícula repetida no arquivo; vale a primeira linha.",
  PERSON_NOT_FOUND: "Matrícula não encontrada no cadastro do seu alcance.",
  MATRICULA_DUPLICATED: "Matrícula repetida em mais de um cadastro; corrija antes.",
  PERSON_INACTIVE: "Pessoa inativa no cadastro.",
  SELF_CREDENTIAL: "É o seu próprio acesso; outra pessoa autorizada precisa fazer isso.",
  TARGET_MORE_PRIVILEGED: "Tem papéis que você não pode conceder.",
  TARGET_LEADS_OUTSIDE_SCOPE: "Lidera pessoas fora do seu alcance.",
  EMERGENCY_ACCOUNT: "Conta de emergência: usa senha da INIA, não a rede.",
  EMAIL_INVALID: "E-mail inválido (deixe vazio ou corrija).",
  EMAIL_REQUIRED: "Informe o e-mail desta pessoa na coluna email.",
  EMAIL_IN_USE: "O e-mail já é de outra conta.",
  CONCURRENT_CHANGE: "Mudou enquanto o arquivo era aplicado; confira e envie de novo.",
}

/** Motivo da linha, com as matrículas parecidas quando ela não existe. */
export function networkEnableRowNote(row: NetworkEnableRow): string {
  const refusal = row.refusal ? NETWORK_ENABLE_REFUSAL_LABELS[row.refusal] : ""
  const similar = row.similar.length > 0 ? ` No cadastro há: ${row.similar.join(", ")}.` : ""
  return `${refusal}${similar}${row.emailIgnored ? "O e-mail do arquivo não foi usado: a conta já existe com outro." : ""}`
}

/**
 * Texto seguro para abrir em planilha, sempre entre aspas: célula que começa com = + - @ viraria fórmula. Vale também depois de vírgula
 * (planilha que separa por vírgula lê o arquivo de outro jeito e abriria uma célula ali).
 */
const csvCell = (value: string) => {
  const safe = (/^[\t\r]/.test(value) ? `'${value}` : value).replace(/(^|,)(\s*[=+\-@])/g, "$1'$2")
  return `"${safe.replaceAll('"', '""')}"`
}
export function networkEnableReportCsv(rows: readonly NetworkEnableRow[], phase: "preview" | "applied"): string {
  const lines = rows.map((row) => [String(row.line), row.matricula, row.name ?? "", row.login ?? "", NETWORK_ENABLE_OUTCOME_LABELS[row.outcome][phase], networkEnableRowNote(row)].map(csvCell).join(";"))
  return `\ufeff${["linha;matricula;nome;login_na_inia;resultado;motivo", ...lines].join("\r\n")}\r\n`
}
