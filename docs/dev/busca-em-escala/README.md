# Busca nas bases em escala — avaliação de recall (16/11/2026)

Script: `backend/scripts/dev/kb-scale-eval/eval-recall.ts`. Ele mede só se o trecho necessário chega à IA, e não mede a qualidade da resposta.

**Gabaritos:**
- `gold.json` (v1) traz as 16 perguntas do piloto de 06/11/2026: 13 com seção obrigatória, 20 seções no total.
- `gold-v2.json` traz 21 perguntas novas, quase todas paráfrases, escritas a partir de trechos sorteados e **gravadas antes de medir qualquer
  variante** (commit 8ac611db).
- Total: **41 seções obrigatórias**.

**Corpus:** `inia_chatbench`, só leitura, com 58 bases. A escala tem as mesmas 58 e mais 1000 sintéticas de distração (determinísticas, com
vocabulário operacional parecido e assuntos fora dos gabaritos), todas no escopo. É o pior caso da camada 1.

**Modelos:** bge-m3 local no Ollama (sem custo), `gemini-embedding-001` e `gemini-embedding-2`, os dois pelo mesmo adapter que a INIA usa.
**Gasto estimado:** US$ 0,26 (0,10 e 0,16; o preço do `gemini-embedding-2` foi estimado em US$ 0,25 por milhão de tokens), dentro do teto de US$ 2
aprovado.

Dados por seção e variante: `resultados/recall-<modelo>.json`.

## O que mudou no padrão

Os candidatos passaram a ser **seções**, e não partes de seção. As listas do vetor e do texto são **intercaladas**: 1º do vetor, 1º do texto,
2º do vetor, e assim por diante, no lugar da junção RRF. São **60 candidatos** (`DEFAULT_FUSION`, `HYBRID_RECALL_V2`).

O motivo é que a pré-leitura (as 8 seções que chegam lidas à primeira decisão) sai do topo da lista. Na RRF, o melhor do vetor ficava atrás de
seções que apareciam nas duas listas em posições medianas. Com 60 candidatos, a lista de bases e a ordem da pré-leitura não ficam maiores para a IA.

## Resultado (de 41 seções obrigatórias)

| Variante | bge-m3 · 58 | bge-m3 · 1058 | Gemini 001 · 58 | Gemini 001 · 1058 | Gemini 2 · 58 | Gemini 2 · 1058 |
|---|---|---|---|---|---|---|
| **Entre os candidatos** | | | | | | |
| Só BM25 (fluxo de texto de sempre) | 33 | 33 | 33 | 33 | 33 | 33 |
| V1 de 16/11 (RRF por trecho, 40) | 38 | 36 | 39 | 39 | 38 | 38 |
| **Novo padrão (seção, intercalado, 60)** | **39** | **38** | **39** | **39** | **41** | **40** |
| **Já lida na 1ª decisão** | | | | | | |
| Só BM25 | 23 | 23 | 23 | 23 | 23 | 23 |
| V1 de 16/11 | 31 | 30 | 34 | 34 | 35 | 35 |
| **Novo padrão** | **33** | **33** | **37** | **37** | **37** | **37** |
| **Base entre as 10 primeiras (descoberta)** | | | | | | |
| Novo padrão | 39 | 38 | 39 | 39 | 41 | 41 |

A lista que o fluxo atual mostra à IA traz 120 bases por ordem de título. Com 58 bases, as 41 seções ficam em bases listadas. Com 1058 bases, só
21 das 41 ficam. Com a busca nova, as 41 ficam listadas nas duas escalas.

A busca leva 18 a 145 ms de mediana com as 58 bases e até 780 ms no máximo com 1058 bases (vetor de 3072 posições). O vetor da pergunta não está
nessa conta.

## O que a troca custou (Gemini 001, intercalado × RRF)

