/**
 * V1.7.1e — FLEXÃO DETERMINÍSTICA de verbos da regra (domínio puro, sem modelo). Serve só para a APRESENTAÇÃO do feedback:
 * transformar a ação LITERAL de uma regra ("informar o prazo exibido na ferramenta") em imperativo ("informe…"), gerúndio
 * ("continue informando…"), pretérito ("você cancelou…") ou substantivo ("cancelamento da recorrência").
 *
 * Conservador por construção: verbo fora das formas regulares conhecidas ou da tabela de irregulares ⇒ null (quem chama cai na
 * formulação que cita a regra literal). Nunca inventa uma forma.
 */

const IRREGULAR_IMPERATIVE: Record<string, string> = {
  fazer: "faça", dizer: "diga", trazer: "traga", ter: "tenha", ver: "veja", vir: "venha", pôr: "ponha", por: "ponha", poder: "possa", saber: "saiba",
  querer: "queira", ser: "seja", estar: "esteja", ir: "vá", dar: "dê", pedir: "peça", ouvir: "ouça", seguir: "siga", conseguir: "consiga", sentir: "sinta",
  repetir: "repita", preferir: "prefira", servir: "sirva", medir: "meça", perder: "perca", valer: "valha", manter: "mantenha", obter: "obtenha", conter: "contenha",
  reter: "retenha", prever: "preveja", rever: "reveja", propor: "proponha", compor: "componha", dispor: "disponha", expor: "exponha", requerer: "requeira",
  redigir: "redija", corrigir: "corrija", exigir: "exija", dirigir: "dirija", agir: "aja", consentir: "consinta", advertir: "advirta", referir: "refira",
  transferir: "transfira", conferir: "confira", sugerir: "sugira", inserir: "insira", investir: "invista", vestir: "vista", despedir: "despeça", impedir: "impeça",
  proteger: "proteja", eleger: "eleja", escolher: "escolha", atender: "atenda", entender: "entenda", responder: "responda", esclarecer: "esclareça",
}
const IRREGULAR_PRETERITE: Record<string, string> = {
  fazer: "fez", dizer: "disse", trazer: "trouxe", ter: "teve", ver: "viu", vir: "veio", pôr: "pôs", por: "pôs", poder: "pôde", saber: "soube", querer: "quis",
  ser: "foi", ir: "foi", estar: "esteve", dar: "deu", manter: "manteve", obter: "obteve", conter: "conteve", reter: "reteve", propor: "propôs", compor: "compôs",
  dispor: "dispôs", expor: "expôs", prever: "previu", rever: "reviu",
}
/** Verbos -er/-ir regulares no imperativo que a tabela não cobre, mas com radical seguro (terminação + a). */
const REGULAR_ER_IR = /(?:ender|ecer|olher|over|ever|ibir|itir|umir|imir|artir|istir|uir|ptir)$/

/** Substantivo (com gênero) de uma ação — lista FECHADA; ausente ⇒ null. */
const NOMINALIZATION: Record<string, [string, "m" | "f"]> = {
  cancelar: ["cancelamento", "m"], registrar: ["registro", "m"], confirmar: ["confirmação", "f"], informar: ["informação", "f"], orientar: ["orientação", "f"],
  explicar: ["explicação", "f"], verificar: ["verificação", "f"], identificar: ["identificação", "f"], analisar: ["análise", "f"], ativar: ["ativação", "f"],
  consultar: ["consulta", "f"], validar: ["validação", "f"], recapitular: ["recapitulação", "f"], encerrar: ["encerramento", "m"], oferecer: ["oferta", "f"],
  bloquear: ["bloqueio", "m"], solicitar: ["solicitação", "f"], abrir: ["abertura", "f"], enviar: ["envio", "m"], emitir: ["emissão", "f"], ajustar: ["ajuste", "m"],
  estornar: ["estorno", "m"], apresentar: ["apresentação", "f"], acompanhar: ["acompanhamento", "m"], agendar: ["agendamento", "m"], transferir: ["transferência", "f"],
  atualizar: ["atualização", "f"], conferir: ["conferência", "f"], avisar: ["aviso", "m"], comunicar: ["comunicação", "f"], alterar: ["alteração", "f"],
  reembolsar: ["reembolso", "m"], contestar: ["contestação", "f"], demonstrar: ["demonstração", "f"], detalhar: ["detalhamento", "m"], resumir: ["resumo", "m"],
  escutar: ["escuta", "f"], agradecer: ["agradecimento", "m"], cumprimentar: ["cumprimento", "m"], checar: ["checagem", "f"], esclarecer: ["esclarecimento", "m"],
  suspender: ["suspensão", "f"], reativar: ["reativação", "f"], negociar: ["negociação", "f"], parcelar: ["parcelamento", "m"], protocolar: ["protocolo", "m"],
  /** V1.7.1m — verbos de checklist ("Forneci protocolo?", "Comparei contas anteriores?"). */
  fornecer: ["fornecimento", "m"], comparar: ["comparação", "f"], aplicar: ["aplicação", "f"], ouvir: ["escuta", "f"],
}

