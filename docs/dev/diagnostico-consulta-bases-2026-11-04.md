# Diagnóstico da consulta às bases no chat (04/11/2026)

Somente diagnóstico, com código, testes, rastros e amostras já existentes. `PRINCIPAL:` = checkout `admin-list-standardization`. `BRANCH:` = `claude/kb-chat-flow`, onde estão as amostras, em `docs/dev/consulta-bases-chat/resultados/`. Na matriz: S sim, N não, NO não observado.

## A. Veredito

O maior custo medido é a decisão depois da leitura: mediana de 12,9 s em pergunta nova (n=17) e 30,8 s na continuação de Banda Larga (n=4), contra cerca de 7 s da decisão que pede leitura. A perda mais frequente vem antes dela, na escolha do que ler: q08 perdeu débitos e prazo em 5 de 14 amostras padrão sem que essas seções tivessem sido lidas. A segunda seleção descartou informação necessária em Banda Larga (1 de 12 no padrão, em contexto congelado; as outras 11 perguntaram), mas nas 11 amostras padrão em que descartou seções nenhuma seção esperada se perdeu. Os três casos de omissão têm o esperado em base fictícia de teste, competindo com um procedimento amplo, então não se sabe quanto valem para o catálogo do cliente. Não há evidência para mudar a arquitetura nem para eliminar a segunda decisão, que também pergunta, recusa e declara conflitos.

## B. Estado analisado

| Checkout | Branch/commit | Alterações locais relevantes | Comportamento ativo |
| --- | --- | --- | --- |
| Principal | `admin-list-standardization` `cdc379e2` | sem commit: rótulos e avisos de progresso (serviço, rota, transporte) e trabalho de outras sessões | atende `:3000` e `:3333`. Prompts V4 desde `b70a1a79` (26/10), sem política ativa no dev, sem leituras reaproveitadas e sem limite por mensagem |
| Worktree `kb-chat-flow` | `claude/kb-chat-flow` `12f64655`, base `69374087` | nenhuma | não atende a tela. Leituras reaproveitadas desligadas, limites por mensagem ligados |
| Experimentos removidos | `avaliacao-do-cache.patch` sobre `a97b1c6e`; `raciocinio-baixo.patch` sobre `8c1cf9c2` | só em patch | não ativos |

**Versão das amostras:**
- Lado OFF de `validacao-ampliada`, `validacao-complementar` e `validacao-q08`: o mais próximo do principal.
- Lado `on:false` de `validacao-ultima-decisao` e `validacao-respostas-diretas`: raciocínio padrão, mas com leituras reaproveitadas ligadas na continuação.
- Rastros anteriores a 26/10 usaram prompts anteriores à V4.

## C. Fluxo atual

```
PERGUNTA NOVA (realtime-router.ts:1685)
 R  roteamento especulativo, em paralelo; descartado se o esclarecimento responder (:1701)
 1  DECISÃO: catálogo (até 12 títulos por base, knowledge-workspace.ts:149) + pergunta
    ▸ SELEÇÃO 1: o que abrir e ler, até 6 bases e 12 seções (clarification-contract.ts:82-83)
    leitura sem IA: 6 mil por seção, 30 mil no total; acima disso fica de fora (workspace:88)
 2  DECISÃO depois da leitura, com o catálogo de novo; até 2 rodadas de leitura (service:94)
    → READ | CLARIFY | INSUFFICIENT | NOT_APPLICABLE | ANSWER
    ▸ SELEÇÃO 2: answerEvidence, até 12 seções. Vale citar título não lido (workspace:136)
    ▸ FILTRO: marcador fora do que foi mostrado cai em silêncio (contract:257)
 3  CONTEXTO, sem IA: evidências + fontes de conflito (service:331)
    ▸ CORTE: acima de 24 mil caracteres a seção fica de fora, em silêncio (service:327)
 4  REDAÇÃO em fluxo, com validação de marcadores e 1 correção
 5  CONFERÊNCIA, quando há regra: segura o texto (router:1297)

FORMULÁRIO (service:182): sem R. Evidência da opção escolhida já começa aberta, e a seção citada, lida (:210-212). Depois, 1 a 5.
DIGITADA com etapa aberta: sem R. Opções abertas. "Outro assunto" recomeça com nova decisão (:238).
VOZ: as mesmas etapas por /tool-call (router:887), sem redação em fluxo.
```

## D. Evidências de omissão

