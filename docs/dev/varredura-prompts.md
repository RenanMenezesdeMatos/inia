# Varredura dos prompts — onde dá para gastar menos (09/11/2026)

**Conclusão.** O maior desperdício está nos **argumentários do motor de feedback**. Cada análise de chamada leva em média **37
argumentários (25 mil tokens, metade do pedido)**, mas a IA avalia só **2,6** deles (p90: 6; máximo: 14). A revisão manda tudo de novo.
Escolher antes quais argumentários podem valer para a chamada cortaria cerca de 40 mil tokens por chamada analisada (análise +
revisão), algo como 35% a 40% do feedback de monitoria. É mudança de qualidade sensível: só com teste de recuperação antes.

Os outros achados são menores: rótulos explicativos repetidos em cada argumentário (~4 mil tokens por análise), o lembrete das rodadas
do roteamento colocado no meio do prompt (impede o cache entre rodadas) e texto repetido nas ferramentas do roteamento (~600 tokens).

Medido sem custo: banco de dev em modo leitura, rede bloqueada, prompts montados pelas funções reais, nenhuma IA chamada. Scripts em
[`varredura-prompts/`](varredura-prompts/). Tokens por proporção (3,99 caracteres por token).

## 1. Motor de feedback (187 análises reconstruídas, 45 dias)

| Parte da análise da chamada | Tokens (média) |
| --- | ---: |
| Instruções | 2.141 |
| Orientação do especialista | 386 |
| Transcrição (curtas no dev) | 610 |
| Procedimentos (4,9 documentos) | 20.385 |
| **Argumentários (37,1 por chamada)** | **25.321** |
| Catálogo de produtos | 139 |
| **Total** | **49.174** |

- **Argumentários enviados × usados.** Nas mesmas 187 análises, a IA registrou avaliação para 2,6 argumentários por chamada (850 "aplica",
  202 "não aplica"). Os outros ~34 foram lidos e descartados. Os argumentários vão por equipe, sem olhar assunto ou produto da chamada.
- **Procedimentos enviados × usados:** 4,8 documentos enviados, 1,9 com avaliação. Aqui o corte é mais arriscado: omissão e
  encerramento dependem de ler o procedimento inteiro, e a seleção por relevância já existe.
- **Revisão:** 49,3 mil tokens, dos quais **89% já foram enviados na análise** (procedimentos, argumentários, transcrição). É de propósito:
  a revisão é independente e precisa da regra completa. Cortar os argumentários na análise corta também aqui.
- **Texto repetido dentro do pedido:** 33% da análise está em trechos de 8 palavras que aparecem mais de uma vez; quase tudo nos
  argumentários (58% deles). Desse total, ~4 mil tokens (8% da análise) são **rótulos do código repetidos em cada item**, por exemplo:
  "CONDIÇÃO / GATILHO (situação a reconhecer na conversa inteira — não é busca de palavras):", "— todos exigidos quando a condição
  se aplica", "ARGUMENTÁRIO SUGERIDO (EXEMPLO de abordagem — não é texto obrigatório, nunca compare literalmente com a fala, não cria
  exigência):" e "REFERÊNCIA PARA A MONITORIA (...)", 37 vezes cada. O resto é conteúdo parecido entre argumentários do próprio cadastro
  (no dev, convertidos do cadastro antigo; não dá para generalizar para a Vivo).
- **Marcadores de linha** (`[L12]`): 6,5% do pedido. Necessários para a citação; já são curtos.
- **Espaços sobrando:** desprezível.

## 2. Chat (13 pessoas, 1 pergunta recente de cada; 39 montagens de especialista)

| Etapa | Tokens | Partes |
| --- | ---: | --- |
| Esclarecimento: sistema do planejador | 5.127 | instruções 1.703 · **lista das bases 3.244 (31 bases)** · limites 106 · glossário 49 · repetido dentro 636 |
| Roteamento: prompt do Orquestrador + ferramentas | 554 + 1.916 | 6,9 ferramentas; **601 tokens repetidos** entre as descrições (o mesmo texto do parâmetro `query` e o mesmo começo em cada uma) |
| Especialista: sistema | 1.497 | trecho das bases 558; quase nada repetido |

