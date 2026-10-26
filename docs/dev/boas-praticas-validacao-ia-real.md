# Base de boas práticas — validação com IA real no dataset sintético (20/10/2026)

> Autorizada pelo usuário em 20/10/2026. Prompts `BEST_PRACTICE_DISCOVERY_PROMPT_V1`, `BEST_PRACTICE_CODING_PROMPT_V1` e
> `BEST_PRACTICE_OBLIGATION_PROMPT_V1`; modelo gemini-3.8-flash (Use Case `BEST_PRACTICE_ANALYSIS`, sem policy da organização).
> Dataset: cópia `BP_SINTETICO_V1_IA_REAL` do `BP_SINTETICO_V1` (mesmo corpus e gabarito, escopo próprio — sem os padrões que o
> modelo simulado já tinha criado, para não contaminar a descoberta). Nível de contexto: motivo. Comparação: 1º quartil × demais.
>
> **Valida o mecanismo e os prompts num corpus fictício gerado por regra (falas quase idênticas entre chamadas). Não prova que as
> hipóteses funcionam no mundo real nem mede a qualidade da codificação em transcrições reais, que são muito mais ruidosas.**

## Como reproduzir

```
cd backend
npx tsx scripts/dev/best-practices-synthetic.ts load --key BP_SINTETICO_V1_IA_REAL
npx tsx scripts/dev/best-practices-synthetic.ts analyze TMA --model real --key BP_SINTETICO_V1_IA_REAL
npx tsx scripts/dev/best-practices-synthetic.ts analyze NOTA_URA --model real --key BP_SINTETICO_V1_IA_REAL
npx tsx scripts/dev/best-practices-evaluate.ts <id da análise>
```

O comparador liga cada candidato da IA a um comportamento do gabarito pelo DADO (conjunto de chamadas codificadas como presentes ×
conjunto em que o gabarito diz que o operador faz o comportamento; Jaccard ≥ 0,5), nunca pela redação, e compara a decisão com a da
análise SIMULADA do mesmo indicador e nível no dataset original (referência do mecanismo). Antes de usar com a IA real, o
comparador foi conferido sobre uma análise simulada: 10 de 10 candidatos ligados com Jaccard 1,00 e decisões idênticas.

## Resultado

- **Custo**: 50 chamadas ao modelo (25 por indicador), US$ 0,59 no uso de IA da organização (US$ 0,2921 TMA + US$ 0,2996 Nota da
  URA), ~117 mil tokens de raciocínio. A estimativa de custo devolvida pelo gateway veio vazia (modelo fora da tabela estática): o
  relatório da análise agora conta essas chamadas como "sem preço na resposta" e o custo real é o do uso de IA.
- **Descoberta**: 5 candidatos no total (2 em TMA, 3 na Nota da URA), TODOS correspondentes aos padrões verdadeiros do gabarito;
  nenhum falso positivo. A IA não propôs obrigação (boas-vindas), a omissão do aviso obrigatório (associada ao TMA), a frase isolada,
  o comportamento do operador com poucas avaliações, a instrução injetada pelo cliente ("50% de desconto") nem algo que exija áudio.
  As travas por código (comum aos dois grupos, conflito, isolado, fala de cliente) não precisaram agir nesta rodada — continuam
  provadas pelo modelo simulado, que propõe tudo isso de propósito.
- **Codificação cega**: 450 leituras, nenhuma sem decisão, nenhum trecho que não conferiu, nenhuma fala de cliente aceita. Presença:
  precisão 100% em todos os candidatos; cobertura 100%, exceto "retomar resumindo" (50% — a IA definiu o comportamento de forma mais
  estreita, "resumo do diagnóstico antes de registrar a contestação", e codificou só as 10 ocorrências de Fatura, todas certas; a
  decisão final é a mesma). "Não se aplica" × "ausente": a IA marcou "ausente" em parte das chamadas sem a situação (explicar a
  espera em Fatura: 2% de acordo; combinar horário em Fatura: 47%). Efeito: "explicar a espera" em Fatura saiu "sem diferença" em vez
  de "dados insuficientes" — nos dois casos não orienta naquele contexto.
- **Obrigação**: "explicar por que a confirmação de dados é necessária" = execução diferenciada (igual ao gabarito, com o trecho da
  regra conferido). "Explicar a espera" e "retomar resumindo" = execução diferenciada (o gabarito dizia opcional): a IA ligou cada um
  a uma etapa obrigatória real e conferida (o teste de linha; registrar a contestação e informar o prazo) e descreveu o que vai além —
  leitura defensável; continuam recomendáveis. "Combinar horário de novo contato" = opcional (o gabarito esperava "incerto" →
  pendente): a IA afirmou que nenhuma fonte trata disso e todas as fontes foram lidas, o que pela regra é opcional. O caminho
  "pendente" segue provado só pelo modelo simulado.
- **Decisões finais**: TMA → os 2 padrões esperados (Fatura e Suporte técnico, cada um no seu contexto); Nota da URA → os 3 padrões
  esperados, com os mesmos contextos. "Explicar com as palavras do cliente" não foi nem proposto em TMA (no gabarito ele não
  diferencia os grupos de TMA) e foi o primeiro achado da Nota da URA.

## Próximos passos sugeridos

