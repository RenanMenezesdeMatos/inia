# Rodada V10 (02/10/2026) — comparação de contratos + rodada real, avaliação

**Quem avaliou e como.** Claude (modelo de IA, na mesma sessão de código que escreveu o contrato e as correções), lendo as respostas
gravadas contra dois gabaritos registrados ANTES de qualquer chamada paga desta rodada: o revisado da V9 (`round-v9-ground-truth.md`,
inalterado — sha256 nos artefatos) para as chamadas reais e `round-v10-synthetic-ground-truth.md` para o caso sintético. **Não é
validação humana independente.** O que não está em nenhum gabarito foi avaliado caso a caso e está marcado como tal.

Artefatos (`results/`): `round-v10-comparison-paid-2026-10-02T14-44-16-633Z.json` (+ `.prompts.json`),
`round-v10-paid-2026-10-02T15-07-50-074Z.json` (+ `.prompts.json`), `round-v10-budget-ledger.json` (orçamento global da tarefa),
replays sem custo `replay-obligations-v10-*.json`, `replay-round-v9-*.json`, `replay-round-v10-*.json`.

## 1. Comparação focal de contratos (mesmo modelo, mesmos parâmetros, mesma entrada)

Mensagem do usuário da V9 reproduzida byte a byte pelo motor atual (A: sha `cb7f8bb9…`, B: `ba19cf47…`); só instruções e schema mudam.
Parâmetros efetivos nos dois lados: gemini-3.8-flash, `responseMimeType: application/json` + `responseSchema`, `maxOutputTokens`
24.576, sem temperatura nem orçamento de raciocínio explícitos (padrões do provedor), nenhuma resposta cortada (`STOP`).
Referência = respostas pagas da V9 (uma por chamada) — **não é comparação estatística**.

| | V9 (contrato atual, por linha) | Alternativa `OBLIGATIONS_V1` (orientada ao caso) |
|---|---|---|
| Instruções do sistema | 13.399 caracteres | 5.882 caracteres |
| A — custo / saída | US$ 0,0549 · 7.624 tokens de saída+raciocínio | US$ 0,0515 · 7.078 |
| B — custo / saída | US$ 0,0848 · 15.271 | US$ 0,0471 · 5.600 |
| A — unidades | 12 critérios; 109 itens do caminho "sem avaliação" (40 à revisão, 57 nunca) | 9 obrigações completas; 0 declaradas não avaliadas |
| B — unidades | 21 critérios + 2 grupos | 5 obrigações; 2 declaradas não avaliadas; 4 itens do argumentário sem destino (o código os torna lacuna) |
| A — leituras inaceitáveis | consultas internas (§9, 21 itens) como cumprido; estorno no lugar de crédito (parcial) | consulta interna (§21 "Verificar") como cumprido; "abrir análise" com a declaração (T11) rotulada como conduta; estorno no lugar de crédito (parcial) |
| A — ponto material (cancelamento pendente, A9) | não encontrado | não encontrado |
| A — condição × conduta | (V8 tinha "Existir cobrança…" como acerto) | condição separada da ação ("Abrir análise quando: existir cobrança…") |
| B — ponto material (protocolo antes de transferir, B6) | fora do caminho da análise; só a revisora achou (descartado pelo código) | **encontrado pela própria análise** (parcial: motivo dito, número não) |
| B — "fatura ou parcelamento" (B2) | NÃO cumprido por leitura literal (inaceitável) | não avaliado pela análise (sem acusação) |
| B — "testar, quando possível, outro canal" (B3) | NÃO cumprido sem ler o "quando possível" (inaceitável) | não avaliado (sem acusação) |
| B — "SMS … autorizado" (B5) | cumprido (elogio inaceitável) | não avaliado (sem elogio) |
| B — e-mail novo sem validação (B4) | NÃO cumprido (acusação) | PARCIAL (acusação) — mas o próprio modelo marcou as falas como intenção/declaração |
| B — verificação/registro internos | "verificar indisponibilidade" cumprido | "verificar" e "registrar" como partes FEITAS de uma obrigação cumprida (inaceitável) |