**Chamadas por pergunta** (agrupamento por pessoa com até 40 s entre chamadas, uso do dev): 3,0 rodadas de roteamento (18,6 mil tokens)
e 3,9 chamadas do esclarecimento (22,9 mil) por pergunta com Orquestrador; 59 de 84 perguntas tiveram 2 ou mais rodadas de roteamento.
O agrupamento pode juntar perguntas seguidas, então tratar como ordem de grandeza.

**O lembrete das rodadas quebra o cache.** A cada rodada, o roteamento manda o mesmo prompt mais os resultados das ferramentas, e
acrescenta ao FIM DO SISTEMA "restam N rodadas…" ([`run-orchestrated-reply.ts`](../../backend/src/modules/assistant/application/run-orchestrated-reply.ts:442)).
Como o sistema vem antes da conversa, a rodada 2 já difere da rodada 1 logo depois do sistema, e o cache não aproveita a conversa nem os
resultados. Com o lembrete depois dos resultados, cada rodada reaproveitaria a anterior inteira (~6 mil tokens). Não reduz o que é
enviado; reduz o que é cobrado, se a Vivo descontar o cache.

## 3. Oportunidades, do maior ganho para o menor

| # | O que mudar | Economia estimada | Risco de qualidade | Como testar aqui |
| --- | --- | --- | --- | --- |
| 1 | **Escolher antes os argumentários que podem valer** para a chamada e mandar só eles na análise e na revisão | ~40 mil tokens por chamada analisada (~35–40% do feedback) | **Alto se errar**: argumentário que valia e ficou de fora = ponto de feedback perdido | Repetir a escolha nas 187 análises e medir quantos dos 850 "aplica" a escolha manteria (recuperação). Meta: ~100% |
| 2 | Explicar os rótulos uma vez na legenda e usar etiquetas curtas em cada argumentário | ~4 mil por análise (+ ~4 mil na revisão); cai para ~0,7 mil se o item 1 for feito | Baixo a médio: muda o texto que o modelo lê junto de cada item | A/B pequeno nos casos de condição, opcional e "não se aplica" |
| 3 | Lembrete das rodadas do roteamento depois dos resultados, não no sistema | Até ~6 mil tokens em cache por rodada extra (custo, não envio) | Baixo: a frase é a mesma, muda o lugar | Comparar decisões de rodada num conjunto pequeno |
| 4 | Texto comum das ferramentas do roteamento dito uma vez | ~600 tokens por rodada de roteamento | Baixo | Comparar a escolha do especialista |
| 5 | Lista das bases do esclarecimento | — | — | Não mexer: 99% dela já se repete entre perguntas (bom para o cache) e a seleção com vetores de 06/11 não ganhou |

**Como escolher os argumentários do item 1 (três jeitos, um teste para cada):**

- **A IA escolhe, lendo só os gatilhos** (cerca de 37 × 1 linha + a conversa): uma chamada pequena (~3 mil tokens) antes da análise.
  Mantém a regra de que quem decide aplicabilidade é o modelo, não o código. Teste: ~US$ 0,40 nas 187 análises (dentro do teto de US$ 1).
- **RAG com vetores** (embeddings da conversa × gatilhos): sem chamada de IA a mais, mas o código passa a decidir o que o modelo vê, o
  que contraria a regra de aplicabilidade semântica decidida pelo modelo. Teste grátis com o `bge-m3` local (Ollama). A linha de
  vetores ficou de parar e só recomeçar com o seu OK.
- **Por cadastro** (assunto, produto, área do argumentário × da chamada): grátis e explicável, mas hoje a aplicabilidade é decidida pela
  leitura da conversa inteira; filtro por cadastro pode cortar o que valia.

Em todos, qualquer perda de recuperação mantém a mudança desligada (regra de qualidade antes de velocidade). Prompt e esquema são
contratos versionados: mudar exige nova versão e invalida o reaproveitamento das análises já pagas (a chave usa o hash do prompt).

## 4. RAG — onde cabe e onde não cabe

RAG (geração aumentada por recuperação) = em vez de mandar o material inteiro, buscar os trechos que importam para a pergunta e mandar
só eles. A INIA já faz isso no chat: o especialista recebe só os trechos encontrados nas bases, e o esclarecimento navega pela lista das
bases e abre só as seções que escolhe.

