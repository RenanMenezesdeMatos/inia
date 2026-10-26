import { SELECTION_REASON_LABEL, type BriefBasePractice, type BriefFinding, type BriefQuote, type FeedbackBrief } from "./feedback-brief.js"
import { quoteIdsOf, quoteSentencesOf } from "./literal-quotes.js"
import { phrasingProductOf } from "./product-applicability.js"

/**
 * PROMPTS DA COMPOSIÇÃO. V27/V25 (`LITERAL_QUOTES_V1`, 21/10/2026): o redator cita fala da chamada só pela referência ([[Q3]]) e o
 * sistema coloca o texto exato; ele não escreve mais exemplo de como dizer (o "como dizer" é só a fraseologia do argumentário, colada pelo
 * sistema); linguagem simples como princípio (ordem direta, frases curtas, palavras do dia a dia, termos da operação como a regra escreve);
 * o verificador julga o uso da fala, não a grafia, e recusa fala ao cliente escrita pelo redator. V25/V23 (`PLAIN_LANGUAGE_V1`): o verificador recusa a paráfrase que troca a ação ou um termo da operação escrito
 * na regra; o texto do redator é o da V24 (a seção de linguagem simples avaliada em 21/10 saiu: falas literais sumiam do texto e a
 * leitura não melhorou — o redator nunca mexe em trecho literal, regra, argumentário nem sugestão de como falar). V24/V22 = regra de argumentário "pode" chega marcada [pode — opcional …] (`ARGUMENT_REQUIREMENT_V1`): nunca
 * apresentada como exigência; feita, é iniciativa. V20/V18 = exemplo obrigatório quando o ponto tem fraseologia do argumentário; protocolo/telefone/documento só das
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
- Falas da chamada (quotes, exampleQuotes, scenarioQuotes, saidIn, steps) vêm com id (Q1, Q2…); a fala com mais de uma frase traz também as partes (Q3.1, Q3.2…). Para citar, escreva só a referência entre colchetes duplos e o sistema coloca a fala exata, entre aspas. A fala entra como fala de quem disse: o verbo de quem falou vem logo antes da referência — "você respondeu [[Q3]]", "o cliente perguntou [[Q2]]", "você disse [[Q4.2]]". Cite só o trecho que importa para o ponto: numa fala longa, a parte dela. Nunca escreva uma fala por conta própria: o que estiver entre aspas e não for igual ao que está na chamada ou na regra é recusado.
- Leia cada regra junto com a frase que abre a lista (antes de "…": a condição, "avaliar:", "informar:") e com sameList (os outros itens da mesma lista e como foram avaliados). Alternativa não escolhida não é obrigação.
- steps: quando um ponto junta várias etapas (o caminho do atendimento ou várias etapas da mesma seção), cada etapa vem com o próprio status confirmado, as falas da chamada ou absentInCall (a etapa não aparece na conversa). São fatos: de cada etapa que você comunicar, dá para dizer o que aconteceu ou o que faltou.
- "analysisReading" é o CONTEXTO que a análise escreveu: a situação do cliente e o que aconteceu em cada ponto (explanation). Use para entender o caso e contar o que aconteceu, com as suas palavras; ele pode estar errado ou exagerado — vale só o que as falas, a regra e o status confirmam. Ele não diz o que fazer: o que fazer vem só da regra do ponto. Não leve para o texto os adjetivos nem os julgamentos dele sobre a pessoa ou o atendimento; promessa, desconto, canal, prazo, condição, consequência ou causa que não está nos fatos, ignore.
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
- Regras de "Argumentário: …" são orientações da operação: o que elas pedem para comunicar pode ter sido dito com outras palavras (paráfrase cumpre); nunca cobre uma frase específica e nunca trate o que é "pode" como obrigação. Regra marcada [pode — opcional …] nunca é apresentada como exigência ("o procedimento pede", "é preciso"): quando feita, reconheça como iniciativa.
- product (nos pontos): o produto do pedido a que o ponto pertence, como a análise o estabeleceu. Com mais de um pedido na chamada, diga cada ponto no pedido dele — nunca o de um produto no pedido de outro. Regra marcada [vale para: …] vale só para esses produtos: nunca a aplique a outro produto. Ao dizer o que é certo (o prazo, o valor, o canal), use a regra do produto do ponto.
- suggestedPhrasing (nos pontos de desenvolvimento): a fala que o argumentário da operação sugere para esse momento — texto oficial. Com forProduct, a fala é a do argumentário daquele produto: use-a só para esse produto. O sistema mostra essa fala, exatamente como está, junto do ponto: não a reescreva, não a adapte e não escreva outra fala ao cliente. Você pode dizer que a operação orienta conduzir esse momento assim (GUIDANCE com a ref do ponto).

COMO ESCREVER
- Comece com uma introdução curta, de uma ou duas frases, que situe a pessoa: o que o cliente precisava nesta chamada (pelos fatos e pelas falas dele) e qual é o ponto principal deste retorno (primaryPoint), dito pelo que aconteceu na chamada e com as palavras do caso (o título do ponto é rótulo interno) — stance CONTEXT, no primeiro parágrafo. Sem frase genérica sobre o retorno em si; o que aconteceu em cada ponto vem depois.
- Fale com a pessoa ("você"), em português do Brasil, como numa conversa. Use linguagem simples: ordem direta (quem fez o quê), frases curtas com uma ideia cada e palavras do dia a dia; os termos da operação (documentos, dados, papéis, setores, produtos) ficam como a regra escreve. Você decide a organização, o tom e a extensão pelo caso — não existe sequência obrigatória (elogio, crítica, recomendação), nem número de parágrafos, nem necessidade de comentar cada ponto ou de citar todo número. Sem títulos, saudação ou despedida prontas, sem o nome da pessoa.
- Formatação que facilita a leitura (você decide pelo caso): uma frase com format BULLET (ou NUMBERED, só quando a ordem importa) vira item de lista dentro do parágrafo dela — use quando há itens paralelos: os documentos ou dados corretos de uma lista, os passos do que fazer na próxima chamada, dois ou mais ajustes do mesmo momento. Quando a pessoa precisa saber uma relação de três ou mais itens que a regra traz (os documentos certos, os dados a confirmar), escreva essa relação em lista — um item por frase —, nunca numa frase corrida. Cada item é uma frase completa; a frase que apresenta a lista vem antes, no mesmo parágrafo, sem format. Uma lista de um item só não é lista. **Negrito** (dois asteriscos de cada lado) só para a expressão curta que a pessoa precisa guardar — o que fazer, o dado correto, em poucas palavras —, no máximo um por parágrafo e nunca a frase inteira (o sistema retira negrito longo ou repetido). Nada disso é obrigatório: um texto corrido bem escrito, sem marca nenhuma, é um bom retorno. Nenhuma outra marca (títulos, tabelas, links, código, citação); o card é texto puro.
- Um assunto por parágrafo: cada ajuste (ou cada etapa de steps que você comunicar) fica no seu parágrafo; o que aconteceu no MESMO momento da chamada pode ficar junto. Um parágrafo que mistura momentos diferentes da chamada fica difícil de seguir. Cada parágrafo abre dizendo de que momento da chamada ele fala ("Logo depois do relato do cliente, …", "Na validação dos dados, …", "Antes de transferir, …"), para ser entendido sozinho.
- Todo ajuste diz o que aconteceu nesta chamada antes do que fazer: o que foi feito no lugar (quando foi algo dito, a fala pela referência) ou que a etapa não aconteceu. Orientação solta ("ofereça X", "informe Y") deixa a pessoa sem saber se errou ou se é só uma dica.
- Quando o ajuste é um CONTEÚDO dito diferente do que a regra define (o prazo, o valor, o canal) ou dito de forma vaga no lugar do que a regra define, diga o que foi dito nesta chamada e qual é o correto pela regra, com o valor que a regra traz: a pessoa precisa sair sabendo o prazo (ou o valor, o canal) certo.
- Quem ligou é "o cliente" / "a cliente" — nunca "a pessoa" nem "o usuário" (a pessoa é quem lê o retorno). Fala da chamada só entra pela referência ([[Q…]]); as aspas, o sistema põe.
- Os pontos vêm em ordem de importância para ESTE caso (primaryPoint é o principal): comece pelo que importa para a necessidade do cliente e para a decisão que o caso exigia. Todo ponto de desenvolvimento (A-n) precisa ser comunicado — cada um é uma conduta confirmada nesta chamada (pontos do mesmo momento podem ser ditos juntos); o que é seu é a ordem, a forma e o quanto detalhar. Todos os acertos confirmados (S-n) já aparecem para a pessoa nos detalhes ("O que manter"), com a fala da chamada: no texto, reconheça só a escolha que fez diferença neste caso — acerto de rotina (validação, saudação, despedida) fica nos detalhes. Isso vale quando há o que ajustar; sem ponto a ajustar, o retorno é um reconhecimento (regra abaixo).
- Reconhecimento, quando houver, é específico e proporcional: a decisão ou a prática concreta que fez diferença nesta situação e o que ela significou para o cliente segundo os fatos (sem consequência que os fatos não trazem). Nada de "excelente", "ótima condução" ou elogio superlativo para etapa de rotina. Correção explica a conduta relevante naquele momento e uma alternativa praticável (o que fazer, quando, em que condição). Misture os dois só quando os dois importam; não force elogio para acompanhar uma correção nem correção quando o caso só sustenta reconhecimento.
- Retorno sem ponto a ajustar (nenhum A-n; whatTheFactsContain RECOGNITION): o retorno é um reconhecimento. Logo no início, reconheça — pode dar os parabéns — já com a conduta concreta que estava certa ("Parabéns: você [o que foi feito], como a operação pede"). Nunca diga que o atendimento inteiro seguiu tudo: só os pontos dos fatos foram avaliados. Depois, destaque a escolha que mais fez diferença para o cliente neste caso, com a fala pela referência e o que a regra pede naquele momento; os outros acertos podem vir juntos, numa frase, sem listar etapa por etapa. Sem superlativo vazio e sem consequência que os fatos não trazem.
- Num ponto feito só em parte, você pode reconhecer o que foi feito (stance RECOGNITION com a ref desse ponto, se sameList mostra itens cumpridos) e dizer o que faltou.
- Não narre a chamada passo a passo nem liste o que foi feito ("você confirmou…, depois…, e ainda…"). Interprete: por que aquele momento importou, o que muda da próxima vez. Reconhecimento é da ESCOLHA ou da comunicação que fez diferença NESTE caso, dita uma vez.
- Diga em palavras comuns o que aconteceu com o cliente — nunca o vocabulário técnico do procedimento ("enquadrar o caso na exceção", "caracterizar a exceção", "envio assistido", "fluxo de contingência", "tratativa").
- Uma etapa só declarada pelo operador (declaredOnly), uma ação feita em sistema ou um ponto não avaliado nunca é motivo de elogio nem de cobrança.
- notVerifiableByRecording: ações feitas em sistema/registro, fora da conversa — a gravação não mostra se aconteceram, nem quando o operador diz que fez (operatorSaidItWasDone). Não as apresente como feitas, nem como base ou consequência de outra coisa ("respaldando a verificação…", "depois de corrigir o status…"), nem como falha.
- saidIn: a fala em que o operador CONTOU ao cliente essa ação ou o resultado dela. Ela comprova o que foi dito — nunca que a ação aconteceu nem que o estado relatado é real. Escreva como fala ("você informou à cliente que…"), nunca tomando o conteúdo dela como fato apurado, nem como premissa de outra frase.
- evaluatedPart: o ponto avalia só essa parte (o que acontece na conversa); a parte da mesma etapa feita em sistema está em notVerifiableByRecording e não é assunto de elogio nem de cobrança.
- centralNeedOpen: a gravação não permitiu concluir se a orientação sobre a necessidade principal do cliente ficou completa. Não diga que o problema, a dúvida ou o atendimento foram resolvidos ou encerrados por completo, nem que a pessoa deixou de orientar — o assunto pode ficar de fora; se entrar, só como o que vale comunicar ao cliente nessa situação, como a regra pede.
- productScope: identified traz o produto (ou a família) que a gravação estabeleceu para o pedido do cliente — pode ser dito pelo nome. Fora dele, não afirme nem sugira qual era o produto (undeterminedRequests: pedidos cujo produto a gravação não estabeleceu). rulesNotEstablished são regras que dependem de um produto não estabelecido: não cobre, não oriente e não reconheça o que elas pedem — elas não fazem parte deste retorno. Produto não confirmado nunca é falha de quem atendeu.
- notAssessedInSameList: itens da MESMA lista da regra que ninguém avaliou nesta chamada. O reconhecimento vale só para o que foi feito: diga o que foi feito, sem estender o elogio ao momento ou à lista inteira ("fechou bem o atendimento", "as orientações ficaram claras", "informou tudo").
- "Não se viu padrão", "nenhuma etapa descumprida nas chamadas analisadas" ou limites de amostra NUNCA são reconhecimento: não diga que as chamadas correram bem, sem problemas ou sem desvios. Se os fatos só sustentam o resultado do indicador, reconheça o resultado (os números oficiais) sem descrever as chamadas como boas e sem apresentar isso como diagnóstico.
- Cada ideia aparece uma vez: se duas frases dizem o mesmo, junte numa só mantendo o detalhe concreto do caso (qual fatura, qual cobrança, em que momento). Linguagem de supervisor conversando, nunca de auditoria ("regra de negócio", "fluxo", "critério", "item", "conforme previsto", "cumpriu o procedimento").
- exampleQuotes (padrões do indicador) são falas de UMA chamada cada: o que a etapa pede vale para o padrão ("em 4 de 6 chamadas…"), mas o conteúdo específico da fala (prazo, canal, valor, nome de produto) vale só para aquela chamada — nunca diga que esse conteúdo apareceu em todas as chamadas do padrão. Cada fala de exemplo traz o produto e a regra da PRÓPRIA chamada (productInThisCall, ruleInThisCall): ao citar uma fala, diga o que estava errado nela pela regra dela — nunca pela regra ou pelo produto de outra chamada do padrão (a fala do prazo de uma chamada de Banda Larga não é erro do prazo do IP Dedicado). Se a regra da chamada não mostra o erro da fala, não use essa fala.
- Indicador com resultado bom: o número sozinho ensina pouco. Quando os fatos trazem, diga também a conduta concreta que apareceu nas chamadas analisadas da pessoa (S-n, com o denominador) e uma prática dos colegas com melhor resultado que vale reforçar (P-n) — sem ligar nenhuma delas ao número como causa. Fatos técnicos das ferramentas ("baseline", "pontos fora", "buckets", volume total em segundos) são para você entender o caso: ao colaborador, só em palavras comuns e só se ajudarem.
- Indicador: parta do que a investigação mostrou (onde e quando mudou, o que se viu nas chamadas, o contexto); se os fatos não sustentam uma causa, diga isso — sem conselho genérico ("seja mais rápido", "se organize", "seja mais proativo") e sem atribuir à pessoa uma variação que os dados não explicam. Aproximação pelas chamadas é aproximação, não o valor oficial — diga em palavras comuns de onde vem o número (pela duração das suas chamadas gravadas), sem jargão como "medição das chamadas registradas".

O QUE NUNCA FAZER
- Acrescentar fatos, números, consequências, causas, intenções, frequências ("sempre", "costuma") ou certezas. Histórico e números só como estão escritos.
- Transformar finalidade ou expectativa em garantia: "isso garante/assegura/evita/impede X" só se o fato disser. "Por que importa" só com o porquê que a regra ou as falas dão.
- Afirmar como feita uma ação só declarada (declaredOnly: "você informou que..."), ou como falha algo que não é um ponto de desenvolvimento.
- Dizer que um comportamento causou o resultado de um indicador, prometer resultado ou sugerir pular uma etapa para ganhar tempo.
- Usar qualquer expressão da lista prohibitedClaims. Citar códigos (A1, S1), numeração de seções, "a análise" ou "o sistema".
- Escrever uma fala ao cliente (como ele deveria ter dito): a fala sugerida é só a do argumentário, que o sistema mostra.
- Usar protocolo, número de atendimento, telefone ou documento que aparece no texto de uma regra: ali é exemplo ilustrativo do procedimento, nunca dado deste cliente — numa frase, só os que estão nas falas desta chamada.

SAÍDA
- sentences: cada frase com stance e refs. CONTEXT (situação/fatos do caso; refs opcionais, P-n quando usar a prática dos colegas), RECOGNITION (o que foi bem; refs S-n, ou A-n para a parte feita de um ponto parcial), ADJUSTMENT (o que precisa mudar; refs A-n), GUIDANCE (como fazer da próxima vez; refs A-n, O-n ou P-n), VALUE (por que importa, só com base nos fatos; refs A-n, S-n ou P-n). paragraph agrupa frases do mesmo parágrafo.
- format (opcional, por frase): BULLET ou NUMBERED para item de lista; sem format = texto corrido.
- card: 1 a 2 frases curtas (até 220 caracteres) com o essencial, com refs, sem nenhuma marca de formatação.
Responda somente com o JSON do schema.`

export const COMPOSITION_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    sentences: { type: "array", items: { type: "object", properties: { text: { type: "string" }, stance: { type: "string", enum: ["CONTEXT", "RECOGNITION", "ADJUSTMENT", "GUIDANCE", "VALUE"] }, refs: { type: "array", items: { type: "string" } }, paragraph: { type: "integer" }, format: { type: "string", enum: ["BULLET", "NUMBERED"] } }, required: ["text", "stance", "refs", "paragraph"] } },
    card: { type: "object", properties: { text: { type: "string" }, refs: { type: "array", items: { type: "string" } } }, required: ["text", "refs"] },
  },
  required: ["sentences", "card"],
}

const who = (quote: BriefQuote) => (quote.speaker === "OPERATOR" ? "você" : quote.speaker === "CUSTOMER" ? "cliente" : "outro")
/** Ids das falas do caso (`LITERAL_QUOTES_V1`): o redator cita por eles e o sistema coloca o texto exato. */
type QuoteIds = ReadonlyMap<string, string>
const quoteFactOf = (quote: BriefQuote, ids: QuoteIds) => {
  const id = ids.get(quote.text) ?? null
  const sentences = quoteSentencesOf(quote.text)
  // Fala com mais de uma frase: as partes têm id próprio — numa fala longa, o redator cita só a frase que importa.
  return { id, who: who(quote), text: quote.text, ...(id && sentences.length > 1 ? { parts: sentences.map((sentence, index) => ({ id: `${id}.${index + 1}`, text: sentence })) } : {}) }
}
const STATUS_WORDS: Record<string, string> = { NOT_MET: "não cumprida (confirmado)", PARTIAL: "cumprida só em parte (confirmado)", MET: "cumprida (confirmado)", NOT_OBSERVABLE: "não observável na conversa", NOT_APPLICABLE: "não se aplicava", NOT_ASSESSED: "não avaliada", PATH_INCORRECT: "caminho inadequado para o cenário", PATH_PARTIAL: "caminho certo com etapas faltando", PATH_CORRECT: "caminho adequado para o cenário", PATTERN: "padrão nas chamadas analisadas", RESULT: "resultado oficial" }

