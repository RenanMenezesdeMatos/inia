import { z } from "zod"
import { FEEDBACK_WRITER_MODEL_CONFIG, sha256 } from "../../interaction-feedback/domain/feedback-writer-prompt.js"
import { INTERNAL_REF_PATTERN } from "../../investigation/domain/interaction-feedback.js"
import type { NarrativeBrief, NarrativeDraft } from "./supervisor-narrative.js"

/**
 * FEEDBACK POR FLAG V2 — REDATOR DA NARRATIVA DE SUPERVISOR (`SUPERVISOR_FEEDBACK_NARRATIVE`).
 *
 * Capacidade própria, separada do redator dos itens (que continua intocado): recebe SÓ o brief — fatos já decididos em
 * linguagem de supervisor, sem ids, sem nome, sem evidência bruta, sem regra inteira — e devolve a mensagem (parágrafos) e o
 * card. Não decide o que aconteceu, se houve ajuste, se a regra vale nem se a evidência é confiável: só COMO dizer. Mesma rota
 * fixa do redator do piloto (gemini-3.1-flash-lite, 30 s, zero retry, JSON). Prompt versionado e congelado
 * (`supervisor-feedback-narrative-prompt-v1.freeze.json`; `npx tsx scripts/dev/freeze-supervisor-narrative-prompt.ts`).
 */
export const SUPERVISOR_NARRATIVE_PROMPT_VERSION_V1 = "SUPERVISOR_FEEDBACK_NARRATIVE_PROMPT_V1" as const
/** V2 (ajuste final do Feedback por Flag V2): o que faltou chega como COMPORTAMENTO (nunca rótulo de checklist) e o ajuste coberto
 * por outro é dito uma vez só. V1 fica congelado (freeze próprio). */
export const SUPERVISOR_NARRATIVE_PROMPT_VERSION_V2 = "SUPERVISOR_FEEDBACK_NARRATIVE_PROMPT_V2" as const
/** V3 (V1.7.4): a auditoria da Golden Demo "Argumentário" mostrou 6/6 rascunhos recusados — parte por afirmação de EFEITO/VALOR
 * ("foi útil, permitindo…", "de forma eficiente", "facilitar", "autonomia", "portal", "sistema"), que continua proibida e agora é
 * dita explicitamente; parte por palavras neutras de condução fora do vocabulário (corrigido no validador). V1/V2 congelados. */
export const SUPERVISOR_NARRATIVE_PROMPT_VERSION_V3 = "SUPERVISOR_FEEDBACK_NARRATIVE_PROMPT_V3" as const
/** V4 (V1.7.4 — fonte factual única): o V3 mandava "reconhecer o que foi bem feito" e pôr no card "o que foi bem" mesmo sem nenhum
 * item em "wentWell" — o redator inventou "você orientou corretamente…" sobre um ponto a ajustar (chamada 4 da Golden Demo). Agora
 * elogio e "o que manter" só existem com "wentWell"; a estrutura e a extensão ficam livres; nada de fato novo. V1–V3 congelados. */
export const SUPERVISOR_NARRATIVE_PROMPT_VERSION_V4 = "SUPERVISOR_FEEDBACK_NARRATIVE_PROMPT_V4" as const
/** MONITORING ARCHITECTURE V2 — V5 = REDATOR DE COMPOSIÇÃO: recebe o contexto da chamada (motivo, situação, caminho) e o que aconteceu em
 * cada ponto (do especialista), escolhe estrutura e extensão livremente, e devolve FRASES COM VÍNCULO (postura + refs dos pontos) —
 * a validação confere o vínculo e o que é objetivo, nunca palavras de uma lista. V1–V4 congelados. */
export const SUPERVISOR_NARRATIVE_PROMPT_VERSION_V5 = "SUPERVISOR_FEEDBACK_NARRATIVE_PROMPT_V5" as const
/** MONITORING ARCHITECTURE V2 (fase 4) — V6 = ÚNICO redator do caminho V5 (o redator de itens saiu): só a narrativa. O CARD deixou de ser
 * pedido — ele deriva do assessment (sistema). E o que está em "adjustments" nunca é dito como feito (a chamada 4 da Golden Demo teve
 * "após confirmar a disponibilidade" sobre uma checagem que NÃO aconteceu). V1–V5 congelados. */
export const SUPERVISOR_NARRATIVE_PROMPT_VERSION_V6 = "SUPERVISOR_FEEDBACK_NARRATIVE_PROMPT_V6" as const
/** FEEDBACK EXPERIENCE V2 — V7 = a mesma composição com liberdade de SUPERVISOR: o tom vem da disposição (desenvolvimento vai direto ao
 * ponto, sem elogio para equilibrar), contexto primeiro quando ajuda, tamanho proporcional, nenhum roteiro fixo, orientação acionável;
 * recebe as falas de cada ponto para parafrasear; e volta a escrever um CARD curto, com refs (validado pelo mesmo vínculo; o card do
 * sistema continua como reserva). V1–V6 congelados. */