**Caso sintético** (`synthetic-paraphrase-case.ts`, outro serviço, outras palavras; SINTÉTICO, não substitui as chamadas reais):
**9 de 9 conforme o gabarito** — paráfrase que define a escolha (cumpriu), "quando a agenda permitir" (não verificável),
registro/consulta/envio declarados (não verificáveis), recebimento ≠ destino verificado (não verificável), condição presente com ação
interna (não verificável), alternativa escolhida (cumpriu), mencionar a OS ≠ informar o número (parcial), ausência real de "mais
alguma dúvida" (não cumpriu). Não houve controle no contrato V7 para o sintético (sem requisição disponível).

**Leitura da comparação:** a alternativa é mais barata, menos ruidosa e acerta a cobertura do caso B (protocolo); na A tem a mesma
qualidade da V9, com erros diferentes; nos dois lados o modelo erra declaração/execução interna e estorno. **Confusão registrada:** a
alternativa traz dois princípios novos (mencionar ≠ comunicar; confirmação do cliente comprova só o relatado) além da mudança de
estrutura — a comparação não separa o efeito de cada um. Decisão: incorporar a alternativa CONGELADA (o prompt medido é o de
produção) e corrigir no código e na revisão o que o próprio modelo declarou — sem mudar o prompt depois de medido.

## 2. Rodada real V10 (análise = resposta paga da comparação; revisão, confirmação, redação e ferramentas pagas aqui)

### A — C07
- Diagnóstico: titular validado (cumpriu, confirmado), escuta/identificação (cumpriu), recapitulação com valor, ação, prazo, canal e
  protocolo (cumpriu), dúvidas (cumpriu); "Verificar: data/falha" e "Abrir análise quando: existir cobrança…" → **não observáveis,
  fala registrada como declaração** (a revisora leu "declaração sobre ação" / "depende de algo fora da fala"); correções internas →
  não observáveis; estorno × crédito → **não observável pelo código** (o próprio modelo leu a combinação dos itens como indefinida,
  com crédito feito). A revisora repetiu o estorno como "obrigação de fora" com as MESMAS linhas — descartado como duplicata
  (corrigido depois: agora fica registrado na obrigação existente). Marca "Vivo" × "Conecta" lida como parcial (baixa, rotina) —
  leitura literal da base; provavelmente inconsistência da massa demo. Caminho "parcialmente correto" confirmado — apoiado nesse
  ponto de marca.
- Ponto material A9 (o que acontece com o cancelamento pendente): **não encontrado** pela análise nem pela revisão.
- Texto produzido (exato):
  > **Contestação de cobrança** · Atendimento de 21/08/2026
  > **Card:** Você protegeu os dados da titular ao validar o cadastro antes da consulta e fechou a contestação de R$ 59,90 com prazos, canal e protocolo bem explicados.
  >
  > Ao atender a cliente sobre a fatura gerada após o pedido de cancelamento, você teve o cuidado de confirmar a titularidade e a data de nascimento antes de consultar os dados da linha. Essa conduta protegeu as informações da titular logo no início do contato, respaldando a verificação do histórico da linha.
  >
  > A apuração foi direta ao identificar exatamente o valor questionado, a fatura correspondente e o fato de a conta já ter sido paga. No encerramento, as orientações ficaram bem claras, com o resumo da contestação de R$ 59,90, o prazo de cinco dias úteis, o canal de retorno por SMS e o protocolo.

### B — DEMO-INT-0001-08
- Diagnóstico: **protocolo antes da transferência — parcial confirmado** (motivo dito; número não); "informe o número do protocolo"
  (checklist) — não cumprido confirmado (mesmo fato); explicação dos lançamentos — cumpriu.
- Barrado sem chegar à memória como fato:
  - acusação do e-mail, pelo código: a prova era intenção/declaração;
  - a mesma acusação, refeita pela revisora como obrigação de fora, foi pela confirmação focal: **INCERTA**, "a ausência de
    validação verbal não comprova a omissão";
  - "verificar/registrar" da exceção: a revisora disse que depende de algo fora da fala.
- Itens do argumentário "Segunda via", **os 4 avaliados pela revisão**:
  - "fatura ou parcelamento": cumprido por T33, por paráfrase; leitura registrada, não confirmada (acerto só da revisão);
  - "orientar o app depois de confirmar": a revisora disse parcial → **REFUTADO** pela confirmação focal (T71);
  - os dois "evitar": cumpridos.
