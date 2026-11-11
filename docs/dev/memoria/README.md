# Memória do projeto — organização

O `CLAUDE.md` da raiz é carregado inteiro em toda sessão. Em 07/10/2026 ele tinha 494,2 KB e misturava as regras permanentes (papel, produto, organização do código, regras de domínio) com o histórico de cada versão: investigação, rodadas pagas, smokes, motor de feedback, Central de Dados etc. Esta pasta guarda a memória de cada área. O `CLAUDE.md` fica só com o que toda sessão precisa e com um índice.

A divisão **moveu** o texto: cada seção do arquivo antigo está, sem edição, em exatamente um destino. Os únicos textos novos são o índice do `CLAUDE.md`, o cabeçalho de cada arquivo desta pasta (origem, notas de navegação, documentos relacionados) e este README.

## Critérios

- **(a)** regra/convenção permanente — fica no CLAUDE.md.
- **(b)** memória de uma área — útil quando se mexe nela.
- **(c)** histórico encerrado — versão substituída ou linha fechada.

Uma seção vai para o `CLAUDE.md` só quando a regra vale para qualquer código ou sessão. Exemplos: nunca conhecer código de domínio ou de indicador; nunca misturar Acompanhamento, Pendências e Sino. O resto é memória de área (b) ou histórico (c). O histórico continua nesta pasta porque explica os artefatos antigos que ainda estão no banco.

## O que fica no `CLAUDE.md`

- Papel do assistente, O produto e Organização do código, inteiros.
- De “Memória arquitetural”, só as seções transversais:
  - Múltiplas IAs especializadas — toda interação com qualquer IA é persistida — vale para qualquer código que fale com IA.
  - Motor de agentes, gatilhos e execução — agente × gatilho, como cada tipo é acionado, provedor trocável, evidência literal.
  - Acompanhamento × Pendências × Sino — três conceitos que nunca se misturam, conteúdo rico, Canvas do avatar, dados de demonstração só por seed.
  - Domínios de negócio — catálogo administrável — nenhum módulo funcional conhece código de domínio.
  - Catálogo de indicadores metadata-driven — nenhum módulo funcional conhece código de indicador.
- O índice “Memória por área”: uma linha por arquivo desta pasta.

## Arquivos de área

