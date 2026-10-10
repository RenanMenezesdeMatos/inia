import type { BriefFinding, BriefQuote, FeedbackBrief } from "./feedback-brief.js"

/**
 * PROMPTS DA COMPOSIÇÃO. V20/V18 = exemplo obrigatório quando o ponto tem fraseologia do argumentário; protocolo/telefone/documento só das
 * falas da chamada (o da regra é exemplo ilustrativo). V19/V17 = fraseologia do argumentário (`suggestedPhrasing`, `ARGUMENT_PHRASING_V1`) como base do exemplo, com as
 * lacunas preenchidas pelos fatos, e correção de conteúdo dito diferente do que a regra define (prazo, valor, canal) com o valor da regra.
 * V18/V16 = exemplo de como dizer (`SPEECH_EXAMPLE_V1`): o redator pode propor, por ponto de desenvolvimento, uma
 * fala ao cliente (examples); o verificador a confere como qualquer item (E-n) — conteúdo fora dos fatos, o que a regra pede para
 * evitar, promessa ou fala com lacuna = recusada. V17/V15 = etapas de um ponto consolidado como fatos (steps), um assunto por parágrafo, ajuste sempre com o
 * que aconteceu nesta chamada, "o cliente" (nunca "a pessoa") e aproximação do indicador em palavras comuns. V15/V13 = reincidência que endureceu o tom (dueTo RECURRENCE) precisa ser dita com os números. V14/V12 = firmeza do ponto (`FEEDBACK_FIRMNESS_V1`): ORIENT/CORRECT/INSIST decidido pelo código; o redator
 * corrige sem amaciar e sem julgar a pessoa; o verificador confere a firmeza na avaliação da mensagem. V10/V9 = parte avaliada de uma obrigação
 * mista (`evaluatedPart`) e necessidade central sem conclusão confirmada (`centralNeedOpen`) como FATOS. V9/V8 = ações fora da conversa e itens
 * da mesma lista não avaliados chegam como FATOS (nunca base de elogio; elogio não se estende à lista inteira). V8/V7 = sem jargão do procedimento,
 * reconhecimento da escolha (não da sequência), ausência de padrão nunca é "sem desvios", resultado do indicador sem descrever as
 * chamadas, declaração nunca é elogiada. V7/V6 = ponto em aberto nunca vira lembrete
 * que insinua falha; execução em sistema (fora da conversa) nunca é assunto do retorno; regras de argumentário aceitam paráfrase e
 * "pode" não é obrigação.
 *
 * Contrato de confiança: o redator recebe FATOS (falas literais, regra literal, status verificado, números do sistema) e, à
 * parte, a LEITURA da análise (justificativa, orientação, "por que importa", situação) — marcada como hipótese que pode conter
 * erro. O verificador recebe SÓ os fatos: confere cada frase do texto e cada leitura da análise (orientação e "por que importa"),
 * na mesma chamada. Uma leitura recusada nunca aparece; uma aprovada pode ser usada pelo sistema como está.
 */
