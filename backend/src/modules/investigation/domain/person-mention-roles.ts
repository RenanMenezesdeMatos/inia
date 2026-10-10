import { projectTranscript } from "./transcript-projection.js"

/**
 * V1.7.1g — PAPEL DA PESSOA MENCIONADA (`PERSON_MENTION_ROLES_V1`, domínio puro, sem LLM).
 *
 * A proteção contra reidentificação de OUTRO colaborador (display evidence) comparava nomes: nome no trecho + nome igual ao de
 * um colega da equipe ⇒ trecho oculto. Com nomes comuns isso escondia a fala em que o operador chama o CLIENTE pelo nome
 * ("recapitulando, Roberto: …") só porque a equipe tem um Roberto — e a recapitulação some do feedback.
 *
 * Aqui o PAPEL de um primeiro nome é resolvido pela ESTRUTURA da transcrição (falante de cada turno), nunca pela semântica:
 *
 *   CUSTOMER          o nome foi dado pelo próprio CLIENTE numa autoapresentação ("meu nome é Roberto", "é a Patrícia");
 *   SUBJECT_OPERATOR  o nome é o primeiro nome do colaborador desta análise (a própria pessoa nunca é terceiro);
 *   OTHER_EMPLOYEE    o nome aparece em REFERÊNCIA a uma terceira pessoa ("vou transferir para o Roberto", "o Roberto do
 *                     suporte", "minha colega Ana") em QUALQUER turno — vence os outros papéis (ambíguo = protegido);
 *   UNKNOWN_PERSON    nenhuma das provas acima — comportamento conservador de sempre (protegido).
 *
 * Só o PRIMEIRO nome é liberado por papel: nome completo ou nome + sobrenome de colega continuam sempre protegidos.
 */
export const PERSON_MENTION_ROLES_VERSION = "PERSON_MENTION_ROLES_V1" as const

export type PersonMentionRole = "SUBJECT_OPERATOR" | "CUSTOMER" | "OTHER_EMPLOYEE" | "UNKNOWN_PERSON"

export type PersonMentionRoles = {
  version: typeof PERSON_MENTION_ROLES_VERSION
  /** Primeiros nomes com que o CLIENTE se apresentou (forma dobrada: sem acento, minúscula). */
  customerNames: string[]
  /** Primeiro nome do colaborador desta análise (dobrado), quando conhecido. */
  subjectOperatorNames: string[]
  /** Primeiros nomes usados em referência a uma terceira pessoa em algum turno (dobrados). */
  thirdPartyReferencedNames: string[]
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
const NAME = "(\\p{Lu}\\p{Ll}{2,})"
/** Autoapresentação: "meu nome é X", "me chamo X", "aqui é (o|a) X", "quem fala é X", "(é|sou) (o|a) X" no começo de frase, "X falando". */
const SELF_INTRODUCTION = [
  new RegExp(`(?:[Mm]eu\\s+nome\\s+é|[Mm]e\\s+chamo|[Aa]qui\\s+(?:quem\\s+fala\\s+)?é|[Qq]uem\\s+fala\\s+é)\\s+(?:[oa]\\s+)?${NAME}`, "gu"),
  new RegExp(`(?:^|[.!?,;]\\s*)(?:[Ss]ou|[Éé])\\s+(?:[oa]\\s+)?${NAME}`, "gu"),
  new RegExp(`${NAME}\\s+falando(?!\\p{L})`, "gu"),
]
/** Referência a TERCEIRO: preposição/cargo antes do nome ("para o Roberto", "pro Roberto", "com a Ana", "pela Ana", "colega Ana") ou
 * complemento de lotação depois ("Roberto do suporte", "Roberto da retenção", "Ana vai te ligar"). */
// "do/da" fica fora: marca posse ou produto ("do Proteção Digital", "a linha do titular"), não uma terceira pessoa.
const THIRD_PARTY_BEFORE = new RegExp(`(?<!\\p{L})(?:[Pp]r[oa]|[Pp]ara\\s+[oa]|[Cc]om\\s+[oa]|[Aa]o|[Àà]|[Pp]el[oa]|[Cc]olega|[Ss]upervisor[a]?|[Cc]oordenador[a]?|[Gg]erente|[Aa]nalista|[Aa]tendente|[Cc]onsultor[a]?|[Vv]endedor[a]?|[Tt][eé]cnic[oa])\\s+${NAME}`, "gu")
const THIRD_PARTY_AFTER = new RegExp(`${NAME}\\s+(?:d[oa]\\s+(?:suporte|setor|área|area|equipe|retenção|retencao|financeiro|faturamento|loja|técnico|tecnico|backoffice|jurídico|juridico|ouvidoria)|vai\\s+(?:te|lhe)\\s+(?:ligar|retornar|atender|passar)|(?:te|lhe)\\s+(?:liga|retorna|atende))`, "gu")

const namesMatching = (pattern: RegExp, text: string) => [...text.matchAll(pattern)].map((match) => fold(match[1]!))

export function personMentionRolesOf(transcript: string, subjectOperatorName: string | null | undefined): PersonMentionRoles {
  const turns = projectTranscript(transcript, { maxChars: Number.MAX_SAFE_INTEGER }).turns
  const customerNames = new Set<string>()
  const thirdParty = new Set<string>()
  for (const turn of turns) {
    if (turn.speaker === "CLIENTE") for (const pattern of SELF_INTRODUCTION) for (const name of namesMatching(pattern, turn.text)) customerNames.add(name)
    for (const name of [...namesMatching(THIRD_PARTY_BEFORE, turn.text), ...namesMatching(THIRD_PARTY_AFTER, turn.text)]) thirdParty.add(name)
  }
  const subjectFirst = subjectOperatorName?.trim().split(/\s+/)[0]
  return {
    version: PERSON_MENTION_ROLES_VERSION,
    customerNames: [...customerNames].sort(),
    subjectOperatorNames: subjectFirst ? [fold(subjectFirst)] : [],
    thirdPartyReferencedNames: [...thirdParty].sort(),
  }
}

/** Papel de um PRIMEIRO nome nesta interação. Referência a terceiro vence (ambíguo = protegido); sem prova = desconhecido. */
export function mentionRoleOf(firstName: string, roles: PersonMentionRoles | null | undefined): PersonMentionRole {
  if (!roles) return "UNKNOWN_PERSON"
  const name = fold(firstName)
  if (roles.thirdPartyReferencedNames.includes(name)) return "OTHER_EMPLOYEE"
  if (roles.subjectOperatorNames.includes(name)) return "SUBJECT_OPERATOR"
  if (roles.customerNames.includes(name)) return "CUSTOMER"
  return "UNKNOWN_PERSON"
}