| Caso/amostra | Informação necessária | Primeiro ponto de perda | Evidência | Padrão ou experimento | Certeza |
| --- | --- | --- | --- | --- | --- |
| Banda Larga: `complementar` `reparo-base-grande-escolha` OFF 2 | 24 horas e 30 segundos (base fictícia) | escolha da leitura | leu só §§ 57 e 58; resposta sem prazo (`revisao-respostas.json`) | padrão | comprovado |
| Banda Larga: `etapa-a` A1 padrão 6 | idem | decisão depois da leitura | base no contexto, não citada; citadas = válidas, filtro não agiu | padrão, contexto selecionado | comprovado |
| Banda Larga: rastros 27/10 14:03 e 04/11 15:04 | idem | não citada; leitura por seção não gravada | a de 04/11 traz prazos da § 30, sem 24 horas e sem aviso | padrão, principal | não observado |
| Fator que agrava: `etapa-a` A1+A3 | idem | decisão | omissão em 11 de 12 com raciocínio baixo × 1 de 12 | experimento | comprovado |
| q08: `validacao-q08` OFF 3, 5, 8, 10 e `ampliada` OFF 1 | débitos (§ 10) e prazo (§ 11), base fictícia | escolha da leitura | § 5 lida; §§ 10 e 11 visíveis na 1ª vista, nem lidas nem citadas | padrão | comprovado até a redação; resposta não observado |
| q08, contraprova: `validacao-q08` OFF 1; rastro 20/10 (correção) | idem | sem perda | citou sem ler; a resposta do rastro traz débitos e 3 dias | padrão; rastro com prompt antigo | comprovado |
| Segunda via: `ultima` q16 `on:false` 1 | canal e prazo por produto, só nas bases fictícias | escolha da leitura | leu só o procedimento geral; a amostra 2 perguntou | padrão | comprovado até a decisão; resposta não observado |
| Fator que agrava: q16 `on:true` 1 e 2 | idem | decisão | leu regras gerais e descartou, sem perguntar | experimento | comprovado |
| Conflito: `diretas` `on:false` 1; rastro 27/10 11:31 | 24 horas × § 30 | sem perda | as duas fontes chegaram, e a resposta avisa | padrão | comprovado |
| Conflito: `diretas` `on:false` 3 | idem | escolha da leitura | § 30 não lida, sem aviso | padrão | comprovado |
| Conflito: `etapa-a` A3 baixo; A4 | idem; contradição direta | decisão | A3: 0 conflitos em 5 respostas. A4: padrão 6 de 6 | experimento e padrão | comprovado |

| Amostra | Existia | Acesso | Catálogo | Lida | Contexto | Selecionada | Filtro descartou | Redação | Resposta |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Banda Larga `complementar` OFF 2 | S | S | aberta | N | N | N | NO | N | N |
| Banda Larga `etapa-a` A1-6 | S | S | aberta | S | S | N | N | N | N |
| Banda Larga rastro 27/10 14:03 | S | S | aberta | NO | NO | NO | NO | NO | N |
| q08 `validacao-q08` OFF 3 | S | S | 1ª vista, posições 11 e 12 | N | N | N | NO | N | NO |
| q08 `validacao-q08` OFF 1 | S | S | 1ª vista | N | N | S, pelo título | NO | S | NO |
| q16 `ultima` `on:false` 1 | só em teste | S | 1ª vista | N | N | N | NO | N | NO |
| Conflito `diretas` `on:false` 1 | S | S | aberta | S | S | S | NO | S | S |

**Quando o esclarecimento é necessário:**
- Banda Larga × Linha Móvel muda prazo e visita (24 × 72 horas).
- Na Segunda via, só as bases fictícias distinguem produtos: SMS em 10 minutos, e-mail em 2 horas, Correios em 5 dias úteis. O procedimento geral não tem essa dimensão, e sem aquelas bases a resposta direta seria adequada.
- O conflito 24 horas × § 30 também nasce de conteúdo fictício.

**A favor da hipótese:** A1-6 e o custo da decisão pós-leitura.

**Contra:**
- nas 34 amostras padrão com contexto de redação, houve 11 descartes, todos fora das seções esperadas (o gabarito é parcial);
- 2 amostras acrescentaram seções sem ler;
- depois do READ, os rastros mostram 12 CLARIFY em 15 perguntas novas e 3 em 13 escolhas;
- q01 e q02, em base única e sem conteúdo de teste, levaram tudo à redação em 4 de 4 cada.