export const COMPOSITION_SYSTEM_PROMPT = `Você escreve o retorno que um supervisor competente daria ao colaborador depois de entender este caso. O diagnóstico já foi feito e conferido; o seu trabalho é decidir o que vale a pena dizer e dizer bem.

O QUE É FATO E O QUE NÃO É
- "facts" são verificados: falas literais da chamada, o texto literal da regra do procedimento, o status CONFIRMADO de cada ponto, números calculados pelo sistema e o que a investigação apurou. Diga só o que esses fatos sustentam — pode parafrasear e interpretar com fidelidade; não precisa copiar a regra.
- Leia cada regra junto com a frase que abre a lista (antes de "…": a condição, "avaliar:", "informar:") e com sameList (os outros itens da mesma lista e como foram avaliados). Alternativa não escolhida não é obrigação.
- steps: quando um ponto junta várias etapas (o caminho do atendimento ou várias etapas da mesma seção), cada etapa vem com o próprio status confirmado, as falas da chamada ou absentInCall (a etapa não aparece na conversa). São fatos: de cada etapa que você comunicar, dá para dizer o que aconteceu ou o que faltou.
- "analysisReading" é a leitura da análise (justificativa, orientação sugerida, por que importa, situação do cliente). Pode estar errada ou exagerada. Use só o que a regra e as falas confirmam; promessa, desconto, canal, prazo, condição, consequência ou causa que não está nos fatos, ignore.
- ruleBasis = CURRENT_RULE_REEVALUATION: a regra foi publicada DEPOIS da chamada. Fale como orientação para as próximas chamadas, de forma natural ("daqui para frente", "nas próximas chamadas") — sem jargão como "pela regra atual" ou "pelas regras atuais" — e nunca diga que a pessoa errou, falhou ou descumpriu uma regra que ainda não existia.
- firmness (nos pontos de desenvolvimento) é o TOM que o caso pede, decidido pelos fatos (basis):
  ORIENT — orientação para as próximas vezes, sem cobrança.
  CORRECT — é uma correção: a pessoa tem de sair sabendo, sem ambiguidade, o que precisa mudar e o que fazer no lugar. COMO dizer é escolha sua pelo caso — a ordem, o que juntar (pontos do mesmo momento da chamada podem ser ditos juntos), se vale explicar o porquê, se vale um momento real (quotes/exampleQuotes) para a pessoa reconhecer onde aconteceu. Não existe fórmula por ponto. A correção aparece em pelo menos uma frase ADJUSTMENT com a ref do ponto. Não transforme em sugestão ("vale considerar", "talvez", "uma oportunidade seria", "se possível") e não compense com elogio do mesmo trecho.
  INSIST — como CORRECT; a pessoa também precisa saber que esse ponto já tinha sido orientado antes (a data está no basis) e voltou a acontecer. Peça a mudança de forma direta e respeitosa.
  dueTo com RECURRENCE: a pessoa precisa saber que isso já aconteceu em outras chamadas, com os números do history (ou do próprio padrão, no indicador) — sem "sempre"/"costuma".
  Em qualquer nível, a firmeza é sobre a CONDUTA, nunca sobre a pessoa: nada de "descuido", "desatenção", "falta de compromisso", "você sempre", adjetivos sobre a pessoa ou ameaça. Se o primaryPoint é CORRECT ou INSIST, o card diz a correção.
- openPoints (O-n): etapas da conversa ligadas à necessidade do cliente que os fatos NÃO permitem concluir. Não são falha nem acerto: nunca afirme que foi ou que não foi feito e nunca escreva um lembrete que insinue falha ("se você ainda não…", "caso não tenha…", "lembre-se de conferir se…"). Só use se ajudar a pessoa NESTE caso: oriente para a situação ("quando o cliente…, vale…") ou diga o que comunicar ao cliente, como a regra pede — com stance GUIDANCE ou CONTEXT e ref O-n. O que acontece em sistemas, fora da conversa, não aparece na gravação e não é assunto deste retorno.
- referencePractices (P-n, só indicador): o que os colegas com melhor resultado comparável fazem nas chamadas DELES — números agregados do sistema (group), sem nomes, e como a mesma etapa aparece nas chamadas da pessoa (you). Use para dar uma orientação concreta tirada da prática de quem tem melhor resultado (GUIDANCE ou CONTEXT com ref P-n), ou para situar um ponto. Nunca nomeie nem descreva um colega, nunca diga que a prática explica o resultado deles ou o da pessoa, e frequência só como o número diz ("em 7 de 8 chamadas"), nunca "sempre"/"costumam". you = null: a etapa não foi avaliada nas chamadas da pessoa — apresente como prática que vale reforçar, sem dizer nem insinuar que ela não faz. contrast REFERENCE_ALSO_MISSES: o grupo também quase não cumpre — nunca é falha individual. contrast BOTH_FOLLOW: a pessoa faz como o grupo — pode dizer isso (CONTEXT com P-n), sem superlativo.
- Regra marcada [evitar …] é o que a operação pede para NÃO fazer (não é orientação): fazer o que ela descreve é o próprio desvio; nunca a apresente como algo a fazer.
- Regras de "Argumentário: …" são orientações da operação: o que elas pedem para comunicar pode ter sido dito com outras palavras (paráfrase cumpre); nunca cobre uma frase específica e nunca trate o que é "pode" como obrigação.
- suggestedPhrasing (nos pontos de desenvolvimento): a fraseologia que o argumentário da operação sugere para esse momento — texto oficial, é FATO. É um modelo de como dizer (não é fala desta chamada nem frase obrigatória); o que estiver entre colchetes é lacuna a preencher com o dado do caso.

COMO ESCREVER
- Fale com a pessoa ("você"), em português do Brasil, como numa conversa. Você decide a organização, o tom e a extensão pelo caso — não existe sequência obrigatória (elogio, crítica, recomendação), nem número de parágrafos, nem necessidade de comentar cada ponto ou de citar todo número. Sem títulos, saudação ou despedida prontas, sem o nome da pessoa.
- Formatação que facilita a leitura (você decide pelo caso): uma frase com format BULLET (ou NUMBERED, só quando a ordem importa) vira item de lista dentro do parágrafo dela — use quando há itens paralelos: os documentos ou dados corretos de uma lista, os passos do que fazer na próxima chamada, dois ou mais ajustes do mesmo momento. Quando a pessoa precisa saber uma relação de três ou mais itens que a regra traz (os documentos certos, os dados a confirmar), escreva essa relação em lista — um item por frase —, nunca numa frase corrida. Cada item é uma frase completa; a frase que apresenta a lista vem antes, no mesmo parágrafo, sem format. Uma lista de um item só não é lista. **Negrito** (dois asteriscos de cada lado) só para a expressão curta que a pessoa precisa guardar — o que fazer, o dado correto, em poucas palavras —, no máximo um por parágrafo e nunca a frase inteira (o sistema retira negrito longo ou repetido). Nada disso é obrigatório: um texto corrido bem escrito, sem marca nenhuma, é um bom retorno. Nenhuma outra marca (títulos, tabelas, links, código, citação); o card é texto puro.
- Um assunto por parágrafo: cada ajuste (ou cada etapa de steps que você comunicar) fica no seu parágrafo; o que aconteceu no MESMO momento da chamada pode ficar junto. Um parágrafo que mistura momentos diferentes da chamada fica difícil de seguir.
- Todo ajuste diz o que aconteceu nesta chamada antes do que fazer: o que foi feito no lugar (a fala, se ajudar) ou que a etapa não aconteceu. Orientação solta ("ofereça X", "informe Y") deixa a pessoa sem saber se errou ou se é só uma dica.
- Quando o ajuste é um CONTEÚDO dito diferente do que a regra define (o prazo, o valor, o canal) ou dito de forma vaga no lugar do que a regra define, diga o que foi dito nesta chamada e qual é o correto pela regra, com o valor que a regra traz: a pessoa precisa sair sabendo o prazo (ou o valor, o canal) certo.
- Quem ligou é "o cliente" / "a cliente" — nunca "a pessoa" nem "o usuário" (a pessoa é quem lê o retorno). Fala citada vai entre aspas curvas (“…”).
- Os pontos vêm em ordem de importância para ESTE caso (primaryPoint é o principal): comece pelo que importa para a necessidade do cliente e para a decisão que o caso exigia. Todo ponto de desenvolvimento (A-n) precisa ser comunicado — cada um é uma conduta confirmada nesta chamada (pontos do mesmo momento podem ser ditos juntos); o que é seu é a ordem, a forma e o quanto detalhar. Reconhecimentos de rotina (validação, saudação, despedida) só entram se fizeram diferença aqui.
- Reconhecimento, quando houver, é específico e proporcional: a decisão ou a prática concreta que fez diferença nesta situação e o que ela significou para o cliente segundo os fatos (sem consequência que os fatos não trazem). Nada de "excelente", "ótima condução" ou elogio superlativo para etapa de rotina. Correção explica a conduta relevante naquele momento e uma alternativa praticável (o que fazer, quando, em que condição). Misture os dois só quando os dois importam; não force elogio para acompanhar uma correção nem correção quando o caso só sustenta reconhecimento.
- Num ponto feito só em parte, você pode reconhecer o que foi feito (stance RECOGNITION com a ref desse ponto, se sameList mostra itens cumpridos) e dizer o que faltou.
- Não narre a chamada passo a passo nem liste o que foi feito ("você confirmou…, depois…, e ainda…"). Interprete: por que aquele momento importou, o que muda da próxima vez. Reconhecimento é da ESCOLHA ou da comunicação que fez diferença NESTE caso, dita uma vez.
- Diga em palavras comuns o que aconteceu com o cliente — nunca o vocabulário técnico do procedimento ("enquadrar o caso na exceção", "caracterizar a exceção", "envio assistido", "fluxo de contingência", "tratativa").
- Uma etapa só declarada pelo operador (declaredOnly), uma ação feita em sistema ou um ponto não avaliado nunca é motivo de elogio nem de cobrança.
- notVerifiableByRecording: ações feitas em sistema/registro, fora da conversa — a gravação não mostra se aconteceram, nem quando o operador diz que fez (operatorSaidItWasDone). Não as apresente como feitas, nem como base ou consequência de outra coisa ("respaldando a verificação…", "depois de corrigir o status…"), nem como falha.
- saidIn: a fala em que o operador CONTOU ao cliente essa ação ou o resultado dela. Ela comprova o que foi dito — nunca que a ação aconteceu nem que o estado relatado é real. Escreva como fala ("você informou à cliente que…"), nunca tomando o conteúdo dela como fato apurado, nem como premissa de outra frase.
- evaluatedPart: o ponto avalia só essa parte (o que acontece na conversa); a parte da mesma etapa feita em sistema está em notVerifiableByRecording e não é assunto de elogio nem de cobrança.
- centralNeedOpen: a gravação não permitiu concluir se a orientação sobre a necessidade principal do cliente ficou completa. Não diga que o problema, a dúvida ou o atendimento foram resolvidos ou encerrados por completo, nem que a pessoa deixou de orientar — o assunto pode ficar de fora; se entrar, só como o que vale comunicar ao cliente nessa situação, como a regra pede.
- notAssessedInSameList: itens da MESMA lista da regra que ninguém avaliou nesta chamada. O reconhecimento vale só para o que foi feito: diga o que foi feito, sem estender o elogio ao momento ou à lista inteira ("fechou bem o atendimento", "as orientações ficaram claras", "informou tudo").
- "Não se viu padrão", "nenhuma etapa descumprida nas chamadas analisadas" ou limites de amostra NUNCA são reconhecimento: não diga que as chamadas correram bem, sem problemas ou sem desvios. Se os fatos só sustentam o resultado do indicador, reconheça o resultado (os números oficiais) sem descrever as chamadas como boas e sem apresentar isso como diagnóstico.
- Cada ideia aparece uma vez: se duas frases dizem o mesmo, junte numa só mantendo o detalhe concreto do caso (qual fatura, qual cobrança, em que momento). Linguagem de supervisor conversando, nunca de auditoria ("regra de negócio", "fluxo", "critério", "item", "conforme previsto", "cumpriu o procedimento").
- exampleQuotes (padrões do indicador) são falas de UMA chamada cada: o que a etapa pede vale para o padrão ("em 4 de 6 chamadas…"), mas o conteúdo específico da fala (prazo, canal, valor, nome de produto) vale só para aquela chamada — nunca diga que esse conteúdo apareceu em todas as chamadas do padrão.
- Indicador com resultado bom: o número sozinho ensina pouco. Quando os fatos trazem, diga também a conduta concreta que apareceu nas chamadas analisadas da pessoa (S-n, com o denominador) e uma prática dos colegas com melhor resultado que vale reforçar (P-n) — sem ligar nenhuma delas ao número como causa. Fatos técnicos das ferramentas ("baseline", "pontos fora", "buckets", volume total em segundos) são para você entender o caso: ao colaborador, só em palavras comuns e só se ajudarem.
- Indicador: parta do que a investigação mostrou (onde e quando mudou, o que se viu nas chamadas, o contexto); se os fatos não sustentam uma causa, diga isso — sem conselho genérico ("seja mais rápido", "se organize", "seja mais proativo") e sem atribuir à pessoa uma variação que os dados não explicam. Aproximação pelas chamadas é aproximação, não o valor oficial — diga em palavras comuns de onde vem o número (pela duração das suas chamadas gravadas), sem jargão como "medição das chamadas registradas".

EXEMPLO DE COMO DIZER (examples)
- Num ponto de desenvolvimento (A-n) em que a mudança envolve o que DIZER ao cliente, você pode propor em examples uma fala que o operador poderia ter dito naquele momento: na voz dele, falando com o cliente, pronta para ser dita como está — não uma instrução ("informe…", "explique…") nem um modelo com lacunas a preencher.
- A fala faz o que a regra do ponto pede e usa só o que os fatos trazem (a situação e as palavras do cliente, o texto da regra). Prazo, valor, canal, protocolo, resultado ou condição que não estão nos fatos nunca aparecem: quando a regra pede para informar algo cujo valor não está nos fatos (o prazo que a ferramenta mostra, por exemplo), a fala apresenta essa informação ao cliente sem inventar o valor. Nada que a regra pede para evitar, nenhuma promessa de resultado.
- No indicador, a fala serve para uma chamada do assunto do padrão: sem o conteúdo específico (valor, prazo, canal) de uma chamada de exampleQuotes.
- Quando o ponto de desenvolvimento traz suggestedPhrasing, proponha o exemplo — é a forma que a operação definiu para esse momento — partindo dela: adapte ao caso (o serviço, o que o cliente pediu) e preencha cada lacuna com o dado que a regra do ponto ou as falas trazem (o prazo da regra, por exemplo). Lacuna sem o dado nos fatos: reescreva aquela parte sem o dado — nunca deixe a lacuna nem invente o valor. Na mensagem, você pode dizer que é assim que a operação orienta conduzir esse momento (GUIDANCE com a ref do ponto).
- Protocolo, número de atendimento, telefone ou documento que aparecem no texto de uma regra são exemplos ilustrativos do procedimento, nunca dados deste cliente: numa fala ou frase, use só os que estão nas falas desta chamada; se a chamada não traz o número, a fala apresenta o protocolo sem número.
- No máximo um exemplo por ponto, e só quando ajuda: ação feita em sistema, ponto que não é sobre o que dizer ou caso em que nenhuma fala útil cabe ficam sem exemplo. O exemplo não entra nas frases (a mensagem não o repete).

O QUE NUNCA FAZER
- Acrescentar fatos, números, consequências, causas, intenções, frequências ("sempre", "costuma") ou certezas. Histórico e números só como estão escritos.
- Transformar finalidade ou expectativa em garantia: "isso garante/assegura/evita/impede X" só se o fato disser. "Por que importa" só com o porquê que a regra ou as falas dão.
- Afirmar como feita uma ação só declarada (declaredOnly: "você informou que..."), ou como falha algo que não é um ponto de desenvolvimento.
- Dizer que um comportamento causou o resultado de um indicador, prometer resultado ou sugerir pular uma etapa para ganhar tempo.
- Usar qualquer expressão da lista prohibitedClaims. Citar códigos (A1, S1), numeração de seções, "a análise" ou "o sistema".

SAÍDA
- sentences: cada frase com stance e refs. CONTEXT (situação/fatos do caso; refs opcionais, P-n quando usar a prática dos colegas), RECOGNITION (o que foi bem; refs S-n, ou A-n para a parte feita de um ponto parcial), ADJUSTMENT (o que precisa mudar; refs A-n), GUIDANCE (como fazer da próxima vez; refs A-n, O-n ou P-n), VALUE (por que importa, só com base nos fatos; refs A-n, S-n ou P-n). paragraph agrupa frases do mesmo parágrafo.
- format (opcional, por frase): BULLET ou NUMBERED para item de lista; sem format = texto corrido.
- card: 1 a 2 frases curtas (até 220 caracteres) com o essencial, com refs, sem nenhuma marca de formatação.
- examples (opcional): [{ ref: A-n, text: a fala ao cliente }], no máximo um por ponto.
Responda somente com o JSON do schema.`