- **Ganhou** 5 pré-leituras: G01, G02, G05, G09 e H14.
- **Perdeu** 2 pré-leituras em bases grandes: G06 e G16. As duas continuam entre os candidatos e com a base listada, então a IA pode pedir a
  leitura, como hoje.
- **Saiu dos candidatos** a seção "Débitos" da G04, que continua chegando lida porque a base é pequena e entra inteira.

O ganho se repete nos três modelos, nas duas escalas e no gabarito novo. No v2, a pré-leitura do bge-m3 foi de 16 para 19 seções.

## O que ficou de fora

- **Seções que nenhuma variante pré-lê** (Gemini 2): G02 e G06 (candidatas nas posições 4 a 7, fora das 8 pré-lidas pelo limite por base e de
  caracteres), G11 (fora dos candidatos), G14 e H13. Aumentar a pré-leitura deixaria a decisão mais lenta, como mostrou o piloto, e não foi testado.
- **Só vetor** pré-lê 38 de 41, mas perde os termos exatos (códigos, siglas, argumentário: piloto de 06/11). O BM25 fica.
- **Modelo da VM:** o gateway usa `text-embedding-3-small`, que não foi medido aqui (não há chave OpenAI no dev). Os dois Gemini foram melhores que o
  bge-m3 local. O `gemini-embedding-2` foi o melhor nos candidatos.

**Limites:** gabarito pequeno, então diferenças de 1 ou 2 seções estão no ruído. As distratoras são sintéticas, e variantes de produto reais
parecidas entre si são um caso mais difícil. A qualidade da resposta não foi remedida.

## Validação paga das respostas do chat (16/11/2026, teto aprovado US$ 2,00)

Script: `backend/scripts/dev/kb-scale-eval/eval-chat.ts`. Usa o serviço real do esclarecimento e o modelo real da rota de sempre
(`KNOWLEDGE_CLARIFICATION`, Gemini) sobre as **1058 bases** (58 reais + 1000 sintéticas). Para cada pergunta roda dois caminhos, alternando
qual vai primeiro: **desligada** (como era antes da busca) e **V2**. Foi 1 amostra por caminho. As respostas, o rastro e o custo **não ficam no repositório**, porque
o texto das bases de dev cita o cliente. Estão só na máquina de desenvolvimento, em `~/Developer/Works/inia-avaliacoes-locais/chat-escala-2026-11-16.jsonl`.

**Gasto:** US$ 1,38 calculados pelo uso devolvido pelo provedor, aos preços da tabela do piloto: ensaio de 1 pergunta (US$ 0,11) mais a
rodada (US$ 1,27).

**Seleção, registrada antes de rodar:** 16 perguntas.
- 8 cuja base o caminho desligado esconde nessa escala, por ficar fora das 120 primeiras por título: H02, G05, H03, G09, H07, G10, H13 e H18.
- 8 cuja base ele lista: G01, G04, G06, G16, H01, H05, H06 e H12.

**Critério:** os pontos obrigatórios gravados no gabarito antes da rodada (commit 77931c18), e cada resposta lida à mão. A leitura corrigiu a
conta automática em H01 (desligada) e H06 (V2): as duas estão certas com outras palavras.

| | Desligada | V2 |
|---|---|---|
| Resposta certa | 6 de 16 | **12 de 16** |
| Pergunta de esclarecimento legítima (as bases têm cenários diferentes) | 2 (H05, G16) | 4 (H02, G01, H05, H18) |
| Erro ("não encontrei", ou resposta pela regra geral sem a do produto) | **8** | **0** |
| Nas 8 bases escondidas | 0 certas e 8 erros | 6 certas e 2 esclarecimentos |
| Nas 8 bases listadas | 6 certas e 2 esclarecimentos | 6 certas e 2 esclarecimentos |
| Tempo por turno, mediana | 20,2 s | 17,7 s |
| Custo | US$ 0,80 (mediana 0,060) | US$ 0,58 (mediana 0,029) |

