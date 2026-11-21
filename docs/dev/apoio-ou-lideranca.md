# Apoio ou liderança: quando a INIA manda o operador procurar alguém

**Data do levantamento:** 19/11/2026.
**Branch:** `claude/anjo-em-vez-de-lideranca-71d6ec`.
**Validação pelo responsável:** pendente (20/11).

**Pergunta do responsável:** "não sei se faz sentido mandar procurar a liderança sempre".
Com o Apoio com Anjo, que o operador vê como "Apoio", parte das dúvidas pode ir para uma pessoa da equipe de apoio. A liderança fica com o que é dela.

## Classificação usada

- **(a) Continua com a liderança.** Gestão de pessoas e decisões que só o gestor toma. Inclui a avaliação de continuidade, que é sempre humana e restrita.
- **(b) Melhor apontar o Apoio.** Dúvida de procedimento, de sistema ou de atendimento.
- **(c) Depende.** Aponta o Apoio se ele estiver disponível para aquela pessoa naquele momento; senão, a liderança.

"Disponível" segue a regra que já existe no módulo do apoio. Nada novo foi inventado:

1. O apoio está ligado para o Grupo/Subgrupo atual da pessoa (`enabledForPlace`: chave geral › Grupo › Subgrupo).
2. Há alguém **em serviço** no escopo dela (`anjosInServiceCount`):
   - área do Anjo aberta, com conexão válida;
   - fora de Indisponível e fora da pausa "Desconexão" (195);
   - papel de Anjo cobrindo o Grupo/Subgrupo da pessoa;
   - mesmo universo do operador, quando a exigência está ativada.

Essa é a mesma condição em que o pedido pode ser criado. Sem ninguém em serviço, o pedido é recusado e vale a regra "sem Anjo disponível".

Em pausa (exceto "Desconexão") ou ocupado, o Anjo ainda conta como em serviço. O pedido vai para a fila, com o prazo e os tempos de resposta de sempre. Esses tempos continuam valendo depois que o pedido existe; nada disso mudou.

## Inventário

A busca cobriu `backend/src`, `frontend/src`, seeds e o banco de dev (agentes e Orquestradores).

Fora do inventário ficaram os textos em que "liderança" é público ou assunto, não destino do operador. Exemplos: "comunicados da liderança", ferramentas `leadership_*`, diagnóstico da liderança e os temas e práticas "que a liderança lê".