const VERB = /^(\p{L}+?)(ar|er|ir|or|ôr)(-se)?$/u
/** Verbos em -or: só pôr e compostos (senão "valor", "setor" seriam verbos). */
const OR_VERBS = new Set(["pôr", "por", "propor", "compor", "dispor", "expor", "repor", "impor", "supor", "depor"])
const splitVerb = (word: string) => {
  const match = VERB.exec(word.toLowerCase())
  if (!match) return null
  const infinitive = `${match[1]}${match[2]}`
  if ((match[2] === "or" || match[2] === "ôr") && !OR_VERBS.has(infinitive)) return null
  return { stem: match[1]!, ending: match[2]!, reflexive: Boolean(match[3]), infinitive }
}

/** "informar" → "informe"; "explicar" → "explique"; "agradecer" → "agradeça"; "permitir" → "permita"; desconhecido → null. */
export function imperativeOf(infinitive: string): string | null {
  const verb = splitVerb(infinitive)
  if (!verb) return null
  const irregular = IRREGULAR_IMPERATIVE[verb.infinitive]
  let form: string | null = irregular ?? null
  if (!form && verb.ending === "ar") {
    const stem = verb.stem
    form = stem.endsWith("c") ? `${stem.slice(0, -1)}que` : stem.endsWith("g") ? `${stem}ue` : stem.endsWith("ç") ? `${stem.slice(0, -1)}ce` : `${stem}e`
  } else if (!form && (verb.ending === "er" || verb.ending === "ir") && REGULAR_ER_IR.test(verb.infinitive)) {
    const stem = verb.stem
    form = verb.infinitive.endsWith("uir") ? `${stem}a` : stem.endsWith("c") ? `${stem.slice(0, -1)}ça` : stem.endsWith("g") ? `${stem.slice(0, -1)}ja` : `${stem}a`
  }
  if (!form) return null
  return verb.reflexive ? `${form}-se` : form
}

/** "informar" → "informando"; "pôr" → "pondo". Regular para todos os verbos em -ar/-er/-ir. */
export function gerundOf(infinitive: string): string | null {
  const verb = splitVerb(infinitive)
  if (!verb) return null
  const form = verb.ending === "or" || verb.ending === "ôr" ? `${verb.stem}ondo` : `${verb.stem}${verb.ending === "ar" ? "ando" : verb.ending === "er" ? "endo" : "indo"}`
  return verb.reflexive ? `${form}-se` : form
}

/** Pretérito (3ª pessoa, "você"): "cancelar" → "cancelou"; "fazer" → "fez"; desconhecido → null. */
export function preteriteOf(infinitive: string): string | null {
  const verb = splitVerb(infinitive)
  if (!verb) return null
  const form = IRREGULAR_PRETERITE[verb.infinitive] ?? (verb.ending === "ar" ? `${verb.stem}ou` : verb.ending === "er" ? `${verb.stem}eu` : verb.ending === "ir" ? `${verb.stem}iu` : null)
  if (!form) return null
  return verb.reflexive ? `${form}-se` : form
}

/** V1.7.1m — 1ª pessoa do pretérito ("eu"), a forma dos checklists de autoavaliação ("Validei o titular?"). */
const IRREGULAR_FIRST_PERSON_PRETERITE: Record<string, string> = {
  fazer: "fiz", dizer: "disse", trazer: "trouxe", ter: "tive", ver: "vi", vir: "vim", pôr: "pus", por: "pus", poder: "pude", saber: "soube", querer: "quis",
  ser: "fui", ir: "fui", estar: "estive", dar: "dei", manter: "mantive", obter: "obtive", propor: "propus", prever: "previ", rever: "revi",
}
/** "validar" → "validei"; "identificar" → "identifiquei"; "abrir" → "abri"; "fornecer" → "forneci"; desconhecido → null. */
export function firstPersonPreteriteOf(infinitive: string): string | null {
  const verb = splitVerb(infinitive)
  if (!verb) return null
  const irregular = IRREGULAR_FIRST_PERSON_PRETERITE[verb.infinitive]
  if (irregular) return irregular
  if (verb.ending === "ar") { const stem = verb.stem; return stem.endsWith("c") ? `${stem.slice(0, -1)}quei` : stem.endsWith("g") ? `${stem}uei` : stem.endsWith("ç") ? `${stem.slice(0, -1)}cei` : `${stem}ei` }
  return verb.ending === "er" || verb.ending === "ir" ? `${verb.stem}i` : null
}

const CONTRACTIONS: Record<string, string> = { a: "da", o: "do", as: "das", os: "dos", um: "de um", uma: "de uma" }
const PREPOSITIONS = new Set(["sobre", "com", "para", "de", "do", "da", "dos", "das", "no", "na", "nos", "nas", "ao", "à", "em", "por", "pelo", "pela", "quando", "se", "antes", "após"])

