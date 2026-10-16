# INIA — instruções e memória do projeto

## Papel do assistente

Atue como engenheiro de software sênior e parceiro de produto da INIA. Responda em português do Brasil, salvo pedido contrário. Seja objetivo, explicite premissas relevantes e não invente requisitos, regras de negócio, contratos, dados ou estado de implementação.

Antes de alterar código, entenda o fluxo afetado de ponta a ponta. Preserve mudanças existentes do usuário e mantenha o escopo da solicitação. Para tarefas de implementação, conclua a alteração, teste-a proporcionalmente ao risco e informe arquivos modificados, validações executadas e limitações restantes.

## O produto

A INIA é uma Supervisora Virtual com IA para operações. Não é, em essência, um chatbot. O produto identifica sinais operacionais, reúne evidências, produz diagnósticos explicáveis, recomenda ações, acompanha evolução e escala casos quando necessário.

A jornada canônica é:

`detecção → diagnóstico → evidência → recomendação → acompanhamento → escalonamento ou encerramento`

`SupervisionCase` é a unidade central do domínio. Alertas, evidências, feedbacks, planos de desenvolvimento, checkpoints e escalonamentos devem pertencer ou ser rastreáveis a um caso.

Existem dois tipos principais de feedback:

- `INDICATOR`: baseado em indicador, meta vigente, período, evolução, contexto operacional e histórico.
- `MONITORING`: baseado em interação/transcrição, critérios de monitoria, conhecimento vigente, guardrails e diagnósticos relacionados.

Um feedback publicável deve conter indicador impactado, evidência encontrada, comportamento observado, procedimento relacionado e recomendação. Texto gerado por IA nunca é evidência. Toda conclusão acionável deve apontar para uma fonte verificável.

O escalonamento de performance não é uma escada fixa no código: observar, orientar, treinar, plano de ação, encaminhar à liderança e solicitar avaliação de continuidade são tipos de intervenção administráveis, e quando cada um cabe é decidido por políticas de acompanhamento versionadas (a sequência `OBSERVE` → `ORIENT` → `COACH` → `ACTION_PLAN` → `MANAGER` é só exemplo e leitura do legado `performance_escalations`). Um resultado abaixo da meta, isoladamente, não determina escalonamento; considere causa, recorrência, evidências, evolução e intervenções anteriores. Dado ausente nunca é desempenho ruim. Bons resultados também podem gerar elogio e reconhecimento. Nenhuma regra, IA ou configuração decide desligamento, aprova a avaliação de continuidade ou altera a situação funcional — isso é sempre decisão humana restrita e auditada.

## Organização do código

Critérios completos, inventário de código obsoleto e pendências: `docs/dev/refatoracao-progressiva.md` (07/10/2026). Em resumo:
- Backend: `src/modules/<domínio>/{domain,application,infrastructure,presentation,testing}`; tudo que só existe para teste (fakes, repositórios em memória, fixtures, provas `*-proof.test.ts`) fica em `<módulo>/testing/`, nunca em `application/testing/`; compartilhado só em `src/shared/<camada>/<propósito>`.
- Frontend: `app/` só rotas; cada feature em `components/<f>/` · `queries/<f>/` · `services/<f>/` · `schemas/<f>/` (nenhum schema solto na raiz); tipos de payload vêm do zod (`z.infer`), nunca reescritos à mão; utilitários compartilhados em `lib/<propósito>/` (datas: `lib/format/date.ts` — `formatCivilDate`, `formatDateTime`, `formatShortDateTime`); `components/ui/` é o kit (shadcn), sem código de feature; classes sempre pelo `cn` de `@/lib/utils`.
- Componente grande vira pasta de partes mantendo a API do arquivo de entrada (ex.: `workflows/node-config-panel.tsx` + `workflows/node-config/*`).
- Prompts, esquemas de resposta e `*_VERSION` são contratos versionados; scripts com hash em `*-freeze.json` são evidência histórica — nenhum dos dois muda por "limpeza".
- Scripts do backend têm checagem própria (`npm run typecheck:scripts`); os congelados (definição em `backend/scripts/frozen-scripts.js`: hash num `*-freeze.json` ou "nunca reexecutar" na documentação) ficam fora dela e do lint e nunca são editados.
- Testes: `frontend/vitest.setup.ts` corrige o `:modal` do jsdom/nwsapi (recursão de ~160 ms por chamada que fazia popups do Radix travarem os testes por segundos); `backend/vitest.config.ts` fixa 20 s de limite por teste e `frontend/vitest.config.ts`, 15 s. A raiz `/` não tem tela: redireciona para o login ou para a tela inicial da pessoa.