**Correções a relatórios anteriores:**
- "Segunda via, 3 de 4 sem raciocínio baixo" estava errado: foi 1 de 2 no padrão e 2 de 2 com raciocínio baixo.
- "3 de 3 em 21/10" não aparece nos rastros: lá foi 1 de 3, com prompt antigo.
- O conflito real com raciocínio padrão tem medição, ao contrário do que eu disse.
- "29 de 41 bases pequenas" engana: 27 são de teste, e das outras 14 só 2 têm até 8 mil caracteres.

## E. Custo e tempo existentes

| Caminho | Etapa | Chamadas/tokens/tempo | Amostra | Limitação |
| --- | --- | --- | --- | --- |
| Nova, chat | turno inteiro | ANSWER p50 17,1 s (9,2–65,4); CLARIFY 18,4 s; INSUFFICIENT 17,4 s | 18; 7; 9 | rastros de 20/10 a 04/11, código variou |
| Formulário, chat | turno inteiro | ANSWER p50 24,6 s (13–34,5); correção 38 s | 6; 3 | idem |
| Digitada, chat | turno inteiro | não medido | 0 | os 10 rastros são de voz |
| Nova | decisão com READ | p50 6,8 s; ~8,9 mil tokens; raciocínio 465 | 26 | `ultima`, `diretas`; selecionadas |
| Nova | decisão final; redação | p50 12,9 s, ~10,9 mil, raciocínio 707; 5,1 s, ~2,6 mil | 17; 2 | idem |
| Formulário (Banda Larga) | decisão com READ | p50 7,1 s; ~10,9 mil | 4 | só um caso; leituras reaproveitadas ligadas |
| Formulário (Banda Larga) | decisão final; redação | p50 30,8 s, ~14,7 mil, raciocínio 3.371; 6,8 s, ~4,3 mil | 4; 2 | idem |
| Todos | esclarecimento, entrada ≥ 5.500 | p50 7,6 s; p90 14,6 s; ~8,3 mil de entrada | 184 | sem etiqueta de etapa; recorte por tamanho |
| Nova | R | p50 4,3 s; ~4,1 mil de entrada | 76 | descarte só em log, não medido |
| Com regra | conferência | p50 1,2 s; ~680 de entrada | 13 | recente |
| Falhas | erros e repetições | esclarecimento 4 limite, 1 tempo; R 8 tempo, 4 limite, 4 provedor; 0 repetições gravadas; 0 correções em 96 | dev | a tabela não mostra repetição interna |
| Local | banco e catálogo; leitura cortada por orçamento | 7–31 ms; 0 em 96 | não informada; rastros | 21/10 (`relatorio.md:49`); corte de 24 mil não gravado |

**Trabalho a examinar:**
- Sequência necessária: decidir o que ler → ler → decidir → redigir.
- Paralelo existente: R com a decisão.
- Repetido: o catálogo a cada decisão. A utilidade na última rodada é hipótese, porque permite citar pelo título.
- Duplicado: releitura literal em 2 de 6 amostras sem a melhoria (`diagnostico-trabalho-evitavel.json`).

## F. Alternativas

| Alternativa | Mudança concreta | Trabalho eliminado | Proteção da qualidade | Riscos | Dependência de provedor | Esforço |
| --- | --- | --- | --- | --- | --- | --- |
| 1. Manter o fluxo, preservando a evidência da escolha | seção lida de base citada pela opção escolhida entra na redação, dentro de 24 mil | nenhum; acrescenta contexto (benefício: hipótese) | ataca A1-6; só a escolha atual, com versão e acesso de agora | contexto maior; não resolve o que não foi lido | nenhuma | pequeno |
| 2. Ler inteira a base pequena tocada | seção lida ou base escolhida de até 8 mil entra inteira, ampliando o `readSmallBases` da branch | rodada de READ na continuação (medido, misturado com cache: 3 → 2 chamadas); na qualidade, hipótese | cobre q08 e `complementar` OFF 2; mantém tetos; regra só de tamanho e origem | 2 de 14 bases sem título de teste são pequenas; a decisão ainda pode não citar; não cobre Segunda via | nenhuma | pequeno |
| 3. Unir decisão final e redação | a chamada depois da leitura já redige quando decidir responder | uma chamada no caminho ANSWER (hipótese) | exige manter CLARIFY, INSUFFICIENT, conflitos e marcadores | muda prompt e contrato; qualidade sensível ao raciocínio (Etapa A) | saída estruturada em fluxo; não medida no cliente | alto |

As regras acima são genéricas de integridade, sem lista de palavras nem regra de negócio. Nenhuma envia todas as bases: o relevante continua vindo da escolha da pessoa e da seção que a IA pediu.

## G. Recomendação