/** Regra como FATO: origem (argumentário) + seção + abertura da lista + texto literal; numa regra composta, a parte avaliada. */
const ruleFactOf = (rule: BriefFinding["rules"][number]) => `${(rule.appliesTo ?? []).length > 0 ? `[vale para: ${rule.appliesTo!.join(", ")}] ` : ""}${rule.avoid ? "[evitar — a operação pede para NÃO fazer isto] " : ""}${rule.requirement === "OPTIONAL" ? "[pode — opcional: fazer é iniciativa, não fazer não é falha] " : ""}${rule.sourceKind ? `[${rule.documentTitle}${rule.section ? ` — ${rule.section}` : ""}] ` : rule.section ? `[${rule.section}] ` : ""}${rule.leadIn ? `${rule.leadIn} … ` : ""}${rule.text}${rule.part ? ` (parte avaliada neste ponto: “${rule.part}”)` : ""}`

/** FATOS de uma etapa de um ponto consolidado (`CONSOLIDATED_STEPS_V1`). */
const stepFactsOf = (step: NonNullable<BriefFinding["steps"]>[number], ids: QuoteIds) => ({
  title: step.title,
  status: STATUS_WORDS[step.status] ?? step.status,
  ...(step.quotes.length > 0 ? { quotes: step.quotes.map((quote) => quoteFactOf(quote, ids)) } : {}),
  absentInCall: step.absentInCall,
  declaredOnly: step.declaredOnly,
  ...((step.rules ?? []).length > 1 ? { rule: step.rules!.map(ruleFactOf) } : step.rule ? { rule: ruleFactOf(step.rule) } : {}),
})