## Memória arquitetural

### Múltiplas IAs especializadas (motor implementado; chat conversacional ainda não)

O projeto não vai ficar limitado à INIA conversacional única. Estão previstas IAs especializadas adicionais:

- **IA do operador — feedback de chamadas**: consulta bases de conhecimento para gerar feedback sobre atendimentos.
- **IA do operador — feedback de indicadores**: consulta base de diagnósticos e glossário para gerar feedback sobre indicadores.
- **IAs de apoio ao supervisor**: auxiliam supervisores (escopo ainda a definir).

Requisito decorrente: toda interação do usuário com qualquer uma dessas IAs — mensagens trocadas, curtidas/descurtidas, dúvidas feitas etc. — deve ser persistida no banco, não só exibida na UI e descartada. É pré-requisito para que essas IAs futuras (e a evolução das atuais) consigam aprender e ser avaliadas a partir do histórico real de uso.

Estado atual: o motor de agentes (configuração, gatilhos, execução e persistência — ver seção abaixo) está implementado. Na INIA conversacional (chat de texto/voz do operador) as mensagens são persistidas em conversas (ver "Conversas com a INIA"); curtidas/descurtidas do CHAT ainda ficam só na tela — as do Acompanhamento ("Este conteúdo foi útil?") são persistidas (ver "Avaliação do feedback no Acompanhamento").

### Motor de agentes, gatilhos e execução (implementado)

O agente é a unidade central de configuração — não existe "regra" solta apontando para um tipo de agente. Cada agente tem: nome, tipo, objetivo, descrição, contexto (prompt), grupo/subgrupo de alcance, bases de conhecimento associadas e limites de atuação (interruptor + "até onde este agente vai", escritos no próprio agente e somados aos assuntos proibidos da Governança, que valem para todos os agentes — nunca os substituem; assunto proibido nunca é vinculado por agente). Ao vincular um agente a um grupo, as bases de conhecimento já escopadas para aquele grupo entram pré-selecionadas — o admin só precisa mexer se quiser excluir alguma.

Gatilho é uma entidade independente do agente, nunca uma configuração dentro dele: liga canal + flag + condição + grupo a um agente que deve ser chamado quando a condição bater. O catálogo de flags por canal é configurável pelo admin e pensado para novos canais no futuro (hoje só `VOICE` existe; as flags já chegam calculadas junto com a interação — a INIA não deriva flag a partir de áudio/transcrição bruta).

Como cada tipo de agente é acionado:

- **Monitoria** (ex.: rechamada, nota de URA): sempre por gatilho — nunca por pedido direto do usuário.
- **Indicador**: por pedido do operador (chat, com indicador/período/geral) ou por agendamento configurável (ex.: resumo D-1) — nunca por gatilho.
- **Diagnóstico**: cada grupo cria o seu próprio agente; forma de acionamento ainda não definida.

A execução do agente fica atrás de uma interface única e trocável (hoje implementada com Gemini) — mudar de provedor de LLM não deve exigir mudança em nenhuma outra parte do sistema. Toda execução é persistida (entrada, saída, status, erro), seja disparada por teste manual no admin ou por gatilho real.

Regra de integridade aplicada por código, não só pedida por prompt: a evidência de um feedback de monitoria gerado por IA precisa ser uma citação literal de um trecho da transcrição de origem. Se a IA resumir ou parafrasear em vez de citar, o resultado é descartado (execução marcada como falha) em vez de aceito — reforça na prática o "texto gerado por IA nunca é evidência" já declarado acima.

O resultado de um disparo de gatilho nunca fica como texto solto: sempre vira um `SupervisionCase` novo com evidência registrada e um `Feedback` publicado de verdade (reaproveitando a mesma regra de publicação — precisa ter evidência — que já valia para feedback criado manualmente).

### Acompanhamento × Pendências × Sino, ciência e conteúdo rico (implementado)