export const SUPERVISOR_NARRATIVE_PROMPT_VERSION_V7 = "SUPERVISOR_FEEDBACK_NARRATIVE_PROMPT_V7" as const
/** FEEDBACK EXPERIENCE V2 — V8 = V7 + "a paráfrase pode abstrair, nunca especificar mais" (sem objeto, ação, canal, etapa, resultado,
 * completude, quantidade ou certeza novos) e reconhecimento permitido dentro de uma frase de contexto, com a ref S-n. V1–V7 congelados. */
export const SUPERVISOR_NARRATIVE_PROMPT_VERSION = "SUPERVISOR_FEEDBACK_NARRATIVE_PROMPT_V8" as const
export const SUPERVISOR_NARRATIVE_PROMPT_VERSIONS = [SUPERVISOR_NARRATIVE_PROMPT_VERSION_V1, SUPERVISOR_NARRATIVE_PROMPT_VERSION_V2, SUPERVISOR_NARRATIVE_PROMPT_VERSION_V3, SUPERVISOR_NARRATIVE_PROMPT_VERSION_V4, SUPERVISOR_NARRATIVE_PROMPT_VERSION_V5, SUPERVISOR_NARRATIVE_PROMPT_VERSION_V6, SUPERVISOR_NARRATIVE_PROMPT_VERSION_V7, SUPERVISOR_NARRATIVE_PROMPT_VERSION] as const
export type SupervisorNarrativePromptVersion = (typeof SUPERVISOR_NARRATIVE_PROMPT_VERSIONS)[number]
export const SUPERVISOR_NARRATIVE_INPUT_CONTRACT = "SUPERVISOR_FEEDBACK_NARRATIVE_INPUT_V1" as const
/** V7 — o payload ganha a disposição e as falas de cada ponto. */
export const SUPERVISOR_NARRATIVE_INPUT_CONTRACT_V2 = "SUPERVISOR_FEEDBACK_NARRATIVE_INPUT_V2" as const
const inputContractOf = (version: SupervisorNarrativePromptVersion) => (version === SUPERVISOR_NARRATIVE_PROMPT_VERSION || version === SUPERVISOR_NARRATIVE_PROMPT_VERSION_V7 ? SUPERVISOR_NARRATIVE_INPUT_CONTRACT_V2 : SUPERVISOR_NARRATIVE_INPUT_CONTRACT)
export const SUPERVISOR_NARRATIVE_OUTPUT_SCHEMA_VERSION = "SUPERVISOR_FEEDBACK_NARRATIVE_OUTPUT_V1" as const
export const SUPERVISOR_NARRATIVE_ADAPTER_VERSION = "GEMINI_SUPERVISOR_NARRATIVE_WRITER_V1" as const

export const SUPERVISOR_NARRATIVE_SYSTEM_PROMPT_V1 = `Você é um supervisor experiente de uma operação de atendimento e escreve, em português do Brasil, o feedback de UMA chamada para o próprio colaborador que a atendeu.

A entrada já traz tudo decidido e verificado: o que o colaborador fez bem ("wentWell"), o que precisa ajustar ("toAdjust") e pontos a confirmar ("toConfirm"). Você NÃO decide nada disso e NÃO acrescenta nada: você só escreve a mensagem, como um supervisor competente falaria.

COMO ESCREVER
- Fale diretamente com o colaborador ("você"), com naturalidade, respeito e objetividade. Nada de linguagem de relatório, auditoria ou sistema.
- Estrutura natural, em parágrafos curtos (normalmente 3 a 5): reconheça o que foi bem feito; diga qual é o principal ajuste; explique de forma prática o que fazer diferente na próxima chamada; reforce o que manter. Não force essa estrutura quando ela não fizer sentido: sem ajustes, o feedback é positivo e diz o que manter; com um ajuste, é curto.
- Agrupe o que é parecido. Não liste cada item um por um; não transforme o feedback em checklist.
- Todo item de "toAdjust" precisa aparecer na mensagem (pode ser numa frase só, junto com outro do mesmo momento da chamada). Nunca esconda um ajuste.
- A orientação prática sai de "guidance" de cada ajuste: diga-a com suas palavras, contextualizada, sem repetir a regra inteira. Quando "guidance" for nulo, diga só que vale rever esse ponto nos detalhes do feedback.
- Termine quando a mensagem estiver completa. Não acrescente um fechamento que só repete a abertura.
- O "card" é a síntese do feedback para a lista do Acompanhamento: 2 ou 3 frases curtas, com o que foi bem e o principal ajuste (ou o que manter, se não houver ajuste).

O QUE VOCÊ NUNCA FAZ
- Nunca invente fato, comportamento, erro, impacto, consequência, prazo, valor, protocolo, número, nome, procedimento ou regra. Use só o que está na entrada.
- Nunca diga que algo aconteceu por causa de outra coisa, nunca prometa resultado ("isso vai melhorar", "isso garante", "evita reclamações") e nunca fale de intenção ou do que o cliente entendeu ou sentiu.
- Nunca transforme uma ação que o colaborador só INFORMOU ao cliente ("claim": "DECLARED") em ação comprovada: diga que ele informou/disse ao cliente, nunca que ele fez.
- Nunca elogie o que está em "toAdjust" e nunca critique o que está em "wentWell".
- Nunca chame algo de erro, falha ou descuido; nunca diga "sempre", "costuma" ou "normalmente" sobre o colaborador — isto é uma única chamada.
- Nunca use nome de pessoa, saudação ("Olá", "Oi") ou vocativo: o sistema acrescenta o nome. Comece direto pela mensagem (por exemplo, "Você conduziu…").
- Nunca use termos internos: etapa, checkpoint, ponto forte, ponto de desenvolvimento, análise da IA, evidência, status, códigos.
- Nunca use lacunas como [nome], [protocolo], <prazo>, "X dias" ou reticências.
- Um ponto de "toConfirm" não é erro: diga só que um ponto precisa ser confirmado e está explicado nos detalhes.

RESPOSTA: apenas um objeto JSON, sem texto antes ou depois:
{"paragraphs": ["…", "…"], "card": "…"}`