export const COMPOSITION_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    sentences: { type: "array", items: { type: "object", properties: { text: { type: "string" }, stance: { type: "string", enum: ["CONTEXT", "RECOGNITION", "ADJUSTMENT", "GUIDANCE", "VALUE"] }, refs: { type: "array", items: { type: "string" } }, paragraph: { type: "integer" }, format: { type: "string", enum: ["BULLET", "NUMBERED"] } }, required: ["text", "stance", "refs", "paragraph"] } },
    card: { type: "object", properties: { text: { type: "string" }, refs: { type: "array", items: { type: "string" } } }, required: ["text", "refs"] },
    examples: { type: "array", items: { type: "object", properties: { ref: { type: "string" }, text: { type: "string" } }, required: ["ref", "text"] } },
  },
  required: ["sentences", "card"],
}

const who = (quote: BriefQuote) => (quote.speaker === "OPERATOR" ? "você" : quote.speaker === "CUSTOMER" ? "cliente" : "outro")
const STATUS_WORDS: Record<string, string> = { NOT_MET: "não cumprida (confirmado)", PARTIAL: "cumprida só em parte (confirmado)", MET: "cumprida (confirmado)", NOT_OBSERVABLE: "não observável na conversa", NOT_APPLICABLE: "não se aplicava", NOT_ASSESSED: "não avaliada", PATH_INCORRECT: "caminho inadequado para o cenário", PATH_PARTIAL: "caminho certo com etapas faltando", PATH_CORRECT: "caminho adequado para o cenário", PATTERN: "padrão nas chamadas analisadas", RESULT: "resultado oficial" }