| Lugar | Cabe? | Por quê |
| --- | --- | --- |
| Argumentários no motor | **Sim, é o melhor candidato** | 37 enviados, 2,6 usados (item 1) |
| Procedimentos no motor | Com cuidado | Para apontar o que o operador deixou de fazer, a regra precisa estar inteira; uma busca por semelhança com a conversa pode não trazer justamente o que foi omitido |
| Esclarecimento e especialista no chat | Já é usado | O piloto com vetores (06/11) empatou com o fluxo atual; a busca não é o gargalo |
| Roteamento ("roteador semântico": escolher o especialista por semelhança, sem chamar a IA) | Possível, a testar | Pouparia rodadas de ~6 mil tokens, mas o roteamento também decide "nenhum especialista", vários especialistas e quando aprofundar. Teste grátis exige ter gravado qual especialista a IA escolheu em cada pergunta |

## 5. Limites

- Dev: argumentários convertidos do cadastro antigo, bases de teste, transcrições curtas, poucas pessoas. Na Vivo, o número de
  argumentários por equipe e o tamanho das transcrições podem ser bem diferentes.
- "Usado" = argumentário com avaliação registrada na análise. Um argumentário lido e considerado sem registro não aparece aqui.
- Revisão montada sem o JSON da análise (que muda por chamada).
- Chamadas por pergunta do chat: agrupamento aproximado.

## 6. Reproduzir

A partir de `backend/` (só números e rótulos do código na saída):

```bash
NODE_OPTIONS=--max-old-space-size=6144 npx tsx ../docs/dev/varredura-prompts/motor.mts
```

```bash
npx tsx ../docs/dev/varredura-prompts/chat.mts
```

Argumentários enviados × avaliados por análise:

```sql
select count(*) analises, round(avg(n), 1) argumentarios_avaliados
from (select analysis_run_id, count(distinct argument_script_id) n from call_criterion_assessments
      where created_at > now() - interval '45 days' group by 1) a;
```

## 7. Testes de 09/11 — escolher os argumentários antes da análise

Gabarito: as 187 análises do dev (45 dias), com os argumentários que cada uma recebeu (montados pelas funções reais) e os que ela
julgou "aplica" (472 pares análise × argumentário, em 94 análises; nas outras 93 nenhum se aplicou). A meta é não perder nenhum "aplica".

| Jeito de escolher | Mantém dos "aplica" | Perdidos | Argumentários enviados | Tokens de argumentário mantidos | Custo do teste |
| --- | ---: | ---: | ---: | ---: | ---: |
| Hoje (todos) | 100% | 0 | 37,1 | 100% | — |
| RAG com vetores (bge-m3 local), os 10 mais parecidos | 42,8% | 270 | 10 | 27% | grátis |
| RAG com vetores, os 20 mais parecidos | 69,3% | 145 | 20 | 54% | grátis |
| Os frequentes (≥ 10% de "aplica") + os 8 mais parecidos por vetor | 97,2% | 13 | 16,3 | 43% | grátis |
| Pelo cadastro (assunto) | não serve: nenhum argumentário do dev tem assunto cadastrado | — | — | — | grátis |
| **A IA escolhe lendo só os gatilhos** (94 análises com "aplica") | **99,6%** | **2** | 10,3 | 27% | US$ 0,51 |
| **A IA ∪ os frequentes (≥ 10%)** | **100%** | **0** | 11,8 | 30% | — |

- **Por que o RAG com vetores falhou:** vetor mede parecença de assunto, e o que mais vale são argumentários de condução geral, que
  valem em qualquer assunto: 10 argumentários respondem por 89% dos "aplica". "Aplica" depende do que aconteceu na conversa, não do tema.
- **A escolha pela IA** lê nome, "quando se aplica" e "quando não se aplica" de cada um mais a conversa, e responde com os códigos
  ("na dúvida, inclua"). Pedido de ~3,4 mil tokens, ~0,8 mil de saída e raciocínio, US$ 0,0055 por chamada. Os 2 perdidos são
  argumentários que valem em 15% das chamadas; somar os frequentes cobre os dois.
- **"Frequente" sem olhar a própria análise:** a taxa de cada argumentário foi calculada sem a análise testada. Na Vivo, essa taxa só
  existe depois de um histórico; até lá, mandar todos (como hoje) ou só a escolha da IA.

**Economia estimada por chamada analisada** (IA ∪ frequentes, mesma escolha na análise e na revisão): argumentários de 25,3 mil para
~7,6 mil tokens em cada uma → ~35 mil tokens a menos, menos ~4,2 mil da chamada de escolha = **~31 mil tokens líquidos (cerca de 32% de
análise + revisão)**. Em dinheiro, ~US$ 0,021 por chamada analisada (cerca de 10% dos ~US$ 0,20), porque saída e raciocínio pesam no
custo. Para o limite por minuto, conta o volume de tokens.