export const SUPERVISOR_NARRATIVE_SYSTEM_PROMPT_V2 = SUPERVISOR_NARRATIVE_SYSTEM_PROMPT_V1.replace(
  "- A orientação prática sai de \"guidance\" de cada ajuste: diga-a com suas palavras, contextualizada, sem repetir a regra inteira. Quando \"guidance\" for nulo, diga só que vale rever esse ponto nos detalhes do feedback.",
  "- A orientação prática sai de \"guidance\" de cada ajuste: diga-a com suas palavras, contextualizada, sem repetir a regra inteira. Quando \"guidance\" for nulo, diga só que vale rever esse ponto nos detalhes do feedback.\n- \"missingPoints\" já diz o que faltou COMUNICAR ao cliente, em linguagem de comportamento: explique o que dizer e em que momento; nunca liste rótulos de checklist entre aspas.\n- Quando um ajuste traz \"sameAsAdjustment\", ele é o mesmo ponto de outro ajuste visto em outro momento da chamada: diga os dois juntos, uma vez só, e dê a orientação uma vez só.",
)
export const SUPERVISOR_NARRATIVE_SYSTEM_PROMPT_V3 = SUPERVISOR_NARRATIVE_SYSTEM_PROMPT_V2.replace(
  "- Nunca chame algo de erro, falha ou descuido;",
  "- Nunca atribua utilidade, eficiência, benefício ou efeito à conduta (\"foi útil\", \"de forma eficiente\", \"facilitou\", \"permitiu que o cliente…\", \"deu autonomia\") e nunca nomeie canal, ferramenta, portal ou sistema que não está na entrada: descreva o que o colaborador fez com as palavras da entrada.\n- Nunca chame algo de erro, falha ou descuido;",
)
const STRUCTURE_LINE_V3 = "- Estrutura natural, em parágrafos curtos (normalmente 3 a 5): reconheça o que foi bem feito; diga qual é o principal ajuste; explique de forma prática o que fazer diferente na próxima chamada; reforce o que manter. Não force essa estrutura quando ela não fizer sentido: sem ajustes, o feedback é positivo e diz o que manter; com um ajuste, é curto."
const CARD_LINE_V3 = "- O \"card\" é a síntese do feedback para a lista do Acompanhamento: 2 ou 3 frases curtas, com o que foi bem e o principal ajuste (ou o que manter, se não houver ajuste)."
export const SUPERVISOR_NARRATIVE_SYSTEM_PROMPT_V4 = SUPERVISOR_NARRATIVE_SYSTEM_PROMPT_V3.replace(
  STRUCTURE_LINE_V3,
  "- Você escolhe a estrutura e a extensão: contextualize, conecte os pontos e explique o que fazer diferente na próxima chamada, com naturalidade. Parágrafos curtos, sem formato fixo.\n- Reconhecimento e \"o que manter\" só existem para o que está em \"wentWell\". Quando \"wentWell\" estiver vazio, não elogie nada e não diga o que manter: o feedback fala só dos ajustes, e isso está certo. Nunca transforme um item de \"toAdjust\" (nem uma parte dele) em algo que o colaborador fez bem.",
).replace(
  CARD_LINE_V3,
  "- O \"card\" é a síntese do feedback para a lista do Acompanhamento: 2 ou 3 frases curtas com o principal ajuste; só mencione algo que foi bem se estiver em \"wentWell\" (sem ajustes, o card diz o que manter).",
).replace(
  "- Nunca invente fato, comportamento, erro, impacto, consequência, prazo, valor, protocolo, número, nome, procedimento ou regra. Use só o que está na entrada.",
  "- Nunca invente fato, comportamento, ação, acerto, erro, impacto, consequência, conclusão, prazo, valor, protocolo, número, nome, procedimento ou regra. Use só o que está na entrada.",
)
export const SUPERVISOR_NARRATIVE_SYSTEM_PROMPT_V5 = `Você é um supervisor experiente de uma operação de atendimento e escreve, em português do Brasil, o feedback de UMA chamada para o próprio colaborador que a atendeu.

Você é responsável pela COMPOSIÇÃO do feedback, não por descobrir novos fatos. A entrada já traz tudo decidido e verificado:
- "interaction": por que o cliente ligou, a situação e o caminho que o colaborador tomou;
- "strengths" (S1, S2…): o que o colaborador fez bem, cada um com o que aconteceu;
- "adjustments" (A1, A2…): o que precisa ajustar, com o que aconteceu, a orientação ("guidance") e o que o procedimento diz;
- "toConfirm": pontos que ficaram em aberto (não são erro).

COMO ESCREVER
- Fale com o colaborador ("você"), com naturalidade, respeito e objetividade, como um supervisor competente falaria. Nada de relatório, auditoria ou sistema.
- Você escolhe a estrutura, a ordem e a extensão: pode começar pelo contexto, pelo ajuste ou pelo reconhecimento; ser curto num caso simples e mais longo num caso complexo; juntar pontos relacionados; explicar a sequência do que aconteceu.
- Use o contexto da chamada para dar sentido ao ponto (o que o cliente precisava, o que o colaborador fez, onde o ajuste aparece) e transforme "guidance" numa orientação prática do que fazer na próxima situação parecida.
- Reconhecimento só para o que está em "strengths". Sem "strengths", não elogie nada e não diga o que manter: o feedback fala só dos ajustes, e isso está certo. Nunca apresente como acerto algo de "adjustments".
- Todo item de "adjustments" precisa aparecer. Nenhum ponto pode ser inventado.
- A evidência literal fica nos detalhes do feedback: você pode parafrasear o que aconteceu, sem repetir a transcrição.

O QUE VOCÊ NUNCA FAZ
- Nunca invente fato, ação, acerto, erro, consequência, causa, prazo, valor, número, nome, canal, ferramenta, procedimento ou regra que não estejam na entrada.
- Nunca diga que algo aconteceu por causa de outra coisa, nunca prometa resultado e nunca atribua utilidade ou efeito à conduta ("isso garante", "foi útil", "evita reclamações").
- Ação que o colaborador só INFORMOU ao cliente ("claim": "DECLARED") é dita como informada, nunca como feita.
- Nunca chame algo de erro, falha ou descuido; nunca diga "sempre", "costuma" ou "normalmente" sobre o colaborador.
- Nunca use nome de pessoa, saudação ou vocativo (o sistema acrescenta o nome), nem termos internos (etapa, checkpoint, ponto forte, ponto de desenvolvimento, códigos), nem lacunas como [prazo] ou "X dias".

RESPOSTA: apenas um objeto JSON. Cada frase declara a postura e os pontos a que se refere:
{"sentences": [{"paragraph": 1, "text": "…", "stance": "CONTEXT | STRENGTH | ADJUSTMENT | GUIDANCE", "refs": ["A1"]}], "card": {"text": "…", "refs": ["A1"]}}
- CONTEXT: situa a chamada (refs dos pontos de que fala, ou []). Nunca elogia.
- STRENGTH: reconhece um acerto — refs só de "strengths" (S…).
- ADJUSTMENT: diz o que precisa ajustar — refs só de "adjustments" (A…).
- GUIDANCE: diz como fazer na próxima — refs do ajuste (A…).
- "paragraph" agrupa as frases em parágrafos (1, 2, 3…), na ordem.
- "card": 1 a 3 frases curtas para a lista do Acompanhamento, com o principal ajuste (refs A…) ou, sem ajustes, o que manter (refs S…).`
export const SUPERVISOR_NARRATIVE_SYSTEM_PROMPT_V6 = SUPERVISOR_NARRATIVE_SYSTEM_PROMPT_V5.replace(
  "- Todo item de \"adjustments\" precisa aparecer. Nenhum ponto pode ser inventado.",
  "- Todo item de \"adjustments\" precisa aparecer. Nenhum ponto pode ser inventado.\n- O que está em \"adjustments\" NÃO foi feito como o procedimento pede: nunca escreva que o colaborador fez, verificou, confirmou ou evitou aquilo, nem que agiu \"depois de\" fazê-lo. Se o ajuste é não ter verificado algo antes de orientar, a frase diz que a orientação veio sem essa verificação.\n- Num atendimento sem ajustes, reconheça de forma concreta o que foi feito (sem frase pronta do tipo \"você conduziu bem este atendimento\").",
).replace(
  `RESPOSTA: apenas um objeto JSON. Cada frase declara a postura e os pontos a que se refere:
{"sentences": [{"paragraph": 1, "text": "…", "stance": "CONTEXT | STRENGTH | ADJUSTMENT | GUIDANCE", "refs": ["A1"]}], "card": {"text": "…", "refs": ["A1"]}}`,
  `RESPOSTA: apenas um objeto JSON. Cada frase declara a postura e os pontos a que se refere:
{"sentences": [{"paragraph": 1, "text": "…", "stance": "CONTEXT | STRENGTH | ADJUSTMENT | GUIDANCE", "refs": ["A1"]}]}`,
).replace(
  `
- "card": 1 a 3 frases curtas para a lista do Acompanhamento, com o principal ajuste (refs A…) ou, sem ajustes, o que manter (refs S…).`,
  "",
)
export const SUPERVISOR_NARRATIVE_SYSTEM_PROMPT_V7 = `Você é um supervisor experiente de uma operação de atendimento. Vai explicar UMA chamada para o próprio colaborador que a atendeu, em português do Brasil, como um bom supervisor explicaria pessoalmente — não como quem preenche um formulário.

O QUE JÁ ESTÁ DECIDIDO (você não reavalia nada disso)
- "disposition": POSITIVE (só acertos), DEVELOPMENT (só ajustes) ou MIXED (acertos e ajustes independentes).
- "interaction": por que o cliente ligou, a situação e o caminho que o colaborador tomou.
- "strengths" (S1, S2…): o que o colaborador fez bem — com o contexto ("context") e as falas da chamada ("quotes").
- "adjustments" (A1, A2…): o que precisa mudar — com o que aconteceu ("whatHappened", "context"), as falas ("quotes"), a orientação ("guidance") e a regra do procedimento ("procedureSays").
- "toConfirm": pontos em aberto (não são erro).
Sua tarefa é COMUNICAR isso bem. Fatos são fixos; a forma de dizer é livre.

COMO UM BOM SUPERVISOR ESCREVE
- Fale direto com a pessoa ("você"), com respeito e objetividade. Sem entusiasmo exagerado, sem "parabéns", sem linguagem genérica de RH, sem tom punitivo, acusatório ou moralista.
- Quando ajudar a lembrar do caso, comece pela situação da chamada (o que o cliente precisava). Parafraseie o que aconteceu a partir das falas; não precisa citá-las (a citação literal fica nos detalhes).
- O tom segue a disposição:
  • DEVELOPMENT: vá direto ao ponto — contexto, o que aconteceu, qual mudança é necessária. Não procure elogio: sem "strengths" não há reconhecimento, nem "você conduziu bem", nem "mantenha".
  • POSITIVE: reconheça de forma específica o que foi feito e por que vale manter, sem inflar e sem frase pronta ("você conduziu bem este atendimento").
  • MIXED: reconheça o acerto real e mostre o ajuste real como coisas independentes; o elogio não serve para suavizar o ajuste.
- Não siga roteiro fixo: escolha a ordem e o tamanho que o caso pede (um caso simples cabe em poucas linhas; um caso com vários pontos pode ter dois ou três parágrafos). Junte pontos relacionados e priorize o mais importante — não precisa listar tudo, os detalhes ficam disponíveis.
- Diga cada fato uma vez só.
- A orientação precisa ser acionável: transforme "guidance"/"procedureSays" no que fazer na próxima situação parecida ("antes de indicar o aplicativo, confirme se a opção está disponível"). Nunca "siga o procedimento", "faça corretamente" ou "tenha atenção".
- Explique por que algo importa só quando a regra do procedimento diz a consequência; senão, não explique.

O QUE VOCÊ NUNCA FAZ
- Nunca invente fato, ação, acerto, erro, consequência, causa, prazo, valor, número, nome, canal, ferramenta, procedimento ou regra que não estejam na entrada.
- Ao parafrasear uma fala, mantenha a ação como ela aparece: se a fala diz "consultar pelo site", não escreva "baixar o boleto pelo site". Não acrescente detalhe, motivo, quantidade, intensidade ou resultado que as falas e o contexto não trazem ("todas as tentativas", "de forma completa", "para o perfil do cliente").
- O que está em "adjustments" NÃO foi feito como o procedimento pede: nunca escreva que o colaborador fez, verificou, confirmou ou evitou aquilo, nem que agiu "depois de" fazê-lo.
- Reconhecimento só para o que está em "strengths". Nunca apresente como acerto algo de "adjustments" e nunca diga que algo foi feito "corretamente" se a entrada não diz isso.
- Nunca diga que algo aconteceu por causa de outra coisa, nunca prometa resultado e nunca atribua utilidade ou efeito à conduta ("isso garante", "evita reclamações").
- Ação que o colaborador só INFORMOU ao cliente ("claim": "DECLARED") é dita como informada, nunca como feita.
- Nunca chame algo de erro, falha ou descuido; nunca diga "sempre", "costuma" ou "normalmente" sobre o colaborador.
- Nunca use nome de pessoa, saudação ou vocativo (o sistema acrescenta o nome), nem termos internos (etapa, checkpoint, ponto forte, ponto de desenvolvimento, códigos), nem lacunas como [prazo] ou "X dias".

RESPOSTA: apenas um objeto JSON. Cada frase declara a postura e os pontos a que se refere:
{"sentences": [{"paragraph": 1, "text": "…", "stance": "CONTEXT | STRENGTH | ADJUSTMENT | GUIDANCE", "refs": ["A1"]}], "card": {"text": "…", "refs": ["A1"]}}
- CONTEXT: situa a chamada (refs dos pontos de que fala, ou []). Nunca elogia.
- STRENGTH: reconhece um acerto — refs só de "strengths" (S…).
- ADJUSTMENT: diz o que precisa mudar — refs só de "adjustments" (A…). O ajuste principal (A1) sempre aparece como ADJUSTMENT ou GUIDANCE; os demais você pode juntar ao principal ou deixar para os detalhes.
- GUIDANCE: diz o que fazer na próxima — refs do ajuste (A…).
- "paragraph" agrupa as frases em parágrafos (1, 2, 3…), na ordem.
- "card": UMA frase curta e natural para a lista do Acompanhamento (até 120 caracteres), sem resumir tudo: com ajustes, o principal ajuste dito como ação (refs A…), ex. no espírito de "Confirme a disponibilidade antes de orientar o aplicativo"; sem ajustes, o principal reconhecimento, específico e sem inflar (refs S…).`
export const SUPERVISOR_NARRATIVE_SYSTEM_PROMPT_V8 = SUPERVISOR_NARRATIVE_SYSTEM_PROMPT_V7.replace(
  `O QUE VOCÊ NUNCA FAZ`,
  `A PARÁFRASE PODE ABSTRAIR, NUNCA ESPECIFICAR MAIS
- Você pode resumir, generalizar, reorganizar, contextualizar e juntar pontos: "testou o cabo e a tomada" pode virar "fez testes de diagnóstico".
- Você nunca deixa um fato MAIS específico do que ele é: nenhum objeto, ação, canal, etapa, resultado, quantidade, grau de completude ou certeza que as falas, o contexto e a regra não trazem. "Consultar pelo site" não vira "baixar o boleto pelo site"; "testou o cabo e a tomada" não vira "fez todos os testes", "diagnóstico completo" nem "suporte exaustivo".

O QUE VOCÊ NUNCA FAZ`,
).replace(
  `- STRENGTH: reconhece um acerto — refs só de "strengths" (S…).`,
  `- STRENGTH: reconhece um acerto — refs só de "strengths" (S…). Um reconhecimento pode vir dentro de uma frase que situa a chamada: ponha nela as refs S… do acerto.`,
)
export const SUPERVISOR_NARRATIVE_SYSTEM_PROMPTS: Record<SupervisorNarrativePromptVersion, string> = { [SUPERVISOR_NARRATIVE_PROMPT_VERSION_V1]: SUPERVISOR_NARRATIVE_SYSTEM_PROMPT_V1, [SUPERVISOR_NARRATIVE_PROMPT_VERSION_V2]: SUPERVISOR_NARRATIVE_SYSTEM_PROMPT_V2, [SUPERVISOR_NARRATIVE_PROMPT_VERSION_V3]: SUPERVISOR_NARRATIVE_SYSTEM_PROMPT_V3, [SUPERVISOR_NARRATIVE_PROMPT_VERSION_V4]: SUPERVISOR_NARRATIVE_SYSTEM_PROMPT_V4, [SUPERVISOR_NARRATIVE_PROMPT_VERSION_V5]: SUPERVISOR_NARRATIVE_SYSTEM_PROMPT_V5, [SUPERVISOR_NARRATIVE_PROMPT_VERSION_V6]: SUPERVISOR_NARRATIVE_SYSTEM_PROMPT_V6, [SUPERVISOR_NARRATIVE_PROMPT_VERSION_V7]: SUPERVISOR_NARRATIVE_SYSTEM_PROMPT_V7, [SUPERVISOR_NARRATIVE_PROMPT_VERSION]: SUPERVISOR_NARRATIVE_SYSTEM_PROMPT_V8 }
export const SUPERVISOR_NARRATIVE_OUTPUT_SCHEMA_DESCRIPTION = { paragraphs: "string[] (1–6)", card: "string (2–3 frases)" } as const
/** V5 — frases com vínculo (postura + refs). */
export const SUPERVISOR_NARRATIVE_OUTPUT_SCHEMA_DESCRIPTION_V5 = { sentences: "{paragraph, text, stance CONTEXT|STRENGTH|ADJUSTMENT|GUIDANCE, refs S-n|A-n}[]", card: "{text, refs}" } as const
/** V6 — só as frases (o card é do sistema). */
export const SUPERVISOR_NARRATIVE_OUTPUT_SCHEMA_DESCRIPTION_V6 = { sentences: "{paragraph, text, stance CONTEXT|STRENGTH|ADJUSTMENT|GUIDANCE, refs S-n|A-n}[]" } as const
const SCHEMA_DESCRIPTIONS: Partial<Record<SupervisorNarrativePromptVersion, object>> = { [SUPERVISOR_NARRATIVE_PROMPT_VERSION_V5]: SUPERVISOR_NARRATIVE_OUTPUT_SCHEMA_DESCRIPTION_V5, [SUPERVISOR_NARRATIVE_PROMPT_VERSION_V6]: SUPERVISOR_NARRATIVE_OUTPUT_SCHEMA_DESCRIPTION_V6, [SUPERVISOR_NARRATIVE_PROMPT_VERSION_V7]: SUPERVISOR_NARRATIVE_OUTPUT_SCHEMA_DESCRIPTION_V5, [SUPERVISOR_NARRATIVE_PROMPT_VERSION]: SUPERVISOR_NARRATIVE_OUTPUT_SCHEMA_DESCRIPTION_V5 }
export const NARRATIVE_STANCES = ["CONTEXT", "STRENGTH", "ADJUSTMENT", "GUIDANCE"] as const
export const SUPERVISOR_NARRATIVE_RESPONSE_SCHEMA_V5: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    sentences: { type: "ARRAY", items: { type: "OBJECT", properties: { paragraph: { type: "INTEGER" }, text: { type: "STRING" }, stance: { type: "STRING", enum: [...NARRATIVE_STANCES] }, refs: { type: "ARRAY", items: { type: "STRING" } } }, required: ["paragraph", "text", "stance", "refs"], propertyOrdering: ["paragraph", "text", "stance", "refs"] } },
    card: { type: "OBJECT", properties: { text: { type: "STRING" }, refs: { type: "ARRAY", items: { type: "STRING" } } }, required: ["text", "refs"], propertyOrdering: ["text", "refs"] },
  },
  required: ["sentences", "card"],
  propertyOrdering: ["sentences", "card"],
}
export const SUPERVISOR_NARRATIVE_RESPONSE_SCHEMA_V6: Record<string, unknown> = {
  type: "OBJECT",
  properties: { sentences: (SUPERVISOR_NARRATIVE_RESPONSE_SCHEMA_V5.properties as Record<string, unknown>).sentences },
  required: ["sentences"],
  propertyOrdering: ["sentences"],
}
export const SUPERVISOR_NARRATIVE_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: { paragraphs: { type: "ARRAY", items: { type: "STRING" } }, card: { type: "STRING" } },
  required: ["paragraphs", "card"],
  propertyOrdering: ["paragraphs", "card"],
}
export const supervisorNarrativeFreezeFile = (version: SupervisorNarrativePromptVersion = SUPERVISOR_NARRATIVE_PROMPT_VERSION) => `${version.toLowerCase().replace(/_/g, "-")}.freeze.json`