| # | Onde | Texto (resumo) | Contexto | Versionado? | Classe | Decisão |
|---|---|---|---|---|---|---|
| 1 | `knowledge-clarification/application/knowledge-clarification-service.ts` (decisão INSUFFICIENT, nos 2 ramos) | "Se a dúvida continuar, [reformule a pergunta ou] procure a sua liderança imediata." | Esclarecimento pelas bases, chat e voz de quem atende. Também na consulta de processo da liderança e na sessão de feedback. | Não: texto fixo do código. | (c) | **Implementado** (`HELP_ROUTE_V1`), detalhes abaixo. |
| 2 | `knowledge-clarification/domain/clarification-prompts.ts` › `ANSWER_SYSTEM` | "…diga numa frase que não a encontrou nas bases consultadas, oriente procurar a liderança imediata…" | Resposta parcial (ANSWERED com `limitations`). | **Sim**: `KNOWLEDGE_CLARIFICATION_PROMPTS_V5`. | (c) | **Proposta P1.** |
| 3 | `agents/application/build-system-prompt.ts` › `NOT_FOUND_GUIDANCE` | "…não encontrou essa informação nas bases oficiais e oriente-o a procurar a liderança imediata (supervisor)…" | Prompt de todo especialista. A frase só vale na conversa. | Não tem `*_VERSION` próprio, mas é instrução de IA de todos os agentes. | (c) | **Proposta P2.** |
| 4 | Banco de dev, `agents.context_prompt` de 5 agentes demo (Eficiência no atendimento, Suporte Técnico, RH, Orquestradora INIA, Contestação) | "Se a base não cobrir a dúvida, diga isso com clareza e oriente procurar a liderança [ou o canal de RH]." | Texto cadastrado pelo administrador. | São dados (versão do agente), não código. | (c); no RH, (a) | **Proposta P3**, sem mudança no código. |
| 5 | `governance/domain/response-compliance.ts` › `RESPONSE_BLOCKED_TEXT` | "Não posso tratar disso por aqui. Se precisar, fale com a sua liderança. …" | Resposta barrada pela conferência por violação de regra (assunto proibido, limite de atuação). | Texto fixo. | (a) | **Mantido.** Proposta P4 discute a mudança. |
| 6 | `governance/domain/response-compliance.ts` › `SPOKEN_VIOLATION_NOTICE` | "Parte do que falei antes não deveria ter sido dita. … Se precisar, fale com a sua liderança." | Voz, depois de fala barrada. | Texto fixo. | (a) | **Mantido**, pelo mesmo motivo do #5. |
| 7 | Frontend `operator-inia-chat/dislike-form.tsx` | Com "ainda preciso de ajuda": "Um Anjo pode ajudar…", "Falar com um Anjo", "O apoio com Anjo ainda não está disponível para sua equipe." | Descurtida no chat livre. | Não. | (c) | **Implementado.** Ver "Implementado". |
| 8 | `investigation/domain/interaction-feedback-writer.ts:349` | "Sugestão: converse com a sua liderança sobre formas de conduzir situações parecidas." | Feedback de interação do caminho antigo da investigação, já substituído pelo motor de feedback. | Faz parte do redator antigo (histórico). | (a) | **Mantido.** É coaching e conduta, papel da liderança. Caminho antigo, não mexer. |
| 9 | Motor de feedback (`feedback-engine/**`) e redator confiável (`reliable-feedback/**`) | Nenhum texto manda o operador procurar a liderança. O redator **proíbe** "conversar com a liderança" como dica genérica (`NO_GENERIC_TIPS`, `reliable-writer-prompts.ts`). | — | Sim. | — | **Nada a fazer.** O motor não foi alterado. |
| 10 | `human-support/domain/catalogs.ts` › `FORWARDED` | "Encaminhado à liderança ou a outra área". | Classificação do atendimento pelo **Anjo**. | Catálogo de classificação. | (a) | **Mantido.** É o Anjo que encaminha o que não é dele. |
| 11 | `assistant/domain/asking-person-profile.ts` (`leaderFrame`) e `leadership-analytics/application/leadership-context.ts` | Para quem LIDERA: "…nunca diga para ela procurar a liderança imediata". | Perfil de liderança. | — | n/a | **Mantido.** Ver "Achado à parte". |
| 12 | Wiki (`/wiki/introducao`, políticas de acompanhamento) e Administração (`workflow-enrollments-tab.tsx`, `intervention-actions.tsx`) | "encaminhar à liderança" como tipo de intervenção ou caminho "Escalar" do Workflow. | Telas da gestão. | — | (a) | **Mantido.** Escalonamento de performance é da liderança e de políticas versionadas. |
| 13 | Mensagens de erro (`domain-error-codes.generated.ts`) | Nenhuma manda o operador procurar a liderança. As que citam "liderança" são de cadastro e administração. | — | — | n/a | Nada a fazer. |
| 14 | Persona do chat e da voz, "Ouvir com a INIA", alinhamentos e comunicados | Nenhuma instrução manda procurar a liderança. Os alinhamentos só proíbem prometer avisos "da liderança". | — | — | n/a | Nada a fazer. |

## Implementado

### #1: resposta "insuficiente" do esclarecimento (`HELP_ROUTE_V1`)

**Antes:** a última frase da resposta era sempre "procure a sua liderança imediata". Logo abaixo da mesma resposta, o chat mostrava a sugestão "Falar com o Apoio", porque o sinal `KNOWLEDGE_INSUFFICIENT` já existia. A tela dava duas direções ao mesmo tempo.

**Agora:**

- **Apoio disponível para a pessoa agora** (regra acima): "Se a dúvida continuar, [reformule a pergunta ou] fale com o Apoio." A sugestão com o botão continua logo abaixo, como já era.
- **Qualquer outro caso:** o texto de antes. Isso inclui:
  - apoio desligado ou ninguém em serviço;
  - pausa "Desconexão" ou área fechada;
  - falha ou demora de mais de 1,5 s na leitura;
  - liderança, sessão de feedback ou conversa de Workflow.
- A rota só é lida na decisão INSUFFICIENT. Pergunta de esclarecimento, resposta e "não convergiu" não consultam o apoio.
- A leitura não registra nada. A "tentativa sem Anjo" (D4) continua sendo registrada só pela prévia do pedido.
- O rastro do esclarecimento grava `helpRoute` (`SUPPORT` ou `LEADERSHIP`). Assim dá para auditar qual frase cada resposta recebeu.

**Isolamento mantido:** quem decide é o módulo do apoio (`human-support/application/suggestions.ts` › `createHelpRouteResolver`). A função é injetada no `realtime-router` pelo `createApp`, como a `recordSuggestion`. O esclarecimento só conhece as duas palavras (`knowledge-clarification/domain/help-route.ts`). Nenhum prompt mudou.

**Onde vale:** chat de texto e voz de quem atende, só no chat livre (`origin = USER`), que é onde a sugestão do Apoio aparece. Na voz, a frase é a mesma, sem citar botão. A sugestão aparece na conversa, como os demais sinais da voz.

