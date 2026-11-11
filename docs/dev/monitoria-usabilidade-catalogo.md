# Monitoria de usabilidade — catálogo (gerado do código)

> Arquivo GERADO por `npx tsx scripts/usage-analytics/export-docs.ts` (backend). Não edite à mão: mude o código e regenere.
> Versões: definições `USABILITY_METRICS_V1` · sessão `USAGE_SESSION_V1` · atividade `USAGE_ACTIVITY_V1` · funis `USAGE_FUNNELS_V1` · dificuldade `USAGE_DIFFICULTY_V1`.

## Dicionário de métricas

| Id | Aba | Rótulo | Definição | Fórmula | Unidade | Fonte | Base | Deduplicação | Cobertura | Exclusões | Limitações |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| population.registered | people | Pessoas cadastradas ativas | Pessoas com cadastro ativo na organização (no escopo do observador). | `count(people.active)` | PEOPLE | Cadastro oficial (people) — estado ATUAL | — | Por pessoa | Estado atual; não é histórico. | Desligadas (cadastro inativo). | Não reconstrói o cadastro passado. |
| population.no_account | people | Sem conta de acesso | Pessoas ativas sem conta — barreira de provisionamento, FORA do denominador de contas habilitadas. | `count(people.active ∧ ∄ user_account)` | PEOPLE | people × user_accounts (estado atual) | — | Por pessoa | Estado atual. | — | — |
| population.account_disabled | people | Conta desabilitada | Pessoas ativas cuja conta está desabilitada. | `count(people.active ∧ user_account.active = false)` | PEOPLE | user_accounts (estado atual) | — | Por pessoa | Estado atual. | — | — |
| population.away | people | Afastadas | Pessoas ativas com situação funcional diferente de Em produção (férias, INSS, licenças…), conforme a situação oficial vigente. | `count(people.active ∧ situação ≠ EM_PRODUCAO)` | PEOPLE | Situação funcional oficial (estado atual) | — | Por pessoa | Estado atual. | — | Afastamento não exclui a pessoa da elegibilidade de uso: só é mostrado à parte. |
| population.terminated | people | Desligadas | Cadastros inativos. | `count(¬people.active)` | PEOPLE | people (estado atual) | — | Por pessoa | Estado atual. | — | — |
| population.eligible_current | people | Elegíveis agora | Pessoas ativas com conta habilitada neste momento. | `count(people.active ∧ user_account.active)` | PEOPLE | people × user_accounts (estado atual) | — | Por pessoa | Estado atual. | Eventos de sistema, polling, prefetch, heartbeat isolado, contas classificadas como teste/demonstração/automação (salvo inclusão explícita) e, por padrão, a Administração e o próprio painel. | População atual ≠ população do período. |
| population.eligible_period | people | Elegíveis no período | Pessoas com conta habilitada e acesso ao produto em pelo menos parte do período, pelos intervalos de elegibilidade registrados. | `count(distinct pessoa com intervalo de elegibilidade ∩ período ≠ ∅)` | PEOPLE | Intervalos de elegibilidade registrados pela monitoria (desde o início da coleta) | — | Por pessoa (união dos intervalos) | Só a partir do início do registro de elegibilidade; antes disso é desconhecida (nunca suposta). | Eventos de sistema, polling, prefetch, heartbeat isolado, contas classificadas como teste/demonstração/automação (salvo inclusão explícita) e, por padrão, a Administração e o próprio painel. | Elegibilidade anterior ao registro não é reconstruída. |
| activity.active_people | overview | Pessoas ativas | Pessoas com ao menos uma tela apresentada em primeiro plano ou interação humana válida no intervalo. | `count(distinct pessoa com atividade qualificada no intervalo)` | PEOPLE | Eventos do navegador (projeção por pessoa/dia) + ações de domínio confirmadas no servidor | — | Pessoa única no intervalo inteiro (nunca soma de ativos diários) | Período coberto pela coleta do navegador; antes dela = histórico não medido. | Eventos de sistema, polling, prefetch, heartbeat isolado, contas classificadas como teste/demonstração/automação (salvo inclusão explícita) e, por padrão, a Administração e o próprio painel. | Ausência de evento durante falha de coleta não prova ausência de uso. |
| activity.engaged_people | overview | Pessoas engajadas | Pessoas que concluíram ao menos uma ação de domínio: enviar mensagem/turno de voz, avaliar feedback, confirmar ciência, iniciar aplicação, solicitar execução manual. | `count(distinct pessoa com ação de domínio confirmada no intervalo)` | PEOPLE | Tabelas oficiais (mensagens, avaliações, ciência, aplicações, execuções manuais) | — | Pessoa única no intervalo | Desde a existência de cada fonte oficial. | Contas de teste/demonstração (salvo inclusão). | Quantidade de cliques nunca substitui ação de domínio. |
| activity.adoption_rate | overview | Adoção no período | Elegíveis no período com atividade observada ÷ elegíveis no período. | `ativos ∩ elegíveis ÷ elegíveis` | PERCENT | Elegibilidade registrada × atividade observada | Pessoas elegíveis no período | Pessoa | Mínimo entre a cobertura da elegibilidade e a da atividade. | Eventos de sistema, polling, prefetch, heartbeat isolado, contas classificadas como teste/demonstração/automação (salvo inclusão explícita) e, por padrão, a Administração e o próprio painel. | Pessoas sem conta não reduzem a adoção das habilitadas: aparecem como barreira à parte. |
| activity.eligible_inactive | people | Elegíveis sem atividade observada | Elegíveis no período sem nenhuma atividade observada no período. | `elegíveis − ativos` | PEOPLE | Elegibilidade × atividade | — | Pessoa | Igual à adoção. | Eventos de sistema, polling, prefetch, heartbeat isolado, contas classificadas como teste/demonstração/automação (salvo inclusão explícita) e, por padrão, a Administração e o próprio painel. | “Sem atividade observada” — nunca inferir desinteresse ou causa. |
| activity.first_access | people | Primeiro acesso observado no período | Pessoas cujo primeiro acesso observado pela monitoria ocorreu no período. | `count(marco de primeiro acesso ∈ período)` | PEOPLE | Marcos de acesso (monitoria) + último login conhecido (histórico oficial) | — | Pessoa | Pessoa com login registrado antes da coleta nunca conta como primeiro acesso. | Eventos de sistema, polling, prefetch, heartbeat isolado, contas classificadas como teste/demonstração/automação (salvo inclusão explícita) e, por padrão, a Administração e o próprio painel. | “Primeiro observado” ≠ “primeiro da vida”. |
| activity.never_since_enabled | people | Sem acesso desde a habilitação | Contas habilitadas DEPOIS do início da coleta, sem nenhum acesso observado desde então (toda a janela tem cobertura). | `elegível ∧ habilitação ≥ início da coleta ∧ ∄ acesso` | PEOPLE | Elegibilidade + marcos + coleta | — | Pessoa | Só classifica com cobertura total desde a habilitação. | Eventos de sistema, polling, prefetch, heartbeat isolado, contas classificadas como teste/demonstração/automação (salvo inclusão explícita) e, por padrão, a Administração e o próprio painel. | last_login_at nulo, sozinho, nunca autoriza “nunca acessou”. |
| activity.no_record_since_collection | people | Sem registro desde o início da coleta | Contas habilitadas antes da coleta, sem acesso observado desde o início dela — histórico anterior desconhecido. | `elegível ∧ habilitação < início da coleta ∧ ∄ acesso observado ∧ ∄ login conhecido` | PEOPLE | Elegibilidade + marcos | — | Pessoa | Histórico anterior à coleta é desconhecido. | Eventos de sistema, polling, prefetch, heartbeat isolado, contas classificadas como teste/demonstração/automação (salvo inclusão explícita) e, por padrão, a Administração e o próprio painel. | Não é “nunca acessou”. |
| activity.returned | people | Retornaram após inatividade | Pessoas ativas no período cuja atividade anterior observada foi há 7, 14 ou 30 dias ou mais. | `ativo no período ∧ (primeiro dia ativo do período − último dia ativo anterior) ≥ N` | PEOPLE | Projeção por pessoa/dia | — | Pessoa | Precisa de cobertura nos N dias anteriores ao retorno. | Eventos de sistema, polling, prefetch, heartbeat isolado, contas classificadas como teste/demonstração/automação (salvo inclusão explícita) e, por padrão, a Administração e o próprio painel. | — |
| activity.inactive_days | people | Sem atividade há N dias | Elegíveis cuja última atividade observada foi há 3, 7, 14 ou 30 dias ou mais (no fim do período). | `fim do período − última atividade ≥ N dias` | PEOPLE | Marcos de acesso | — | Pessoa | Indica quando a janela não tem cobertura completa. | Eventos de sistema, polling, prefetch, heartbeat isolado, contas classificadas como teste/demonstração/automação (salvo inclusão explícita) e, por padrão, a Administração e o próprio painel. | — |
| activity.dau | overview | DAU | Pessoas distintas ativas no dia civil de referência. | `count(distinct pessoa ativa no dia)` | PEOPLE | Projeção por pessoa/dia | — | Pessoa | Dia coberto. | Eventos de sistema, polling, prefetch, heartbeat isolado, contas classificadas como teste/demonstração/automação (salvo inclusão explícita) e, por padrão, a Administração e o próprio painel. | — |
| activity.wau | overview | WAU (7 dias móveis) | Pessoas distintas ativas nos 7 dias civis até o dia de referência, inclusive. | `count(distinct pessoa ativa em [ref−6, ref])` | PEOPLE | Projeção por pessoa/dia | — | Pessoa única na janela | Janela coberta. | Eventos de sistema, polling, prefetch, heartbeat isolado, contas classificadas como teste/demonstração/automação (salvo inclusão explícita) e, por padrão, a Administração e o próprio painel. | Janela móvel — não é semana civil. |
| activity.mau | overview | MAU (30 dias móveis) | Pessoas distintas ativas nos 30 dias civis até o dia de referência, inclusive. | `count(distinct pessoa ativa em [ref−29, ref])` | PEOPLE | Projeção por pessoa/dia | — | Pessoa única na janela | Janela coberta. | Eventos de sistema, polling, prefetch, heartbeat isolado, contas classificadas como teste/demonstração/automação (salvo inclusão explícita) e, por padrão, a Administração e o próprio painel. | Janela móvel — não é mês civil. |
| activity.dau_mau | overview | DAU/MAU | DAU do dia de referência ÷ MAU da janela de 30 dias correspondente. | `DAU(ref) ÷ MAU(ref)` | PERCENT | Projeção por pessoa/dia | MAU da mesma janela | Pessoa | Janela de 30 dias coberta. | Eventos de sistema, polling, prefetch, heartbeat isolado, contas classificadas como teste/demonstração/automação (salvo inclusão explícita) e, por padrão, a Administração e o próprio painel. | Não é média de DAU ÷ MAU. |
| sessions.started | overview | Acessos (sessões iniciadas) | Sessões de uso iniciadas no intervalo. Reload, navegação e outra aba não criam sessão; 30 min sem atividade qualificada encerram. | `count(sessão com início ∈ intervalo)` | SESSIONS | Sessões derivadas dos eventos do navegador | — | Sessão = conta × navegador × período contínuo de atividade | Coleta do navegador. | Eventos de sistema, polling, prefetch, heartbeat isolado, contas classificadas como teste/demonstração/automação (salvo inclusão explícita) e, por padrão, a Administração e o próprio painel. | Sessão analítica nunca substitui a sessão de autenticação. |
| sessions.active_in_day | people | Sessões ativas no dia | Sessões que tiveram atividade no dia (inclusive as iniciadas antes da meia-noite). | `count(sessão ∩ dia ≠ ∅)` | SESSIONS | Sessões derivadas | — | Sessão | Coleta do navegador. | Eventos de sistema, polling, prefetch, heartbeat isolado, contas classificadas como teste/demonstração/automação (salvo inclusão explícita) e, por padrão, a Administração e o próprio painel. | Coluna separada de “iniciadas no dia”. |
| sessions.per_active_person | overview | Acessos por pessoa ativa | Sessões iniciadas no intervalo ÷ pessoas ativas no intervalo. | `sessões ÷ pessoas ativas` | RATIO | Sessões + projeção | Pessoas ativas no intervalo | — | Coleta do navegador. | Eventos de sistema, polling, prefetch, heartbeat isolado, contas classificadas como teste/demonstração/automação (salvo inclusão explícita) e, por padrão, a Administração e o próprio painel. | Complementar com a distribuição e sessões por pessoa/dia ativo. |
| sessions.duration | overview | Duração da sessão | Fim − início da sessão (média, mediana, p95). NÃO é tempo ativo. | `percentile_cont sobre as sessões encerradas` | SECONDS | Sessões derivadas | — | Sessão | Coleta do navegador. | Sessões ainda abertas. | Duração inclui pausas de até 30 min. |
| activity.active_time | overview | Tempo ativo observado | Soma, por pessoa, da UNIÃO dos intervalos em primeiro plano com interação recente (≤ 60 s) ou voz em andamento — abas e dispositivos simultâneos contam uma vez. | `Σ pessoas ( \|∪ intervalos de atenção\| )` | SECONDS | Heartbeats do navegador (≤ 15 s) | — | União por pessoa | Coleta do navegador. | Aba oculta, tela suspensa, reprodução pausada. | Estimativa de atividade observada — não comprova atenção nem leitura. |
| retention.d_n | people | Retenção D1/D7/D30 | Da coorte de primeiro acesso comprovado, quem voltou exatamente no dia civil 1, 7 ou 30 depois. | `retornos no dia N ÷ tamanho da coorte madura` | PERCENT | Marcos + projeção por pessoa/dia | Pessoas da coorte cuja janela N já terminou | Pessoa | Só coortes maduras; histórico desconhecido não entra como primeiro acesso. | Eventos de sistema, polling, prefetch, heartbeat isolado, contas classificadas como teste/demonstração/automação (salvo inclusão explícita) e, por padrão, a Administração e o próprio painel. | — |
| auth.logins | people | Logins bem-sucedidos | Autenticações aceitas pelo servidor. | `count(auth.login_succeeded)` | EVENTS | Servidor (login) | — | Evento | Desde o início da coleta do servidor. | — | Falhas de login nunca são atribuídas a uma pessoa pela entrada digitada. |
| screens.views | screens | Visualizações de tela | Telas/abas/painéis/diálogos apresentados em primeiro plano (evento canônico screen.viewed). | `count(screen.viewed)` | EVENTS | Navegador | — | Instância de tela; remontagem técnica não duplica, retorno real conta | Coleta do navegador, por tela (catálogo). | Eventos de sistema, polling, prefetch, heartbeat isolado, contas classificadas como teste/demonstração/automação (salvo inclusão explícita) e, por padrão, a Administração e o próprio painel. | page_view de rota nunca é somado a screen.viewed. |
| screens.time | screens | Tempo ativo mediano na tela | Mediana, entre as pessoas, do tempo ativo observado na tela. | `percentile_cont(0,5) dos segundos por pessoa` | SECONDS | Heartbeats por tela | — | União por pessoa e tela | Coleta do navegador. | Eventos de sistema, polling, prefetch, heartbeat isolado, contas classificadas como teste/demonstração/automação (salvo inclusão explícita) e, por padrão, a Administração e o próprio painel. | Soma entre telas não é aditiva (painel sobre a tela conta nos dois). |
| elements.activation_rate | screens | Taxa de acionamento | Pessoas que acionaram ÷ pessoas às quais o elemento foi exposto (≥ 50 % visível por 1 s). | `pessoas com acionamento ÷ pessoas expostas` | PERCENT | Navegador | Pessoas expostas ao elemento | Pessoa | Só elementos centrais com exposição medida; sem exposição medida, mostra só a contagem. | Eventos de sistema, polling, prefetch, heartbeat isolado, contas classificadas como teste/demonstração/automação (salvo inclusão explícita) e, por padrão, a Administração e o próprio painel. | Não é CTR quando a exposição não é medida. |
| feedback.available | feedbacks | Feedbacks disponibilizados | Fontes × destinatários publicados/entregues no período e visíveis no Acompanhamento. | `count(fonte publicada/entregue no período)` | ITEMS | feedbacks (published_at) e interaction_feedback_deliveries (delivered_at) | — | Organização × tipo da fonte × id × destinatário | Fonte oficial desde a existência da tabela. | Ocultados do Acompanhamento. | — |
| feedback.exposure_rate | feedbacks | Exposição | Da coorte disponibilizada, quantos tiveram o card exposto ao destinatário na janela. | `expostos ÷ disponibilizados` | PERCENT | Navegador (exposição) × fonte oficial | Disponibilizados na coorte | Fonte × destinatário | Itens disponibilizados antes da coleta ficam como “exposição não medida”. | Exposição por gestores (ator ≠ destinatário). | Exposição ≠ leitura. |
| feedback.open_rate | feedbacks | Abertura | Da coorte, quantos o destinatário abriu: expandiu o feedback no Acompanhamento (“Entenda este feedback”, “Ver feedback completo”) ou abriu a sessão com a INIA. | `abertos ÷ disponibilizados` | PERCENT | Navegador × fonte oficial | Disponibilizados na coorte | Fonte × destinatário | Igual à exposição. | — | Abrir ≠ ler. O feedback novo mostra a narrativa direto no feed; a leitura dela sem expandir aparece em “Leitura do conteúdo” (rolagem), não como abertura. |
| feedback.rating_among_opened | feedbacks | Avaliação entre abertos | Abertos com avaliação vigente (UP/DOWN) no corte ÷ abertos. CONGELADA desde 10/11/2026: o “Este conteúdo foi útil?” deixou de gravar; a avaliação passou a ser a concordância registrada na ciência (migration 186). | `abertos ∧ avaliação vigente ÷ abertos` | PERCENT | Navegador × feedback_ratings (histórico) | Abertos na coorte | Fonte × destinatário | Abertura medida. | Avaliação retirada (NONE). | A tela permite avaliar sem abrir — caminho mostrado à parte. |
| feedback.useful_rate | feedbacks | Utilidade positiva | Avaliações vigentes UP ÷ (UP + DOWN) no corte. CONGELADA desde 10/11/2026: o “Este conteúdo foi útil?” deixou de gravar (a avaliação passou a ser a concordância na ciência, migration 186); só mede o histórico. | `UP ÷ (UP + DOWN)` | PERCENT | feedback_ratings (versão vigente na data do corte) | Avaliações vigentes UP + DOWN | Uma vigente por pessoa × fonte | Desde a migration 113. | NONE fora do denominador. | Mudanças não contam como novos feedbacks avaliados. |
| feedback.ack_rate | feedbacks | Ciência | Da coorte, quantos têm ciência confirmada pelo destinatário (login e senha). | `com ciência ÷ disponibilizados` | PERCENT | acknowledged_at das fontes oficiais | Disponibilizados na coorte | Fonte × destinatário; confirmação repetida nunca é nova ciência | Fonte oficial. | — | Ciência não comprova execução da orientação nem encerra caso. |
| feedback.application_rate | feedbacks | Aplicação iniciada | Da coorte, quantos tiveram a aplicação com a INIA iniciada. | `com aplicação iniciada ÷ disponibilizados` | PERCENT | feedback_applications | Disponibilizados na coorte | Uma aplicação por fonte | Desde a migration 103. | — | — |
| feedback.application_completion | feedbacks | Conclusão da aplicação | Aplicações concluídas ÷ iniciadas da mesma coorte. | `concluídas ÷ iniciadas` | PERCENT | feedback_applications | Aplicações iniciadas na coorte | Aplicação | Desde a migration 103. | — | Hoje a conclusão acontece pela confirmação de ciência. |
| feedback.time_to | feedbacks | Tempo até abrir/avaliar/aplicar/dar ciência | Mediana e p95 do tempo desde a entrega até o primeiro fato. Itens sem o fato continuam pendentes (nunca duração zero). | `percentile_cont(fato − entrega) entre os que tiveram o fato` | SECONDS | Fonte oficial + navegador | — | Fonte × destinatário | Igual ao fato medido. | Itens pendentes (mostrados em contagem própria). | — |
| confirmation.attempts | feedbacks | Tentativas de confirmação | Aberturas do formulário de ciência (uma tentativa por abertura), com envios, falhas, recuperação e cancelamento. | `count(distinct attempt_id)` | ATTEMPTS | feedback_read_confirmation_events (oficial) | — | attempt_id | Desde a migration 114. | — | Login digitado e senha nunca são registrados. |
| chat.people | conversations | Pessoas que usaram a INIA | Pessoas com ao menos uma mensagem de texto ou turno de voz concluído no intervalo; separadas por texto, voz e ambos. | `count(distinct dono de mensagem humana)` | PEOPLE | assistant_interactions (role user) | — | Pessoa | Desde a migration 094 (conversas). | Mensagem proativa da INIA, chunk de streaming, transcrição parcial. | Pergunta digitada numa sessão de voz é TEXTO de entrada. |
| chat.conversations | conversations | Conversas com participação humana | Conversas com ao menos uma mensagem humana no intervalo; criadas no intervalo é número separado. | `count(distinct conversa com mensagem humana)` | CONVERSATIONS | assistant_conversations × assistant_interactions | — | Conversa | Desde a migration 094. | Histórico legado não tem fronteira de conversa (não conta como conversa). | Reconexão de voz nunca cria conversa. |
| chat.response_rate | conversations | Taxa de resposta | Turnos humanos com resposta da INIA persistida na mesma conversa até 5 min ÷ turnos humanos elegíveis (que já passaram da janela). | `turnos com resposta ÷ turnos elegíveis` | PERCENT | assistant_interactions | Turnos humanos cuja janela de 5 min terminou | Turno | Desde a migration 094. | Turnos ainda dentro da janela (em andamento, não são falha). | Resposta cortada pela pessoa conta como respondida (o trecho ouvido é gravado). |
| workflows.root_runs | workflows | Execuções raiz (disparos) | Matrículas raiz (sem pai) efetivamente criadas no período — responde “qual workflow é mais disparado?”. Filhos de fan-out, tentativas e retries não são disparos. | `count(workflow_enrollments where parent_enrollment_id is null)` | EXECUTIONS | workflow_enrollments (motor) | — | Matrícula raiz | Fonte oficial desde a criação do motor. | QA Lab (simulações não são persistidas pelo motor). | Zero no período não comprova defeito. |
| workflows.failure_rate | workflows | Taxa de falha | Na coorte de raízes iniciadas no período: falhas ÷ estados terminais no corte (pendentes contados à parte). | `failed+dead ÷ (completed+failed+dead)` | PERCENT | workflow_enrollments | Raízes da coorte em estado terminal | Raiz | Fonte oficial. | Raízes ainda ativas ou aguardando. | dead, espera e bloqueio nunca contam como sucesso. |
| workflows.duration | workflows | Duração (raízes concluídas) | Mediana e p95 de (última atualização − criação) das raízes concluídas da coorte. | `percentile_cont sobre raízes completed` | SECONDS | workflow_enrollments | — | Raiz | Fonte oficial. | Abertas (aparecem como idade). | Inclui o tempo aguardando revisão humana. |
| quality.ingestion | quality | Eventos recebidos/aceitos/duplicados/recusados | Contadores dos lotes recebidos do navegador. | `Σ por lote` | EVENTS | Lotes de ingestão | — | eventId | Desde o início da coleta. | — | Evento perdido antes de chegar ao servidor tem contagem exata desconhecida. |