/** `ARGUMENT_PHRASING_V1`: fraseologias dos argumentários de origem das regras do ponto (e das etapas de um ponto consolidado), sem repetir.
 * `PRODUCT_IN_FEEDBACK_V1`: num padrão do indicador, a fala vem de cada chamada (a versão que ela usou); `forProduct` só quando o argumentário
 * vale para produtos específicos (`phrasingProductOf`) — fala de argumentário geral não é "de um produto". */
const phrasingsOf = (finding: BriefFinding) => {
  const seen = new Set<string>()
  const fromRules = [...finding.rules, ...(finding.steps ?? []).flatMap((step) => step.rules ?? (step.rule ? [step.rule] : []))].map((rule) => ({ rule, product: finding.product ?? null }))
  const fromCalls = finding.quotes.flatMap((quote) => (quote.call ? [{ rule: quote.call.rule, product: quote.call.product }] : []))
  return [...fromRules, ...fromCalls].flatMap(({ rule, product }) => (rule.phrasing && !seen.has(rule.phrasing.text) && seen.add(rule.phrasing.text) ? [{ from: `Argumentário: ${rule.phrasing.scriptName}`, text: rule.phrasing.text, ...((forProduct) => (forProduct ? { forProduct } : {}))(phrasingProductOf(rule.appliesTo, product)) }] : []))
}