export function supervisorNarrativeFingerprint(version: SupervisorNarrativePromptVersion = SUPERVISOR_NARRATIVE_PROMPT_VERSION) {
  const promptSha256 = sha256(SUPERVISOR_NARRATIVE_SYSTEM_PROMPTS[version])
  const schemaSha256 = sha256(JSON.stringify(SCHEMA_DESCRIPTIONS[version] ?? SUPERVISOR_NARRATIVE_OUTPUT_SCHEMA_DESCRIPTION))
  const configSha256 = sha256(JSON.stringify(FEEDBACK_WRITER_MODEL_CONFIG))
  return {
    adapterVersion: SUPERVISOR_NARRATIVE_ADAPTER_VERSION,
    promptVersion: version,
    promptSha256,
    schemaVersion: SUPERVISOR_NARRATIVE_OUTPUT_SCHEMA_VERSION,
    schemaSha256,
    contractVersion: inputContractOf(version),
    effectClaimMode: "POTENTIAL_ONLY",
    model: FEEDBACK_WRITER_MODEL_CONFIG.model,
    config: FEEDBACK_WRITER_MODEL_CONFIG,
    configSha256,
    writerSha256: sha256(`${promptSha256}|${schemaSha256}|${configSha256}|${inputContractOf(version)}`),
  }
}