## Eventos

Todo evento tem esquema FECHADO (propriedade desconhecida = evento recusado). Organização, ator, estrutura e classificação vêm do servidor; nenhum evento carrega conteúdo digitado, senha, áudio ou transcrição.

| Evento | Família | Emissor | Autoridade | Propósito | Momento | Correlação | Deduplicação | Sensibilidade | Atividade qualificada | Entidades |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `screen.viewed` | Telas visualizadas | Navegador | Navegador (catálogo fechado) | Visualização canônica de tela/aba/painel/diálogo — base do ranking de telas. | Quando a tela está apresentada em primeiro plano (aba do navegador visível); prefetch e render no servidor não emitem. | screenInstanceId (uma por apresentação); usageSessionId; tabId | eventId único; remontagem técnica (Strict Mode/hidratação) na mesma tela em < 1,5 s não gera outra instância | LOW | sim | PUBLISHED_FEEDBACK, INTERACTION_FEEDBACK_DELIVERY, PERSON, CASE, WORKFLOW, KNOWLEDGE_MATERIAL, CONVERSATION |
| `screen.left` | Telas visualizadas | Navegador | Navegador | Saída/transição observada (fechamento explícito). Saída sem este evento é INFERIDA e rotulada. | Ao trocar de tela, fechar o painel/diálogo, esconder a aba ou descarregar a página (best effort). | screenInstanceId da visualização encerrada | eventId; no máximo uma saída por instância | LOW | não | — |
| `activity.heartbeat` | Sessão e tempo ativo | Navegador | Navegador | Confirma um intervalo de atenção observada (tempo ativo). Não renova sozinho a última interação. | A cada ≤ 15 s enquanto a aba está visível e houve interação nos últimos 60 s (ou voz em andamento); ao esconder a aba fecha o intervalo parcial. | screenInstanceId; usageSessionId | eventId; intervalos sobrepostos são unidos por pessoa (nunca somados) | LOW | não | — |
| `element.activated` | Elementos (exposição e acionamento) | Navegador | Navegador (catálogo fechado) | Clique, toque ou ativação por teclado de um elemento identificado. NÃO comprova o resultado da ação. | No acionamento (captura), antes do efeito. | screenInstanceId; correlationId quando a ação tem contrato | eventId | LOW | sim | PUBLISHED_FEEDBACK, INTERACTION_FEEDBACK_DELIVERY, ALERT, KNOWLEDGE_MATERIAL, WORKFLOW, PERSON, CONVERSATION |
| `element.exposed` | Elementos (exposição e acionamento) | Navegador | Navegador | Exposição real de elemento central: ≥ 50 % visível por 1 s em primeiro plano, uma vez por visualização. | Ao completar 1 s contínuo de visibilidade ≥ 50 %. | screenInstanceId + elementKey (+ entidade) | uma exposição por (instância de tela, elemento, entidade) | LOW | não | PUBLISHED_FEEDBACK, INTERACTION_FEEDBACK_DELIVERY, ALERT, KNOWLEDGE_MATERIAL |
| `content.scrolled` | Rolagem | Navegador | Navegador | Profundidade de rolagem observada (25/50/75/100 %). Nunca é leitura. | Ao atingir cada marco pela primeira vez na visualização; conteúdo que cabe na tela emite um único marco 100 com fitsViewport=true. | screenInstanceId + contentKey | um marco por (instância, conteúdo, profundidade) | LOW | sim | PUBLISHED_FEEDBACK, INTERACTION_FEEDBACK_DELIVERY, KNOWLEDGE_MATERIAL |
| `action.started` | Ações de interface | Navegador | Navegador (intenção) | Início de uma operação de interface com contrato. | Quando a requisição é disparada. | correlationId (mesmo nos estágios seguintes) | eventId; estágios correlacionados por correlationId | LOW | sim | — |
| `action.succeeded` | Ações de interface | Navegador | Navegador (confirmação recebida) | A interface recebeu a confirmação do servidor. O FATO de negócio continua sendo o da tabela oficial. | Quando a resposta 2xx chega. | correlationId | um sucesso por correlationId | LOW | não | — |
| `action.failed` | Ações de interface | Navegador | Navegador | Falha observada na interface (erro devolvido ou rede). | Quando o erro chega. | correlationId | um desfecho por correlationId | LOW | não | — |
| `action.cancelled` | Ações de interface | Navegador | Navegador | Cancelamento explícito pela pessoa (fechar, desistir). Diferente de ausência de desfecho e de falha. | No cancelamento. | correlationId | um desfecho por correlationId | LOW | sim | — |
| `search.performed` | Busca e filtros | Navegador | Navegador | Busca iniciada; guarda só FAIXA de tamanho da consulta e de resultados — nunca a consulta. | Quando a lista é recarregada com a busca (após o debounce). | screenInstanceId | eventId | LOW | sim | — |
| `search.result_opened` | Busca e filtros | Navegador | Navegador | Abertura de um resultado depois de uma busca. | No acionamento do resultado. | screenInstanceId | eventId | LOW | sim | — |
| `filter.applied` | Busca e filtros | Navegador | Navegador | Filtro utilizado (nome do filtro, nunca o valor). | Quando o filtro muda. | screenInstanceId | eventId | LOW | sim | — |
| `latency.measured` | Conversa (interface) | Navegador | Navegador | Latência percebida até o primeiro texto ou o primeiro áudio da INIA, com desfecho. | No primeiro fragmento recebido, na interrupção ou no tempo-limite. | correlationId do turno | uma medida por (correlationId, métrica) | LOW | não | — |
| `voice.mic_permission` | Voz (transporte e reprodução) | Navegador | Navegador (API de mídia) | Resultado do pedido de microfone. | Quando o navegador responde ao pedido. | voiceIntentId | eventId | LOW | sim | — |
| `voice.connection` | Voz (transporte e reprodução) | Navegador | Transporte de voz (navegador) | Ciclo técnico da conexão de voz; reconexão mantém a mesma intenção (voiceIntentId) e nunca cria conversa. | Em cada mudança de estado do transporte. | voiceIntentId (intenção de uso) + connectionSeq | eventId | LOW | não | — |
| `voice.mic_span` | Voz (transporte e reprodução) | Navegador | Transporte de voz | Intervalo com microfone ativo. Microfone aberto NÃO é fala. | Ao desligar o microfone (ou no heartbeat de 15 s enquanto ligado). | voiceIntentId | intervalos unidos por pessoa | LOW | não | — |
| `voice.playback` | Voz (transporte e reprodução) | Navegador | Reprodução no navegador | Reprodução da fala da INIA (conversa, apresentação de feedback ou recado), com interrupção. | No início real do áudio e no fim/interrupção (com o intervalo efetivamente tocado). | voiceIntentId ou correlationId | eventId | LOW | não | PUBLISHED_FEEDBACK, INTERACTION_FEEDBACK_DELIVERY, WORKFLOW_OUTPUT |
| `voice.mode_changed` | Voz (transporte e reprodução) | Navegador | Navegador | Mudança de modo (silenciar, microfone, câmera). | Na mudança. | voiceIntentId quando houver | eventId | LOW | sim | — |
| `auth.login_succeeded` | Autenticação | Servidor | Servidor (login aceito) | Login bem-sucedido. last_login_at continua só o último. | Depois de a sessão ser emitida. | conta | eventId do servidor | MEDIUM | não | — |
| `auth.logout` | Autenticação | Servidor | Servidor | Logout explícito — encerra a sessão de uso. | Na chamada de logout com sessão válida. | conta | eventId do servidor | LOW | não | — |
| `voice.session_issued` | Voz (transporte e reprodução) | Servidor | Servidor (token de voz emitido) | Pedido de conexão de voz aceito pelo servidor. | Depois de emitir a sessão efêmera. | conta | eventId do servidor | LOW | não | — |
| `feedback_application.lifecycle` | Aplicação de feedback com a INIA | Servidor | Servidor (aplicação) | Início, retomada, abertura e pausa da aplicação — a tabela oficial guarda só o último estado. | Depois de a operação responder 2xx. | fonte do feedback (entidade) + applicationId | eventId do servidor | LOW | não | PUBLISHED_FEEDBACK, INTERACTION_FEEDBACK_DELIVERY |
| `feedback_application.presentation` | Aplicação de feedback com a INIA | Servidor | Servidor (fatos do áudio informados pela sessão) | Apresentação por áudio iniciada, concluída, interrompida ou com falha — histórico (a tabela guarda o último). | Depois de a operação responder 2xx. | applicationId | eventId do servidor | LOW | não | PUBLISHED_FEEDBACK, INTERACTION_FEEDBACK_DELIVERY |
| `feedback_application.invite` | Aplicação de feedback com a INIA | Servidor | Servidor (convite) | Convite oferecido, aceito, lido ou adiado. | Depois de a operação responder 2xx. | fonte do feedback (entidade) | eventId do servidor | LOW | não | PUBLISHED_FEEDBACK, INTERACTION_FEEDBACK_DELIVERY |
| `notification.read` | Notificações | Servidor | Servidor (alerts.read_at) | Notificação marcada como lida (uma ou todas). | Depois de a operação responder 2xx. | alerta (ou todos) | eventId do servidor | LOW | não | ALERT |
| `usability.export` | Exportações da monitoria | Servidor | Servidor (monitoria) | Exportação CSV da monitoria concluída ou recusada. | Depois de gerar (ou falhar) o arquivo. | aba + recorte | eventId do servidor | LOW | não | — |