O que a leitura mostrou:
- **Todos os erros do caminho desligado vêm da escala.** A IA não vê a base certa e responde "não encontrei", como em G05, H03, H07, H13 e H18.
  Em G09, ela respondeu pela regra geral sem a do produto. Em G10, disse que não havia procedimento de Linha Móvel.
- **Nas bases que os dois veem, a V2 não piorou.**
  - G01: a V2 perguntou o tipo de análise, onde o desligado listou os prazos (o gabarito aceita os dois).
  - G16: o inverso — a V2 respondeu com os 4 pontos, e o desligado perguntou de qual serviço.
- **A V2 avisou divergência entre bases** quando ela existe (G09, G10), como fazia a referência do piloto.
- **H18 e H02 não foram respondidas direto pela V2:** ela perguntou o cenário (dados móveis ou Wi-Fi; procedimento padrão ou ÍRIS-12).
  É o comportamento esperado quando as bases têm caminhos diferentes. Não foi medida a resposta depois da escolha.

**Limites:** 1 amostra por caminho, só Gemini (o modelo da VM não foi medido), distratoras sintéticas, conferência das respostas (PEN-017)
fora do teste nos dois caminhos.

## Família × produto e siglas do glossário (16/11/2026)

**Pergunta do responsável:** quem pergunta pela família ("reparo de Dados Avançados") encontra a base que só fala do produto ("reparo de LP de
Dados no Sigitim")?

**Gabarito v3,** gravado antes de cada medição (commits 75c396ff, 4347c559 e cb61608f):
- T01–T06: família com nome descritivo.
- T07–T10: família com nome de marca.
- T11–T14: quatro bases da **mesma ação** (suspensão temporária) para quatro produtos de famílias com nome de marca. É o caso que separa.
- A01–A03: siglas do Glossário (ME, TT).

As bases dos casos T são fictícias (`taxonomy-fixtures.json`). A ligação família › produto existe só no cadastro.

**Na busca** (gemini-embedding-2; 58 seções; 1072 bases):

| | Entre os candidatos | Já lidas |
|---|---|---|
| V2 | 57 | 53 |
| V2 + produto cadastrado no texto do vetor | 57 | **54** |
| V2 + siglas do glossário na consulta | 56 | 53 |

- T01–T10 já eram achados sem o cadastro. Os nomes descritivos e a ação de cada base bastam, e o vetor entende "celular" como "linha móvel"
  sem ajuda.
- Na T11 (mesma ação, família com nome de marca), o produto cadastrado levou a base do 9º para o 1º lugar.
- As siglas não trouxeram ganho e tiraram 2 seções dos candidatos: **ficam desligadas.** O Glossário continua indo inteiro para a IA.

**No chat** (V2 sem × com produto; T11–T14, 1 amostra):
- **Sem o produto na lista da IA:** 4 de 4 "não encontrei".
- **Com o produto só na lista:** a IA achou a base e o valor certo nas 4, mas ressalvou "não encontrei para a linha Órion". A redação não via o
  produto.
- **Com o produto em frase** ("vale para Rastreador Veicular, produto da família Linha Órion") **na lista e na redação** (prompts V5): T11 e T13
  responderam direto e certo, nas 2 amostras.
- G09 e G10, que usam bases com produto, continuaram certas.

**Gasto do chat nesta aprovação:** US$ 1,84 de US$ 2 (1,38 + 0,27 + 0,06 + 0,04 + 0,08). Na busca, US$ 0,002.

## Gíria do Glossário na seção — opção 4 (23/11/2026)

Pergunta do responsável: o operador usa um termo da operação que a base não escreve. A busca acha a seção?

**Opção medida:** na indexação, a seção que contém o **termo oficial** ganha uma linha `Também chamado: <gíria>`. O termo oficial é a 1ª
oração da definição no Glossário. A pergunta do operador não muda. Foram três variantes: a gíria no texto e no vetor, só no texto (BM25) e
só no vetor. Implementado **só no roteiro** (`withJargon` em `eval-recall.ts`); nada mudou no produto.

**Gabarito v4** (`gold-v4-jargao.json`, sha256 `9a1d60d5…0fde7a`, gravado antes de medir): 20 perguntas (J01–J20) e 20 seções em 5 procedimentos
reais (reparo de banda larga, contestação, cancelamento, portabilidade móvel, gestor e titularidade entre empresas).
- **As gírias são sintéticas,** criadas pela IA a pedido do responsável ("pane de bairro", "conta gêmea", "número tampão", "papo de 171"…).
  Elas testam o mecanismo, não a cobertura do jargão real da operação.
- Nenhuma gíria existe no corpus, e a pergunta nunca usa o termo oficial.
- O enriquecimento tocou 59 seções com as bases reais e 368 com as distratoras, porque termos como "roaming internacional" estão nelas.

**Resultado:** seções já lidas na 1ª decisão. J = as 20 do jargão; demais = as 58 dos gabaritos v1–v3. As seções entre os candidatos não caíram
em nenhum caso.

| Modelo · escala | V2: J | V2 + gíria (texto e vetor): J · demais | Só texto: J · demais | Só vetor: J · demais |
|---|---|---|---|---|
| bge-m3 · 72 | 6 | **19** · 44 (−1) | 15 · 45 | **19** · 44 (−1) |
| bge-m3 · 1072 | 6 | **18** · 44 (−1) | 13 · 45 | **18** · 44 (−1) |
| gemini-embedding-001 · 72 | 13 | **20** · 53 | 16 · 53 | **20** · 53 |
| gemini-embedding-001 · 1072 | 13 | **20** · 52 (−1) | 16 · 52 (−1) | **20** · 53 |
| gemini-embedding-2 · 72 | 17 | **20** · 53 | **20** · 53 | 18 · 53 |
| gemini-embedding-2 · 1072 | 17 | **20** · 52 (−1) | **20** · 52 (−1) | 18 · 53 |

- **O ganho no jargão é grande e se repete nos três modelos.** No bge-m3, a pré-leitura do jargão foi de 6 para 18–19 de 20. No Gemini 001,
  de 13 para 20.
- Sem ajuda, o vetor do Gemini já entende parte das gírias (13–17 de 20). Só o BM25 acha 1–3.
- **As perdas, sempre de 1 seção e só na pré-leitura:**
  - G05 no bge-m3, com a gíria no vetor: caiu da 3ª para a 5ª posição;
  - G09 com 1072 bases no Gemini, com a gíria no texto: caiu da 7ª para a 9ª/10ª posição.

  As duas continuam entre os candidatos. Pelo tamanho do gabarito, estão no ruído, mas pela regra (qualidade não pode cair) contam.
- **Sem nenhuma perda:** só a variante "só vetor" no gemini-embedding-001 (20 de 20 no jargão; 53 e 53 nas demais).

**Gasto:** US$ 0,28 estimados (Gemini 001: 0,10; Gemini 2: 0,17). O bge-m3 é local, sem custo.

**Limites:**
- Gírias sintéticas e "limpas": cada uma é a única pista da pergunta.
- A regra "1ª oração da definição = termo oficial" é uma convenção que o cadastro do Glossário teria que seguir.
- O modelo da VM (`text-embedding-3-small`) não foi medido.
- A qualidade da resposta do chat não foi medida.
- O motor de feedback (transcrição) não usa esta busca.

**Decisão do responsável (23/11/2026):** a gíria entra **só no vetor** (a variante sem perda no Gemini 001) e fica **desligada**.
Interruptor `INIA_KB_GLOSSARY_JARGON_VECTORS=on` na API e no processamento, depois reinício (migration 251). Detalhes em
`docs/dev/memoria/agentes-e-conhecimento.md`, "Gíria do Glossário no vetor".
