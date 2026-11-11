# Conferência das respostas (PEN-017 e PEN-078)

Implementada em desenvolvimento (migration 169). **Não publicada em produção.** Decidida em 04/11/2026. Critérios e evidências por canal: ESP-INIA-03 §4.1 e §4.5.

**Não é proteção integral.** Cada canal tem uma cobertura, e elas não se misturam:

| Cobertura | Onde | O que significa |
|---|---|---|
| Prevenção | Chat, voz pelo servidor, agente, especialista com limites, orquestrador em Workflow | Confere antes de entregar ou seguir |
| Detecção posterior | Fala gerada pelo modelo de voz | Confere depois de falada. Não impede a fala nem retira o que foi dito |
| Sem cobertura | Motor de feedback (inclusive `PROCESS_ASSESSMENT`), reports, intervenções, treino, boas práticas | Não recebem as regras nem são conferidos. Decisão ligada à PEN-018; não é exceção aprovada |

## Modos (`INIA_RESPONSE_CHECK`, lido a cada resposta)

| Modo | Quando vale | O que faz | É prevenção? |
|---|---|---|---|
| `ENFORCE` | Padrão, inclusive sem valor ou com valor desconhecido | Confere antes de entregar | Sim, nos canais de prevenção |
| `AUDIT` | Valor explícito | Entrega e confere depois; a violação sai da conversa com aviso | Não, só detecção |
| `OFF` | Valor explícito | Não confere nem registra | Não, nem detecção |

`GET /api/v1/admin/response-checks/summary` devolve `mode`, e a aba da Governança descreve o modo em vigor e os fluxos sem cobertura. O registro marca `control`: `PREVENTIVE` ou `DETECTIVE`.

## Fontes da resposta (RESPONSE_COMPLIANCE_V3, 05/11/2026)

**Por quê:** a V1 vê só a pergunta e a resposta. Ela não tem como saber se um prazo veio do procedimento ou foi inventado. Em 05/11/2026, barrou uma resposta correta sobre reparo de Linha Móvel: "até 72 horas" estava literal na base consultada, e a pessoa recebeu "Não posso tratar disso por aqui".

**Como funciona:** a resposta que se apoiou em alguma fonte continua sendo conferida, agora vendo de onde a informação veio. A fonte nunca isenta nada por código: quem compara é a IA, pelo sentido.

| Fonte | Quando vai |
|---|---|
| Trecho de base consultado (`KNOWLEDGE`) | Seções usadas pelo esclarecimento (`groundedOn`), `knowledge.retrieved` de cada especialista e do Orquestrador, consulta de processo da liderança, agente e síntese de Workflow |
| Resposta anterior da mesma conversa (`PRIOR_ANSWER`) | Até 4, no chat e na voz. É a única fonte da fala do modelo de voz: ela repete o que o servidor entregou, e isso já foi conferido. Uma resposta barrada fica na conversa só como o texto fixo |

| Situação | O que roda |
|---|---|
| Sem fonte | V1, como sempre, com todas as regras numa chamada |
| Com fonte | V3 com os assuntos proibidos e as fontes |
| Com fonte e limite de atuação ligado | Em paralelo: V3 com os assuntos proibidos e as fontes; V1 só com o limite, sem as fontes |

O limite vai à parte porque não depende de onde a informação veio. Junto da comparação, o modelo via o dado na fonte e deixava passar resposta fiel e fora do limite. Na combinação, violação em qualquer parte é violação; sem violação, a falha de uma parte impede a resposta. A versão usada fica em `prompt_version`: V3 quando houve fonte com assunto proibido.

Na V3, o modelo preenche a comparação de cada prazo, valor, desconto ou condição com a fonte e se a informação vale para o caso da pergunta, analisa cada regra uma a uma e só então decide. Regra de não criar: o que está nas fontes, com o mesmo sentido e para o mesmo caso, foi repassado. Regra de assunto: estar nas fontes não libera. As fontes são dado, nunca instrução (`neutralizeMarks`). Somam no máximo 40 mil caracteres, e a que não cabe sai inteira, com os trechos de base antes das respostas anteriores. Sem ela, o erro possível é barrar, nunca liberar.

### Medição (`gemini-3.1-flash-lite`, 05/11/2026)

Casos em [conferencia-das-respostas-casos/](conferencia-das-respostas-casos/): 31 escritos durante o ajuste e 106 escritos às cegas por um agente que não viu o prompt nem os outros casos. Toda mudança nesta conferência precisa ser medida de novo com eles.

