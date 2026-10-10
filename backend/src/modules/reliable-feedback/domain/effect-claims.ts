/**
 * V1.7.1 — EFEITO GARANTIDO / CAUSAL em TODO o conteúdo final do feedback confiável (domínio puro, sem LLM).
 *
 * A guarda V1.4.9g (`detectGuaranteedEffectLanguage`) é de alta precisão por desenho: só `observed`/`whyItMatters` e só com um
 * ESTADO DO CLIENTE de lista fechada. No smoke da V1.7.0 passou "continuar formalizando o registro da contestação GARANTE que a
 * solicitação seja encaminhada" — em `whatYouCanDo` e com um objeto fora da lista. No feedback confiável a regra é outra:
 * efeito garantido/causal só existe quando a PRÓPRIA regra oficial do item o sustenta.
 *
 *   garantir / assegurar (verbo)            "garante que…", "assegurando…" (o substantivo "garantia" não conta)
 *   fazer com que                          "faz com que…", "fará com que…"
 *   resultado futuro certo                 "vai evitar/reduzir/eliminar/resolver/impedir/causar", "evitará", "eliminará"…
 *   resultado presente sem modal           "isso evita/elimina/impede/resolve/reduz…" (sem "pode", "ajuda a", "contribui para")
 *   necessidade/universalidade do efeito   "necessariamente", "sempre resulta", "resulta(rá) em"
 *   causa (verbo)                          "causa/causará/causou…" (o substantivo "a causa" não conta; V1.7.1f: nem a pergunta
 *                                          indireta relatada — "perguntou o que causou…")
 *
 * NÃO são garantia (V1.7.1f, auditado): "ajuda a…", "contribui para…", "facilita…", "pode…" — linguagem de possibilidade. Se
 * afirmarem um resultado sem fonte, quem responde é a validação de afirmação sem suporte, não esta regra léxica.
 *
 * PERMITIDO só quando o radical do verbo aparece nos textos da regra verificada do item (trecho, abertura, detalhe) — a fonte
 * oficial sustenta a relação. Trechos entre aspas são evidência literal (conferida em outro validador), não afirmação.
 *
 * A checagem roda sobre a PROJEÇÃO NORMALIZADA do conteúdo (todos os campos de texto, qualquer que seja o nome): redator,
 * fallback, edição do QA e publicação usam a mesma função — nenhum buraco por nome de propriedade.
 */
type EffectPattern = { stem: string; pattern: RegExp; modalSensitive: boolean }

const MODAL_BEFORE = /(?:pode|podem|poder[áa]|poderia|poderiam|possa|possam|ajuda(?:m|r)?\s+a|contribui(?:r|rá|em)?\s+para|tende(?:m)?\s+a|busca(?:r)?|para)\s+$/iu
const ARTICLE_BEFORE = /(?:^|\s)(?:a|da|na|uma|pela|sua|essa|esta|qual|principal)\s+$/iu
/**
 * V1.7.1f — PERGUNTA INDIRETA não é afirmação de efeito: "você perguntou … o que causou o valor diferente" relata o que o operador
 * perguntou (smoke V1.7.1e). Só com um verbo de pergunta/apuração na mesma oração E o pronome interrogativo colado ao verbo.
 */
const INDIRECT_QUESTION_BEFORE = /(?<!\p{L})(?:pergunt\p{L}*|question\p{L}*|quis\s+saber|saber|entender|apur\p{L}*|verific\p{L}*|identific\p{L}*|investig\p{L}*)(?!\p{L})[^.;!?]*(?<!\p{L})(?:o\s+que|que|qual|quem|por\s*que)\s+$/iu