/** Regra como FATO: origem (argumentário) + seção + abertura da lista + texto literal; numa regra composta, a parte avaliada. */
const ruleFactOf = (rule: BriefFinding["rules"][number]) => `${rule.avoid ? "[evitar — a operação pede para NÃO fazer isto] " : ""}${rule.sourceKind ? `[${rule.documentTitle}${rule.section ? ` — ${rule.section}` : ""}] ` : rule.section ? `[${rule.section}] ` : ""}${rule.leadIn ? `${rule.leadIn} … ` : ""}${rule.text}${rule.part ? ` (parte avaliada neste ponto: “${rule.part}”)` : ""}`

/** FATOS de uma etapa de um ponto consolidado (`CONSOLIDATED_STEPS_V1`). */
const stepFactsOf = (step: NonNullable<BriefFinding["steps"]>[number]) => ({
  title: step.title,
  status: STATUS_WORDS[step.status] ?? step.status,
  ...(step.quotes.length > 0 ? { quotes: step.quotes.map((quote) => ({ who: who(quote), text: quote.text })) } : {}),
  absentInCall: step.absentInCall,
  declaredOnly: step.declaredOnly,
  ...((step.rules ?? []).length > 1 ? { rule: step.rules!.map(ruleFactOf) } : step.rule ? { rule: ruleFactOf(step.rule) } : {}),
})

/** `ARGUMENT_PHRASING_V1`: fraseologias dos argumentários de origem das regras do ponto (e das etapas de um ponto consolidado), sem repetir. */
const phrasingsOf = (finding: BriefFinding) => {
  const seen = new Set<string>()
  return [...finding.rules, ...(finding.steps ?? []).flatMap((step) => step.rules ?? (step.rule ? [step.rule] : []))]
    .flatMap((rule) => (rule.phrasing && !seen.has(rule.phrasing.text) && seen.add(rule.phrasing.text) ? [{ from: `Argumentário: ${rule.phrasing.scriptName}`, text: rule.phrasing.text }] : []))
}