| Arquivo | Conteúdo | Categoria | Tamanho |
|---|---|---|---|
| [motor-de-feedback.md](motor-de-feedback.md) | caminho atual de “Gerar feedback”: análise de chamada com revisão, investigação de indicador, práticas e temas, firmeza, entrega única, memória do motor, diagnóstico da liderança e registro das rodadas pagas. | b | 60,6 KB |
| [diagnostico-de-indicador.md](diagnostico-de-indicador.md) | estratégia de diagnóstico por indicador (versões, rascunho × publicada, pino no nascimento, “Testar diagnóstico”, sinal da população) e as execuções de diagnóstico anteriores ao motor de feedback. | b, c | 16,5 KB |
| [experiencia-do-colaborador.md](experiencia-do-colaborador.md) | narrativa do feedback e “Entenda este feedback”, timeline e ocultação lógica do Acompanhamento, “Ouvir com a INIA” (aplicação de feedback e consultas na sessão), ciência com login e senha e com concordância (a avaliação do feedback), o antigo “Este conteúdo foi útil?” e cabeçalho do item. | b | 37,1 KB |
| [conversa-voz-e-avatar.md](conversa-voz-e-avatar.md) | conversas persistidas com a INIA e monitoramento da gestão, recados de Workflow no Chat e no Avatar (com a voz do recado), avatar Mentora (modelo, lip-sync PT-BR, animação, laboratório) e Cenário da INIA. | b | 20,6 KB |
| [perfil-e-navegacao.md](perfil-e-navegacao.md) | perfil pessoal (nome preferido, foto, capa), cabeçalho global e seletor de área, abas do perfil e acesso à área de Diagnóstico. | b | 5,6 KB |
| [workflows.md](workflows.md) | Workflows-modelo e validação de publicação (DRAFT válido, destinatário pela estrutura, editor), gatilho Manual “Executar agora”, worker concorrente com posse da matrícula, aba Resultados com correlação do uso de IA e configuração em rascunho × publicada com confirmação do impacto de entrar no ar. | b | 24,1 KB |
| [agentes-e-conhecimento.md](agentes-e-conhecimento.md) | Agents especialistas por domínio, busca na base de conhecimento, Orquestradores e suas políticas, resultado estruturado do Orquestrador, materiais de apoio e limites de atuação. | b, c | 20,0 KB |
| [investigacao.md](investigacao.md) | Tools de investigação para Agents e a evolução V1.1–V1.3.4.2 (eficiência, Zero-ID, gating fail-closed, suficiência da evidência, recall, integridade literal, semântica temporal). | b | 53,6 KB |
| [ia-provedores-e-custos.md](ia-provedores-e-custos.md) | provedores, conexões e modelos de IA, policies de roteamento por Use Case, segredos, uso, custo e orçamento. | b | 6,4 KB |
| [indicadores-e-estrutura.md](indicadores-e-estrutura.md) | analytics compartilhado de Indicadores e Equipe (escopo, PRV, atingimento consolidado, comparação operacional) e o organograma “Minha estrutura” (métricas gerenciais, “Ir até mim”). | b | 11,7 KB |
| [read-model-e-ciclo-de-vida.md](read-model-e-ciclo-de-vida.md) | read model do analytics da liderança (componentes por pessoa × janela, escopo pelo grafo em cache, versões por trigger, atividade diária, caches), resumo diário de IA, fim do outbox e retenção com políticas desligadas (13/10/2026). | b | 9 KB |
| [central-de-dados-e-instalacao.md](central-de-dados-e-instalacao.md) | Central de Dados (fontes, feeds, contratos, quarentena, lineage), situação funcional, escala e calendário operacional, disponibilidade × classificação, conector de banco externo, instalação e publicação em Windows/IIS. | b | 23,8 KB |
| [acesso.md](acesso.md) | contas × papéis × permissões × escopos, delegação, liberação de acesso com senha temporária e primeiro login. | b | 12,1 KB |
| [massa-demo-e-holdout.md](massa-demo-e-holdout.md) | massa demo grande (`db:seed:demo`, população e lotes de diagnóstico, gabarito isolado) e o holdout independente `inia_holdout_v2`. | b | 10,7 KB |
| [wiki.md](wiki.md) | `/wiki` como documentação oficial do produto: sitemap, catálogos cobertos pelo tipo, testes de links e âncoras. | b | 1,8 KB |
| [monitoria-de-usabilidade.md](monitoria-de-usabilidade.md) | coleta no navegador e no servidor, painel, permissões, flags, worker e provas. | b | 3,8 KB |
| [seguranca.md](seguranca.md) | controles transversais de segurança (escopo do servidor, catálogos da organização, sessão, CSRF, destinos de saída, arquivos, limites) e o estado da auditoria de 08/10/2026; detalhe em `docs/security/`. | a, b | 4,1 KB |
| [politicas-de-acompanhamento.md](politicas-de-acompanhamento.md) | (criado em 13/10/2026) tipos de intervenção por capacidade, políticas versionadas, avaliação MET/NOT_MET/INCONCLUSIVE, identidade e conflitos, relatório de inteligência, nó do Workflow, superfícies do líder, avaliação de continuidade e papéis. | b | 12,5 KB |
| [banco-e-consultas.md](banco-e-consultas.md) | consultas do caminho quente (LIMIT e keyset, conteúdo depois do LIMIT, aviso × entrega pelo id, pendente com aviso vivo, escrita em lote), limites de sessão do pool por papel e índices 130 e 132–134. | a, b | 6,9 KB |
| [escala-e-operacao.md](escala-e-operacao.md) | N APIs/interfaces e M workers: estado compartilhado no PostgreSQL (limites de requisição, pausa do provedor de IA, avisos por NOTIFY), prontidão e desligamento, SSE com cancelamento, métricas internas, logs assíncronos, web farm do IIS e cache dos estáticos. | b | 11,0 KB |
| [liderancas.md](liderancas.md) | (criado em 15/10/2026; iteração 3 em 16/10) INIA para Supervisor, Coordenador, Gerente, Gerente Sênior, Diretor e o operador (`my_results`): ferramentas escolhidas pela intenção no chat e na voz (consulta flexível, força de trabalho, diagnóstico), regras analíticas, cartões, "Onde atuar hoje", provas com dados reais e decisões em aberto. | b | 8 KB |
| [reports-recorrentes.md](reports-recorrentes.md) | (criado em 16/10/2026) Reports recorrentes: definição reproduzível, oferta no chat, agenda/fila no worker, regra de atualização, versões por escopo, papel Report, comparação e análise da IA, QA ao vivo |
| [boas-praticas.md](boas-praticas.md) | (criado em 20/10/2026) Base de boas práticas: análise comparativa, critérios de evidência, obrigação × boa prática, revisão, dataset sintético, integração com chat/voz/feedback/Diagnóstico |
| [produtos-e-aplicabilidade.md](produtos-e-aplicabilidade.md) | (criado em 21/10/2026) Produtos e aplicabilidade: tela por produto (bases gerais, de um produto ou de vários; indícios versionados para reconhecer o produto; categoria opcional), produto de cada solicitação na análise e na revisão, regra suspensa, liderança e confirmação no chat |
| [apoio-com-anjo.md](apoio-com-anjo.md) | (criado em 09/11/2026) Apoio com Anjo: motivo da descurtida e sinais (Parte A); pedido, distribuição, sala, área do Anjo, configuração e painel (Parte B) | b |
| [visual-do-app.md](visual-do-app.md) | (criado em 10/11/2026) visual do app inteiro: referência observada, tokens e kit (camada 1), peças de `components/ui/surface.tsx` e a camada 2 tela a tela | b |
| [indicadores-de-sucesso.md](indicadores-de-sucesso.md) | (criado em 10/11/2026) Indicadores de sucesso da INIA: decisões de alcance por bloco, leitores oficiais, tempo de resposta pelo par de chaves, lacuna da assertividade do Anjo, provas e pendências | b |
| [diagnostico-de-erros.md](diagnostico-de-erros.md) | (criado em 11/11/2026) Telas de erro, catálogo de códigos, referência de ocorrência, ocorrências no banco, Diagnóstico de erros na Administração, CLI e runbook da VM | b |
| [investigacao-v14.md](investigacao-v14.md) | (linha encerrada) descoberta semântica V1.4.0–V1.4.8f: frames, findings, patterns, candidatos de afirmação, atribuição de resultado, variância da extração. | c | 50,4 KB |
| [historico-feedback-v15-v16.md](historico-feedback-v15-v16.md) | (substituído pelo motor de feedback) feedback de atendimento V1 e caminho confiável V1.5.x–V1.6.0: redator, revisão/QA, política de autonomia, entrega no Acompanhamento e “Gerar feedback” no Workflow. | c | 47,3 KB |
| [historico-monitoria-v17.md](historico-monitoria-v17.md) | (substituído pelo motor de feedback) monitoria por processo V1.7.1–V1.7.4, Checkpoint Registry e Monitoring Architecture V2. | c | 92,3 KB |