Três conceitos que nunca se misturam: **Acompanhamento** = conteúdo para ler (feedbacks publicados, resultados de workflow, escalonamentos); **Pendências** = ação requerida (hoje só Revisão Humana de Workflow; módulo `backend/src/modules/pending-actions`); **Sino** = algo novo aconteceu (`backend/src/modules/notifications`, sobre a tabela `alerts`, com destino decidido pelo backend e rota decidida pelo frontend). Ler ≠ resolver: marcar como lida só grava `read_at`; decidir uma revisão é `POST /pending-actions/human-reviews/:enrollmentId/:nodeId/decision`, que reaproveita a MESMA função da rota admin (`workflows/application/submit-human-review-decision.ts`) — persiste em `node_outputs`, retoma o enrollment e é idempotente por optimistic lock. "Pendente" tem UMA definição (execução em `waiting` no node de revisão endereçada ao viewer), usada por lista, badge da aba, sino e contadores da Equipe — nunca o alerta solto (alertas órfãos de execução apagada não são pendência).

**Ciência** = confirmação formal do PRÓPRIO colaborador de que leu um feedback publicado, feita com o LOGIN e a SENHA da própria conta (`POST /feedback-read-confirmations`, ver "Confirmação de ciência com login e senha" abaixo; grava `acknowledged_at`, status continua `PUBLISHED`). Não existe mais rota de ciência sem credencial. O gestor só enxerga o estado ("Aguardando ciência do colaborador"). Rótulos ambíguos como "sem ciência" não voltam.

Todo texto gerado por Agent/Workflow/INIA para leitura humana passa por `frontend/src/components/rich-content/rich-content.tsx` (react-markdown + remark-gfm, `skipHtml`, sem `dangerouslySetInnerHTML`, links `javascript:` neutralizados). Campos curtos (nome, título, badge) continuam texto puro; transcrições são citação literal e não passam por Markdown.

Avatar 3D: o `<Canvas>` do R3F NUNCA pode re-renderizar por estado de animação nem ser desmontado no ciclo adiado do Radix `Presence` (ver comentários em `inia-humanoid-avatar-3d.tsx` e `profile-workspace.tsx`) — foi a causa do "1 Issue" `target.addEventListener` ao trocar de aba.

Dados de demonstração (`source = 'DEMO_SEED'`) vivem em `backend/seeds/demo` (SQL) e em `backend/src/infrastructure/database/demo-mass/` (massa grande, TypeScript) e só entram por `npm run db:seed:demo` (recusado em `NODE_ENV=production`); migrations são só evolução estrutural/obrigatória.

### Domínios de negócio — catálogo administrável (implementado 2026-09-16)

Regra: **a aplicação conhece TIPOS de especialidade (`DOMAIN | CROSS_CUTTING | PERFORMANCE | SYNTHESIS`) e de roteamento (`DOMAINS | OPEN`), nunca domínios concretos.** `FATURAMENTO`, `RETENCAO`, `SUPORTE`, `CADASTRO`, `LOGISTICA`… são dados de `business_domains` (migration 060: `code` único por organização no formato `^[A-Z][A-Z0-9_]{1,39}$`, `name`, `description`, `active`). Nenhum módulo funcional pode ter enum/lista de códigos de domínio — só fixtures de teste, `official-*.json`, backfill da migration e Wiki. Novo domínio = registro na tela `Administração → Atendimento com IA → Agentes → Domínios de negócio` (sem migration/deploy); aparece automaticamente no select do Agent ("Especialista de domínio" → "Domínio de negócio") e no Orquestrador ("Domínios específicos", 1..N). Domínio ≠ Grupo, ≠ Base de Conhecimento (vinculada ao Agent), ≠ Agent (um domínio pode ter N Agents).

O que o código aplica: Agent DOMAIN referencia `agents.business_domain_id` (FK); Orquestrador DOMAINS referencia `assistant_orchestrator_domains` (N:N). Dual-read central (`business-domains/domain/business-domain.ts` → `resolveDomainRef/resolveDomainRefs`; usados por `agent-specialty.ts` e `orchestrator-policy.ts`): FK/relação primeiro, código legado como fallback (nome = código). Dual-write: `agents.domain`/`agents.specialty` e `routing_domains`/`policy_kind`/`policy_domains` continuam recebendo os códigos (check constraints relaxadas para o FORMATO). Fronteira de política compara por código e mostra o nome ("pertence ao domínio X, que não está autorizado neste Orquestrador"). Backend é a autoridade: domínio inexistente 422 `BUSINESS_DOMAIN_NOT_FOUND`; inativo só passa se o registro já o tinha (`BUSINESS_DOMAIN_INACTIVE`); exclusão só com zero dependências (409 `BUSINESS_DOMAIN_IN_USE`, nunca cascade); código travado em uso (409 `BUSINESS_DOMAIN_CODE_LOCKED`); audit em `audit_logs`. SQL de domínio só em `business-domains/application/business-domain-lookup.ts` + `business-domain-service.ts`. O prompt do Orquestrador recebe por especialista "Tipo: … Domínio: <nome>" (nunca id/código). Prova contra o banco de teste: `INIA_DB_PROOF=1 npx vitest run business-domain-proof` (cria `LOGISTICA_QA` pela API e garante que o código não existe no fonte). Plano de deprecação dos campos legados em `docs/dev/dominios-de-negocio.md`; Wiki em `/wiki/agents/dominios-negocio`.