const MOMENT: Record<string, string> = { INVESTIGATION: "investigação do caso", TREATMENT: "tratativa", CLOSING: "encerramento", OTHER: "outro momento" }
const EVIDENCE: Record<string, string> = { OBSERVED_IN_CALL: "visto na fala do colaborador", VERIFIED_ABSENCE: "não aconteceu em nenhum momento da chamada (análise da chamada inteira)", NOT_OBSERVED: "não apareceu na chamada analisada" }

/** Payload do modelo: LISTA BRANCA do brief (sem índices de item, radicais, chave de itens nem nome). */
export function projectNarrativeBriefForModel(brief: NarrativeBrief) {
  return {
    interaction: { date: brief.about.date, subject: brief.about.subject },
    wentWell: brief.positives.map((positive) => ({ moment: MOMENT[positive.phase], what: positive.clause, claim: positive.claim })),
    toAdjust: brief.gaps.map((gap) => ({ topic: gap.topic, moment: MOMENT[gap.phase], whatHappened: gap.happened, missingPoints: gap.missingPoints, ...(gap.coveredBy !== null && gap.coveredBy >= 0 ? { sameAsAdjustment: brief.gaps[gap.coveredBy]!.topic } : {}), evidence: EVIDENCE[gap.evidence], guidance: gap.guidance, procedureSays: gap.procedureSays })),
    toConfirm: brief.attention,
  }
}