## Ações com resultado (contrato iniciada → concluída | falhou | cancelada)

| Ação | Rótulo |
| --- | --- |
| `chat.send_message` | Enviar mensagem à INIA |
| `feedback.rate` | Avaliar feedback |
| `feedback.confirm_reading` | Confirmar ciência |
| `feedback.start_application` | Iniciar/retomar aplicação com a INIA |
| `workflow.manual_run` | Executar workflow manualmente |
| `material.download` | Baixar material de apoio |
| `profile.save` | Salvar perfil |
| `usability.export` | Exportar CSV da monitoria |

## Telas

`INSTRUMENTED` = visualização + elementos centrais medidos; `PARTIAL` = só visualização/abas/links; `NOT_INSTRUMENTED` = existe, mas não emite eventos.

| Chave | Rótulo | Tipo | Área | Funcionalidade | Rota | Instrumentação |
| --- | --- | --- | --- | --- | --- | --- |
| `home` | Início | ROUTE | Uso do colaborador | Início | `/` | PARTIAL |
| `my_profile.operator` | Meu perfil (operador) | ROUTE | Uso do colaborador | Perfil | `/operator` | INSTRUMENTED |
| `my_profile.manager` | Meu perfil (gestão) | ROUTE | Gestão (perfil e ficha) | Perfil | `/supervisor` | INSTRUMENTED |
| `my_profile.operator.followup` | Meu perfil › Acompanhamento | TAB | Uso do colaborador | Acompanhamento | — | INSTRUMENTED |
| `my_profile.operator.indicators` | Meu perfil › Indicadores | TAB | Uso do colaborador | Indicadores | — | PARTIAL |
| `my_profile.operator.people` | Meu perfil › Equipe | TAB | Uso do colaborador | Equipe | — | PARTIAL |
| `my_profile.operator.pending` | Meu perfil › Pendências | TAB | Uso do colaborador | Pendências | — | PARTIAL |
| `my_profile.operator.structure` | Meu perfil › Organograma | TAB | Uso do colaborador | Organograma | — | PARTIAL |
| `my_profile.operator.calendar` | Meu perfil › Calendário da equipe | TAB | Uso do colaborador | Calendário da equipe | — | PARTIAL |
| `my_profile.manager.followup` | Meu perfil (gestão) › Acompanhamento | TAB | Gestão (perfil e ficha) | Acompanhamento | — | INSTRUMENTED |
| `my_profile.manager.indicators` | Meu perfil (gestão) › Indicadores | TAB | Gestão (perfil e ficha) | Indicadores | — | PARTIAL |
| `my_profile.manager.people` | Meu perfil (gestão) › Equipe | TAB | Gestão (perfil e ficha) | Equipe | — | PARTIAL |
| `my_profile.manager.pending` | Meu perfil (gestão) › Pendências | TAB | Gestão (perfil e ficha) | Pendências | — | PARTIAL |
| `my_profile.manager.structure` | Meu perfil (gestão) › Organograma | TAB | Gestão (perfil e ficha) | Organograma | — | PARTIAL |
| `my_profile.manager.calendar` | Meu perfil (gestão) › Calendário da equipe | TAB | Gestão (perfil e ficha) | Calendário da equipe | — | PARTIAL |
| `employee_profile` | Ficha do colaborador | ROUTE | Gestão (perfil e ficha) | Ficha do colaborador | `/supervisor/operators/:operatorId` | PARTIAL |
| `employee_profile.followup` | Ficha › Acompanhamento | TAB | Gestão (perfil e ficha) | Acompanhamento | — | PARTIAL |
| `employee_profile.indicators` | Ficha › Indicadores | TAB | Gestão (perfil e ficha) | Indicadores | — | PARTIAL |
| `employee_profile.people` | Ficha › Equipe | TAB | Gestão (perfil e ficha) | Equipe | — | PARTIAL |
| `employee_profile.pending` | Ficha › Pendências | TAB | Gestão (perfil e ficha) | Pendências | — | PARTIAL |
| `employee_profile.structure` | Ficha › Organograma | TAB | Gestão (perfil e ficha) | Organograma | — | PARTIAL |
| `employee_profile.calendar` | Ficha › Calendário da equipe | TAB | Gestão (perfil e ficha) | Calendário da equipe | — | PARTIAL |
| `case_detail` | Caso de supervisão | ROUTE | Gestão (perfil e ficha) | Casos de supervisão | `/supervisor/cases/:caseId` | PARTIAL |
| `profile_edit` | Editar perfil | ROUTE | Uso do colaborador | Edição do perfil | `/perfil/editar` | PARTIAL |
| `support_material` | Material de apoio | ROUTE | Uso do colaborador | Materiais de apoio | `/materiais/:materialId` | INSTRUMENTED |
| `diagnostics` | Diagnóstico | ROUTE | Ferramentas (Diagnóstico, QA) | Diagnóstico | `/diagnostics` | PARTIAL |
| `diagnostics.processes` | Diagnóstico › Processos | TAB | Ferramentas (Diagnóstico, QA) | Diagnóstico | — | PARTIAL |
| `diagnostics.people` | Diagnóstico › Pessoas e equipes | TAB | Ferramentas (Diagnóstico, QA) | Diagnóstico | — | PARTIAL |
| `diagnostics.concentration` | Diagnóstico › Concentração | TAB | Ferramentas (Diagnóstico, QA) | Diagnóstico | — | PARTIAL |
| `diagnostics.materials` | Diagnóstico › Materiais | TAB | Ferramentas (Diagnóstico, QA) | Diagnóstico | — | PARTIAL |
| `diagnostics.indicators` | Diagnóstico › Indicadores | TAB | Ferramentas (Diagnóstico, QA) | Diagnóstico | — | PARTIAL |
| `qa_feedbacks` | QA de feedbacks | ROUTE | Ferramentas (Diagnóstico, QA) | QA Lab | `/qa-lab/feedbacks` | PARTIAL |
| `followup.chat_panel` | Conversa com a INIA (painel) | PANEL | Uso do colaborador | Conversa com a INIA | — | INSTRUMENTED |
| `followup.conversation_history` | Conversas anteriores | PANEL | Uso do colaborador | Histórico de conversas | — | INSTRUMENTED |
| `feedback.detail` | Feedback aberto | MODAL | Uso do colaborador | Leitura de feedback | — | INSTRUMENTED |
| `feedback.session` | Sessão de feedback com a INIA | MODAL | Uso do colaborador | Aplicação de feedback com a INIA | — | INSTRUMENTED |
| `feedback.confirm_reading` | Confirmação de ciência | MODAL | Uso do colaborador | Confirmação de ciência | — | INSTRUMENTED |
| `feedback.rating_reason` | Motivo de “não foi útil” | PANEL | Uso do colaborador | Avaliação de feedback | — | INSTRUMENTED |
| `notifications.panel` | Notificações (sino) | PANEL | Uso do colaborador | Notificações | — | INSTRUMENTED |
| `workflow.manual_run` | Executar workflow agora | MODAL | Administração | Execução manual de workflow | — | INSTRUMENTED |
| `admin.knowledge` | Base de conhecimento | ROUTE | Administração | Bases de conhecimento | `/admin/knowledge` | PARTIAL |
| `admin.knowledge.new` | Nova base de conhecimento | ROUTE | Administração | Bases de conhecimento | `/admin/knowledge/new` | PARTIAL |
| `admin.knowledge.detail` | Base de conhecimento (detalhe) | ROUTE | Administração | Bases de conhecimento | `/admin/knowledge/:documentId` | PARTIAL |
| `admin.knowledge.edit` | Editar base de conhecimento | ROUTE | Administração | Bases de conhecimento | `/admin/knowledge/:documentId/edit` | PARTIAL |
| `admin.checkpoints` | Checkpoints | ROUTE | Administração | Bases de conhecimento | `/admin/checkpoints` | PARTIAL |
| `admin.business_domains` | Domínios de negócio | ROUTE | Administração | Configurações operacionais | `/admin/business-domains` | PARTIAL |
| `admin.agents` | Agentes | ROUTE | Administração | Agentes | `/admin/agents` | PARTIAL |
| `admin.agents.new` | Novo agente | ROUTE | Administração | Agentes | `/admin/agents/new` | PARTIAL |
| `admin.agents.detail` | Agente (edição) | ROUTE | Administração | Agentes | `/admin/agents/:agentId` | PARTIAL |
| `admin.orchestrators` | Orquestradores | ROUTE | Administração | Orquestradores | `/admin/assistant` | PARTIAL |
| `admin.orchestrators.detail` | Orquestrador (edição) | ROUTE | Administração | Orquestradores | `/admin/assistant/:orchestratorId` | PARTIAL |
| `admin.ai` | IA / Modelos | ROUTE | Administração | IA / Modelos | `/admin/ai` | PARTIAL |
| `admin.indicators` | Indicadores (configuração) | ROUTE | Administração | Indicadores (configuração) | `/admin/indicators` | PARTIAL |
| `admin.argument_scripts` | Argumentários | ROUTE | Administração | Configurações operacionais | `/admin/argument-scripts` | PARTIAL |
| `admin.call_rules` | Regras de chamada | ROUTE | Administração | Configurações operacionais | `/admin/call-rules` | PARTIAL |
| `admin.channel_flags` | Flags de canal | ROUTE | Administração | Configurações operacionais | `/admin/channel-flags` | PARTIAL |
| `admin.workflows` | Workflows | ROUTE | Administração | Workflows (administração) | `/admin/workflows` | PARTIAL |
| `admin.workflows.detail` | Workflow | ROUTE | Administração | Workflows (administração) | `/admin/workflows/:workflowId` | PARTIAL |
| `admin.workflows.detail.editor` | Workflow › Editor | TAB | Administração | Workflows (administração) | — | PARTIAL |
| `admin.workflows.detail.enrollments` | Workflow › Execuções | TAB | Administração | Workflows (administração) | — | PARTIAL |
| `admin.workflows.detail.results` | Workflow › Resultados | TAB | Administração | Workflows (administração) | — | PARTIAL |
| `admin.qa_lab` | QA Lab | ROUTE | Administração | QA Lab | `/admin/simulate` | PARTIAL |
| `admin.qa_lab.workflow` | QA Lab › Workflow | TAB | Administração | QA Lab | — | PARTIAL |
| `admin.qa_lab.agent` | QA Lab › Agente | TAB | Administração | QA Lab | — | PARTIAL |
| `admin.qa_lab.orchestrator` | QA Lab › Orquestrador | TAB | Administração | QA Lab | — | PARTIAL |
| `admin.qa_lab.feedbacks` | QA Lab › Feedbacks | TAB | Administração | QA Lab | — | PARTIAL |
| `admin.qa_lab.history` | QA Lab › Histórico | TAB | Administração | QA Lab | — | PARTIAL |
| `admin.conversations` | Conversas com a INIA | ROUTE | Administração | Conversas com a INIA (leitura) | `/admin/conversations` | PARTIAL |
| `admin.inia_scenes` | Cenário da INIA | ROUTE | Administração | Configurações operacionais | `/admin/inia-scenes` | PARTIAL |
| `admin.users` | Usuários e acessos | ROUTE | Administração | Usuários e acessos | `/admin/users` | PARTIAL |
| `admin.governance` | Governança | ROUTE | Administração | Configurações operacionais | `/admin/governance` | PARTIAL |
| `admin.operational_calendar` | Calendário operacional | ROUTE | Administração | Configurações operacionais | `/admin/operational-calendar` | PARTIAL |
| `admin.data_hub` | Central de Dados | ROUTE | Administração | Central de Dados | `/admin/data-hub` | PARTIAL |
| `admin.data_hub.import` | Central de Dados › Importar | ROUTE | Administração | Central de Dados | `/admin/data-hub/import` | PARTIAL |
| `admin.data_hub.source_new` | Central de Dados › Nova fonte | ROUTE | Administração | Central de Dados | `/admin/data-hub/sources/new` | PARTIAL |
| `admin.data_hub.source` | Central de Dados › Fonte | ROUTE | Administração | Central de Dados | `/admin/data-hub/sources/:sourceId` | PARTIAL |
| `admin.data_hub.feed` | Central de Dados › Feed | ROUTE | Administração | Central de Dados | `/admin/data-hub/feeds/:feedId` | PARTIAL |
| `admin.data_hub.run` | Central de Dados › Carga | ROUTE | Administração | Central de Dados | `/admin/data-hub/runs/:runId` | PARTIAL |
| `admin.usability` | Monitoria de usabilidade | ROUTE | Painel de monitoria | Monitoria de usabilidade | `/admin/usability` | INSTRUMENTED |
| `admin.usability.person` | Monitoria de usabilidade › Pessoa | ROUTE | Painel de monitoria | Monitoria de usabilidade | `/admin/usability/people/:personId` | INSTRUMENTED |
| `wiki` | Wiki | ROUTE | Wiki | Wiki | `/wiki/*` | PARTIAL |