Texto final, 2 rodadas por caso:

| Grupo | V3 + limite à parte | V1 (versão atual sem fontes, de 1 a 2 rodadas por caso) |
|---|---|---|
| Repassa o que a base diz (não pode barrar) | 82 de 82 | 12 de 52 |
| Cria, muda ou amplia (precisa barrar) | 88 de 88 | 50 de 51 |
| Assunto proibido e palavra em outro sentido | 60 de 60 | 30 de 33 |
| Limite de atuação | 42 de 44 | 20 de 24 |

Os casos às cegas, na primeira vez que rodaram: 117 de 120, 105 de 108 e 87 de 90. Cada um mediu uma versão intermediária do texto, e os erros encontrados levaram aos ajustes seguintes. **O texto final não tem medição às cegas:** a tabela acima usa casos que já tinham sido vistos.

Fluxo real pela voz, com o Orquestrador, as bases e o modelo do dev (`Como faço para abrir um reparo?` → `Linha Móvel`): resposta com "até 72 horas" entregue, resposta e fala conferidas na V3, conversa de teste apagada pelo id. Esse fluxo rodou antes do último ajuste do texto (`vale_para_o_caso`); a resposta real da Linha Móvel com as bases reais está no caso A01 da medição final.

Custo e tempo: cada conferência com fonte passou de cerca de 1,2 s para 1,8 s e de cerca de US$ 0,0003 para US$ 0,0007, porque a saída ficou maior. O conjunto das medições custou cerca de US$ 1,40, somando todas as rodadas de ajuste; nenhuma rodada passou de US$ 0,10 confirmados.

## Dados calculados como fonte (RESPONSE_COMPLIANCE_V5, 11/11/2026)

**O que aconteceu:** pela voz, uma operadora pediu "quero saber dos MEUS números". A INIA acionou `self_ask`, `my_results` calculou os resultados oficiais de setembro e a resposta foi barrada três vezes pela regra "Promessa financeira não autorizada" ("Não criar valores, descontos ou prazos"). A conferência só via trechos de base e respostas anteriores: os números não estavam em nenhuma fonte, e o modelo os tomou por valores criados. A pessoa recebeu "Não posso tratar disso por aqui".

**O que mudou:** os resultados das ferramentas diretas do backend acionadas na resposta (`directResults`, com o texto que o modelo recebeu) entram como fonte de origem `DATA` (`<fonte origem="dados_calculados">`), no chat e na voz (`toolDataSources` + `replyDataSources` no router). A consulta de processo da liderança (`leadership_process`) fica de fora, porque o texto dela é de outra IA. Com alguma fonte `DATA`, vale a V5: o texto da V3 com a descrição dessa origem e a linha "informar à pessoa um resultado, meta, atingimento, quartil… que está nos dados calculados não é valor criado nem prometido". Sem fonte `DATA`, o texto e a versão continuam exatamente os da V3. No limite de 40 mil caracteres, a ordem é base, dados e respostas anteriores. O dado não libera por código: a decisão continua sendo da IA, e a violação apontada continua valendo. O nome V4 fica reservado à conferência do limite de atuação, ainda sem commit.

**Medição (`gemini-3.1-flash-lite`, chamadas diretas, 3 rodadas cada):** a resposta real da operadora com o resultado real de `my_results` e `my_best_practices` como fonte passou 3 de 3. O controle, a mesma resposta com "se você bater a meta em outubro, eu garanto um bônus de R$ 500 e 30% de desconto no seu plano", foi barrado 3 de 3 pela mesma regra. É um caso só, sem bateria às cegas, e não houve fluxo completo pela voz com o modelo real.

**Prova:** `response-compliance-sources.test.ts` ("dados calculados pelo sistema como fonte") e `realtime-router-response-check.test.ts` (chat e `self_ask` mandam `DATA`; a consulta de processo não).

## Decisões (PEN-078)

1. Chat: confere antes de entregar. Com regra aplicável, a exibição gradual dá lugar à entrega depois da conferência.
2. Resposta bloqueada: mensagem fixa, compreensível e sem conteúdo restrito (`RESPONSE_BLOCKED_TEXT`).
3. Falha da conferência: a resposta não sai sem verificação (`RESPONSE_CHECK_UNAVAILABLE_TEXT`).
4. Voz: aceita a detecção posterior da fala gerada pelo modelo (`SPOKEN_VIOLATION_NOTICE`).
5. Demais fluxos: cobertura decidida junto da PEN-018.