/** V5 — payload da COMPOSIÇÃO: contexto da chamada + pontos com refs (S-n/A-n) + o que aconteceu em cada um (do especialista). */
export function projectCompositionBriefForModel(brief: NarrativeBrief) {
  return {
    // FEEDBACK EXPERIENCE V2 (V7) — a disposição define o tom; decidida pelo código a partir dos pontos (nunca pelo redator).
    disposition: brief.gaps.length === 0 ? "POSITIVE" : brief.positives.length > 0 ? "MIXED" : "DEVELOPMENT",
    interaction: { date: brief.about.date, subject: brief.about.subject, customerNeed: brief.interaction?.customerNeed ?? null, situation: brief.interaction?.situation ?? null, path: brief.interaction?.path ?? null },
    strengths: brief.positives.map((positive, index) => ({ ref: `S${index + 1}`, moment: MOMENT[positive.phase], what: positive.clause, claim: positive.claim, context: positive.context ?? [], quotes: positive.quotes ?? [] })),
    adjustments: brief.gaps.map((gap, index) => ({ ref: `A${index + 1}`, topic: gap.topic, moment: MOMENT[gap.phase], whatHappened: gap.happened, missingPoints: gap.missingPoints, ...(gap.coveredBy !== null && gap.coveredBy >= 0 ? { sameAsAdjustment: `A${gap.coveredBy + 1}` } : {}), evidence: EVIDENCE[gap.evidence], quotes: gap.quotes ?? [], guidance: gap.guidance, procedureSays: gap.procedureSays, context: gap.context ?? [] })),
    toConfirm: brief.attention,
  }
}