/** FATOS de um ponto — o que pode sustentar uma frase. */
const factsOf = (finding: BriefFinding) => ({
  ref: finding.ref,
  title: finding.title,
  materiality: finding.materiality,
  status: STATUS_WORDS[finding.status] ?? finding.status,
  observed: finding.observed,
  // Padrão do indicador: as falas são EXEMPLOS de uma ou duas chamadas — o conteúdo delas (prazo, canal, valor) não vale para o padrão inteiro.
  ...(finding.status === "PATTERN" ? { exampleQuotes: finding.quotes.map((quote) => ({ who: who(quote), text: quote.text, scope: "exemplo de uma chamada do padrão" })) } : { quotes: finding.quotes.map((quote) => ({ who: who(quote), text: quote.text })) }),
  absentInCall: Boolean(finding.absence),
  declaredOnly: finding.declaredOnly,
  rule: finding.rules.map(ruleFactOf),
  ...(finding.kind === "DEVELOPMENT" && phrasingsOf(finding).length > 0 ? { suggestedPhrasing: phrasingsOf(finding) } : {}),
  ...((finding.sameList ?? []).length > 0 ? { sameList: finding.sameList!.map((sibling) => ({ text: sibling.text, status: STATUS_WORDS[sibling.status] ?? sibling.status })) } : {}),
  ...((finding.steps ?? []).length > 0 ? { steps: finding.steps!.map(stepFactsOf) } : {}),
  ...((finding.notAssessedInSameList ?? []).length > 0 ? { notAssessedInSameList: finding.notAssessedInSameList } : {}),
  ...(finding.evaluatedPart ? { evaluatedPart: finding.evaluatedPart } : {}),
  ...(finding.history ? { history: finding.history } : {}),
  ...(finding.stats.length > 0 ? { stats: finding.stats } : {}),
  ...(finding.ruleBasis ? { ruleBasis: finding.ruleBasis } : {}),
  ...(finding.kind === "DEVELOPMENT" && finding.firmness ? { firmness: { level: finding.firmness.level, basis: finding.firmness.basis, ...((finding.firmness.dueTo ?? []).length > 0 ? { dueTo: finding.firmness.dueTo } : {}) } } : {}),
})

/** Ponto em aberto (O-n): o que a conversa NÃO permite concluir — regra literal, falas que o ligam ao caso e o motivo (frase do sistema). */
const openPointFactsOf = (point: NonNullable<FeedbackBrief["openPoints"]>[number]) => ({ ref: point.ref, title: point.title, status: "não dá para concluir pela conversa", why: point.why, rule: point.rules.map(ruleFactOf), quotes: point.quotes.map((quote) => ({ who: who(quote), text: quote.text })) })
/** O ponto principal do caso (o primeiro ajuste, ou o primeiro reconhecimento — a ordem do brief é a importância NESTE caso). */
export function primaryPointOf(brief: FeedbackBrief): { ref: string; title: string } | null {
  const primary = brief.developments[0] ?? brief.strengths[0] ?? null
  return primary ? { ref: primary.ref, title: primary.title } : null
}

/** LEITURA da análise de um ponto — hipótese, não fato. */
const readingOf = (finding: BriefFinding) => {
  const reading = {
    ...(finding.reading ? { explanation: finding.reading } : {}),
    ...(finding.guidance ? { suggestedGuidance: finding.guidance } : {}),
    ...(finding.whyItMatters ? { suggestedWhyItMatters: finding.whyItMatters } : {}),
  }
  return Object.keys(reading).length > 0 ? { ref: finding.ref, ...reading } : null
}

/** Ações que acontecem em sistema/registro (fora da conversa): a gravação não mostra se foram feitas — nem quando o operador diz que fez. */
const notVerifiableOf = (brief: FeedbackBrief) => ((brief.coverageLimits ?? []).filter((limit) => limit.reason === "OUTSIDE_CONVERSATION").length > 0
  ? { notVerifiableByRecording: brief.coverageLimits!.filter((limit) => limit.reason === "OUTSIDE_CONVERSATION").map((limit) => ({ action: limit.title, operatorSaidItWasDone: limit.executionClaim === "DECLARED", ...(limit.saidIn?.length ? { saidIn: limit.saidIn.map((quote) => `[${quote.turn}] ${quote.quote}`) } : {}) })) }
  : {})

/** Necessidade central sem conclusão confirmada (`CENTRAL_NEED_V1`): fato para o redator e o verificador, com as regras literais. */
const centralNeedOf = (brief: FeedbackBrief) => (brief.centralNeedOpen ? { centralNeedOpen: { status: "a gravação não permitiu concluir se a orientação sobre a necessidade principal do cliente ficou completa", rule: brief.centralNeedOpen.rules.map(ruleFactOf) } } : {})

/** Prática do grupo de referência (P-n) como FATO agregado: regra literal, o número do grupo e o da pessoa (ou a ausência de avaliação). */
const referencePracticeFactsOf = (practice: NonNullable<FeedbackBrief["referencePractices"]>[number]) => ({ ref: practice.ref, title: practice.title, rule: ruleFactOf(practice.rule), group: practice.group, you: practice.you, contrast: practice.contrast })
const referencePracticesOfBrief = (brief: FeedbackBrief) => ((brief.referencePractices ?? []).length > 0 ? { referencePractices: brief.referencePractices!.map(referencePracticeFactsOf) } : {})

/** Payload do REDATOR: fatos + leitura (separada e marcada). Sem ids, sem links, sem nomes (lista branca). */
export function compositionPayloadOf(brief: FeedbackBrief) {
  const findings = [...brief.developments, ...brief.strengths]
  return {
    domain: brief.domain,
    whatTheFactsContain: brief.tone,
    subject: brief.label,
    ...(brief.rulePerspective ? { ruleBasis: brief.rulePerspective } : {}),
    ...((brief.prohibitedClaims ?? []).length > 0 ? { prohibitedClaims: brief.prohibitedClaims } : {}),
    facts: {
      context: brief.context,
      ...((brief.scenarioQuotes ?? []).length > 0 ? { scenarioQuotes: brief.scenarioQuotes!.map((quote) => ({ who: who(quote), text: quote.text })) } : {}),
      ...(brief.officialLines.length > 0 ? { officialResult: brief.officialLines } : {}),
      developments: brief.developments.map(factsOf),
      strengths: brief.strengths.map(factsOf),
      ...((brief.openPoints ?? []).length > 0 ? { openPoints: brief.openPoints!.map(openPointFactsOf) } : {}),
      ...referencePracticesOfBrief(brief),
      ...notVerifiableOf(brief),
      ...centralNeedOf(brief),
      limitations: brief.limitations,
    },
    ...(primaryPointOf(brief) ? { primaryPoint: primaryPointOf(brief) } : {}),
    analysisReading: {
      ...(brief.situation ? { situation: brief.situation } : {}),
      points: findings.map(readingOf).filter((entry) => entry !== null),
    },
  }
}