- Nada de "testar outro canal", nada de elogio ao SMS.
- **Mensagem não produzida**: o primeiro rascunho passou inteiro no verificador, mas o código recusou a frase que reconhecia a parte
  feita do ponto parcial (o ponto chegava ao redator sem as partes); o reparo pedido gastou a última requisição de B e a verificação
  dele não coube → `NO_SAFE_MESSAGE:MODEL_BUDGET_EXHAUSTED`.
- **Replay sem custo com o código corrigido depois da rodada (NÃO é saída paga do motor; corrigida, ainda não revalidada)** — as
  MESMAS respostas pagas de redação e verificação produzem:
  > **Dúvida sobre fatura e segunda via de conta com falha no aplicativo** · Atendimento de 10/08/2026
  > **Card:** Você explicou com clareza os lançamentos da fatura e o motivo da transferência. Daqui para frente, passe também o protocolo ao cliente antes de transferir.
  >
  > Você explicou com clareza os valores da fatura para a cliente, detalhando o plano, o serviço adicional e a cobrança proporcional pela troca de plano no meio do ciclo. No momento de direcionar o atendimento para o faturamento, você também explicou o motivo da transferência.
  >
  > Daqui para frente, antes de transferir a ligação ou finalizar o atendimento, informe também o número do protocolo diretamente para o cliente.

### C — TMA agosto/2026
- Planejador (contrato de argumentos completo): pediu `segment_indicator {dimension: SUBJECT}`, `detect_anomalies`,
  `inspect_indicator_composition`, `compare_periods` — **as 4 executaram**. Assunto: nenhum recorte com volume mínimo (contestação
  534 s em 10 chamadas; demais com 1). Dia: **04/08 atípico** (377,8 s × base 354,3 s) → recorte R1 → pergunta das chamadas daquele
  dia ficou sem exame (sem orçamento para análise) → conclusão `CHANGE_LOCATED_NOT_EXAMINED`, com a limitação nos detalhes.
- Universo/amostra: medição diária de 21 dias; 13 chamadas gravadas em agosto e 1 em julho (comparar assuntos entre meses
  impossível); nenhuma chamada do recorte analisada; nenhuma terceira chamada da Larissa analisada.
- Texto produzido (exato):
  > **Tempo Médio de Atendimento** · agosto/2026
  > **Card:** Em agosto, o seu Tempo Médio de Atendimento fechou em 357 s, dentro da meta de 400 s e com melhora em relação aos 382 s de julho.
  >
  > Em agosto, o seu Tempo Médio de Atendimento fechou em 357 segundos, ficando dentro da meta de 400 segundos e melhorando em relação aos 382 segundos registrados em julho.

## 3. Consumo (orçamento global da tarefa, nunca reiniciado)
16 requisições, **US$ 0,3045** (teto US$ 0,60), nenhuma bloqueada. Comparação 3 (US$ 0,1149) · A 5 (US$ 0,0787) · B 5 (US$ 0,0951) ·
C 3 (US$ 0,0157). Análise de A e B reaproveitada da comparação (não paga de novo).

## 4. Parecer por dimensão (sem média)

| Dimensão | A | B (paga) | C |
|---|---|---|---|
| Correção | Aprovado com ressalvas: nada interno virou acerto, sem estorno, condição ≠ conduta; ressalvas: marca "Vivo" e caminho parcial apoiado nela | Aprovado (diagnóstico e memória) | Aprovado |
| Cobertura dos pontos materiais observáveis | **Reprovado** (cancelamento pendente) | Aprovado (protocolo; 4 itens do argumentário) | Aprovado para o resultado; recorte 04/08 não examinado (orçamento) |
| Sem acusação/elogio sem base | Aprovado com ressalva leve ("respaldando a verificação do histórico" pressupõe a consulta interna) | Aprovado (diagnóstico); sem mensagem | Aprovado |
| Utilidade | Baixa (só reconhecimento) | **Não avaliável na saída paga** (abstenção); replay útil | Limitada e correta |
| Naturalidade | Aprovado | — (replay: aprovado) | Aprovado |
| Rastreabilidade | Aprovado | Aprovado | Aprovado |

Os verificadores do próprio motor aprovaram A e C — isso não basta: A continua sem o ponto material.
