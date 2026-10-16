# INIA para lideranças — diagnóstico, arquitetura e plano

Data: 15/10/2026. Escopo: Supervisor, Coordenador, Gerente, Gerente Sênior (e Diretor, que o código já conhece).
Memória da área: [memoria/liderancas.md](memoria/liderancas.md).

Convenção deste documento: **[existe]** = encontrado no código/banco antes desta evolução; **[proposto]**/**[implementado]** = decisão desta evolução (implementada na fatia 1, ver §8); **[pendente]** = depende de dado ou decisão de negócio.

---

## 1. Diagnóstico do projeto atual

### 1.1 Hierarquia, escopo e autorização — maduro, reaproveitável

- **[existe]** Cadeia `DIRECTOR → SENIOR_MANAGER → MANAGER → COORDINATOR → SUPERVISOR → OPERATOR` em `performance-analytics/domain/hierarchy-levels.ts` (`HIERARCHY_ROLES`, rótulos, âncora de estrutura por nível, `groupingOptionsBelow`). O Coordenador já é um nível de primeira classe (migration 037; o comentário da migration o descreve entre Operador e Supervisor, mas código e dados o colocam **acima** do Supervisor — vale o código).
- **[existe]** Níveis intermediários ausentes já acontecem nos dados de desenvolvimento: 45 supervisores respondem direto a um gerente (sem coordenador), 7 operadores respondem direto a um gerente, 1 gerente sem gerente sênior. O "Agrupar por" e a Equipe tratam isso em cascata (`build-team-overview.ts › collectUnits`, balde "Sem coordenador").
- **[existe]** Escopo resolvido no backend a cada request: `loadViewerScope` = subárvore real (`reports_to_id`, grafo em cache por versão STRUCTURE) ∪ escopo da permissão `indicators.view` da CONTA (Organização/Grupo/Subgrupo). Cargo nunca amplia visão; `subjectKind/subjectId` do navegador nunca é confiado (`resolveSubject` → 403 `STRUCTURE_ACCESS_DENIED`).
- **[existe]** Ver ≠ agir: Pendências (revisão humana, produção não identificada, intervenção) são por **destinatário**; intervenções têm `relationFor` + permissões `interventions.view/execute/approve/sensitive_decide`, revisão otimista e `intervention_events`. A ficha do colaborador só abre operador ativo visível (`canOpenEmployeeProfile`).
- **[existe]** Isolamento por organização em todas as leituras (organização do token).
- **Limite**: a hierarquia não tem histórico — `reports_to_id` é só o vínculo atual.

### 1.2 Indicadores e cálculo — duas camadas, regras explícitas

- **[existe]** Catálogo metadata-driven (`indicator_definitions`): unidade, direção (`HIGHER | LOWER | TARGET`), estratégia (`RATE | WEIGHTED_AVERAGE | AVERAGE | SUM | LATEST`), mínimos de amostra/cobertura. Nenhum código de indicador no código.
- **[existe]** Fechamento oficial mensal (`employee_indicator_performance`): por pessoa × indicador × competência, valor, meta, **atingimento** (já normalizado pela direção) e **quartil oficial** (Q1 melhor, vindo da fonte). **Não tem numerador/denominador** → o resultado oficial de uma estrutura não pode ser recomposto por Σnum/Σden.
- **[existe]** Camada operacional diária (`indicator_measurements`, 1,6 mi linhas até 13/10): numerador/denominador/amostra; consolidação correta por estratégia (`combineWindowComponents`, "pooled", nunca média de médias), elegibilidade (escala, situação, feriados), read model (`analytics_member_window*`), quartil operacional com população explícita (`assignOperationalQuartiles`: ranking de competição, mínimo 4).
- **[existe]** Regra única de "dentro/abaixo da referência" (`isWithinReference`: atingimento oficial ≥ 100%; sem ele, valor × meta × direção). Situação do colaborador determinística (`member-situation.ts`). Sem dado nunca vira zero.
- **[existe — atenção]** "Atingimento consolidado" da estrutura = **média simples** dos atingimentos individuais (documentado em `CONSOLIDATION_METHOD`). É uma leitura normalizada, não o resultado da estrutura no indicador.
- **[não existe]** Decis; ranking de pessoas como produto; contribuição de cada unidade para o desvio; regra de comparabilidade entre estruturas; distinção concentrado × disseminado.

### 1.3 Acompanhamento, ações e processos

- **[existe]** `/supervisor` = `ProfileWorkspace` com abas decididas pelo backend (`view-capabilities.ts`): Acompanhamento, Indicadores, Equipe/Estrutura, Calendário, Pendências, Organograma. Acompanhamento do líder = feed dos feedbacks publicados da estrutura + alertas endereçados a ele + chat da INIA ao lado.
- **[existe]** Casos (`/supervisor/cases/:id`), intervenções com políticas versionadas, Pendências com decisão auditada.
- **[existe]** Conhecimento: `retrieveKnowledgeForAgent` (bases ligadas ao agente). Os especialistas do Orquestrador do chat já respondem processos — o líder herda isso.

### 1.4 Chat com a INIA — a lacuna principal

- **[existe]** O líder **já tem** o chat (`OperatorIniaChat context="team"` no Acompanhamento), com conversas persistidas, Orquestrador por time (TEAM antes de ALL_TEAMS), especialistas como function calling (uma rodada + síntese), evidence gating, guardrails.
- **[existe — bloqueio]** O backend só monta contexto da **própria pessoa** (indicadores, feedbacks, ferramentas de investigação com sujeito único). `asking-person-profile.ts` instrui o modelo a **recusar** perguntas sobre a equipe. A saudação do líder ("Analisei os sinais da sua equipe…") promete o que o backend não entrega.
- **[existe]** Curtir/descurtir do chat é só local (dívida já registrada no CLAUDE.md).

### 1.5 Conclusão

| Reutilizar como está | Adaptar | Criar |
|---|---|---|
| Escopo (`loadViewerScope`, `resolveSubject`), hierarquia, `isWithinReference`, dataset oficial, read model operacional, cascata de unidades, Pendências, intervenções, casos, conversas persistidas, Orquestrador e especialistas de processo, `RichContent` | Orquestração do chat (aceitar ferramentas determinísticas do backend), perfil de quem pergunta (deixar de recusar), filtros da Equipe por URL, saudação e sugestões do líder | Regras analíticas de liderança (ranking, decis, concentração, comparabilidade), análise de indicador numa estrutura, prioridades "onde atuar", cartões de dados no chat, cartão "Onde atuar hoje" no Acompanhamento |

---

## 2. Arquitetura recomendada

### 2.1 Decisão: uma INIA, capacidades por escopo — sem agente por cargo

```
pergunta do líder ──► Orquestrador do chat (o mesmo do operador)
                         │  tools = especialistas configurados (processos, RH…)
                         │        + Ferramentas da liderança (código, determinísticas)  ◄── só se o viewer tem escopo de liderança
                         ▼
             backend executa a ferramenta com o ESCOPO da sessão (loadViewerScope)
                         │  cálculo oficial no backend (regras analíticas versionadas no código)
                         ▼
     resultado = { texto factual p/ o modelo , cartão estruturado p/ a tela }
                         ▼
   síntese curta do modelo (observado × hipótese × recomendação)  +  cartão de dados (números do backend, links)
```

- **Por quê**: o que muda entre Supervisor, Coordenador, Gerente e Gerente Sênior é o **escopo** (quem está abaixo) e o **nível de agregação padrão** (o primeiro nível de gestão presente abaixo). Ambos já são dados (hierarquia + acesso). Um agente por cargo duplicaria prompts, regras e consultas, e quebraria com níveis ausentes.
- **Ferramentas em código, não configuração**: são regras de negócio estáveis (cálculo, escopo) e precisam de teste; o admin não precisa mantê-las. O que o negócio mantém (indicadores, metas, hierarquia, acessos, bases de conhecimento, assuntos proibidos) continua onde já está.
- **Números nunca vêm do modelo**: o cartão de dados é montado pelo backend; o texto do modelo é resumo e explicação. O modelo recebe o mesmo resultado em texto factual com método, base e limitações.
- **Ação ≠ consulta**: as ferramentas são somente leitura. A ação acontece nos fluxos que já existem (Pendências, caso, intervenção), por link — com os controles que eles já têm.
- **Alternativas descartadas**: (a) agente "Supervisor IA" configurável no admin — mais configuração, mesmo cálculo, e o especialista hoje recebe só `query/periodDays` e sujeito único; (b) multiagente por nível — sem ganho, custo e latência maiores; (c) ampliar as ferramentas de investigação (sujeito único, Zero-ID) — são para investigar UMA pessoa/interação, não populações; (d) nova infraestrutura (cubo/OLAP) — o read model e o dataset oficial em lote já servem.

### 2.2 Separação de responsabilidades

| Camada | Onde vive | Quem muda |
|---|---|---|
| Capacidades compartilhadas da INIA | `leadership-analytics/application/leadership-toolset.ts` (catálogo único de ferramentas) | Engenharia |
| Contexto e permissões do usuário | `loadViewerScope` (já existe) + atribuições de papel | Admin de acessos (tela existente) |
| Escopo organizacional | Central de Dados (`EMPLOYEES`, `ORGANIZATIONAL_STRUCTURE`) → `people.reports_to_id` | Base do cliente |
| Regras de indicador | `indicator_definitions` (tela Indicadores) + metas (`goals`/fechamento oficial) | Negócio |
| Regras analíticas (ranking, decis, concentração, comparabilidade) | `leadership-analytics/domain/analytic-rules.ts` (puro, testado, método devolvido junto do resultado) | Engenharia, com decisão de negócio registrada |
| Conhecimento de processos | Bases de conhecimento ligadas aos especialistas do Orquestrador | Negócio (telas existentes) |
| Orientação de resposta por perfil | UM bloco gerado do escopo (`renderLeadershipInstructions`) — nível, estrutura, níveis abaixo; nunca um prompt por cargo | Engenharia |

### 2.3 Hierarquia e autorização (decisões)

- **Escopo padrão**: a estrutura que a pessoa lidera (âncora do nível dela). Para quem tem acesso ampliado (`indicators.view` em Grupo/Organização) o padrão continua a própria estrutura; as outras são acessíveis por referência.
- **Descendentes autorizados**: qualquer estrutura/pessoa resolvida contra `scope.nodes` (subárvore ∪ acesso). Referência por **nome** é resolvida no backend só dentro do escopo; fora dele a resposta é a mesma de "não encontrado" (não revela existência).
- **Mais de uma estrutura**: a hierarquia tem um gestor por pessoa; múltiplas responsabilidades vêm de atribuições de acesso (uma por Grupo/Subgrupo) — a ferramenta aceita Grupo/Subgrupo como estrutura.
- **Mudanças de equipe ao longo do tempo** **[pendente — decisão de negócio]**: hoje a análise usa a **estrutura vigente aplicada a todas as competências** ("quem está na equipe hoje"), e diz isso no método. Analisar "a equipe como era em julho" exige histórico da hierarquia, que não existe.
- **Visualizar × executar**: ferramentas só leem; executar é sempre no fluxo existente, que revalida permissão e registra auditoria.
- **Cartões reabertos no histórico**: ao reabrir uma conversa, cada cartão é revalidado contra o escopo ATUAL; estrutura que saiu do escopo não é exibida (o texto da conversa continua).

---

## 3. Matriz de capacidades por perfil

Todos os perfis usam as MESMAS ferramentas; muda só o escopo resolvido no backend.

| Perfil | Escopo padrão | Agregação padrão (1º nível abaixo presente) | Aprofundamento permitido | Ações |
|---|---|---|---|---|
| Supervisor | Equipe direta (operadores) | — (pessoas) | Operador (ficha) | Pendências dele, intervenção no caso (permissões existentes) |
| Coordenador | Estrutura do coordenador | Supervisor | Supervisor → equipe → operador | Idem + pendências endereçadas a ele |
| Gerente | Estrutura do gerente | Coordenador; quem não tem coordenador cai em Supervisor ("Sem coordenador") | Coordenador → supervisor → equipe → operador | Idem |
| Gerente Sênior | Estrutura do gerente sênior | Gerente; também Grupo/Subgrupo | Gerente → coordenador → supervisor → equipe → operador | Idem |
| Diretor | Estrutura do diretor | Gerente Sênior; Grupo/Subgrupo | Toda a cadeia abaixo | Idem |
| Fora da hierarquia com `indicators.view` | Grupo/Subgrupo/organização do acesso | Grupo/Subgrupo | Operadores do acesso | Só o que a permissão dele permite |

Capacidades (todos os níveis de liderança):

| Capacidade | Ferramenta |
|---|---|
| Visão geral dos indicadores da estrutura, % dentro/fora, piores indicadores, unidades | `leadership_structure_overview` |
| Um indicador: % do time fora da meta, melhores/piores, quartis oficiais, decis, distribuição, por unidade, concentração, comparabilidade | `leadership_indicator_analysis` |
| Quem são as pessoas (fora da referência, sem dado, aguardando ciência, com revisão pendente) | `leadership_people` |
| Onde atuar hoje: pendências com prazo, concentrações, indicadores em queda, ciências pendentes | `leadership_priorities` |
| Processos e políticas | especialistas de conhecimento já configurados no Orquestrador (sem mudança) |

---

## 4. Mapa das ferramentas

| Ferramenta | Pergunta | Status | Entradas | Saída essencial | Escopo | Cálculo no backend |
|---|---|---|---|---|---|---|
| `leadership_structure_overview` | "Como está minha estrutura?" | **[implementado]** sobre `buildStructureDashboard` + `buildTeamOverview` **[existe]** | estrutura (nome/"minha"), competência | por indicador: com dado, abaixo da referência (n e %), atingimento médio, variação; unidades com mais pessoas fora; cobertura | `resolveStructureReference` + `resolveSubject` | contagens por `isWithinReference`; nada recalculado da camada oficial |
| `leadership_indicator_analysis` | "Qual % do meu time está ruim em X?", "piores e melhores em X", "quartis/decis", "onde está concentrado", "compare as equipes" | **[implementado]** | indicador (nome/código), estrutura, competência, agrupar por | população e denominador; dentro/fora (n, %); sem dado; ranking com empates; quartis oficiais; decis; unidades (n, fora, %, participação no desvio, comparável?); padrão concentrado/disseminado; limitações | idem; unidades e pessoas só do escopo | `analytic-rules.ts` (puro) |
| `leadership_people` | "Quem está fora da meta em X?", "quem está sem dado?" | **[implementado]** sobre `buildTeamMembersPage` **[existe]** | estrutura, situação, indicador, só pendentes | pessoas (até 20) com situação, atingimento, indicadores em atenção, ciência pendente, link da ficha | idem | filtros existentes |
| `leadership_priorities` | "Onde preciso atuar hoje?" | **[implementado]** sobre `buildPendingActions` + `buildTeamOverview` + `buildStructureDashboard` **[existem]** | estrutura (padrão: a própria) | itens ordenados com evidência e link; pergunta sugerida para aprofundar | pendências = do viewer (destinatário); demais = escopo | ordem determinística documentada |
| `leadership_indicator_query` | Qualquer recorte que as outras não cobrem: "piores unidades em X", "evolução de X e Y nos últimos 4 meses", "quem está fora em 3+ indicadores", "como está o mês corrente" | **[implementado — iteração 2]** | indicadores, recorte, competências, fonte (oficial/operacional), janela, filtros, ordenação, limite | tabela (`QUERY_TABLE`) + a mesma tabela em markdown | idem | `indicator-query.ts` (oficial: `isWithinReference`; operacional: Σnum/Σden por recorte) |
| `leadership_indicator_query` (v3) | "Piores/melhores em PRV/X", "pior quartil geral", "supervisores com mais Q4", "maiores dispersões", "pior consolidado nos últimos 3 meses", "recorrência no Q4" | **[implementado — iteração 3]** | + `visao` (INDICADOR, CONSOLIDADO, QUARTIS), PRV como indicador, `periodos_como` (ÚLTIMA, MÉDIA, POR_MÊS, RECORRÊNCIA), `quartis`, ordenar por Q4/DISPERSÃO | idem + `highlights` | idem | `official-query.ts` (PRV = linha de indicador com referência 100%; quartil oficial; desvio padrão, P10–P90; consolidado = algum indicador fora + PRV médio + Q4 de PRV); `operational-query.ts` |
| `leadership_workforce` | "Quantas pessoas estão de férias?", "qual % em produção por supervisor?", "quem está de férias?" | **[implementado — iteração 3]** | estrutura, agrupar por, situações, data, listar pessoas, incluir líderes, limite | quantidade e % por situação funcional e recorte; lista nominal opcional | idem | `workforce.ts` sobre a situação canônica vigente na data; afastamento sensível nunca nominal pelo motivo e somado em recortes < 5 |
| `leadership_indicator_diagnosis` | "Onde está o problema em TMA?", "o que os piores têm em comum?", "como melhorar X?" | **[implementado — iteração 3]** | indicador, estrutura, competência, meses de interações, comparar (fora × dentro, Q4 × Q1), nível (motivo, submotivo) | por motivo › submotivo: participação nos piores × melhores, diferença em p.p., duração média, peso na diferença de duração (tempo); grupos, chamadas/pessoa, tempo de casa e unidades dos piores | idem | `indicator-diagnosis.ts` — associação, não causa; motivos com < 5 interações dos piores somados |
| `my_results` (operador) | "Qual meu pior indicador?", "estou na meta em TMA?", "como evoluí?", "como estou este mês?" | **[implementado — iteração 3]** | indicadores, competência, últimas competências, fonte, janela | PRV e cada indicador (resultado, meta, atingimento, quartil, situação, vs. mês anterior) ou evolução; mês em curso com posição entre os pares | SEMPRE a pessoa da sessão (nenhum parâmetro alcança outra) | `self-results.ts` |
| `leadership_process` | "Como funciona X?", "qual o procedimento de Y?", "como orientar a equipe em Z?" — inclusive de quem lidera equipes de Grupos diferentes | **[implementado — 16/10]** | pergunta, grupo (Grupos da estrutura), estrutura citada | a resposta do Orquestrador DO GRUPO (especialistas, bases, limites e materiais dele), rotulada com o Grupo | Grupos e estruturas só do escopo; Grupos com bases diferentes e nenhuma pista = pergunta de volta | `process-consultation.ts` + `resolveOrchestratorForTeam` (mesma regra do chat de quem atende) |
| `leadership_ask` (voz) | Toda pergunta de gestão feita por voz | **[implementado — iteração 2]** | a pergunta com o contexto | a resposta completa em markdown da MESMA orquestração do texto + cartões | idem | — |
| Processos (quem atende) | "Como funciona o processo de X?" | **[existe]** Orquestrador do Grupo do cadastro + especialistas + KB | pergunta | resposta com materiais de apoio | KB do agente | — |

Como o resultado chega ao usuário (iteração 2): **resposta completa em markdown** — frase direta, tabela com os números exatos da ferramenta, o que os dados mostram, hipóteses marcadas e onde atuar — + **cartão de dados** recolhido ("Dados e links": escopo, período, base, método, limitações e links que abrem a tela certa já filtrada). Por voz, a mesma resposta vai para a tela e a INIA fala um resumo.

---

## 5. Parametrização e regras analíticas

### 5.1 Regras (código: `leadership-analytics/domain/analytic-rules.ts`)

| # | Termo | Definição aplicada | Onde é configurado |
|---|---|---|---|
| R1 | Melhor/pior | Atingimento oficial (já normalizado pela direção). Direção `TARGET` sem atingimento: sem ranking. | `indicator_definitions.desired_direction` (tela Indicadores) |
| R2 | Dentro/fora da meta ("desempenho ruim") | `isWithinReference`: atingimento ≥ 100%; sem atingimento, valor × meta × direção. "Desempenho ruim" sem outra qualificação = **abaixo da referência** (interpretação dita na resposta). | Meta = fechamento oficial/`goals` (Central de Dados) |
| R3 | % do time | Denominador = operadores ativos da estrutura vigente **com referência avaliável** no indicador e competência. Sem dado fica fora do denominador e é informado à parte. | código |
| R4 | Período | Competência oficial fechada; padrão = a mais recente com dado para ≥ 70% da estrutura (um fechamento parcial mais novo vira nota no cartão e pode ser pedido). Ao aprofundar, a INIA mantém a competência da análise anterior. A aba Indicadores continua abrindo na mais recente com qualquer dado; os links dos cartões levam a competência explícita. | código (`LOW_COVERAGE_THRESHOLD`) |
| R5 | Consolidação | Resultado principal da estrutura = **contagem** dentro/fora (sem ambiguidade). "Atingimento médio" = média simples dos atingimentos individuais, sempre rotulado assim — nunca chamado de "resultado da equipe". Resultado em valor do indicador só pela camada operacional (Σnum/Σden). | código |
| R6 | Ranking e empates | Ranking de competição (1, 2, 2, 4) por atingimento; nome só desempata a exibição. Sem atingimento: fora do ranking, contado. | código |
| R7 | Quartil | Quartil **oficial** da fonte (população definida pela fonte; nunca recalculado). | fonte |
| R8 | Decil | Calculado pela INIA **na população analisada** (a estrutura): D1 = melhores 10%, `ceil(10 × posição ÷ n)`, empates na mesma posição, mínimo de 10 pessoas ranqueadas. | código (`MINIMUM_DECILE_POPULATION`) |
| R9 | Ofensor | Três sentidos nunca misturados: (a) **pior resultado** (pessoa/unidade com menor atingimento); (b) **volume de desvios** (participação da unidade no total de pessoas fora); (c) **contribuição para o desvio consolidado** (impacto no resultado em valor) **[pendente: exige Σnum/Σden oficial ou meta operacional por unidade]**. | código |
| R10 | Concentrado × disseminado | Unidades comparáveis (≥ 3 pessoas com referência). **Concentrado**: o menor conjunto de unidades que soma ≥ 50% das pessoas fora tem ≤ 1/3 das unidades e taxa de fora ≥ 1,5× a das demais. **Disseminado**: ≥ 2/3 das unidades com taxa ≥ metade da taxa geral. Senão **misto**; < 3 unidades = indeterminado. | código |
| R11 | Comparabilidade | Unidades comparáveis quando: mesmo Grupo dominante (≥ 80% das pessoas), ≥ 5 pessoas com referência e cobertura ≥ 70%. Fora disso: resultado mostrado com o motivo e o recorte sugerido (por Grupo/Subgrupo). Metas diferentes entre Subgrupos são normalizadas pelo atingimento. | código |
| R12 | Estrutura no tempo | Estrutura vigente aplicada a todas as competências **[pendente]**. | — |

Toda saída de ferramenta traz `method` (texto dessas regras) e `limitations` (cobertura, população insuficiente, competência parcial, estrutura vigente).

### 5.2 Onde configurar cada coisa

| Informação | Lugar | Por quê |
|---|---|---|
| Capacidades e apresentação por perfil | **Código** (catálogo de ferramentas + bloco único de orientação gerado do escopo) | Regra estável; muda com teste, não com tela |
| Estrutura organizacional | **Central de Dados** (já existe) | Vem da base do cliente; a INIA não edita |
| Permissões | **Usuários e acessos** (já existe) | Papel × escopo, auditado |
| Definições dos indicadores (direção, unidade, agregação, mínimos) | **Tela Indicadores** (já existe) | Metadata-driven |
| Metas | **Fechamento oficial / `goals`** pela Central de Dados (já existe) | Fonte do cliente |
| Critérios de comparação e limiares (R4, R8, R10, R11) | **Código**, com constantes nomeadas e devolvidas no método | Só viram configuração da organização se o negócio pedir ajuste recorrente |
| Fontes de processos | **Bases de conhecimento + especialistas do Orquestrador** (já existe) | Mesmo conhecimento do operador |
| Sugestões de perguntas e ações | **Derivadas dos dados** (prioridades do dia) — sem cadastro | Evita painel que ninguém mantém |

Nenhuma tela administrativa nova nesta fatia.

**Ferramentas: no código ou administradas no sistema? (decisão da iteração 3)** — ficam no **código**. Cada ferramenta é um cálculo com regra de negócio (o que é "fora", quartil oficial, PRV, privacidade de afastamento, escopo), testado e versionado; se fosse cadastrável, quem cadastra precisaria escrever consulta e regra — e uma consulta mal escrita vaza dado fora do escopo ou cria um número que as telas não reconhecem. O que já é dado continua dado: indicadores, unidades, direção e estratégia (tela Indicadores), situações funcionais (Central de Dados), domínios e especialistas (Orquestrador). Os parâmetros das ferramentas são metadata-driven (nomes de indicadores, Grupos, Subgrupos e níveis vêm do banco), então indicador novo ou estrutura nova não exige código. Evolução possível sem perder isso: uma tela de **habilitação por organização** (ligar/desligar cada ferramenta, ver uso e custo) — nunca "ferramenta nova por configuração".

**Numerador e denominador no fechamento oficial (iteração 3)** — hoje o fechamento oficial (`employee_indicator_performance`) traz valor, meta, atingimento e quartil por pessoa, sem Σnum/Σden. Todas as perguntas de "quantos/qual %/quem está fora", quartis, dispersão, consolidado e recorrência são respondidas sem ele. Ele só é necessário para o **resultado do indicador da estrutura em valor** (ex.: TMA da coordenação = Σsegundos ÷ Σchamadas) e a **contribuição de cada unidade** para esse valor. Para meses fechados, a camada operacional (`indicator_measurements`, num/den diários) já permite isso no período coberto pela medição diária. Se o negócio precisar do valor OFICIAL consolidado, a mudança é na Central de Dados: campos opcionais `numerator`/`denominator` no contrato de fechamento por pessoa (nova versão do contrato, dual-read), validados pela estratégia do indicador (`requiredComponents`) — sem mudança nas ferramentas além de ler os dois campos.

---

## 6. Jornada e telas essenciais

**Acompanhamento (esquerda) + Chat (direita)** — o que já existe, com duas adições:

1. **Cartão "Onde atuar hoje"** no topo do Acompanhamento do líder (determinístico, sem IA, mesmo cálculo de `leadership_priorities`): pendências com prazo, unidades com concentração de pessoas fora, indicadores com mais pessoas fora, ciências pendentes. Cada item tem a evidência ("9 de 24 fora da referência em TMA — ago/2026"), o link para a tela certa e "Perguntar à INIA".
2. **Cartões de dados nas respostas do chat**: escopo, período, base e método visíveis; tabela de unidades ou pessoas; distribuição; links "Abrir equipe", "Ver pessoas", "Abrir ficha", "Ver pendências".

Estados: carregando (esqueleto), sem dados ("sem fechamento oficial em <mês>"), dados incompletos (cobertura), sem acesso ("não encontrei essa estrutura no seu escopo"), sem ferramentas (perfil sem estrutura: segue o chat de processos).

Jornadas (mesma navegação em todos os níveis):

- **Supervisor**: "Onde preciso atuar hoje?" → prioridades (revisão pendente do Thiago; 9 de 24 fora em TMA) → "Quem está fora em TMA?" → pessoas → ficha → acompanhamento/intervenção do caso.
- **Coordenador**: "Como estão minhas equipes em FCR?" → por supervisor (fora %, participação no desvio, comparáveis?) → "Abrir equipe do Carlos" (Equipe já no sujeito) → pessoas → ficha.
- **Gerente**: "Onde estão os principais desvios?" → por coordenador (supervisores sem coordenador aparecem como unidades próprias) → coordenador → supervisor → equipe → operador.
- **Gerente Sênior**: "O problema de TMA é disseminado ou concentrado?" → padrão + o que é comparável (mesmo Grupo) e o que não é (Grupos diferentes, população pequena) → gerente → … até o detalhe autorizado.

O link preserva sujeito e competência (`subjectKind/subjectId/period/indicator` e os novos filtros da Equipe `situation`/`attention` na URL).

---

## 7. Plano incremental

**Fatia 1 (esta entrega)** — valida a arquitetura com dados reais, para todos os níveis de uma vez (o escopo é genérico):
1. Regras analíticas puras + testes.
2. Ferramentas de liderança (overview, análise de indicador, pessoas, prioridades) com escopo do backend + testes de acesso.
3. Chat de texto **e voz** (a INIA responde falando também ao que é digitado — padrão do produto): ferramentas oferecidas ao Orquestrador e à sessão de voz quando o viewer tem escopo de liderança; perfil deixa de recusar; cartões via SSE/tool-call e no histórico.
4. Frontend: cartões no chat, perguntas sugeridas do líder, cartão "Onde atuar hoje", "Perguntar à INIA" do cartão para o painel, filtros da Equipe por URL.
5. Rota determinística `GET /api/v1/leadership/*` (validação sem custo de IA e base do cartão).
6. Wiki `/wiki/estrutura/lideranca`.

**Fatia 2**: contribuição para o desvio em valor (camada operacional por unidade); pendências dos subordinados (coordenador vê decisões atrasadas dos supervisores, com permissão); curtidas do chat persistidas; comparação temporal de unidades; Equipe filtrada por situação também dentro das unidades.

**Fatia 3** (se o negócio pedir): limiares de comparabilidade por organização; histórico da hierarquia; resumo agendado para líderes via Workflow (Output → Chat).

Decisões de negócio em aberto: R9(c) contribuição em valor; R12 estrutura no tempo; ordem das prioridades do dia (proposta inicial documentada no código).

---

## 8. Implementação e validação (15/10/2026)

O que foi entregue, onde vive e como foi provado está na memória da área: [memoria/liderancas.md](memoria/liderancas.md). Em resumo:

- **Backend**: módulo `leadership-analytics` (regras, referências, análise de indicador, visão geral, pessoas, prioridades, catálogo de ferramentas, contexto do chat, rota `/api/v1/leadership`); `run-orchestrated-reply` com ferramentas diretas; `realtime-router` (texto, voz, histórico revalidado); correção do filtro "indicador em atenção" da Equipe.
- **Frontend**: cartões de dados, "Onde atuar hoje", perguntas sugeridas, ponte "Perguntar à INIA", filtros por URL, página da Wiki.
- **Validação**: suítes completas de backend e frontend; números conferidos com SQL independente; matriz de acesso com contas reais de cada nível; jornadas ponta a ponta (coordenador e supervisora) no navegador, incluindo o aprofundamento com contexto preservado.

### Iteração 2 (15/10/2026, noite)

Consulta flexível de indicadores (oficial e operacional), respostas completas em markdown, voz pela mesma orquestração do texto (`leadership_ask`), enquadramento "líder não atende" também nos especialistas, mês corrente na visão geral, cartões recolhidos no chat e só de leitura no monitoramento do admin. Detalhes e validação: [memoria/liderancas.md](memoria/liderancas.md#iteração-2-15102026-noite--perguntas-livres-e-resposta-em-markdown).

### Iteração 3 (16/10/2026)

A IA escolhe a ferramenta pela intenção e pode consultar em várias rodadas; consulta flexível v3 (PRV, quartis e dispersão, consolidado, recorrência), força de trabalho, diagnóstico do indicador por motivo e submotivo, `my_results` para o operador, e as decisões sobre ferramentas no código e numerador/denominador (§5.2). Detalhes, QA e limitações: [memoria/liderancas.md](memoria/liderancas.md#iteração-3-16102026--a-ia-escolhe-a-ferramenta-o-backend-calcula-a-ia-analisa).

### Consulta de processo por Grupo (16/10/2026)

Quem lidera não usa mais o Orquestrador do Grupo do próprio cadastro: processos vão ao Orquestrador do Grupo da dúvida (`leadership_process`), escolhido pelo Grupo citado, pela equipe citada ou implícito quando todos os Grupos usam a mesma base. Detalhes, QA e o achado sobre o contexto extra dos especialistas: [memoria/liderancas.md](memoria/liderancas.md#consulta-de-processo-por-grupo-16102026-tarde).