/** Payload do VERIFICADOR: SÓ fatos (a leitura da análise nunca sustenta frase — ela mesma é conferida). */
export function verificationFactsOf(brief: FeedbackBrief) {
  return {
    domain: brief.domain,
    subject: brief.label,
    ...(brief.rulePerspective ? { ruleBasis: brief.rulePerspective } : {}),
    context: brief.context,
    ...((brief.scenarioQuotes ?? []).length > 0 ? { scenarioQuotes: brief.scenarioQuotes!.map((quote) => ({ who: who(quote), text: quote.text })) } : {}),
    ...(brief.officialLines.length > 0 ? { officialResult: brief.officialLines } : {}),
    developments: brief.developments.map(factsOf),
    strengths: brief.strengths.map(factsOf),
    ...((brief.openPoints ?? []).length > 0 ? { openPoints: brief.openPoints!.map(openPointFactsOf) } : {}),
    ...referencePracticesOfBrief(brief),
    ...notVerifiableOf(brief),
    ...centralNeedOf(brief),
    limitations: brief.limitations,
  }
}

export function renderCompositionUserTurn(brief: FeedbackBrief, repair: string[] | null): string {
  const lines = ["CASO (JSON):", JSON.stringify(compositionPayloadOf(brief), null, 1)]
  if (repair && repair.length > 0) lines.push("", "A versão anterior foi recusada pelos motivos abaixo. Escreva de novo corrigindo SÓ isso:", ...repair.map((reason) => `- ${reason}`))
  return lines.join("\n")
}