1. Validar com transcrições REAIS de um Grupo com volume (a massa demo tem ~3 chamadas por pessoa/mês e tende a "dados
   insuficientes").
2. Se o "não se aplica" importar para a decisão, reforçar no prompt de codificação (nova versão) a diferença entre "a situação não
   aconteceu" e "aconteceu e o operador não fez" — hoje só afeta o rótulo do contexto em que o padrão já não orienta.

## Relatórios do comparador

### TMA · análise 914f6b8c-e27f-49f2-92b2-73bc4a1bd05e · modelo real (gemini-3.8-flash) · dataset BP_SINTETICO_V1_IA_REAL

Desfecho: PATTERNS_FOUND. Descoberta: 2 candidato(s) aceito(s); recusados: nenhum.
Codificação: 180 leituras, 0 sem decisão (0 trecho não conferido, 0 fala de cliente, 0 sem resposta). IA: 25 chamadas, 44355 tokens de entrada, 8920 de saída; uso de IA registrado no período: 25 chamada(s), US$ 0.2921, 60112 tokens de raciocínio.

| Candidato da IA | ≈ Gabarito (Jaccard) | Precisão | Cobertura | Acordo em "não se aplica" | Decisão da IA | Decisão esperada |
|---|---|---|---|---|---|---|
| Explicar motivo da espera e combinar prazo de retorno | EXPLAIN_WAIT (1.00) | 100% | 100% | 2% | PATTERN_CREATED (Fatura: NO_DIFFERENCE; Suporte técnico: SUPPORTED; DIFFERENTIATED_EXECUTION) | PATTERN_UPDATED (Fatura: INSUFFICIENT_DATA; Suporte técnico: SUPPORTED; OPTIONAL) |
| Resumo explicativo do diagnóstico ao retomar o atendimento | RESUME (0.50) | 100% | 50% | — | PATTERN_CREATED (Fatura: SUPPORTED; Suporte técnico: NO_DIFFERENCE; DIFFERENTIATED_EXECUTION) | PATTERN_UPDATED (Fatura: SUPPORTED; Suporte técnico: NO_DIFFERENCE; OPTIONAL) |

Comportamentos do gabarito sem candidato correspondente: GREETING (Obrigação cumprida por todos); ADAPT_VOCABULARY (Associado a um indicador (Nota da URA), sem evidência para outro (TMA)); SECURITY_EXPLAINED (Execução diferenciada de etapa obrigatória); SKIP_NOTICE (Associação que contraria o processo); CALLBACK (Fontes insuficientes para distinguir obrigação); ISOLATED_PHRASE (Frase isolada numa chamada bem avaliada); APP_FOLLOWUP (Operador com poucas avaliações).
Travas (obrigação, conflito, frase isolada, poucas avaliações, instrução injetada, áudio nunca viram padrão): nenhuma violação.

### NOTA_URA · análise f881dd97-6dda-477a-8654-bfe355c173c4 · modelo real (gemini-3.8-flash) · dataset BP_SINTETICO_V1_IA_REAL

Desfecho: PATTERNS_FOUND. Descoberta: 3 candidato(s) aceito(s); recusados: nenhum.
Codificação: 270 leituras, 0 sem decisão (0 trecho não conferido, 0 fala de cliente, 0 sem resposta). IA: 25 chamadas, 46819 tokens de entrada, 13478 de saída; uso de IA registrado no período: 25 chamada(s), US$ 0.2996, 57059 tokens de raciocínio.

| Candidato da IA | ≈ Gabarito (Jaccard) | Precisão | Cobertura | Acordo em "não se aplica" | Decisão da IA | Decisão esperada |
|---|---|---|---|---|---|---|
| Traduzir diagnóstico para linguagem comum do cliente | ADAPT_VOCABULARY (1.00) | 100% | 100% | — | PATTERN_CREATED (Fatura: SUPPORTED; Suporte técnico: SUPPORTED; OPTIONAL) | PATTERN_CREATED (Fatura: SUPPORTED; Suporte técnico: SUPPORTED; OPTIONAL) |
| Explicar benefício prático da validação de segurança | SECURITY_EXPLAINED (1.00) | 100% | 100% | — | PATTERN_CREATED (Fatura: SUPPORTED; Suporte técnico: SUPPORTED; DIFFERENTIATED_EXECUTION) | PATTERN_CREATED (Fatura: SUPPORTED; Suporte técnico: SUPPORTED; DIFFERENTIATED_EXECUTION) |
| Consultar preferência de horário para eventual retorno | CALLBACK (1.00) | 100% | 100% | 47% | PATTERN_CREATED (Fatura: INSUFFICIENT_DATA; Suporte técnico: SUPPORTED; OPTIONAL) | PATTERN_CREATED (Fatura: INSUFFICIENT_DATA; Suporte técnico: SUPPORTED; UNDETERMINED) |

Comportamentos do gabarito sem candidato correspondente: GREETING (Obrigação cumprida por todos); RESUME (Opcional recorrente entre os melhores (só em Fatura)); EXPLAIN_WAIT (Opcional recorrente entre os melhores (só em Suporte técnico)); SKIP_NOTICE (Associação que contraria o processo); ISOLATED_PHRASE (Frase isolada numa chamada bem avaliada); APP_FOLLOWUP (Operador com poucas avaliações).
Travas (obrigação, conflito, frase isolada, poucas avaliações, instrução injetada, áudio nunca viram padrão): nenhuma violação.