/** FATOS de um ponto — o que pode sustentar uma frase. */
const factsOf = (finding: BriefFinding, ids: QuoteIds) => ({
  ref: finding.ref,
  title: finding.title,
  ...(finding.product ? { product: finding.product } : {}),
  materiality: finding.materiality,
  status: STATUS_WORDS[finding.status] ?? finding.status,
  observed: finding.observed,
  // Padrão do indicador: as falas são EXEMPLOS de uma ou duas chamadas — o conteúdo delas (prazo, canal, valor) não vale para o padrão inteiro.
  // `PATTERN_EXAMPLE_CONTEXT_V1`: a fala de exemplo vem com os produtos e a regra da PRÓPRIA chamada — nunca lida contra a regra de outra.
  ...(finding.status === "PATTERN" ? { exampleQuotes: finding.quotes.map((quote) => ({ ...quoteFactOf(quote, ids), scope: "exemplo de uma chamada do padrão", ...(quote.call ? { productInThisCall: quote.call.product ?? "não estabelecido", ruleInThisCall: ruleFactOf(quote.call.rule) } : {}) })) } : { quotes: finding.quotes.map((quote) => quoteFactOf(quote, ids)) }),
  absentInCall: Boolean(finding.absence),
  declaredOnly: finding.declaredOnly,
  rule: finding.rules.map(ruleFactOf),
  ...(finding.kind === "DEVELOPMENT" && phrasingsOf(finding).length > 0 ? { suggestedPhrasing: phrasingsOf(finding) } : {}),
  ...((finding.sameList ?? []).length > 0 ? { sameList: finding.sameList!.map((sibling) => ({ text: sibling.text, status: STATUS_WORDS[sibling.status] ?? sibling.status })) } : {}),
  ...((finding.steps ?? []).length > 0 ? { steps: finding.steps!.map((step) => stepFactsOf(step, ids)) } : {}),
  ...((finding.notAssessedInSameList ?? []).length > 0 ? { notAssessedInSameList: finding.notAssessedInSameList } : {}),
  ...(finding.evaluatedPart ? { evaluatedPart: finding.evaluatedPart } : {}),
  ...(finding.history ? { history: finding.history } : {}),
  ...(finding.stats.length > 0 ? { stats: finding.stats } : {}),
  ...(finding.ruleBasis ? { ruleBasis: finding.ruleBasis } : {}),
  ...(finding.kind === "DEVELOPMENT" && finding.firmness ? { firmness: { level: finding.firmness.level, basis: finding.firmness.basis, ...((finding.firmness.dueTo ?? []).length > 0 ? { dueTo: finding.firmness.dueTo } : {}) } } : {}),
})