### RAG melhorado (grátis, 09/11): comparar por trecho e enriquecer o argumentário

Duas técnicas para o RAG achar melhor: (1) comparar com **trechos de 3 falas** da conversa (vale o mais parecido), não com a conversa
inteira; (2) usar o **argumentário completo** (orientação, pontos exigidos, o que evitar, referência da monitoria), não só o gatilho.

| Variante (vetores bge-m3 locais) | Mantém com 10 | Com 20 | Tokens com 20 |
| --- | ---: | ---: | ---: |
| Base: conversa inteira × gatilho | 42,8% | 69,3% | 54% |
| 1) Por trecho × gatilho | 61,9% | 85,4% | 54% |
| 2) Conversa inteira × argumentário completo | 49,8% | 74,2% | 54% |
| 1+2) Por trecho × argumentário completo | 69,3% | 90,9% (43 perdidos) | 53% |
| Frequentes + 1+2) com os 8 mais parecidos | — | 97,5% (12 perdidos) | 43% |

As duas técnicas ajudam, e juntas mais, mas ficam longe da escolha pela IA: com o mesmo volume (~27% dos tokens), o RAG mantém ~69% e a
IA 99,6%; com os frequentes, a IA chega a 100% e o RAG a 97,5% mandando mais. Para argumentários, a escolha pela IA continua sendo o
caminho; o custo dela (US$ 0,0055 por análise) é pequeno perto da análise. Script: [`argumentarios-rag2.mts`](varredura-prompts/argumentarios-rag2.mts).

### Revisão: mandar menos da base

| Revisão recebe | Base (tokens) | Corte |
| --- | ---: | ---: |
| Hoje: procedimentos e argumentários inteiros | 45.664 | — |
| Procedimentos inteiros + só os argumentários que a análise avaliou | 22.075 | 52% |
| Só os documentos e argumentários que a análise avaliou | 10.965 | 76% |

O primeiro corte mantém a regra completa dos procedimentos. Risco a medir: hoje a revisão pode notar um argumentário que a análise
pulou; sem ele na lista, não pode. O segundo corte é mais arriscado (omissão em documento que a análise não tocou).

### O que estes testes NÃO provam

- O gabarito é a decisão da própria análise com a lista inteira, não uma opinião independente.
- Não mede se a análise com menos argumentários conclui igual (pode até melhorar, com menos distração, ou mudar). Isso exige rodar a
  análise inteira nos dois jeitos e comparar, com mais de uma amostra por caso, porque o modelo varia muito entre repetições.
- Dev: argumentários convertidos do cadastro antigo, transcrições curtas.

### Próximos testes de qualidade (pagos, acima do teto de US$ 1: precisam de aprovação)

| Teste | O que compara | Custo estimado |
| --- | --- | ---: |
| Q1. Análise + revisão com argumentários escolhidos (IA ∪ frequentes) × lista inteira | pontos "aplica" e status de cada um, evidência, omissões; 10 casos × 2 jeitos × 2 repetições | ~US$ 8 |
| Q2. Revisão só com os argumentários avaliados | mesmas conclusões da revisão; 10 casos × 2 jeitos | ~US$ 2 |
| Q3. Chat: lembrete das rodadas no fim + resultados resumidos nas rodadas seguintes | respostas nas 16 perguntas do gabarito do chat × 2 jeitos | ~US$ 1,2 |

Reproduzir (a partir de `backend/`; o gabarito tem transcrições e vai para fora do repositório):

```bash
NODE_OPTIONS=--max-old-space-size=6144 npx tsx ../docs/dev/varredura-prompts/argumentarios-gabarito.mts /caminho/fora/do/repo/gabarito.json
```

```bash
npx tsx ../docs/dev/varredura-prompts/argumentarios-rag.mts /caminho/fora/do/repo/gabarito.json
```

```bash
npx tsx ../docs/dev/varredura-prompts/argumentarios-rag2.mts /caminho/fora/do/repo/gabarito.json
```

```bash
npx tsx ../docs/dev/varredura-prompts/argumentarios-ia.mts /caminho/fora/do/repo/gabarito.json /caminho/fora/do/repo/ia.jsonl 200 0.95
```