const EFFECT_PATTERNS: readonly EffectPattern[] = [
  { stem: "garant", pattern: /(?<!\p{L})garant(?:e|em|ir|iu|iram|ido|ida|idos|idas|indo|ir[áa]|ir[ãa]o|iria|iriam|imos|a|am)(?!\p{L})/giu, modalSensitive: false },
  { stem: "assegur", pattern: /(?<!\p{L})assegur(?:a|am|ar|ou|aram|ado|ada|ando|ar[áa]|ar[ãa]o|aria|ariam|e|em)(?!\p{L})/giu, modalSensitive: false },
  { stem: "com que", pattern: /(?<!\p{L})(?:faz|fez|far[áa]|far[ãa]o|fazem|fizeram|fazendo|faria|fariam)\s+com\s+que(?!\p{L})/giu, modalSensitive: false },
  { stem: "necessariamente", pattern: /(?<!\p{L})necessariamente(?!\p{L})/giu, modalSensitive: false },
  { stem: "result", pattern: /(?<!\p{L})(?:sempre\s+)?result(?:a|am|ar[áa]|ar[ãa]o|ou|aram)\s+em(?!\p{L})/giu, modalSensitive: true },
  { stem: "result", pattern: /(?<!\p{L})sempre\s+result\p{L}*/giu, modalSensitive: false },
  { stem: "evit", pattern: /(?<!\p{L})(?:(?:vai|v[ãa]o|ir[áa]|ir[ãa]o)\s+evitar|evitar[áa]|evitar[ãa]o|evita|evitam)(?!\p{L})/giu, modalSensitive: true },
  { stem: "reduz", pattern: /(?<!\p{L})(?:(?:vai|v[ãa]o|ir[áa]|ir[ãa]o)\s+reduzir|reduzir[áa]|reduzir[ãa]o|reduz|reduzem)(?!\p{L})/giu, modalSensitive: true },
  { stem: "elimin", pattern: /(?<!\p{L})(?:(?:vai|v[ãa]o|ir[áa]|ir[ãa]o)\s+eliminar|eliminar[áa]|eliminar[ãa]o|elimina|eliminam)(?!\p{L})/giu, modalSensitive: true },
  { stem: "impe", pattern: /(?<!\p{L})(?:(?:vai|v[ãa]o|ir[áa]|ir[ãa]o)\s+impedir|impedir[áa]|impedir[ãa]o|impede|impedem)(?!\p{L})/giu, modalSensitive: true },
  { stem: "resolv", pattern: /(?<!\p{L})(?:(?:vai|v[ãa]o|ir[áa]|ir[ãa]o)\s+resolver|resolver[áa]|resolver[ãa]o)(?!\p{L})/giu, modalSensitive: true },
  { stem: "caus", pattern: /(?<!\p{L})(?:(?:vai|v[ãa]o|ir[áa]|ir[ãa]o)\s+causar|causar[áa]|causar[ãa]o|causa|causam|causou|causaram)(?!\p{L})/giu, modalSensitive: true },
]

const QUOTED_SPAN = /[“"«][^”"»]*[”"»]/g
const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()

/** Afirmações de efeito garantido/causal na prosa (fora de citação) que a regra oficial do item NÃO sustenta. */
const NEGATED_BEFORE = /(?<!\p{L})(?:n[ãa]o|nunca|nem|sem|jamais)(?:\s+\p{L}+){0,4}\s*$/iu
export function detectUnsupportedEffectClaims(text: string, groundingTexts: readonly (string | null | undefined)[] = []): string[] {
  const prose = text.replace(QUOTED_SPAN, " ")
  const grounding = fold(groundingTexts.filter((value): value is string => Boolean(value)).join(" \n "))
  const found: string[] = []
  for (const { stem, pattern, modalSensitive } of EFFECT_PATTERNS) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(prose)) !== null) {
      const before = prose.slice(Math.max(0, match.index - 40), match.index)
      if (modalSensitive && MODAL_BEFORE.test(before)) continue
      if (stem === "caus" && /^causa/iu.test(match[0]) && ARTICLE_BEFORE.test(before)) continue
      if (INDIRECT_QUESTION_BEFORE.test(prose.slice(Math.max(0, match.index - 120), match.index))) continue
      // V1.7.4 — efeito NEGADO na mesma oração ("não poderia prometer ou garantir o desbloqueio", "sem garantir") não é afirmação de
      // efeito: é justamente a abstenção. Só a negação próxima, na mesma oração (nunca atravessa ponto/vírgula de outra oração).
      if (NEGATED_BEFORE.test(before.split(/[.;!?]/u).at(-1) ?? "")) continue
      if (grounding.includes(fold(stem))) continue
      found.push(match[0])
    }
  }
  return found
}

/** Todos os campos de texto de um objeto de conteúdo (projeção normalizada — o nome do campo nunca decide se é checado). */
export function contentTextsOf(content: object | null | undefined): string[] {
  if (!content) return []
  return Object.values(content).flatMap((value) => (typeof value === "string" ? [value] : value && typeof value === "object" ? contentTextsOf(value) : []))
}

export function effectClaimsInContent(content: object | null | undefined, groundingTexts: readonly (string | null | undefined)[] = []): string[] {
  return contentTextsOf(content).flatMap((text) => detectUnsupportedEffectClaims(text, groundingTexts))
}