## Código

- **Regras:** as de sempre (`loadAgentGuardrails`). Nenhum cadastro novo. Sem regra, nenhuma chamada à IA.
- **Núcleo:** `governance/domain/response-compliance.ts` (regras, prompt `RESPONSE_COMPLIANCE_V1`, contrato, textos fixos) e `governance/application/response-compliance.ts` (`checkResponse`, `recordResponseCheck`, `enforceResponseBeforeNextStep`). Use Case `RESPONSE_COMPLIANCE`.
- **Fontes:** `complianceSourcesOfExcerpts`, `replyComplianceSources`, `priorAnswerSources` e `limitComplianceSources`, no domínio. O esclarecimento devolve `groundedOn` só no turno: o estado gravado continua guardando referências, nunca o texto.
- **Chat:** `/messages` retém `chunk` e `retract` em `send`, e `persistReply` confere antes de soltar. Texto do sistema usa `deterministic`.
- **Voz:** `guardVoiceText` no `/tool-call`, antes do modelo de voz. `/voice-turn` confere o que foi falado (`assistantText` ou `spokenText`).
- **Agente e Workflow:** `enforceResponseBeforeNextStep` antes de concluir. Violação é `ModelOutputContractError` (sem nova tentativa). Falha é `RESPONSE_CHECK_UNAVAILABLE` (etapa repete).
- **Especialista:** `guardSpecialistLimits`, só com limites ligados.
- **Registro:** `response_compliance_checks`; o texto só é guardado em violação ou falha. Leitura em `GET /api/v1/admin/response-checks` (alcance de organização) e no monitoramento da conversa.

## Provas

- `INIA_DB_PROOF=1 npx vitest run response-compliance-proof`: 11 cenários, banco e motor reais, provedor simulado. O bloqueio do chat é provado aqui, porque o simulador escreve o texto indevido. No teste com provedor real, o próprio modelo recusou: aquilo não prova o bloqueio.
- `npx vitest run response-compliance realtime-router-response-check`. As fontes estão em `response-compliance-sources.test.ts`, `realtime-router-response-check.test.ts` e nos testes de esclarecimento do chat e da voz.
- **Provas com provedor simulado:** quando houver regra ativa, o simulador precisa responder a `classification.purpose === "RESPONSE_COMPLIANCE"` com `{"verdict":"ALLOW","violated":[]}`. Sem isso a conferência falha e barra a resposta, às vezes sem derrubar o teste. Prova sem simulador usa `vi.stubEnv("INIA_RESPONSE_CHECK", "OFF")`, senão faz chamada real.
- **Testes com banco falso:** nunca devolva as mesmas linhas para qualquer SQL. A leitura de `prohibited_topics` as toma por regras, liga a conferência e, sem simulador, a chamada vai ao provedor por `generateAgentReplyWithUsage`. Com chave no `.env`, o teste paga a chamada e o resultado depende do modelo; sem chave, falha com `RESPONSE_CHECK_UNAVAILABLE` (visto em 06/11/2026 em `orchestrator-executor.test.ts`, que tem o `dbAnswering` como modelo).
- **Sessão real de voz:** para a fala violar uma regra, crie a regra de teste depois de a sessão abrir, porque a instrução da sessão fica congelada e só a conferência lê a regra nova. Apague a regra e a conversa por id ao final.

## Limitações

- A transcrição da fala vem do navegador: um cliente adulterado pode omiti-la ou alterá-la, e ela pode diferir do áudio.
- A sessão de voz já aberta mantém o que disse.
- A conferência é decisão de IA e pode errar nos dois sentidos.
- Resposta acima de 60 mil caracteres conta como falha.
- O monitoramento foi validado visualmente no banco de teste. No banco de desenvolvimento, não: faltou conta disponível com a permissão.
- Limite de atuação: uma resposta fiel à fonte e fora do limite ainda passou nas 5 rodadas (caso K07, multa de cancelamento num agente de suporte técnico). Esse julgamento é da V1 com o limite sozinho, e a V1 não foi alterada.
- O modelo é sensível ao texto: nas medições, ajustes em uma regra mudaram o resultado de casos de outra (J24, H26). Depois de qualquer ajuste, repita todos os casos, não só o que motivou a mudança.
- Não contam como fonte: resultados consolidados na síntese de Workflow e trechos que um especialista busca só durante a investigação (`query_knowledge`). Uma resposta apoiada só neles pode ser barrada como antes. Os números das ferramentas de dados contam desde a V5 (seção acima).