Documentos que já existiam em `docs/dev/`, `docs/architecture/` e `docs/instalacao/` sobre o mesmo assunto foram **linkados** no cabeçalho de cada arquivo, não copiados.

## Mapa: seção do `CLAUDE.md` antigo → destino

Na ordem do arquivo antigo. Use este mapa quando um texto citar uma seção pelo nome.

| Seção | Categoria | Destino |
|---|---|---|
| INIA — instruções e memória do projeto | a | `CLAUDE.md` |
| Papel do assistente | a | `CLAUDE.md` |
| O produto | a | `CLAUDE.md` |
| Organização do código | a | `CLAUDE.md` |
| Memória arquitetural | a | `CLAUDE.md` |
| Múltiplas IAs especializadas (motor implementado; chat conversacional ainda não) | a | `CLAUDE.md` |
| Motor de agentes, gatilhos e execução (implementado) | a | `CLAUDE.md` |
| Indicadores e Equipe/Estrutura — analytics compartilhado (implementado) | b | [indicadores-e-estrutura.md](indicadores-e-estrutura.md) |
| Acompanhamento × Pendências × Sino, ciência e conteúdo rico (implementado) | a | `CLAUDE.md` |
| Massa demo grande (implementado) | b | [massa-demo-e-holdout.md](massa-demo-e-holdout.md) |
| Camada de IA: especialistas por domínio, retrieval de KB e orquestradores (implementado 2026-09-15) | b | [agentes-e-conhecimento.md](agentes-e-conhecimento.md) |
| Workflows-modelo: DRAFT válido, destinatários e editor (hardening 2026-09-16) | b | [workflows.md](workflows.md) |
| Domínios de negócio — catálogo administrável (implementado 2026-09-16) | a | `CLAUDE.md` |
| Catálogo de indicadores metadata-driven (implementado 2026-09-16) | a | `CLAUDE.md` |
| Central de Dados — porta única de entrada dos dados do cliente (implementada 2026-09-16) | b | [central-de-dados-e-instalacao.md](central-de-dados-e-instalacao.md) |
| Central de Dados — bancos de dados externos + instalação reproduzível (2026-10-06, migrations 119 + 120) | b | [central-de-dados-e-instalacao.md](central-de-dados-e-instalacao.md) |
| Wiki geral da INIA (reestruturada 2026-09-16) | b | [wiki.md](wiki.md) |
| Aba "Minha estrutura" no perfil — organograma React Flow read-only, navegação aberta, métricas gerenciais e viagem animada (2026-09-17) | b | [indicadores-e-estrutura.md](indicadores-e-estrutura.md) |
| Resultado estruturado do Orquestrador — construtor visual e fonte única da verdade (2026-09-17, migration 071) | b | [agentes-e-conhecimento.md](agentes-e-conhecimento.md) |
| Material de apoio — capacidade comum de resposta (2026-09-17, migrations 072 + 073) | b | [agentes-e-conhecimento.md](agentes-e-conhecimento.md) |
| Tools de investigação operacional para Agents (2026-09-17, migration 074) | b | [investigacao.md](investigacao.md) |
| Investigação V1.1 — eficiência (2026-09-17, sem migration) | b | [investigacao.md](investigacao.md) |
| Investigação V1.2 — hardening: três contextos, handles, escopo de evidência, gating em toda resposta e roteamento de modelo (2026-09-18, sem migration) | b | [investigacao.md](investigacao.md) |
| Investigação V1.3 — fail-closed, dois universos, gateway único, prompt por componentes, cache e custo (2026-09-18, sem migration) | b | [investigacao.md](investigacao.md) |
| Investigação V1.3.1 — Evidence Sufficiency Controller, fatos críticos e fingerprint da massa (2026-09-18, sem migration) | b | [investigacao.md](investigacao.md) |
| Investigação V1.3.2 — Investigation Recall Hardening (2026-09-18, sem migration) | b | [investigacao.md](investigacao.md) |
| Investigação V1.3.3 — Evidence Projection & Literal Integrity (2026-09-19, sem migration) | b | [investigacao.md](investigacao.md) |
| Investigação V1.3.4 — Temporal Semantics & Comparative Investigation (2026-09-19, sem migration) | b | [investigacao.md](investigacao.md) |
| Investigação V1.3.4.1 — Relation-Specific Temporal Sufficiency (2026-09-19, sem migration) | b | [investigacao.md](investigacao.md) |
| Investigação V1.3.4.2 — Temporal Output & Reference Integrity (2026-09-21, sem migration) | b | [investigacao.md](investigacao.md) |
| Investigação V1.4.0 — Semantic Observation & Pattern Discovery (2026-09-21, sem migration) | c | [investigacao-v14.md](investigacao-v14.md) |
| Investigação V1.4.1 — Finding Formation & Claim-Pattern Binding (2026-09-21, sem migration) | c | [investigacao-v14.md](investigacao-v14.md) |
| Investigação V1.4.2 — Canonical Claim Contract & Support Scope (2026-09-22, sem migration) | c | [investigacao-v14.md](investigacao-v14.md) |
| Investigação V1.4.3 — Claim Salvage & Support-Scope Semantics (2026-09-22, sem migration) | c | [investigacao-v14.md](investigacao-v14.md) |
| Investigação V1.4.4 — Deterministic Claim Projection (2026-09-22, sem migration) | c | [investigacao-v14.md](investigacao-v14.md) |
| Investigação V1.4.5 — Procedural & Semantic Interpretation (2026-09-22, sem migration) | c | [investigacao-v14.md](investigacao-v14.md) |
| Investigação V1.4.6 — Outcome Attribution & Procedural Sidecar (2026-09-22, sem migration) | c | [investigacao-v14.md](investigacao-v14.md) |
| Investigação V1.4.6.1 — Discovery Reproducibility & Context Isolation (2026-09-22, sem migration) | c | [investigacao-v14.md](investigacao-v14.md) |
| Investigação V1.4.6.8 — Semantic Frame Contract Hygiene & Completeness Guard (2026-09-23, sem migration) | c | [investigacao-v14.md](investigacao-v14.md) |
| Investigação V1.4.8f — sidecar needKind (2026-09-23, sem migration; DESLIGADO por padrão) | c | [investigacao-v14.md](investigacao-v14.md) |
| InteractionFeedback V1 — camada estrutural (2026-09-23, sem migration; SEM fiação) | c | [historico-feedback-v15-v16.md](historico-feedback-v15-v16.md) |
| Motor de feedback — FEEDBACK_ENGINE_V1 (2026-09-30, migration 102) — caminho ATUAL de "Gerar feedback" | b | [motor-de-feedback.md](motor-de-feedback.md) |
| V1.5.0 — Controlled Feedback Integration (2026-09-24, migration 077; flag OFF; SEM entrega) | c | [historico-feedback-v15-v16.md](historico-feedback-v15-v16.md) |
| V1.5.13 — Resultados do Workflow + correlação do uso de IA (2026-09-24, migration 084; zero chamada de modelo) | b | [workflows.md](workflows.md) |
| V1.6.0 — Monitoria PROCESS-CENTRIC com base verificada (2026-09-24, sem migration; zero chamada de modelo) | c | [historico-feedback-v15-v16.md](historico-feedback-v15-v16.md) |
| V1.6.1 — Diagnóstico do indicador e coaching com base (2026-09-24, migration 085; zero chamada de modelo) | c | [diagnostico-de-indicador.md](diagnostico-de-indicador.md) |
| V1.6.2 — Estratégia de diagnóstico do indicador (2026-09-24, migration 086; zero chamada de modelo) | b | [diagnostico-de-indicador.md](diagnostico-de-indicador.md) |
| Indicator Diagnosis V2 — estratégia configurável, diagnóstico direto (sem PRV) e Rechamada V1 (2026-09-29, migration 099) | b | [diagnostico-de-indicador.md](diagnostico-de-indicador.md) |
| V1.7.1 — Omissão verificada, feedback de supervisor e caminho rápido do Orquestrador (2026-09-25, sem migration; zero chamada de modelo) | c | [historico-monitoria-v17.md](historico-monitoria-v17.md) |
| V1.7.1a — Exemplo de condução e feedback completo (2026-09-25, sem migration; zero chamada de modelo) | c | [historico-monitoria-v17.md](historico-monitoria-v17.md) |
| V1.7.1b — Feedback pessoal e resolução de aplicabilidade (2026-09-25, sem migration; zero chamada de modelo) | c | [historico-monitoria-v17.md](historico-monitoria-v17.md) |
| V1.7.1c — Contrato da avaliação de processo e retry por categoria (2026-09-25, sem migration; zero chamada de modelo) | c | [historico-monitoria-v17.md](historico-monitoria-v17.md) |
| V1.7.1d — Contrato do redator, proveniência da base e composição do feedback (2026-09-25, sem migration; zero chamada de modelo) | c | [historico-monitoria-v17.md](historico-monitoria-v17.md) |
| V1.7.1e — QA de feedback legível e feedback behavior-first (2026-09-25, sem migration; zero chamada de modelo) | c | [historico-monitoria-v17.md](historico-monitoria-v17.md) |
| V1.7.1f — Endurecimento final da monitoria (2026-09-25, sem migration; zero chamada de modelo) | c | [historico-monitoria-v17.md](historico-monitoria-v17.md) |
| V1.7.1g — Bloqueadores finais da monitoria por Flag (2026-09-25, sem migration; zero chamada de modelo) | c | [historico-monitoria-v17.md](historico-monitoria-v17.md) |
| V1.7.1h — Degradação por campo do texto do redator (2026-09-25, sem migration; zero chamada de modelo) | c | [historico-monitoria-v17.md](historico-monitoria-v17.md) |
| V1.7.1i — Etapa composta, âncora sem dependência léxica e degradação por campo de verdade (2026-09-25, migration 087; zero chamada de modelo) | c | [historico-monitoria-v17.md](historico-monitoria-v17.md) |
| V1.7.1j — Segmentos da base, semântica dos subitens e prontidão analítica (2026-09-25, migration 088; zero chamada de modelo) | c | [historico-monitoria-v17.md](historico-monitoria-v17.md) |
| V1.7.1k — Lista canônica, âncora "evitar" e evidência do item condicional (2026-09-25, sem migration; zero chamada de modelo) | c | [historico-monitoria-v17.md](historico-monitoria-v17.md) |
| V1.7.1l — Papel da seção, etapa executável, canal de retorno e confirmação de entendimento (2026-09-25, migration 089; zero chamada de modelo) | c | [historico-monitoria-v17.md](historico-monitoria-v17.md) |
| V1.7.1m — Processo primário na cobertura, identidade canônica do comportamento, checklist em 1ª pessoa e lacuna no exemplo (2026-09-26, migrations 090 + 091; zero chamada de modelo) | c | [historico-monitoria-v17.md](historico-monitoria-v17.md) |
| V1.7.1n — Etapas endereçadas pelo sistema (checkpointRef), cobertura obrigatória e polaridade da evidência (2026-09-26, migration 092; zero chamada de modelo) | c | [historico-monitoria-v17.md](historico-monitoria-v17.md) |
| V1.7.1o — Item a perguntar com semântica tipada (2026-09-27, sem migration; zero chamada de modelo) | c | [historico-monitoria-v17.md](historico-monitoria-v17.md) |
| V1.7.1p — Especificidade pelo comportamento, "sempre" prospectivo e pergunta direta no texto de segurança (2026-09-28, sem migration; zero chamada de modelo) | c | [historico-monitoria-v17.md](historico-monitoria-v17.md) |
| V1.7.2 — Apresentação de supervisor do feedback de monitoria (2026-09-28, sem migration; zero chamada de modelo) | c | [historico-monitoria-v17.md](historico-monitoria-v17.md) |
| Checkpoint Registry Foundation (2026-09-28, migration 093; zero chamada de modelo) — HISTÓRICO: o motor de feedback não usa o registro nem aprovação | c | [historico-monitoria-v17.md](historico-monitoria-v17.md) |
| V1.7.3 — Cobertura da avaliação com reparo único e ausência verificada exibível (2026-09-28, sem migration; zero chamada de modelo) | c | [historico-monitoria-v17.md](historico-monitoria-v17.md) |
| Feedback por Flag V2 — narrativa de supervisor + detalhes sob demanda (2026-09-29, sem migration) | b | [experiencia-do-colaborador.md](experiencia-do-colaborador.md) |
| Conversas com a INIA — chat em conversas persistidas + monitoramento da gestão (2026-09-29, migration 094) | b | [conversa-voz-e-avatar.md](conversa-voz-e-avatar.md) |
| V1.7.4 — Conduta da evidência, semântica da etapa e reparo semântico (2026-09-29, sem migration) | c | [historico-monitoria-v17.md](historico-monitoria-v17.md) |
| Monitoring Architecture V2 — especialista declara, código confere (2026-09-30, sem migration) | c | [historico-monitoria-v17.md](historico-monitoria-v17.md) |
| Modelo de acesso — contas × papéis × permissões × escopos (V1.5.7, migration 081; V1.5.8 sem migration) | b | [acesso.md](acesso.md) |
| Liberação de acesso e primeiro login (2026-10-06, migration 118) | b | [acesso.md](acesso.md) |
| AI Providers, Modelos, Roteamento e Custos V1 (2026-09-22, migration 076) | b | [ia-provedores-e-custos.md](ia-provedores-e-custos.md) |
| DIAGNOSTIC_HOLDOUT_V2 — holdout independente para generalização (2026-09-21, só DEV/QA; zero runtime) | b | [massa-demo-e-holdout.md](massa-demo-e-holdout.md) |
| (histórico) Material de apoio recomendado no Feedback — fundação (migration 072) | c | [agentes-e-conhecimento.md](agentes-e-conhecimento.md) |
| Avatar da INIA — modelo Mentora, lip-sync PT-BR e animação (2026-09-25) | b | [conversa-voz-e-avatar.md](conversa-voz-e-avatar.md) |
| Perfil pessoal e cabeçalho global (2026-09-29, migration 097) | b | [perfil-e-navegacao.md](perfil-e-navegacao.md) |
| Gatilho Manual — "Executar agora" (2026-09-30, migration 100) | b | [workflows.md](workflows.md) |
| Motor de Workflow — execução concorrente e posse da matrícula (2026-10-05, sem migration) | b | [workflows.md](workflows.md) |
| Workflow Outputs V1 — Chat + Avatar com consumidor real (2026-09-29, migration 098) | b | [conversa-voz-e-avatar.md](conversa-voz-e-avatar.md) |
| Confirmação de ciência com login e senha (2026-10-06, migration 114) | b | [experiencia-do-colaborador.md](experiencia-do-colaborador.md) |
| Cenário da INIA — fundo atrás do avatar, padrão e sazonais (2026-10-01, migrations 106 + 107) | b | [conversa-voz-e-avatar.md](conversa-voz-e-avatar.md) |
| Aplicação de feedback conversacional — "Ouvir com a INIA" (2026-10-01, migration 103) | b | [experiencia-do-colaborador.md](experiencia-do-colaborador.md) |
| Avaliação do feedback no Acompanhamento + cabeçalho do item (2026-10-06, migrations 113 + 115) | b | [experiencia-do-colaborador.md](experiencia-do-colaborador.md) |
| Ciência com concordância (2026-11-10, migration 186) | b | [experiencia-do-colaborador.md](experiencia-do-colaborador.md) |
| Monitoria de usabilidade (2026-10-06, migration 116) | b | [monitoria-de-usabilidade.md](monitoria-de-usabilidade.md) |