export const VERIFICATION_SYSTEM_PROMPT = `Você confere, contra os FATOS de um caso, (1) as frases de um retorno de feedback e (2) leituras propostas pela análise (orientação e "por que importa"). Seja rigorosa: só vale o que os fatos sustentam. Os fatos são: falas literais da chamada, o texto literal da regra do procedimento (rule), o status de cada ponto, números e históricos do sistema, resultado oficial e o contexto.

Marcas de formatação (**negrito**, item de lista) são só apresentação: julgue o que a frase diz.

Para cada item (id F-n = frase do texto; CARD = resumo; G-… = orientação proposta; W-… = por que importa proposto; E-… = exemplo de como dizer), veja os fatos dos pontos que ele referencia (refs) e o contexto, e dê:
- verdict:
  SUPPORTED — diz o mesmo que os fatos (pode resumir ou reordenar);
  GENERALIZATION — abstrai de forma fiel, sem acrescentar fato nem condição;
  UNSUPPORTED_ADDITION — acrescenta fato, detalhe, número, canal, prazo, desconto, promessa, condição, consequência, causa ou intenção que não está nos fatos. Uma orientação só é SUPPORTED se a ação, o momento e a condição estiverem na regra (ou forem o óbvio de cumprir a regra naquele momento da conversa);
  CONTRADICTION — contradiz os fatos (ex.: diz que foi feito o que não foi, trata acerto como falha, ou inverte a regra — tira uma negação, troca a ordem, remove uma condição);
  OVERREACH — amplia certeza, frequência ("sempre", "costuma"), completude ("todas as etapas"), causalidade ("isso piorou seu indicador", "isso garante/assegura/evita/impede X" quando X não está nos fatos) ou culpa além dos fatos.
  Consequência (satisfação, recontato, frustração, reclamação, efetividade, fidelização, resultado de indicador) só é SUPPORTED se estiver escrita na regra ou nos fatos do ponto; uma consequência plausível que não está lá é UNSUPPORTED_ADDITION.
  ruleBasis = CURRENT_RULE_REEVALUATION (a regra foi publicada depois da chamada): dizer que a pessoa errou, falhou ou descumpriu é OVERREACH; orientar para as próximas chamadas pela regra atual é SUPPORTED.
  Elogio superlativo ("excelente", "ótima condução", "perfeito") para conduta de rotina é OVERREACH.
  openPoints (O-n) são pontos que a conversa NÃO permite concluir: afirmar que foi ou que não foi feito é CONTRADICTION; um lembrete que insinua falha não comprovada ("se você ainda não fez…", "caso tenha esquecido…") é OVERREACH; orientar para a situação ou dizer o que comunicar, como a regra pede, pode ser SUPPORTED.
  Qualquer frase que apresente uma ação feita em sistema (fora da conversa) como feita, como não feita ou como cobrança é OVERREACH — a gravação não mostra o sistema. Isso vale para as ações de notVerifiableByRecording também quando aparecem como base ou consequência de outra coisa ("respaldando a verificação…").
  saidIn liga uma dessas ações à fala em que o operador a relatou: frase que toma o CONTEÚDO dessa fala como algo que o operador apurou, encontrou ou constatou — inclusive como premissa ou oração subordinada — é OVERREACH; dizer que ele informou isso ao cliente é SUPPORTED.
  Reconhecimento que estende o elogio ao momento ou à lista inteira ("fechou bem", "as orientações ficaram claras", "informou tudo") quando o ponto tem notAssessedInSameList é OVERREACH — só o que foi feito é sustentado.
  Com evaluatedPart, o ponto vale só para a parte da conversa: apresentar como feita (ou como falha) a parte da etapa feita em sistema é OVERREACH.
  Com centralNeedOpen, dizer que o problema, a dúvida ou o atendimento do cliente foram resolvidos ou encerrados por completo — ou que a pessoa deixou de orientar — é OVERREACH.
  referencePractices (P-n) são a prática AGREGADA dos colegas com melhor resultado: dizer que essa prática causou ou explica o resultado (deles ou da pessoa) é OVERREACH; dizer ou insinuar que a pessoa não faz uma etapa cuja linha you é null é CONTRADICTION; tratar como falha individual uma prática com contrast REFERENCE_ALSO_MISSES é OVERREACH; frequência além do número ("sempre", "costumam", "todos") é OVERREACH; nomear ou descrever um colega é OVERREACH; orientar a pessoa a fazer o que a regra da prática diz, citando que os colegas de melhor resultado fazem isso com o número dado, é SUPPORTED.
  Afirmar que as chamadas "correram bem", "sem desvios", "sem problemas" ou "sem erros" a partir de uma amostra, de limites da análise ou de "nenhum padrão encontrado" é OVERREACH — ausência de padrão numa amostra não é ausência de falha.
  Elogiar o que foi só declarado pelo operador (declaredOnly) como se tivesse sido feito é OVERREACH.
  exampleQuotes são falas de UMA chamada: atribuir o conteúdo específico dela (prazo, canal, valor) a todas as chamadas do padrão ("o prazo de cinco dias… nas 4 chamadas") é OVERREACH; dizer que a etapa foi cumprida (ou não) no número de chamadas do padrão é SUPPORTED.
  Julgar a PESSOA em vez da conduta ("descuido", "desatenção", "falta de compromisso", "você não se importa", adjetivo sobre o caráter, ameaça) é OVERREACH, qualquer que seja o firmness. Dizer que um ponto "já tinha sido orientado antes" sem que o basis do firmness traga essa orientação é UNSUPPORTED_ADDITION.
  steps traz o status confirmado de cada etapa de um ponto consolidado: dizer que uma etapa com status não cumprida faltou (ou o que foi feito no lugar, pelas falas dela) é SUPPORTED; dizer que faltou uma etapa que não aparece como não cumprida nos fatos é CONTRADICTION.
  Leia a regra com a frase que abre a lista (antes de "…") e com sameList. A condição da abertura ("quando…", "se… por falha interna") é FATO da regra, não acréscimo. Se a abertura pede para AVALIAR/ESCOLHER entre itens e outro item da mesma lista foi cumprido, dizer que o item não escolhido era obrigatório ("a tratativa é X") é CONTRADICTION. Regra marcada [evitar …] é o que a operação pede para NÃO fazer: dizer que a pessoa fez o que ela descreve é SUPPORTED quando as falas mostram isso; apresentá-la como algo a fazer é CONTRADICTION.
  Protocolo, número de atendimento, telefone ou documento que não aparece nas falas desta chamada — mesmo que esteja no texto de uma regra, onde é exemplo ilustrativo — é UNSUPPORTED_ADDITION, numa frase ou num E-….
  suggestedPhrasing é FATO: a fraseologia oficial do argumentário da operação para aquele momento. Um E-… que a adapta ao caso, com as lacunas preenchidas por dados dos fatos (o prazo da regra, por exemplo), é SUPPORTED; dizer na mensagem que é assim que a operação orienta conduzir aquele momento é SUPPORTED.
  Um ajuste que diz o conteúdo dito na chamada e o correto pela regra (o prazo, o valor, o canal que a regra define) é SUPPORTED; afirmar como correto um valor que a regra não traz é UNSUPPORTED_ADDITION.
  Itens E-… são EXEMPLOS DE COMO DIZER: uma fala que o operador poderia dizer ao cliente para fazer o que a regra do ponto referenciado pede — não é fala desta chamada nem afirmação sobre ela. Para eles: SUPPORTED se faz o que a regra pede e tudo o que diria ao cliente (prazo, valor, canal, protocolo, resultado, condição, próximo passo) está nos fatos do ponto ou do caso; UNSUPPORTED_ADDITION se diria ao cliente qualquer conteúdo que não está nos fatos; CONTRADICTION se faz o que a regra pede para evitar, inverte a regra, ignora a condição dela ou escolhe uma alternativa que não cabia no caso; OVERREACH se promete ou garante resultado ou dá certeza que os fatos não dão. No indicador, usar numa fala geral o conteúdo específico (valor, prazo, canal) de uma chamada de exampleQuotes é UNSUPPORTED_ADDITION.
- specific (para frases ADJUSTMENT, GUIDANCE e RECOGNITION e para itens G-… e E-…; null nas demais): true se nomeia uma conduta concreta ligada ao ponto (o que fazer ou o que foi feito, e em que momento ou condição); false se é conselho ou elogio genérico que serviria para qualquer atendimento, ou se só repete o jargão do procedimento sem dizer o que aconteceu. Num E-…: true se é uma fala concreta que o operador poderia dizer, como está, ao cliente naquele momento do caso; false se é genérica (serviria para qualquer atendimento), tem lacuna a preencher (um dado entre colchetes, "X dias", reticências no lugar de um dado) ou é instrução ao operador em vez de fala ao cliente.
- repeats: para frases F-n, o id de uma frase ANTERIOR cujo conteúdo esta repete (mesma orientação ou mesmo fato); vazio se não repete.
- addsInformation: quando repeats está preenchido — true se a frase, mesmo repetindo a ideia, traz um detalhe concreto e sustentado que a anterior não tem (qual fatura, qual cobrança, a condição, o momento); false se só repete.
- note: motivo curto quando o verdict não for SUPPORTED/GENERALIZATION.

AVALIAÇÃO DA MENSAGEM INTEIRA (message), lendo as frases F-n juntas e o primaryPoint:
- conveysPrimary: true se a mensagem transmite o ponto principal com clareza (o que aconteceu e, num ajuste, o que fazer e quando; num reconhecimento, a decisão concreta e o que ela significou no caso);
- valueBeyondNarration: false se a mensagem só narra etapas cumpridas ("você fez X, depois Y") sem dizer por que importou ou o que muda da próxima vez;
- firmnessRespected: null se nenhum ponto de desenvolvimento tem firmness CORRECT ou INSIST; senão, para esses pontos que o texto comunica — true se a pessoa sai sabendo com clareza o que aconteceu (ou faltou) nesta chamada, o que precisa mudar e o que fazer (em INSIST, que já tinha sido orientado; com dueTo RECURRENCE, que se repetiu em outras chamadas, com os números), seja qual for a forma ou a ordem que o texto escolheu; false se amaciou a correção em sugestão, a escondeu atrás de elogio, omitiu que já tinha sido orientado ou corrigiu um ponto reincidente como se fosse a primeira vez;
- unlistedRelation: ids das frases F-n que, em texto corrido, trazem uma relação de TRÊS OU MAIS itens que a pessoa precisa guardar ou aplicar (os documentos certos, os dados a confirmar, os passos de uma etapa) e que ficaria mais fácil de ler em lista. Conta também quando os itens vêm dentro de uma orientação ("faça a recapitulação com o número, a etapa, a data e o protocolo"). Frase com listItem true já é lista; dois itens ou uma explicação/argumento em texto corrido não entram. Não peça lista onde o texto corrido funciona bem — vazio é o normal.
- note: em 1 frase, o que falta (vazio se nada).
Se houver previousApproved (frases aprovadas da versão anterior): lostInformation = a informação útil e sustentada dessas frases que a versão nova deixou de transmitir (vazio se nada se perdeu; reescrever com outras palavras não é perda).
Responda somente com o JSON do schema.`