/** "cancelar a recorrência" → { noun: "cancelamento da recorrência", article: "o" }; "orientar sobre conta" → "orientação sobre conta". */
export function nominalizeAction(action: string): { phrase: string; article: "o" | "a" } | null {
  const [first, ...rest] = action.trim().split(/\s+/)
  const entry = first ? NOMINALIZATION[first.toLowerCase()] : undefined
  if (!entry) return null
  const [noun, gender] = entry
  if (rest.length === 0) return { phrase: noun, article: gender === "m" ? "o" : "a" }
  const head = rest[0]!.toLowerCase()
  const tail = rest.slice(1).join(" ")
  const joined = CONTRACTIONS[head] ? `${CONTRACTIONS[head]}${tail ? ` ${tail}` : ""}` : PREPOSITIONS.has(head) ? rest.join(" ") : `de ${rest.join(" ")}`
  return { phrase: `${noun} ${joined}`, article: gender === "m" ? "o" : "a" }
}

/**
 * V1.7.1k — verbos de AÇÃO conhecidos (lista FECHADA: os substantivados + os irregulares). Serve só para reconhecer o
 * IMPERATIVO com que checklists escrevem etapas ("confirme", "informe", "explique"): nunca "qualquer palavra terminada em -e"
 * ("Nome do serviço" não é o verbo "nomar").
 */
export const KNOWN_ACTION_VERBS: ReadonlySet<string> = new Set([...Object.keys(NOMINALIZATION), ...Object.keys(IRREGULAR_IMPERATIVE)])

/** "confirme" → "confirmar"; "explique" → "explicar" — só entre `candidates` (verbos conhecidos); desconhecido → null. */
export function infinitiveOfImperative(word: string, candidates: Iterable<string> = KNOWN_ACTION_VERBS): string | null {
  const value = word.toLowerCase()
  for (const infinitive of candidates) if (imperativeOf(infinitive) === value) return infinitive
  return null
}

/**
 * V1.7.1m — CHECKLIST É AUTOAVALIAÇÃO GRAMATICAL: "Validei o titular?", "Identifiquei…", "Abriu…" descrevem a ação esperada na
 * 1ª/3ª pessoa do pretérito. A forma verbal da REGRA é reconhecida (imperativo, pretérito) só entre verbos CONHECIDOS — nunca
 * stemming genérico; a evidência da chamada continua tendo de provar o comportamento.
 */
export function infinitiveOfConjugated(word: string, candidates: Iterable<string> = KNOWN_ACTION_VERBS): string | null {
  const value = word.toLowerCase().replace(/[^\p{L}]/gu, "")
  for (const infinitive of candidates) if (imperativeOf(infinitive) === value || firstPersonPreteriteOf(infinitive) === value || preteriteOf(infinitive) === value) return infinitive
  return null
}

/** Ação no infinitivo: já infinitivo → ela mesma; imperativo (V1.7.1m: ou pretérito de checklist) de verbo conhecido → reescrita no infinitivo; senão null. */
export function toInfinitiveAction(action: string, candidates: Iterable<string> = KNOWN_ACTION_VERBS): string | null {
  const [first, ...rest] = action.trim().split(/\s+/)
  if (!first) return null
  if (isInfinitive(first)) return action.trim()
  const infinitive = infinitiveOfConjugated(first, candidates)
  // Ação COMPOSTA no imperativo ("ofereça … e confirme …"): só o 1º verbo seria flexionado e a frase ficaria quebrada — nada.
  if (!infinitive || rest.some((word) => infinitiveOfImperative(word.replace(/[^\p{L}]/gu, ""), candidates) !== null)) return null
  return [infinitive, ...rest].join(" ")
}

/** Primeira palavra de uma ação é um verbo no infinitivo reconhecível? */
export const isInfinitive = (word: string | undefined) => Boolean(word && splitVerb(word))

/** Aplica uma flexão ao PRIMEIRO verbo da ação, preservando o resto literal: ("informar o prazo", imperativeOf) → "informe o prazo". */
export function inflectAction(action: string, inflect: (infinitive: string) => string | null): string | null {
  const [first, ...rest] = action.trim().split(/\s+/)
  if (!first || !isInfinitive(first)) return null
  const form = inflect(first)
  if (!form) return null
  // MONITORING V2 — infinitivo COORDENADO ("orientar o acesso … e mencionar a possibilidade") recebe a mesma flexão; só quando o
  // verbo abre um complemento (artigo/preposição/conjunção a seguir) — "e celular" nunca vira verbo.
  const words = rest.map((word, index) => (index > 0 && rest[index - 1] === "e" && isInfinitive(word) && COORDINATED_COMPLEMENT.test(rest[index + 1] ?? "") ? inflect(word) ?? word : word))
  return [form, ...words].join(" ")
}
const COORDINATED_COMPLEMENT = /^(?:o|a|os|as|um|uma|ao|à|aos|às|que|se|de|do|da|sobre|com|para|pelo|pela|no|na)$/iu