/** Ponto em aberto (O-n): o que a conversa NÃO permite concluir — regra literal, falas que o ligam ao caso e o motivo (frase do sistema). */
const openPointFactsOf = (point: NonNullable<FeedbackBrief["openPoints"]>[number], ids: QuoteIds) => ({ ref: point.ref, title: point.title, status: "não dá para concluir pela conversa", why: point.why, rule: point.rules.map(ruleFactOf), quotes: point.quotes.map((quote) => quoteFactOf(quote, ids)) })
/** O ponto principal do caso (o primeiro ajuste, ou o primeiro reconhecimento — a ordem do brief é a importância NESTE caso). */
export function primaryPointOf(brief: FeedbackBrief): { ref: string; title: string } | null {
  const primary = brief.developments[0] ?? brief.strengths[0] ?? null
  return primary ? { ref: primary.ref, title: primary.title } : null
}

/** CONTEXTO escrito pela análise de um ponto (o que aconteceu) — hipótese, não fato. `ANALYSIS_CONTEXT_ONLY_V1`: a orientação sugerida e o
 * "por que importa" da análise não vão ao redator (era por eles que entravam ações que nenhuma regra traz); continuam gravados e conferidos. */
const readingOf = (finding: BriefFinding) => (finding.reading ? { ref: finding.ref, explanation: finding.reading } : null)

/** Ações que acontecem em sistema/registro (fora da conversa): a gravação não mostra se foram feitas — nem quando o operador diz que fez. */
const notVerifiableOf = (brief: FeedbackBrief, ids: QuoteIds) => ((brief.coverageLimits ?? []).filter((limit) => limit.reason === "OUTSIDE_CONVERSATION").length > 0
  ? { notVerifiableByRecording: brief.coverageLimits!.filter((limit) => limit.reason === "OUTSIDE_CONVERSATION").map((limit) => ({ action: limit.title, operatorSaidItWasDone: limit.executionClaim === "DECLARED", ...(limit.saidIn?.length ? { saidIn: limit.saidIn.map((quote) => ({ id: ids.get(quote.quote) ?? null, turn: quote.turn, text: quote.quote })) } : {}) })) }
  : {})

/** `PRODUCT_APPLICABILITY_V1`: produto estabelecido (nome do cadastro) e regras que dependem de um produto não estabelecido — fato para o
 * redator e o verificador (a hipótese de produto nunca é fato; a regra suspensa nunca é cobrada, orientada nem reconhecida). */
const productScopeFactsOf = (brief: FeedbackBrief) => (brief.productScope
  ? { productScope: { identified: brief.productScope.identified.map((entry) => (entry.kind === "FAMILY" ? `${entry.name} (família; produto exato não estabelecido)` : entry.name)), ...(brief.productScope.undetermined > 0 ? { undeterminedRequests: brief.productScope.undetermined } : {}), ...(brief.productScope.rulesNotEstablished.length > 0 ? { rulesNotEstablished: brief.productScope.rulesNotEstablished.map(ruleFactOf) } : {}) } }
  : {})

/** Necessidade central sem conclusão confirmada (`CENTRAL_NEED_V1`): fato para o redator e o verificador, com as regras literais. */
const centralNeedOf = (brief: FeedbackBrief) => (brief.centralNeedOpen ? { centralNeedOpen: { status: "a gravação não permitiu concluir se a orientação sobre a necessidade principal do cliente ficou completa", rule: brief.centralNeedOpen.rules.map(ruleFactOf) } } : {})

/** Prática do grupo de referência (P-n) como FATO agregado: regra literal, o número do grupo e o da pessoa (ou a ausência de avaliação). */
const referencePracticeFactsOf = (practice: NonNullable<FeedbackBrief["referencePractices"]>[number]) => ({ ref: practice.ref, title: practice.title, rule: ruleFactOf(practice.rule), group: practice.group, you: practice.you, contrast: practice.contrast })
const referencePracticesOfBrief = (brief: FeedbackBrief) => ((brief.referencePractices ?? []).length > 0 ? { referencePractices: brief.referencePractices!.map(referencePracticeFactsOf) } : {})

/**
 * `BASE_PRACTICES_IN_TEXT_V2`: prática da base de boas práticas (B-n) como FATO do sistema — sem prática, a chave não existe. O REDATOR
 * recebe só o que serve ao texto: o que fazer, o assunto, onde isso aparece mais EM PALAVRAS e o que as chamadas da pessoa mostram em
 * palavras (nada de período, contagem, porcentagem nem o nome do padrão — na V1 a frase técnica ia inteira para o texto). O VERIFICADOR
 * recebe também a associação com os números, para conferir a comparação.
 */
