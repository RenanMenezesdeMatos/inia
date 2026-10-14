# Modelo funcional — feedbacks, ingestão e supervisão

## Dois tipos de feedback

### Feedback de indicador

Fontes obrigatórias:

- glossário do indicador;
- equipe e contexto operacional do colaborador;
- valor atingido, meta vigente, período e direção esperada;
- diagnóstico gerado a partir da evolução e de grupos comparáveis;
- histórico de feedbacks e planos anteriores.

Saída mínima: indicador, atingimento, meta, diagnóstico, evidências, recomendação, abordagem sugerida e plano/checkpoint quando necessário.

### Feedback de monitoria

Fontes obrigatórias:

- interação e transcrição versionada;
- base de conhecimento vigente na data da chamada;
- glossário operacional;
- assuntos proibidos/guardrails;
- diagnósticos relacionados ao motivo e aos indicadores;
- critérios de monitoria aplicáveis à operação.

Saída mínima: o que acertou, o que errou, trechos que sustentam cada conclusão, procedimento relacionado, melhores práticas, recomendação e plano/checkpoint quando necessário.

#### Gatilhos de monitoria

A monitoria pode ocorrer pela leitura diária programada ou imediatamente após um evento configurado: reincidência, Nota URA baixa ou positiva, desvio de qualidade, termo crítico, tendência negativa ou boa prática relevante.

O gatilho é persistido separadamente da avaliação. Ele registra chamada, tipo, motivo, severidade, valor observado, limiar, quantidade de ocorrências, data e metadados da origem. Assim, todo feedback responde claramente “por que recebi isto agora?”.

## Contratos de entrada

### Indicadores

Cada medição deve conter: identificador externo/idempotência, colaborador, indicador, valor numérico, unidade, início/fim do período e fonte. A meta não deve ser copiada para cada evento: é versionada por indicador, escopo e vigência. A API resolve a meta vigente e classifica o atingimento considerando `HIGHER`, `LOWER` ou `TARGET`.

### Chamadas e transcrições

Cada interação deve conter: identificador externo, colaborador, motivo, canal, início/fim e transcrição. A transcrição guarda versão, idioma e confiança. Futuras versões podem adicionar segmentos com falante e timestamps sem quebrar o contrato inicial.

## Visão do supervisor

1. Resumo da equipe: quantidade de colaboradores, críticos, sem evolução, destaques e planos vencidos.
2. Indicadores da equipe: atingimento consolidado, meta, tendência e quantidade abaixo da meta.
3. Prioridades: colaborador, causa/diagnóstico, indicador, criticidade e plano sugerido.
4. Planos: objetivo, ações, responsável, prazo, status e resultado dos checkpoints.
5. Visão do operador: equipe, indicadores/atingimentos, feedbacks de indicador, feedbacks de monitoria, planos aplicados e evolução.

O supervisor acessa somente equipes dentro do seu escopo. A UI de demonstração usa um tenant fixo até a autenticação/RBAC real ser ligada.

## Escalonamento por performance

> Atualizado em 13/10/2026: a sequência abaixo deixou de ser uma escada fixa no código. O que fazer em cada situação é decidido por **políticas de acompanhamento** configuráveis (tipos de intervenção, regras com condições e ações, versões publicadas com vigência) — ver `docs/dev/memoria/politicas-de-acompanhamento.md` e a Wiki `/wiki/administracao/politicas-de-acompanhamento`. Os níveis abaixo ficam como exemplo de política e como leitura dos escalonamentos antigos (`performance_escalations`, legado só leitura).

A recomendação usa causa, evidências, recorrência, evolução e intervenções anteriores. Estar abaixo de uma meta, isoladamente, não determina escalonamento.

1. `OBSERVE`: primeiro sinal ou oscilação sem padrão.
2. `ORIENT`: desvio confirmado com causa e evidência.
3. `COACH`: reincidência ou ausência de evolução após orientação.
4. `ACTION_PLAN`: persistência após coaching.
5. `MANAGER`: ausência de evolução após plano ou evento crítico.

Melhorias e bons resultados também geram ações: elogio, reconhecimento e recomendação para manter a prática observada.