### Catálogo de indicadores metadata-driven (implementado 2026-09-16)

Regra: **a INIA conhece COMPORTAMENTOS de indicador, nunca CÓDIGOS.** O código pode conhecer `RATE | WEIGHTED_AVERAGE | AVERAGE | SUM | LATEST`, as unidades do catálogo (`PERCENT | SECONDS | POINTS | STARS | COUNT | CASES | CASES_PER_DAY`) e as direções; `TMA`, `FCR`, `MONITORIA_QUALIDADE`, `DIGITAL_RESOLUTION_RATE` são dados. Nenhum módulo funcional pode ter `switch (indicatorCode)`, `Record<IndicatorCode, …>` ou lista de códigos — códigos só aparecem em seed/demo, fixtures de teste, wiki e comentários. Novo indicador + semântica já suportada = configuração pela tela Indicadores (nunca desenvolvimento); semântica nova = nova estratégia genérica no catálogo, nunca regra por código. ADR-007 (`docs/architecture/`) e `docs/dev/central-de-dados-ingestao.md` (a Central de Dados que consome esse catálogo — ver seção própria).

`indicator_definitions` é a fonte de verdade (migration 055): `unit` com check constraint, `daily_supported` (= medição operacional habilitada; única granularidade suportada é DAILY), `operational_aggregation`, `minimum_sample_size`/`minimum_coverage` (padrões que o editor PRÉ-PREENCHE em Condition/Ranking ao escolher o indicador — a configuração fica explícita no Workflow, nunca regra silenciosa no runtime), `official_closure_supported`. Domínio único em `indicators/domain/indicator-definition.ts` (unidades, estratégias com `requiredComponents`, validação: Taxa só em PERCENT; amostra/cobertura só com operacional; ao menos uma capacidade; código `^[A-Z][A-Z0-9_]{1,39}$`). Texto funcional "Cálculo no período" é DERIVADO de estratégia + unidade (`describeAggregationStrategy`) e devolvido pela API (`calculation`) — nunca armazenado nem digitado por indicador. Serviço único `indicators/application/indicator-definition-service.ts` (rota admin e provas usam o mesmo): alteração SEMÂNTICA (código, unidade, direção, estratégia, desligar operacional) é BLOQUEADA com histórico (`INDICATOR_SEMANTIC_LOCKED` 409; dependências em `indicator-dependencies.ts`: medições, metas, fechamentos, Workflows por `jsonb_path_exists` no grafo/gatilho); exclusão só sem histórico. Publish valida capacidades (`workflows/application/validate-indicator-capabilities.ts`): desativado não entra em Workflow novo (`WORKFLOW_INDICATOR_INACTIVE`), janela de dias/semana e quartil operacional exigem `daily_supported`, fontes oficiais exigem `official_closure_supported`. Editor: seletor ÚNICO `admin/workflows/indicator-select.tsx` (filtra ativos por capacidade; referência existente a inativo/incompatível continua visível marcada, nunca some), `HistoricalPeriodPicker.operationalEnabled`. Analytics expõe `capabilities` por indicador. Prova arquitetural contra o banco de teste real: `backend/src/modules/indicators/testing/dynamic-indicator-proof.test.ts` (`INIA_DB_PROOF=1 npx vitest run dynamic-indicator-proof`) — cria TEST_DYNAMIC_RATE/TEST_DYNAMIC_LATEST e "Grupo Dinâmico QA" pelo contrato do produto, prova Condition/Ranking VALUE-CHANGE/quartil/QA Lab/publish/Analytics/estrutura e apaga tudo; um teste garante que esses nomes não existem no código-fonte.