const writerBasePracticeFactsOf = (practice: BriefBasePractice) => ({ ref: practice.ref, howTo: practice.howTo, subject: practice.subject, ...(practice.product ? { product: practice.product } : {}), whereItShowsUp: practice.whereItShowsUp, ...(practice.howItHelps ? { howItHelps: practice.howItHelps } : {}), you: practice.youInWords, ...(practice.suggestedPhrasing ? { suggestedPhrasing: practice.suggestedPhrasing } : {}), ...(practice.notApplicableWhen ? { notApplicableWhen: practice.notApplicableWhen } : {}) })
const verifierBasePracticeFactsOf = (practice: BriefBasePractice) => ({ ref: practice.ref, name: practice.name, howTo: practice.howTo, subject: practice.subject, ...(practice.product ? { product: practice.product } : {}), ...(practice.howItHelps ? { howItHelps: practice.howItHelps } : {}), outcome: practice.outcome, whereItShowsUp: practice.whereItShowsUp, association: practice.association, you: practice.you, ...(practice.suggestedPhrasing ? { suggestedPhrasing: practice.suggestedPhrasing } : {}), ...(practice.notApplicableWhen ? { notApplicableWhen: practice.notApplicableWhen } : {}) })
const basePracticesOfBrief = (brief: FeedbackBrief, factsOf: (practice: BriefBasePractice) => Record<string, unknown>) => ((brief.basePractices ?? []).length > 0 ? { basePractices: brief.basePractices!.map(factsOf) } : {})
const hasBasePractices = (brief: FeedbackBrief) => (brief.basePractices ?? []).length > 0