### #7: descurtida com "ainda preciso de ajuda"

- O operador não lê mais "Anjo", pela regra de 16/11. Os textos passam a ser "O Apoio pode ajudar você com essa dúvida." e o botão `SUPPORT_BUTTON_LABEL` ("Falar com o Apoio").
- Com o apoio desligado para a pessoa, o texto é: "O Apoio ainda não está disponível para sua equipe. Se a dúvida continuar, procure a sua liderança imediata." É o caso (c) sem Apoio. Antes, a pessoa ficava sem saber a quem recorrer.

## Propostas (não implementadas, para decidir)

**P1. Resposta parcial do esclarecimento (#2).**
Para apontar o Apoio na resposta parcial, seria preciso:

- criar `KNOWLEDGE_CLARIFICATION_PROMPTS_V6`, com a frase "oriente procurar a liderança imediata" vinda de um parâmetro (Apoio ou liderança);
- gravar um sinal novo na resposta ANSWERED com `limitations`. Sem esse sinal, a INIA diria "fale com o Apoio" e nenhum botão apareceria, porque o botão fixo saiu em 10/11.

Por isso não foi feito. Muda um prompt versionado e o funil (sinal novo). Também exige uma rodada paga de comparação para provar que a resposta não piora (regra "qualidade antes de velocidade").

*Sugestão mais barata:* tirar do prompt a frase "para onde ir". Ela seria acrescentada pelo código, como no #1, junto do sinal.

**P2. Especialista que não achou nos trechos (#3).**
É o mesmo problema do P1, com alcance maior: o prompt é de todos os agentes. O sinal `KNOWLEDGE_NOT_FOUND` só existe quando nenhum resultado trouxe conteúdo. Quando há trechos e nenhum responde, não há sinal, então também não há botão.

*Proposta:* versionar a orientação ("diga que não encontrou" sem dizer para onde ir) e deixar a rota para o código, depois de uma avaliação paga dentro do teto de US$ 1. Não foi feito porque altera a resposta de todos os especialistas sem medição.

**P3. Instruções cadastradas nos agentes demo (#4).**
São dados. Com o P2 aprovado, sugerir ao administrador trocar "oriente procurar a liderança" por "diga isso com clareza" e deixar a rota para o sistema. Até lá, convivem com o #1:

- a resposta pelas bases (esclarecimento) já aponta o Apoio;
- a resposta pelo especialista ainda pode citar a liderança.

**P4. Resposta barrada por regra (#5 e #6).**
Hoje continua "fale com a sua liderança". Motivos:

- O responsável decidiu em 10/11 que a resposta barrada por violação **não** gera sinal nem sugestão do Apoio (`apoio-com-anjo.md`).
- Os assuntos proibidos costumam ser de gestão ou RH (classe a).

*Discutível:* quando a regra é um limite de atuação de procedimento (ex.: "não informe valores"), o Apoio poderia ajudar. Se o responsável quiser, o caminho é o mesmo do #1, com a rota decidida por código. Mas isso reabre a decisão de 10/11.

**P5. Leitura do apoio para a liderança.**
Hoje, quem lidera nunca recebe a rota (ver "Achado à parte"). Se um dia o Apoio atender líderes, a rota passaria a valer para eles.

## Achado à parte (não corrigido, fora do escopo)

Na consulta de processo de quem **lidera**, o esclarecimento usa o mesmo texto fixo do #1. Ele diz "procure a sua liderança imediata", mas o `leaderFrame` manda nunca dizer isso a quem lidera.

Ficou como está (sem rota, o texto de antes). Corrigir pede outra frase para o líder, por exemplo "consulte a área dona do processo". Essa decisão é do responsável.

## Testes

- `knowledge-clarification-service.test.ts`, bloco "para onde a resposta insuficiente aponta". Cobre:
  - sem função, o texto de antes;
  - Apoio, sem "liderança" nem "Anjo";
  - `LEADERSHIP`;
  - falha na leitura, que vira liderança;
  - a rota é lida só na decisão INSUFFICIENT.
- `realtime-router-knowledge-clarification.test.ts`: o chat livre passa a função, com organização e pessoa da sessão, e ela não é lida no envio. Sem injeção, não passa.
- `human-support-proof` (banco de teste, cenário "rota de ajuda do chat (HELP_ROUTE_V1)", 22/22). Cobre:
  - ninguém em serviço, Subgrupo desligado, outro Grupo, pausa e "Desconexão", conexão vencida e pessoa desconhecida, todos com a rota certa;
  - nenhum registro em `human_support_entry_events`.
- `dislike-form.test.tsx` e `operator-inia-chat.test.tsx`, com os textos novos.
- FAQ do Apoio (`human-support-faq-data.ts`): pergunta nova "A INIA ainda manda procurar a liderança?".
