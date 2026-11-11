# Indicadores de sucesso da INIA

Tela `Administração › Monitoramento › Indicadores de sucesso da INIA` (`/admin/inia-success`), criada em 10/11/2026 na branch
`claude/indicadores-sucesso-inia` (a partir de `claude/apoio-humano-operador-832409`, onde está o Apoio com Anjo). Inventário completo
de fontes, fórmulas, cobertura e lacunas: [docs/dev/indicadores-de-sucesso-da-inia.md](../indicadores-de-sucesso-da-inia.md).

## Decisões

- **Nenhuma permissão nova.** Cada bloco usa a permissão da tela de origem e o mesmo alcance: conversas (`assistant_conversations.view`)
  para tempo de resposta e motivos de procura; painel do apoio (`human_support.coordinate`, D7) para avaliação das respostas, sinais e
  Anjo; contestações (`feedback_contestations.review`) para feedbacks; `configuration.manage` na organização inteira para a conferência
  das respostas. Capability derivada só para o menu: `canViewIniaSuccess`. Rotas em `inia-success/presentation/inia-success-router.ts`,
  montadas antes do `/api/v1/admin` da governança.
- **Leitores oficiais primeiro**: `replyFunnel` (M1–M6) e `supportFunnel` (M7–M17) dão os totais; consultas agrupadas por dia com as
  mesmas regras dão a evolução (a prova confere que a soma dos dias = o funil). Feedbacks usam `publishedFeedbackSourcesSql` +
  `deliveredInteractionFeedbackSourcesSql` + `scopedPeopleSql` e a regra de contestação da fila.
- **Tempo de resposta só no texto, pelo par de chaves** `X` → `X:reply` (servidor: recebido → resposta completa gravada). Texto digitado
  com a voz ligada (`<turno>:user`) fica fora da base do texto; voz sem medida confiável. Nunca por vizinhança de mensagens.
- **O Anjo é uma pessoa** e não classifica a resposta da INIA: "Assertividade segundo o Anjo" e "Erro identificado pelo Anjo" ficam como
  lacuna explicada na tela (nada estimado). A conferência automática (PEN-017) é conformidade com regras, nunca correção.
- Regras de apresentação: taxa sem base = "Sem base para cálculo"; base < 5 = "Amostra pequena" com a contagem; média ponderada pelas
  observações; período de 1 a 92 dias; dia até 31 dias, semana acima; um gráfico por indicador (sem eixo duplo); cor por entidade
  (respostas azul, feedbacks laranja, consulta água, Anjo violeta — passos validados claro/escuro do método de visualização; a paleta
  `--chart-*` do tema falha a faixa de luminosidade para séries).

## Provas e dados de dev

- `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run inia-success-proof` (duas organizações próprias, apagadas no fim; 7 cenários).
- Conferência visual em 10/11/2026 numa pilha isolada desta worktree (API `127.0.0.1:3561` com `--role=api`, web `127.0.0.1:3661`,
  banco `inia`), com uma conta de teste temporária de Administrador geral criada e apagada na mesma sessão.

## Pendências

- Instrumentação mínima proposta (avaliação da resposta pelo Anjo, tempos do turno no banco, concordância explícita, revisão das
  descurtidas do chat) — depende de decisão de produto; ver o inventário.
- As telas de origem não leem o período pela URL: os links de "registros" abrem com o filtro padrão delas.
- O card de tempo de resposta de "Conversas com a INIA" em desenvolvimento em outra frente usa `lag` (mensagem anterior); alinhar com o
  critério da chave ao integrar.