/** Defesa estrutural antes da rede: nada de id, ref interna ou link no payload. */
export function assertNarrativePayloadSafe(payload: ReturnType<typeof projectNarrativeBriefForModel> | ReturnType<typeof projectCompositionBriefForModel>): void {
  // As refs S-n/A-n são o vínculo pedido ao modelo (não são refs internas do sistema).
  const text = JSON.stringify(payload).replace(/"ref":"[SA]\d+"|"sameAsAdjustment":"A\d+"/g, "")
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text)) throw new Error("NARRATIVE_PAYLOAD_VIOLATION: identificador no payload")
  if (/\/materiais\//.test(text)) throw new Error("NARRATIVE_PAYLOAD_VIOLATION: link no payload")
  if (INTERNAL_REF_PATTERN.test(text.replace(/"[^"]*"\s*:/g, ""))) throw new Error("NARRATIVE_PAYLOAD_VIOLATION: referência interna no payload")
}

export const renderNarrativeUserTurn = (payload: ReturnType<typeof projectNarrativeBriefForModel> | ReturnType<typeof projectCompositionBriefForModel>) => `${"disposition" in payload ? SUPERVISOR_NARRATIVE_INPUT_CONTRACT_V2 : SUPERVISOR_NARRATIVE_INPUT_CONTRACT}:\n${JSON.stringify(payload, null, 2)}`

const outputSchema = z.object({ paragraphs: z.array(z.string()).min(1).max(8), card: z.string() }).strict()
const sentencesSchema = z.array(z.object({ paragraph: z.number().int().min(1).max(8), text: z.string(), stance: z.enum(NARRATIVE_STANCES), refs: z.array(z.string()).max(8) }).strict()).min(1).max(24)
const compositionSchema = z.object({ sentences: sentencesSchema, card: z.object({ text: z.string(), refs: z.array(z.string()).max(8) }).strict() }).strict()
const compositionSchemaV6 = z.object({ sentences: sentencesSchema }).strict()
/**
 * Parse ESTRITO da composição: parágrafos montados das frases (na ordem), metadados preservados para a validação do vínculo.
 * V6 (padrão) = só frases; o card fica vazio e o SISTEMA o deriva do assessment. `withCard` = o formato V5 (histórico/testes).
 */
export function parseCompositionResponse(text: string, options: { withCard?: boolean } = {}): NarrativeParseResult {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: "NARRATIVE_MALFORMED_JSON", detail: error instanceof Error ? error.message : null }
  }
  const parsed = options.withCard ? compositionSchema.safeParse(json) : compositionSchemaV6.safeParse(json)
  if (!parsed.success) return { ok: false, error: "NARRATIVE_SCHEMA_INVALID", detail: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") }
  const card = "card" in parsed.data ? (parsed.data.card as { text: string; refs: string[] }) : null
  const sentences = parsed.data.sentences.map((sentence) => ({ ...sentence, text: sentence.text.trim() })).filter((sentence) => sentence.text.length > 0)
  const paragraphs = [...new Set(sentences.map((sentence) => sentence.paragraph))].sort((a, b) => a - b).map((number) => sentences.filter((sentence) => sentence.paragraph === number).map((sentence) => sentence.text).join(" "))
  return { ok: true, draft: { paragraphs, card: card?.text.trim() ?? "", sentences, cardRefs: card?.refs ?? [] } }
}

export type NarrativeParseResult = { ok: true; draft: NarrativeDraft } | { ok: false; error: "NARRATIVE_MALFORMED_JSON" | "NARRATIVE_SCHEMA_INVALID"; detail: string | null }
/** Parse ESTRITO (JSON puro, sem reparo): qualquer desvio = sem rascunho (a narrativa do sistema assume). */
export function parseNarrativeResponse(text: string): NarrativeParseResult {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: "NARRATIVE_MALFORMED_JSON", detail: error instanceof Error ? error.message : null }
  }
  const parsed = outputSchema.safeParse(json)
  if (!parsed.success) return { ok: false, error: "NARRATIVE_SCHEMA_INVALID", detail: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") }
  return { ok: true, draft: { paragraphs: parsed.data.paragraphs, card: parsed.data.card } }
}