## Elementos

| Chave | Rótulo | Funcionalidade | Tipo | Central | Repetição esperada | Prazo do resultado (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| `nav.link` | Link interno | Navegação | LINK |  |  |  |
| `nav.tab` | Aba | Navegação | TAB |  |  |  |
| `nav.user_menu` | Menu da pessoa (cabeçalho) | Navegação | MENU_ITEM |  |  |  |
| `nav.area_switcher` | Seletor de área | Navegação | MENU_ITEM |  |  |  |
| `feedback.card` | Card de feedback | Leitura de feedback | CARD | sim |  |  |
| `feedback.open_detail` | Abrir feedback | Leitura de feedback | BUTTON | sim |  |  |
| `feedback.listen` | Ouvir com a INIA | Aplicação de feedback com a INIA | BUTTON | sim |  | 15000 |
| `feedback.confirm_reading.open` | Confirmar ciência | Confirmação de ciência | BUTTON | sim |  |  |
| `feedback.confirm_reading.submit` | Confirmar (login e senha) | Confirmação de ciência | BUTTON |  |  | 15000 |
| `feedback.confirm_reading.cancel` | Cancelar confirmação | Confirmação de ciência | BUTTON |  |  |  |
| `feedback.confirm_reading.agree` | Concordo com o feedback | Confirmação de ciência | BUTTON |  |  |  |
| `feedback.confirm_reading.disagree` | Não concordo com o feedback | Confirmação de ciência | BUTTON |  |  |  |
| `feedback.confirm_reading.continue` | Continuar para login e senha | Confirmação de ciência | BUTTON |  |  |  |
| `feedback.confirm_reading.change` | Alterar a escolha antes de confirmar | Confirmação de ciência | BUTTON |  |  |  |
| `feedback.evaluation.details` | Ver detalhes da avaliação | Confirmação de ciência | BUTTON |  |  |  |
| `feedback.evaluation.register` | Dizer se concorda (ciência anterior) | Confirmação de ciência | BUTTON | sim |  |  |
| `feedback.rating.up` | Foi útil (legado) | Avaliação de feedback | BUTTON | sim |  | 10000 |
| `feedback.rating.down` | Não foi útil (legado) | Avaliação de feedback | BUTTON | sim |  |  |
| `feedback.rating.submit_reason` | Enviar motivo (legado) | Avaliação de feedback | BUTTON |  |  | 10000 |
| `feedback.material.open` | Abrir material de apoio | Materiais de apoio | LINK | sim |  |  |
| `feedback.invite.listen` | Convite: ouvir agora | Aplicação de feedback com a INIA | BUTTON | sim |  |  |
| `feedback.invite.read` | Convite: ler | Aplicação de feedback com a INIA | BUTTON |  |  |  |
| `feedback.invite.later` | Convite: depois | Aplicação de feedback com a INIA | BUTTON |  |  |  |
| `feedback.session.exit` | Sair da sessão de feedback | Aplicação de feedback com a INIA | BUTTON |  |  |  |
| `feedback.session.replay` | Ouvir/repetir apresentação | Aplicação de feedback com a INIA | BUTTON |  |  |  |
| `material.download` | Baixar material | Materiais de apoio | BUTTON |  |  |  |
| `chat.send` | Enviar mensagem | Conversa com a INIA | BUTTON | sim |  | 30000 |
| `chat.mic` | Microfone | Voz com a INIA | TOGGLE | sim |  |  |
| `chat.mute` | Silenciar a INIA | Voz com a INIA | TOGGLE |  |  |  |
| `chat.camera` | Câmera (avatar) | Voz com a INIA | TOGGLE |  |  |  |
| `chat.end_call` | Encerrar chamada | Voz com a INIA | BUTTON |  |  |  |
| `chat.start_call` | Chamar a INIA | Voz com a INIA | BUTTON | sim |  |  |
| `chat.interrupt` | Interromper a INIA | Voz com a INIA | BUTTON |  |  |  |
| `chat.new_conversation` | Nova conversa | Conversa com a INIA | BUTTON |  |  |  |
| `chat.history.open` | Conversas anteriores | Histórico de conversas | BUTTON |  |  |  |
| `chat.collapse` | Recolher painel da INIA | Conversa com a INIA | BUTTON |  |  |  |
| `notifications.bell` | Sino de notificações | Notificações | BUTTON | sim |  |  |
| `notifications.item` | Notificação | Notificações | CARD | sim |  |  |
| `notifications.mark_all_read` | Marcar todas como lidas | Notificações | BUTTON |  |  |  |
| `workflow.manual_run.open` | Executar agora | Execução manual de workflow | BUTTON | sim |  |  |
| `workflow.manual_run.submit` | Confirmar execução manual | Execução manual de workflow | BUTTON |  |  | 15000 |
| `list.search` | Busca da lista | Busca | INPUT |  |  |  |
| `list.filter` | Filtro da lista | Busca | INPUT |  |  |  |
| `list.pagination` | Paginação | Busca | BUTTON |  | sim |  |
| `usability.export` | Exportar CSV (monitoria) | Exportação | BUTTON |  |  | 60000 |
| `usability.drilldown` | Abrir detalhe de um número | Monitoria de usabilidade | BUTTON |  |  |  |

## Conteúdos com rolagem medida e superfícies de busca

| Conteúdo | Rótulo |
| --- | --- |
| `feedback.content` | Conteúdo do feedback |
| `feedback.session.content` | Feedback na sessão com a INIA |
| `material.content` | Material de apoio |
| `followup.feed` | Feed do Acompanhamento |

| Superfície de busca | Rótulo |
| --- | --- |
| `admin.list` | Listas da Administração |
| `followup.feed` | Acompanhamento |
| `team` | Equipe |
| `structure` | Organograma |
| `usability` | Monitoria de usabilidade |

## Funis

### Entrada → Acompanhamento → feedback aberto → avaliação

Correlação: Sessão de uso; nas duas últimas etapas, o MESMO feedback aberto naquela sessão. Janela: Etapas 1–3 dentro da sessão; avaliação do mesmo feedback em até N dias.

| # | Etapa | Fonte |
| --- | --- | --- |
| 1 | Entrada (sessão iniciada) | Sessões derivadas |
| 2 | Acompanhamento visto | screen.viewed (Acompanhamento) |
| 3 | Feedback aberto | screen.viewed (feedback aberto pelo destinatário) |
| 4 | Mesmo feedback avaliado | feedback_ratings (oficial; congelada desde 10/11/2026 — a avaliação passou para a concordância na ciência) |

### Feedback disponível → exposição → abertura → ciência

Correlação: Fonte × destinatário. Janela: N dias após a entrega.

| # | Etapa | Fonte |
| --- | --- | --- |
| 1 | Disponibilizado | Publicação/entrega oficial |
| 2 | Exposto | element.exposed (card) ou abertura |
| 3 | Aberto | screen.viewed (feedback) |
| 4 | Ciência confirmada | acknowledged_at (oficial) |

### Convite da INIA → aceite → aplicação → interação → ciência

Correlação: Fonte do feedback convidada. Janela: N dias após a oferta do convite.

| # | Etapa | Fonte |
| --- | --- | --- |
| 1 | Convite oferecido | feedback_application.invite OFFER |
| 2 | Convite aceito | feedback_application.invite ACCEPT |
| 3 | Aplicação iniciada | feedback_applications.started_at |
| 4 | Pergunta feita na aplicação | Mensagem humana na conversa da aplicação |
| 5 | Ciência confirmada | acknowledged_at (oficial) |

### Chat aberto → entrada humana → resposta recebida

Correlação: Abertura do painel da INIA (instância) e o turno enviado a partir dela. Janela: Entrada em até 30 min da abertura; resposta em até 5 min da entrada.

| # | Etapa | Fonte |
| --- | --- | --- |
| 1 | Painel da INIA aberto | screen.viewed (painel) |
| 2 | Mensagem enviada | Mensagem humana persistida |
| 3 | Resposta da INIA | Mensagem da INIA persistida |

### Voz solicitada → permissão → conexão → primeira fala → resposta em áudio

Correlação: Intenção de voz (voiceIntentId — reconexão mantém a mesma). Janela: Dentro da conexão.

| # | Etapa | Fonte |
| --- | --- | --- |
| 1 | Voz solicitada | voice.connection REQUESTED |
| 2 | Microfone permitido | voice.mic_permission GRANTED |
| 3 | Conexão estabelecida | voice.connection ESTABLISHED |
| 4 | Primeira fala humana | Turno de voz persistido |
| 5 | Resposta em áudio | voice.playback STARTED (conversa) |

### Execução manual solicitada → raiz criada → término → resultado entregue → resultado aberto

Correlação: Execução manual (workflow_manual_runs). Janela: N dias após a solicitação.

| # | Etapa | Fonte |
| --- | --- | --- |
| 1 | Execução solicitada | workflow_manual_runs |
| 2 | Raiz criada | workflow_enrollments.manual_run_id |
| 3 | Execução terminou | Estado completed/failed/dead |
| 4 | Resultado entregue | Emissão de feedback / saída entregue |
| 5 | Resultado aberto | Feedback aberto / recado ouvido / conversa vista |

### Notificação exposta → aberta → destino apresentado → lida

Correlação: Notificação (alerta). Janela: Destino em até 10 s do clique.

| # | Etapa | Fonte |
| --- | --- | --- |
| 1 | Notificação exposta | element.exposed (sino) |
| 2 | Notificação aberta | element.activated (sino) |
| 3 | Destino apresentado | screen.viewed na mesma aba em até 10 s |
| 4 | Marcada como lida | alerts.read_at (oficial) |

## Sinais de dificuldade (heurísticas)

| Sinal | Rótulo |
| --- | --- |
| `RAGE_CLICK` | Possíveis cliques repetitivos |
| `NO_RESULT` | Possível ação sem retorno |
| `ACTION_ERRORS` | Erros funcionais por ação |
| `VALIDATION_ERRORS` | Validações recusadas |
| `REPEATED_ATTEMPTS` | Tentativas repetidas até conseguir |
| `EMPTY_SEARCH` | Buscas sem resultado |
| `UNFINISHED_OPERATIONS` | Operações iniciadas sem desfecho |
| `VOICE_FAILURES` | Concentração de falhas de voz |
| `LOW_UTILITY` | Baixa utilidade nas avaliações |
| `USAGE_DROP` | Queda de uso |
| `REVIEW_WAIT` | Espera da revisão humana |

Parâmetros: rageClick = {"activations":3,"windowMs":2000} · actionOutcomeWindowMinutes = 5 · retryWindowMinutes = 10 · lowUtility = {"minRatings":5,"downShare":50} · usageDrop = {"minBase":5,"dropPercent":30} · voiceFailure = {"minIntents":5,"failurePercent":20} · notificationDestinationSeconds = 10.