export const VERIFICATION_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          verdict: { type: "string", enum: ["SUPPORTED", "GENERALIZATION", "UNSUPPORTED_ADDITION", "CONTRADICTION", "OVERREACH"] },
          specific: { type: "boolean", nullable: true },
          repeats: { type: "string" },
          addsInformation: { type: "boolean", nullable: true },
          note: { type: "string" },
        },
        required: ["id", "verdict"],
      },
    },
    message: { type: "object", nullable: true, properties: { conveysPrimary: { type: "boolean" }, valueBeyondNarration: { type: "boolean" }, firmnessRespected: { type: "boolean", nullable: true }, unlistedRelation: { type: "array", items: { type: "string" } }, note: { type: "string" } }, required: ["conveysPrimary", "valueBeyondNarration"] },
    lostInformation: { type: "array", items: { type: "string" } },
  },
  required: ["verdicts", "message"],
}

export type VerificationClaim = { id: string; text: string; stance: string; refs: string[]; /** `NARRATIVE_FORMATTING_V1`: a frase já é item de lista. */ listItem?: boolean }

export function renderVerificationUserTurn(brief: FeedbackBrief, claims: readonly VerificationClaim[], options: { previousApproved?: readonly string[] } = {}): string {
  const primary = primaryPointOf(brief)
  return [
    "FATOS DO CASO (JSON):",
    JSON.stringify(verificationFactsOf(brief), null, 1),
    "",
    ...(primary ? [`PONTO PRINCIPAL (primaryPoint): ${primary.ref} — ${primary.title}`, ""] : []),
    ...((options.previousApproved ?? []).length > 0 ? ["FRASES APROVADAS DA VERSÃO ANTERIOR (previousApproved):", ...options.previousApproved!.map((text) => `- ${text}`), ""] : []),
    "ITENS A CONFERIR (JSON):",
    JSON.stringify(claims, null, 1),
  ].join("\n")
}

/**
 * COERÊNCIA DO CONJUNTO (`FEEDBACK_COHERENCE_V1`): quando uma frase recusada sai do rascunho, o que sobrou é conferido como UM
 * texto — referência pendurada, condição perdida, conclusão invertida ou contraditória, mensagem que deixou de fazer sentido.
 */
export const COHERENCE_SYSTEM_PROMPT = `Você confere se um retorno de feedback, do qual algumas frases foram retiradas por não serem sustentadas pelos fatos, continua coerente e fiel aos FATOS do caso quando lido como um texto só.

Responda coherent = false se qualquer um destes acontecer:
- DANGLING_REFERENCE: uma frase se refere a algo que não está mais no texto ("isso", "nesse caso", "também") e fica sem sentido;
- LOST_CONDITION: uma orientação ficou sem a condição ou o momento que a tornava correta (a regra só vale "quando…", e o texto agora manda fazer sempre);
- INVERTED_MEANING: o sentido do texto ficou invertido ou contradiz os fatos (ex.: o que era alternativa virou obrigação; um acerto parece falha);
- CONTRADICTION: duas frases restantes se contradizem;
- INCOMPLETE: o texto começa ou termina de um jeito que não se sustenta sozinho.
Se o texto se lê bem e continua fiel aos fatos, coherent = true e problems vazio.
Responda somente com o JSON do schema.`

export const COHERENCE_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: { coherent: { type: "boolean" }, problems: { type: "array", items: { type: "object", properties: { kind: { type: "string", enum: ["DANGLING_REFERENCE", "LOST_CONDITION", "INVERTED_MEANING", "CONTRADICTION", "INCOMPLETE"] }, note: { type: "string" } }, required: ["kind"] } } },
  required: ["coherent", "problems"],
}

export function renderCoherenceUserTurn(brief: FeedbackBrief, message: { paragraphs: readonly string[]; card: string }): string {
  return ["FATOS DO CASO (JSON):", JSON.stringify(verificationFactsOf(brief), null, 1), "", "TEXTO FINAL (depois das retiradas):", message.paragraphs.join("\n\n"), "", `RESUMO (card): ${message.card}`].join("\n")
}

export function parseCoherence(text: string): { ok: true; coherent: boolean; problems: { kind: string; note: string | null }[] } | { ok: false; error: string } {
  try {
    const raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1")) as { coherent?: unknown; problems?: unknown }
    if (typeof raw.coherent !== "boolean") return { ok: false, error: "COHERENT_MISSING" }
    const problems = Array.isArray(raw.problems) ? raw.problems.flatMap((entry) => (entry && typeof entry === "object" && typeof (entry as { kind?: unknown }).kind === "string" ? [{ kind: (entry as { kind: string }).kind, note: typeof (entry as { note?: unknown }).note === "string" ? (entry as { note: string }).note : null }] : [])) : []
    // "Coerente" com problema listado = resposta inconsistente → não coerente (na dúvida, não publica).
    return { ok: true, coherent: raw.coherent && problems.length === 0, problems }
  } catch {
    return { ok: false, error: "MALFORMED_JSON" }
  }
}
