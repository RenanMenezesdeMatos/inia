# Reformulação — Supervisor, Administração e Diagnóstico

## Supervisor

A rota `/supervisor` deixa de usar o dashboard anterior e passa a responder somente três perguntas:

1. Qual é o foco do dia?
2. Quem precisa de atuação agora?
3. Qual diagnóstico e ação justificam a prioridade?

O detalhamento continua centralizado na jornada única de caso/feedback. As implementações anteriores permanecem temporariamente no código apenas como referência de dados e para evitar perda antes da limpeza definitiva.

## Administração

A rota `/admin` reúne quatro contextos governados:

- perfis: papel e escopo de acesso;
- conhecimento: procedimentos, manuais, fluxos, FAQs e regras versionados;
- assuntos proibidos: limites e comportamento obrigatório da IA;
- glossário: definição e aplicação de termos em monitorias e feedbacks.

Somente conteúdo publicado pode ser usado como fonte factual. Conteúdo em rascunho não participa de diagnósticos.

## Diagnóstico

A rota `/diagnostics` consolida padrões extraídos de grupos comparáveis de transcrições:

> Para o motivo X, colaboradores com bom desempenho no indicador Y costumam executar o comportamento Z.

Cada conclusão deve informar:

- motivo e indicador;
- tamanho da amostra e grupo de referência;
- diferença medida;
- comportamento observado;
- exemplo de fraseologia;
- padrão de silêncio/ritmo;
- confiança;
- orientação de uso no feedback.

Uma correlação nunca deve ser apresentada como regra causal absoluta. A aplicação precisa considerar contexto equivalente, evidência verificável, conhecimento vigente e assuntos proibidos.

## Persistência e APIs

- `GET/PATCH /api/v1/admin/users/:id`
- `GET/POST /api/v1/admin/knowledge`
- `GET/POST /api/v1/admin/prohibited-topics`
- `GET/POST /api/v1/admin/glossary`
- `GET /api/v1/diagnostics?reason=&indicator=`

As tabelas `prohibited_topics`, `glossary_terms`, `interactions`, `transcripts` e `diagnostic_insights` são criadas pela migration `003_governance_and_diagnostics.sql`.