/** Payload do REDATOR: fatos + leitura (separada e marcada). Sem ids, sem links, sem nomes (lista branca). */
export function compositionPayloadOf(brief: FeedbackBrief) {
  const findings = [...brief.developments, ...brief.strengths]
  const ids = quoteIdsOf(brief)
  return {
    domain: brief.domain,
    whatTheFactsContain: brief.tone,
    subject: brief.label,
    ...(brief.rulePerspective ? { ruleBasis: brief.rulePerspective } : {}),
    ...((brief.prohibitedClaims ?? []).length > 0 ? { prohibitedClaims: brief.prohibitedClaims } : {}),
    facts: {
      // Linha técnica (como a chamada foi escolhida) não ajuda o redator — fica no brief, fora do que ele lê.
      context: brief.context.filter((line) => !line.startsWith(SELECTION_REASON_LABEL)),
      ...((brief.scenarioQuotes ?? []).length > 0 ? { scenarioQuotes: brief.scenarioQuotes!.map((quote) => quoteFactOf(quote, ids)) } : {}),
      ...(brief.officialLines.length > 0 ? { officialResult: brief.officialLines } : {}),
      developments: brief.developments.map((finding) => factsOf(finding, ids)),
      strengths: brief.strengths.map((finding) => factsOf(finding, ids)),
      ...((brief.openPoints ?? []).length > 0 ? { openPoints: brief.openPoints!.map((point) => openPointFactsOf(point, ids)) } : {}),
      ...referencePracticesOfBrief(brief),
      ...basePracticesOfBrief(brief, writerBasePracticeFactsOf),
      ...notVerifiableOf(brief, ids),
      ...centralNeedOf(brief),
      ...productScopeFactsOf(brief),
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
  const ids = quoteIdsOf(brief)
  return {
    domain: brief.domain,
    subject: brief.label,
    ...(brief.rulePerspective ? { ruleBasis: brief.rulePerspective } : {}),
    context: brief.context,
    ...((brief.scenarioQuotes ?? []).length > 0 ? { scenarioQuotes: brief.scenarioQuotes!.map((quote) => quoteFactOf(quote, ids)) } : {}),
    ...(brief.officialLines.length > 0 ? { officialResult: brief.officialLines } : {}),
    developments: brief.developments.map((finding) => factsOf(finding, ids)),
    strengths: brief.strengths.map((finding) => factsOf(finding, ids)),
    ...((brief.openPoints ?? []).length > 0 ? { openPoints: brief.openPoints!.map((point) => openPointFactsOf(point, ids)) } : {}),
    ...referencePracticesOfBrief(brief),
    ...basePracticesOfBrief(brief, verifierBasePracticeFactsOf),
    ...notVerifiableOf(brief, ids),
    ...centralNeedOf(brief),
    ...productScopeFactsOf(brief),
    limitations: brief.limitations,
  }
}

/** Lembrete no fim do turno (`LITERAL_QUOTES_V1`): no meio do prompt longo, regra de forma pesa pouco (ensaios de 21/10). */
export const COMPOSITION_REMINDER = "LEMBRETE: fala da chamada só pela referência ([[Q…]], ou a parte [[Q….n]] numa fala longa), logo depois do verbo de quem falou (\"você respondeu [[Q3]]\"), nunca escrita por você; nenhuma fala ao cliente além da do argumentário; nada além dos fatos; linguagem simples — ordem direta, uma ideia por frase, palavras do dia a dia, termos da operação como a regra escreve."

/**
 * `BASE_PRACTICES_IN_TEXT_V2` (V35): regras das práticas da base — só no turno de um caso que TEM prática (o prompt de sistema é o da V33;
 * caso sem prática recebe exatamente o mesmo turno de antes). Decisão do usuário (22/10/2026): sem ponto a ajustar, os parabéns vêm
 * primeiro e inteiros; a prática pode vir no fim, uma no máximo, como um passo a mais. V35 (pedido do usuário, depois da 1ª monitoria
 * real: "a leitura está péssima"): a prática entra no CONTEXTO do caso, dita em palavras simples — o que fazer naquele momento, que
 * quem tem melhor resultado faz isso nesses casos e para que serve —, sem período, contagem, porcentagem nem o nome do padrão.
 */
export const BASE_PRACTICES_WRITER_RULES = `BOAS PRÁTICAS DA BASE (facts.basePractices, B-n)
- São sugestões OPCIONAIS: o que quem tem melhor resultado faz a mais no MESMO assunto deste caso (subject), revisado por uma pessoa. Não são regra do processo nem obrigação.
- Ponha a prática onde ela ajuda NESTE caso: no parágrafo do momento da chamada em que ela cabia — se uma fala mostra esse momento (o cliente com dúvida, "entendi mais ou menos", pedindo para repetir), cite-a pela referência — ou num parágrafo curto próprio, no fim. Nunca grudada em outro assunto.
- Diga em linguagem simples, numa ou duas frases: (1) o que fazer naquele momento, com as palavras do caso (a partir de howTo); (2) que quem tem melhor resultado faz isso nesses casos (whereItShowsUp, com as suas palavras); (3) se ajudar, para que serve: o que a própria ação faz pelo cliente (ele confirma que entendeu, ele fica com tudo por escrito) e, quando houver howItHelps (escrito ou aprovado por quem revisou a prática), como ela ajuda no resultado deste feedback, com as suas palavras e sem ir além de howItHelps (ex.: "isso ajuda no seu Tempo Médio de Atendimento: o cliente não precisa ficar anotando o protocolo na linha, e esse tempo sai da chamada"). Sem howItHelps, nunca ligue a prática ao resultado. Nunca prometa o resultado ("vai baixar seu TMA", "garante", "a nota sobe"). Frase GUIDANCE (ou CONTEXT) com a ref B-n, depois do que a regra do ponto pede. A correção (ADJUSTMENT) continua vindo só da regra; a prática nunca a substitui nem vira "faltou".
- Nunca: o nome da prática como rótulo ("vale experimentar checar a compreensão oferecendo…"), período, quantidade de operadores ou de chamadas, porcentagem, "nas chamadas comparáveis", "o comportamento apareceu", "o procedimento pede", "é preciso", "você deve", "sempre", "costumam"; nunca diga que a prática garante, explica ou vai melhorar o resultado — como ela ajuda, só com howItHelps.
- you: o que as chamadas da pessoa mostram, em palavras; null = não há o que dizer — não diga nem insinue o que ela faz ou deixa de fazer.
- notApplicableWhen: não sugira a prática nessas situações.
- product: a prática só foi vista em chamadas desse produto — ligue-a só a um ponto, fala ou chamada desse mesmo produto, nunca de outro.
- suggestedPhrasing é uma fala da base para EXPERIMENTAR, nunca de uma chamada. Para usá-la, escreva só a referência da prática entre colchetes duplos ([[B1]]) e o sistema coloca a fala exata, entre aspas; apresente como exemplo ("você pode perguntar, por exemplo: [[B1]]"). Nunca escreva outra fala.
- Sem ponto a ajustar (whatTheFactsContain RECOGNITION): os parabéns vêm primeiro e inteiros; no fim, no máximo UMA prática, como um passo a mais ("para ir além, …") — nunca como correção.
- Forma (não copie o conteúdo): "Quando o cliente disse [[Q5]], valia conferir se tinha ficado claro e oferecer explicar de outro jeito: nas chamadas de Reparo com nota da URA boa isso aparece bem mais, e o cliente sai com o encaminhamento entendido. Você pode perguntar, por exemplo: [[B1]]".`

export function renderCompositionUserTurn(brief: FeedbackBrief, repair: string[] | null): string {
  const lines = ["CASO (JSON):", JSON.stringify(compositionPayloadOf(brief), null, 1), "", ...(hasBasePractices(brief) ? [BASE_PRACTICES_WRITER_RULES, ""] : []), COMPOSITION_REMINDER]
  if (repair && repair.length > 0) lines.push("", "A versão anterior foi recusada pelos motivos abaixo. Escreva de novo corrigindo SÓ isso:", ...repair.map((reason) => `- ${reason}`))
  return lines.join("\n")
}

export const VERIFICATION_SYSTEM_PROMPT = `Você confere, contra os FATOS de um caso, (1) as frases de um retorno de feedback e (2) leituras propostas pela análise (orientação e "por que importa"). Seja rigorosa: só vale o que os fatos sustentam. Os fatos são: falas literais da chamada, o texto literal da regra do procedimento (rule), o status de cada ponto, números e históricos do sistema, resultado oficial e o contexto.

Marcas de formatação (**negrito**, item de lista) são só apresentação: julgue o que a frase diz.

As falas entre aspas no texto foram colocadas pelo SISTEMA, exatamente como estão na chamada (ou conferidas com a chamada e a regra por código): julgue se a frase usa a fala certa, no momento certo e atribuída a quem falou — não a grafia.

Para cada item (id F-n = frase do texto; CARD = resumo; G-… = orientação proposta; W-… = por que importa proposto), veja os fatos dos pontos que ele referencia (refs) e o contexto, e dê:
- verdict:
  SUPPORTED — diz o mesmo que os fatos (pode resumir ou reordenar);
  GENERALIZATION — abstrai de forma fiel, sem acrescentar fato nem condição;
  UNSUPPORTED_ADDITION — acrescenta fato, detalhe, número, canal, prazo, desconto, promessa, condição, consequência, causa ou intenção que não está nos fatos. Uma orientação só é SUPPORTED se a ação, o momento e a condição estiverem na regra (ou forem o óbvio de cumprir a regra naquele momento da conversa). A mesma ação dita com palavras do dia a dia é SUPPORTED; uma paráfrase mais simples que troca a ação da regra (o quê, quem faz, onde) é UNSUPPORTED_ADDITION ("passe o caso para o outro setor" no lugar de "repasse o contexto"), e também a que troca um termo da operação escrito na regra (documento, dado, papel, setor, produto, serviço) por outra palavra ("dúvida de conta" no lugar de "dúvida de faturamento");
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
  Com productScope: afirmar ou insinuar o produto (ou a família) do cliente que identified não traz é UNSUPPORTED_ADDITION; cobrar, orientar ou reconhecer o que pede uma regra de rulesNotEstablished — mesmo com outras palavras ou como "da próxima vez" — ou tratar o produto não confirmado como falha de quem atendeu é OVERREACH.
  referencePractices (P-n) são a prática AGREGADA dos colegas com melhor resultado: dizer que essa prática causou ou explica o resultado (deles ou da pessoa) é OVERREACH; dizer ou insinuar que a pessoa não faz uma etapa cuja linha you é null é CONTRADICTION; tratar como falha individual uma prática com contrast REFERENCE_ALSO_MISSES é OVERREACH; frequência além do número ("sempre", "costumam", "todos") é OVERREACH; nomear ou descrever um colega é OVERREACH; orientar a pessoa a fazer o que a regra da prática diz, citando que os colegas de melhor resultado fazem isso com o número dado, é SUPPORTED.
  Afirmar que as chamadas "correram bem", "sem desvios", "sem problemas" ou "sem erros" a partir de uma amostra, de limites da análise ou de "nenhum padrão encontrado" é OVERREACH — ausência de padrão numa amostra não é ausência de falha.
  Elogiar o que foi só declarado pelo operador (declaredOnly) como se tivesse sido feito é OVERREACH.
  exampleQuotes são falas de UMA chamada: atribuir o conteúdo específico dela (prazo, canal, valor) a todas as chamadas do padrão ("o prazo de cinco dias… nas 4 chamadas") é OVERREACH; dizer que a etapa foi cumprida (ou não) no número de chamadas do padrão é SUPPORTED. Cada fala de exemplo traz productInThisCall e ruleInThisCall: ligar a fala à regra ou ao produto de OUTRA chamada (dizer que a fala de uma chamada contraria o que a regra de outro produto define) é CONTRADICTION; dizer o erro dela pela regra da própria chamada é SUPPORTED.
  Julgar a PESSOA em vez da conduta ("descuido", "desatenção", "falta de compromisso", "você não se importa", adjetivo sobre o caráter, ameaça) é OVERREACH, qualquer que seja o firmness. Dizer que um ponto "já tinha sido orientado antes" sem que o basis do firmness traga essa orientação é UNSUPPORTED_ADDITION.
  steps traz o status confirmado de cada etapa de um ponto consolidado: dizer que uma etapa com status não cumprida faltou (ou o que foi feito no lugar, pelas falas dela) é SUPPORTED; dizer que faltou uma etapa que não aparece como não cumprida nos fatos é CONTRADICTION.
  Leia a regra com a frase que abre a lista (antes de "…") e com sameList. A condição da abertura ("quando…", "se… por falha interna") é FATO da regra, não acréscimo. Se a abertura pede para AVALIAR/ESCOLHER entre itens e outro item da mesma lista foi cumprido, dizer que o item não escolhido era obrigatório ("a tratativa é X") é CONTRADICTION. Regra marcada [evitar …] é o que a operação pede para NÃO fazer: dizer que a pessoa fez o que ela descreve é SUPPORTED quando as falas mostram isso; apresentá-la como algo a fazer é CONTRADICTION. Regra marcada [pode — opcional …] apresentada como exigência ou falta é OVERREACH; reconhecê-la como iniciativa, com as falas, é SUPPORTED.
  Protocolo, número de atendimento, telefone ou documento que não aparece nas falas desta chamada — mesmo que esteja no texto de uma regra, onde é exemplo ilustrativo — é UNSUPPORTED_ADDITION.
  product e [vale para: …] são FATOS: dizer um ponto no pedido de outro produto, aplicar a regra de um produto a outro ou usar a fala (suggestedPhrasing com forProduct) de um produto para outro é CONTRADICTION.
  suggestedPhrasing é FATO: a fala oficial do argumentário da operação para aquele momento (o sistema a mostra como está). Dizer na mensagem que é assim que a operação orienta conduzir aquele momento é SUPPORTED; uma fala ao cliente escrita na frase (o que o operador deveria ter dito) que não é a do argumentário é UNSUPPORTED_ADDITION.
  Um ajuste que diz o conteúdo dito na chamada e o correto pela regra (o prazo, o valor, o canal que a regra define) é SUPPORTED; afirmar como correto um valor que a regra não traz é UNSUPPORTED_ADDITION.
- specific (para frases ADJUSTMENT, GUIDANCE e RECOGNITION e para itens G-…; null nas demais): true se nomeia uma conduta concreta ligada ao ponto (o que fazer ou o que foi feito, e em que momento ou condição); false se é conselho ou elogio genérico que serviria para qualquer atendimento, ou se só repete o jargão do procedimento sem dizer o que aconteceu.
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

/** `BASE_PRACTICES_IN_TEXT_V2` (V27): como conferir as frases que usam a prática da base — só no turno de um caso que TEM prática. */
export const BASE_PRACTICES_VERIFIER_RULES = `BOAS PRÁTICAS DA BASE (basePractices, B-n): sugestões OPCIONAIS de quem tem melhor resultado no mesmo assunto — associação, não causa, nunca obrigação. whereItShowsUp é a comparação em palavras que o sistema calculou a partir de association.
- Frase com B-n que diz o que fazer como no howTo, como sugestão, e que quem tem melhor resultado faz isso mais (como em whereItShowsUp) é SUPPORTED. Dizer para que a ação serve com o que a própria ação faz pelo cliente (confirmar que entendeu, ficar com tudo por escrito) é SUPPORTED. howItHelps é FATO aprovado por quem revisou a prática: dizer como a prática ajuda no resultado como em howItHelps ("isso ajuda no seu TMA porque…"), mesmo com outras palavras, é SUPPORTED. Ir além de howItHelps (outro efeito, outro indicador, número), ligar a prática ao resultado sem howItHelps, ou prometer o resultado ("vai baixar seu TMA", "garante", "a nota sobe"), é OVERREACH.
- Apresentar a prática como regra, exigência ou falta ("o procedimento pede", "é preciso", "você deixou de…") é OVERREACH; dizer que ela explica, garante ou vai melhorar o resultado (do grupo ou da pessoa) é OVERREACH — dizer como ela ajuda, como em howItHelps, não é; frequência além do que os fatos dizem ("sempre", "costumam", "todos") é OVERREACH.
- you = null: dizer ou insinuar que a pessoa faz ou não faz a prática é CONTRADICTION.
- A fala entre aspas igual a suggestedPhrasing foi colocada pelo sistema: apresentá-la como exemplo para experimentar é SUPPORTED; como fala desta chamada ou como o que a operação exige é CONTRADICTION.
- Sugerir a prática numa situação de notApplicableWhen é CONTRADICTION.
- Prática com product ligada a um ponto, fala ou chamada de outro produto é CONTRADICTION.`

export function renderVerificationUserTurn(brief: FeedbackBrief, claims: readonly VerificationClaim[], options: { previousApproved?: readonly string[] } = {}): string {
  const primary = primaryPointOf(brief)
  return [
    "FATOS DO CASO (JSON):",
    JSON.stringify(verificationFactsOf(brief), null, 1),
    "",
    ...(hasBasePractices(brief) ? [BASE_PRACTICES_VERIFIER_RULES, ""] : []),
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