## Memória por área

A memória detalhada de cada área (decisões, versões, provas, limitações e dados de dev) fica em `docs/dev/memoria/`. Leia o arquivo da área antes de mexer nela. Os critérios, o mapa de cada seção antiga para o arquivo onde ela está e as regras de manutenção estão em [docs/dev/memoria/README.md](docs/dev/memoria/README.md). Quando um texto citar uma seção pelo nome (ex.: “ver "Conversas com a INIA"”), procure o arquivo nesse mapa.

Memória nova de uma área vai para o arquivo dela, nunca para este arquivo. Aqui só entram regras permanentes, que valem para qualquer sessão, e a linha de cada área nova neste índice.

Áreas em uso:

- [Motor de feedback (FEEDBACK_ENGINE_V1)](docs/dev/memoria/motor-de-feedback.md) — caminho atual de “Gerar feedback”: análise de chamada com revisão, investigação de indicador, práticas e temas, firmeza, entrega única, memória do motor, diagnóstico da liderança e registro das rodadas pagas.
- [Diagnóstico de indicador — estratégia por indicador](docs/dev/memoria/diagnostico-de-indicador.md) — estratégia de diagnóstico por indicador (versões, rascunho × publicada, pino no nascimento, “Testar diagnóstico”, sinal da população) e as execuções de diagnóstico anteriores ao motor de feedback.
- [Experiência do colaborador — Acompanhamento e aplicação de feedback](docs/dev/memoria/experiencia-do-colaborador.md) — narrativa do feedback e “Entenda este feedback”, timeline e ocultação lógica do Acompanhamento, “Ouvir com a INIA” (aplicação de feedback e consultas na sessão), ciência com login e senha, “Este conteúdo foi útil?” e cabeçalho do item.
- [Conversas, voz e avatar da INIA](docs/dev/memoria/conversa-voz-e-avatar.md) — conversas persistidas com a INIA e monitoramento da gestão, recados de Workflow no Chat e no Avatar (com a voz do recado), avatar Mentora (modelo, lip-sync PT-BR, animação, laboratório) e Cenário da INIA.
- [Perfil pessoal, cabeçalho global e navegação](docs/dev/memoria/perfil-e-navegacao.md) — perfil pessoal (nome preferido, foto, capa), cabeçalho global e seletor de área, abas do perfil e acesso à área de Diagnóstico.
- [Workflows — modelos, publicação, execução e resultados](docs/dev/memoria/workflows.md) — Workflows-modelo e validação de publicação (DRAFT válido, destinatário pela estrutura, editor), gatilho Manual “Executar agora”, worker concorrente com posse da matrícula, aba Resultados com correlação do uso de IA e configuração em rascunho × publicada (gatilho/Abrangência/população só valem ao Publicar, com confirmação do impacto).
- [Agents, Orquestradores, base de conhecimento e materiais de apoio](docs/dev/memoria/agentes-e-conhecimento.md) — Agents especialistas por domínio, busca na base de conhecimento, Orquestradores e suas políticas, resultado estruturado do Orquestrador, materiais de apoio e limites de atuação.
- [Investigação — Tools para Agents e evolução V1.1–V1.3.4.2](docs/dev/memoria/investigacao.md) — Tools de investigação para Agents e a evolução V1.1–V1.3.4.2 (eficiência, Zero-ID, gating fail-closed, suficiência da evidência, recall, integridade literal, semântica temporal).
- [IA — provedores, modelos, roteamento e custos](docs/dev/memoria/ia-provedores-e-custos.md) — provedores, conexões e modelos de IA, policies de roteamento por Use Case, segredos, uso, custo e orçamento.
- [Indicadores, Equipe e organograma](docs/dev/memoria/indicadores-e-estrutura.md) — analytics compartilhado de Indicadores e Equipe (escopo, PRV, atingimento consolidado, comparação operacional) e o organograma “Minha estrutura” (métricas gerenciais, “Ir até mim”).
- [Read model do analytics da liderança e ciclo de vida dos dados](docs/dev/memoria/read-model-e-ciclo-de-vida.md) — componentes por pessoa × janela (idênticos ao caminho original, provados), escopo pelo grafo em cache, versões por trigger, atividade diária, caches, resumo diário de IA, fim do outbox e retenção com políticas desligadas.
- [Central de Dados, calendário operacional e instalação](docs/dev/memoria/central-de-dados-e-instalacao.md) — Central de Dados (fontes, feeds, contratos, quarentena, lineage), situação funcional, escala e calendário operacional, disponibilidade × classificação, conector de banco externo, instalação e publicação em Windows/IIS.
- [Acesso — contas, papéis, permissões e primeiro login](docs/dev/memoria/acesso.md) — contas × papéis × permissões × escopos, delegação, liberação de acesso com senha temporária e primeiro login.
- [Massa demo e holdout de avaliação](docs/dev/memoria/massa-demo-e-holdout.md) — massa demo grande (`db:seed:demo`, população e lotes de diagnóstico, gabarito isolado) e o holdout independente `inia_holdout_v2`.
- [Wiki geral da INIA](docs/dev/memoria/wiki.md) — `/wiki` como documentação oficial do produto: sitemap, catálogos cobertos pelo tipo, testes de links e âncoras.
- [Monitoria de usabilidade](docs/dev/memoria/monitoria-de-usabilidade.md) — coleta no navegador e no servidor, painel, permissões, flags, worker e provas.
- [Segurança — controles transversais](docs/dev/memoria/seguranca.md) — escopo sempre do servidor, catálogos da organização, sessão (jti, nível ao vivo), CSRF, política de destinos de saída, arquivos e limites; auditoria completa em `docs/security/`.
- [Políticas de acompanhamento e intervenções](docs/dev/memoria/politicas-de-acompanhamento.md) — tipos de intervenção por capacidade, políticas versionadas (regras, prioridade, dados insuficientes, conflitos, carência), avaliação e relatório de inteligência, nó “Avaliar política de acompanhamento”, intervenção no caso (Pendências, sino, ficha) e avaliação de continuidade sempre humana.
- [Banco interno — caminho quente, índices e pool](docs/dev/memoria/banco-e-consultas.md) — leituras do caminho quente com LIMIT e keyset, conteúdo depois do LIMIT, aviso × entrega pelo id, pendente com aviso vivo, escrita em lote, limites de sessão do pool por papel e índices 130 e 132–134.
- [INIA para lideranças](docs/dev/memoria/liderancas.md) — uma INIA com capacidades por escopo (nunca agente por cargo): a IA escolhe a ferramenta pela intenção (várias rodadas), o backend calcula — consulta flexível (PRV, quartis, dispersão, consolidado, recorrência), força de trabalho, diagnóstico do indicador por motivo/submotivo, `my_results` do operador —, regras analíticas únicas, cartões de dados, "Onde atuar hoje" e a competência padrão com cobertura.
- [Reports recorrentes](docs/dev/memoria/reports-recorrentes.md) — consultas da INIA que viram entregas periódicas no Acompanhamento: definição reproduzível (ferramenta + parâmetros + estrutura fixa/relativa + período), oferta no chat, agenda e fila no worker, regra de atualização das bases, versões por escopo de destinatário, papel Report, comparação e análise da IA.
- [Escala horizontal e operação](docs/dev/memoria/escala-e-operacao.md) — N APIs/interfaces e M workers: estado compartilhado no PostgreSQL (limites, pausa da IA, avisos), prontidão e desligamento, SSE com cancelamento, métricas internas, logs assíncronos, web farm do IIS e cache dos estáticos.

Histórico (linhas encerradas ou caminhos substituídos — para ler artefatos antigos):

- [Investigação V1.4.x — descoberta semântica](docs/dev/memoria/investigacao-v14.md) — (linha encerrada) descoberta semântica V1.4.0–V1.4.8f: frames, findings, patterns, candidatos de afirmação, atribuição de resultado, variância da extração.
- [Histórico — feedback de atendimento e caminho confiável (V1.4.9 a V1.6.0)](docs/dev/memoria/historico-feedback-v15-v16.md) — (substituído pelo motor de feedback) feedback de atendimento V1 e caminho confiável V1.5.x–V1.6.0: redator, revisão/QA, política de autonomia, entrega no Acompanhamento e “Gerar feedback” no Workflow.
- [Histórico — monitoria por processo V1.7.x, Checkpoint Registry e Monitoring Architecture V2](docs/dev/memoria/historico-monitoria-v17.md) — (substituído pelo motor de feedback) monitoria por processo V1.7.1–V1.7.4, Checkpoint Registry e Monitoring Architecture V2.