**Não mudar ainda.** A alternativa 2 é a candidata mais forte, nesta ordem de avaliação: 2, depois 1. A alternativa 3 só com proposta própria.

- **Por que:** a causa mais frequente observada é a seção não lida, não o descarte depois da leitura. A alternativa 2 atua nela sem prompt nem contrato; a 1 cobre o caso restante.
- **Preservar:** a decisão pós-leitura com CLARIFY, INSUFFICIENT e conflitos; citar por título; versão, acesso e cenário abandonado; marcadores.
- **Evidência que falta:**
  - catálogo do cliente: quantas bases pequenas e quantas sobreposições entre bases;
  - resposta final de q08 (a redação não foi chamada);
  - rastro por seção (lidas, citadas, filtradas, levadas à redação), sem conteúdo;
  - saída bruta fora da Etapa A;
  - repetir os casos sem as bases fictícias.
- **Alcance:** 2 ajuda a continuação e a pergunta nova quando a IA lê uma seção de base pequena. 1 só ajuda a continuação. 3 ajudaria ambas no caminho ANSWER. Nenhuma resolve Segunda via, em que as bases de produto nem são abertas.

## H. Próxima validação mínima

**1. Testes locais, sem IA:**
- O rastro por seção registra lidas, citadas, filtradas e levadas à redação, e nunca o texto.
- Com modelo roteirizado, `q08` lê § 5 e o prompt seguinte traz §§ 10 e 11; base grande não muda.
- Opção abandonada, base fora do acesso e versão nova ficam de fora.
- Os tetos de 15 mil, 30 mil e 24 mil continuam valendo, e corte vira registro.
- Pergunta nova sem base pequena envia exatamente os mesmos prompts.

**2. Comparação futura com o cliente, não executar:**

| Caso | Conteúdo esperado | Falha crítica |
| --- | --- | --- |
| Reparo → Banda Larga, escolha | 24 horas, 30 segundos, visita se o teste falhar | sem prazo ou condição |
| Reparo → Linha Móvel | 72 horas, sem visita | regra de Banda Larga |
| q08 | documentos, débitos, 3 dias úteis | omitir débitos ou prazo |
| Segunda via com bases de produto | perguntar o produto ou cobrir cada um | responder uma orientação só |
| Segunda via sem elas | resposta direta do procedimento | pergunta inventada |
| q01 | prazo por situação | prazo errado |
| 24 horas × § 30 e contradição controlada | avisar e mostrar os dois lados | conflito omitido |
| Alteração de escolha; acesso removido | só o cenário e o acesso atuais | conteúdo abandonado ou fora do acesso |

Rodada inicial pequena, por cenário, com preço e limites confirmados na conexão do cliente. Custo: não estimado.

## I. Índice de evidências

- Código: `PRINCIPAL: backend/src/modules/knowledge-clarification/application/knowledge-clarification-service.ts:94,182,210-212,238,246,271,320-335`; `domain/clarification-contract.ts:82-83,257`; `domain/knowledge-workspace.ts:88,136,149,178`; `domain/clarification-prompts.ts:34`; `realtime/presentation/realtime-router.ts:887,1297,1685,1701`.
- Amostras: `BRANCH: validacao-q08.json` (scenario `q08`); `validacao-complementar.json` (`reparo-base-grande-escolha`, `q08`); `validacao-ampliada.json` (`q08`, `q02`); `validacao-ultima-decisao.json` (`q01`, `q02`, `q07`, `q16`); `validacao-respostas-diretas.json` (`reparo-banda-larga-escolha`, `q01`); `etapa-a.json` e `etapa-a-respostas.md` (A1, A3, A4); `revisao-respostas.json`; `diagnostico-trabalho-evitavel.json`; `local.json`.
- Gabarito: `BRANCH: backend/scripts/dev/kb-chat-eval/questions.json` (q08, q16) e `answer-criteria.ts`.
- Bases de teste: `[Teste esclarecimento] Troca de Titularidade — Empresa`; `TESTE PRODUTOS · Reparo — Banda Larga`; `TESTE PRODUTOS · Segunda via — *`. Concorrentes: `Procedimento Operacional — Troca de Titularidade entre Empresas` § 43; `Procedimento Operacional — Reparo de Banda Larga` § 30; `Procedimento Operacional Segunda Via de Conta`.
- Banco de desenvolvimento: `assistant_interactions.tool_calls` (`knowledge_clarification`: trace e state) e `ai_usage_events` desde 20/10.
- Patches: `BRANCH: docs/dev/consulta-bases-chat/avaliacao-do-cache.patch` e `raciocinio-baixo.patch`.
