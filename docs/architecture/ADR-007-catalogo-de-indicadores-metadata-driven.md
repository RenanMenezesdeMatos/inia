# ADR-007 — Catálogo de indicadores metadata-driven e Central de Dados (ingestão futura)

## Status

Aceito (2026-09-16). Catálogo implementado; Central de Dados **não implementada** — só o contrato arquitetural.

## Contexto

Até esta decisão, `indicator_definitions` guardava identidade (código, nome), uma unidade em texto livre e a
direção desejada; a camada operacional (migration 052) já lia `operational_aggregation`/`daily_supported`,
mas a criação pela UI não configurava nada disso (todo indicador novo nascia `AVERAGE`/não operacional),
não havia proteção contra alteração semântica com histórico e o editor de Workflows listava qualquer
indicador (inclusive desativados) e oferecia janelas operacionais a indicadores sem medição operacional.

## Decisão

1. **A INIA conhece comportamentos, não códigos.** O código pode conhecer `RATE`, `WEIGHTED_AVERAGE`,
   `AVERAGE`, `SUM`, `LATEST`, as unidades do catálogo e as direções. `TMA`, `FCR`,
   `MONITORIA_QUALIDADE`, `DIGITAL_RESOLUTION_RATE` são dados. Nenhum módulo funcional pode ter
   `switch (indicatorCode)`, `Record<IndicatorCode, …>` ou lista de códigos.
2. **`indicator_definitions` é a fonte de verdade do comportamento** (migration 055):
   - identidade: `code` (único, normalizado, imutável após uso), `name`, glossário;
   - apresentação: `unit` com contrato (`PERCENT | SECONDS | POINTS | STARS | COUNT | CASES | CASES_PER_DAY`);
   - semântica: `desired_direction`;
   - capacidade operacional: `daily_supported` (medição diária por colaborador — única granularidade
     suportada hoje), `operational_aggregation` (estratégia), `minimum_sample_size` e
     `minimum_coverage` (padrões que o editor pré-preenche em Condition/Ranking — a configuração
     fica explícita no Workflow, nunca regra silenciosa no runtime);
   - capacidade oficial: `official_closure_supported` (periodicidade oficial é sempre mensal por
     competência; a INIA nunca calcula valor/meta/atingimento/quartil/peso oficiais).
3. **Validação de coerência no backend** (`indicators/domain/indicator-definition.ts`): Taxa só em
   Percentual; amostra/cobertura só com medição operacional; ao menos uma capacidade; código no padrão.
4. **Alteração semântica com histórico é bloqueada** (estratégia "A" — bloquear com o motivo):
   código, unidade, direção, estratégia e desligar a medição operacional são recusados
   (`INDICATOR_SEMANTIC_LOCKED`, 409) quando existem medições, metas, fechamentos oficiais ou
   Workflows que referenciam o código. Nome, glossário, padrões de amostra/cobertura, ligar medição
   operacional, fechamento oficial e status são sempre seguros. Exclusão só sem histórico.
5. **Publish valida capacidades** (`workflows/application/validate-indicator-capabilities.ts`):
   indicador desativado não entra em Workflow novo; janela de dias/semana e quartil operacional
   exigem medição operacional; fontes oficiais exigem fechamento oficial. Uma consulta ao catálogo
   por publish.
6. **Texto funcional derivado, não armazenado:** o rótulo "Cálculo no período" vem de estratégia +
   unidade (`describeAggregationStrategy`), calculado pelo backend e devolvido na API — o editor
   não repete a derivação nem digita texto por indicador.

## Contrato genérico de medição (já existente)

```
indicator_measurements
  subject_type / subject_id   (hoje PERSON = colaborador)
  indicator_definition_id     (resolvido pelo code no catálogo)
  period_start / period_end   + granularity (DAILY | MONTHLY | HOURLY | INTERACTION | CUSTOM)
  value                       (medição apresentável do período)
  numerator / denominator     (componentes de agregação — RATE / WEIGHTED_AVERAGE)
  sample_count                (amostra declarada, opcional)
  source                      (origem)
```

Nunca uma coluna por indicador (`tma_total_seconds`, `fcr_resolved`…). Cada estratégia declara os
componentes que exige (`AGGREGATION_STRATEGY_METADATA[kind].requiredComponents`):

| Estratégia         | Exige                          |
| ------------------ | ------------------------------ |
| `RATE`             | value + numerator + denominator |
| `WEIGHTED_AVERAGE` | value + numerator + denominator (sample_count opcional) |
| `AVERAGE`          | value (sample_count opcional)   |
| `SUM`              | value                           |
| `LATEST`           | value                           |

## Central de Dados — evolução futura (NÃO implementada nesta decisão)

```
Central de Dados
├ CSV
├ Excel
├ API de recebimento
├ SFTP
└ Conectores
       ↓
Mapping de colunas → contrato genérico de medição
       ↓
Validação dirigida pelo IndicatorDefinition
  · indicador existe e está ativo
  · granularidade ∈ granularidades suportadas pelo indicador (hoje DAILY)
  · componentes exigidos pela estratégia presentes (RATE ⇒ numerator + denominator; LATEST ⇒ value)
  · unidade/escala coerentes (RATE em %, value = numerator ÷ denominator × 100)
  · janelas [period_start, period_end) no calendário local da organização
       ↓
indicator_measurements (upsert idempotente por organização × indicador × sujeito × período × origem)
```

Princípios que a futura camada deve respeitar:

- **Nenhum endpoint, tabela ou código específico por indicador.** Um indicador novo é uma linha do
  catálogo; sua ingestão é a mesma de todos os outros.
- **A configuração dirige a validação.** O que cada medição precisa informar vem de
  `requiredComponents` da estratégia do indicador — não de um validador por código.
- **Gravar medições ≠ disparar automações.** A ingestão em massa grava direto no contrato (como o seed
  demo faz) e decide explicitamente se matricula Workflows por indicador; a rota atual
  `/ingestion/indicator-measurements/batch` continua sendo o caminho "evento por medição".
- **Fila/lote/erros por linha** são preocupações da Central, não do catálogo.

## Consequências

- Criar "Taxa de Resolução Digital" (PERCENT / HIGHER / operacional / RATE) pela UI a torna
  imediatamente elegível em Condition, Ranking VALUE/CHANGE, quartil operacional, QA Lab, publish e
  Analytics — provado por `backend/src/modules/indicators/testing/dynamic-indicator-proof.test.ts`
  (indicadores e Grupo que o código-fonte desconhece, contra o banco de teste real).
- Uma semântica nova (fórmula composta) exige uma nova estratégia genérica no catálogo de
  comportamentos, nunca uma regra por código.
- Unidade nova = entrada no catálogo de unidades (backend + formatação no frontend) + migration do
  check constraint.