## Como manter

- Memória nova de uma área vai para o fim do arquivo da área. Use o mesmo formato: `### título (data, migrations)`. Nunca escreva memória de área no `CLAUDE.md`.
- Área nova: crie `docs/dev/memoria/<área>.md` com o mesmo cabeçalho e acrescente uma linha ao índice do `CLAUDE.md`.
- O `CLAUDE.md` só recebe regra ou convenção permanente, que vale para qualquer sessão.
- Quando uma versão é substituída, mova a seção sem edição para um arquivo `historico-*` e liste esse arquivo no bloco “Histórico” do índice.
- Quando o assunto já tem documento próprio em `docs/`, ponha o link. Não copie o conteúdo.

## Como a divisão foi feita e conferida

Ferramentas em [ferramentas/](ferramentas/), Node puro, sem dependências:

- `estrutura.mjs` — o mapa. Cada seção é reconhecida pelo início do título. Aqui também ficam os resumos do índice e as notas de cada arquivo.
- `dividir.mjs --entrada <cópia do CLAUDE.md antigo>` — gera o `CLAUDE.md`, os arquivos de área e este README. Falha se alguma seção da entrada não estiver no mapa, ou se uma regra do mapa não encontrar a sua seção. Recusa entrada que já esteja dividida. Também recusa gravar quando o `CLAUDE.md` da raiz ficou diferente da cópia, o que indica edição de outra sessão no meio do caminho.
- `verificar.mjs --original <CLAUDE.md antigo>` — confere que cada seção antiga está inteira, idêntica e uma única vez no destino do mapa. Confere também que toda linha antiga existe nos arquivos novos (com o mesmo número de ocorrências), lista as linhas novas, testa os links e mede o `CLAUDE.md`.

Entrada desta geração: `CLAUDE.md` com 506102 bytes, sha256 `e762eb3f8b70a22dfcbb7a32638fb20e6474ce479e47f3ec900ee037f35da847`. Resultado: `CLAUDE.md` com 21,3 KB.
