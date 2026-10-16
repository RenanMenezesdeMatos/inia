/**
 * FEEDBACK ENGINE — versões do domínio. Uma análise só é reutilizada quando a LÓGICA, o contrato do modelo e a extração dos
 * critérios são os mesmos (entram na chave de compatibilidade). Mudou qualquer uma = nova análise (a anterior fica no histórico).
 */
export const FEEDBACK_ENGINE_VERSION = "FEEDBACK_ENGINE_V1" as const
/** Lógica de verificação/decisão da análise de chamada (regras de evidência, cobertura, desfecho). V2 = checklist transversal de
 * encerramento também é cobrado (documento sem seções herda o papel pelo título). V3 = a fala que comprova um item de uma lista
 * não sustenta, sozinha, que outro item da MESMA lista foi descumprido. V4 = INTEGRIDADE ≠ INTERPRETAÇÃO: toda conclusão que
 * conta (acerto, desvio, parcial, caminho) é PROPOSTA até a revisão independente confirmar (condição, alternativas × cumulativas,
 * oportunidade, ação observável × declarada × interna, a transcrição inteira); a regra V3 virou foco da revisão — não esconde
 * mais a falha legítima de uma lista cumulativa. As leituras V1–V3 ficam no histórico e não entram nas agregações. */
/** V5 = a revisão confere também os DESCARTES das seções em jogo (`CALL_REVIEW_V2`): contestação com fala verificada reabre como
 * incerto ou, com integridade + convergência com a análise, reverte; natureza da etapa (ação INTERNA × COMUNICAR × perguntar ×
 * proibição) — ação interna não verbalizada nunca vira "não cumprida"; papel no caso (central × apoio × rotina) como leitura que só
 * ordena; notas técnicas da revisão saem das limitações (auditoria). */
/** V6 (`LIST_OPENING_V1`, rodada real C07 de 01/10 à tarde): a análise deu conclusões à FRASE QUE ABRE listas ("…avaliar:" como
 * parcial; "Antes de encerrar, informar:" como cumprida) e a revisão as confirmou sem ver os itens — o erro de alternativas voltou
 * por essa porta e um item da recapitulação ficou fora de qualquer leitura. Agora a abertura vai à revisão com os itens e só é
 * confirmada com a lista lida como lista; itens englobados são conferidos como alvos próprios; o não respondido fica registrado. */
/** V7 (`SEMANTIC_AUDITABILITY_V1`) = aplicabilidade × evidência necessária × disponibilidade × conclusão como perguntas separadas,
 * respondidas pela leitura SEMÂNTICA (modelo) e levadas às consequências por código — nunca por verbo, palavra-chave ou nome de
 * sistema: aplicabilidade incerta nunca vira "não cumpriu"; cumprimento fora da conversa (sistema/registro) nunca vira cumprido nem
 * descumprido pela transcrição (declaração e intenção ficam registradas como tal); regra composta avaliada por PARTE (cada uma com a
 * evidência da sua natureza); argumentários (G-n) como fonte estruturada com a situação que os aciona conferida por fala; a condição
 * de uma regra deixa de ser detectada por palavras e o título de seção vira só pista (toda linha tem handle); a oportunidade do
 * encerramento deixa de ser preenchida pelo código. */
/** V8 (`EVIDENCE_POLICY_UNIFIED_V1`) = a política de evidência vale para TODA conclusão, inclusive as que a revisão altera ou cria
 * (contestação de descarte, linha avaliada pela revisão, ajuste de lista): execução fora da conversa nunca fica cumprida,
 * descumprida, parcial nem confirmada — declaração e intenção continuam como tal. `DUPLICATE_BY_MEANING_V1`: texto igual entre
 * fontes não elimina nenhuma exigência antes da análise; a equivalência é leitura semântica rastreável (condição, finalidade,
 * escopo, modalidade). */
/** V9 = decisão da revisão sobre o pedido como foi ENVIADO (linhas que a própria revisão avaliou não criam foco novo depois da
 * resposta) — defeito achado na rodada real de 02/10; corrigido, ainda não revalidado com modelo. */
/** V10 (`OBLIGATION_READING_V1`, rodada real V8): leituras do modelo que se contradizem (ação interna × "na conversa") ficam com a
 * mais restrita; fala oferecida como prova de execução fora da conversa é DECLARAÇÃO; declaração nunca é conduta observada; a fala
 * que só mostra a condição da regra não é conduta; a revisão diz o que a evidência mostra e se a conclusão depende de algo fora da
 * fala (`CALL_REVIEW_V7`); decisão sobre os alvos EXATAMENTE como enviados; caminho "correto" só com todas as etapas do caminho
 * verificáveis e avaliadas (`PATH_COMPLETENESS_V1`). */
/** V11 (02/10/2026, depois da rodada V9): ANÁLISE ORIENTADA AO CASO (`OBLIGATIONS_V1`): a unidade é a OBRIGAÇÃO COMPLETA (ação,
 * condição, partes e como se combinam, onde o cumprimento acontece, linhas de origem); o código aplica as consequências das leituras
 * do próprio modelo (papel de cada trecho: conduta × declaração × intenção × condição × cliente; alternativas com uma parte feita;
 * combinação indefinida) e a integridade de sempre; itens de argumentário aplicável sem avaliação viram lacuna explícita; a revisão
 * por obrigação aponta também obrigações materiais de fora; o que SÓ a revisão encontrou vai à CONFIRMAÇÃO FOCAL
 * (`REVIEW_DISCOVERY_CONFIRMATION_V1`) — nunca descartado por origem, nunca aceito só por ela. O formulário por linha (`LINES_V7`)
 * continua lido para respostas anteriores. */
/** V12 (`PATH_VIGENTE_V1` + `CONDUCT_OCCURRENCE_V1` + `LIST_COVERAGE_V2`): a justificativa e o caminho seguido VIGENTES saem das
 * conclusões FINAIS quando alguma leitura da análise não se sustentou (a original fica em `analysisReading`, auditoria); desvio de
 * caminho exige etapa MATERIAL descumprida; regras que julgam a mesma conduta no mesmo momento viram UMA ocorrência (ligação da
 * revisão conferida pela estrutura); itens das listas em jogo que a análise não avaliou vão à revisão como CONTEXTO (ela aponta em
 * `missed` os que valiam e faltaram) e ficam contados na cobertura — nunca somem, nunca viram falta por estrutura. */
/** V13 (depois da rodada real V11): `OBLIGATION_SPEECH_EXECUTION_V1` — a obrigação mantém o significado da FONTE; a revisão lê onde o
 * ato exigido acontece sem receber os rótulos da análise; relato do resultado de uma consulta comprova a comunicação, nunca a execução;
 * obrigação MISTA confirmada só na parte da conversa (a parte em sistema vira limite). `REVIEW_DIVERGENCE_V1` — leitura da revisão
 * diferente da análise para a MESMA obrigação vai à confirmação focal (confirmada substitui; refutada não; sem decisão = inconclusiva),
 * nunca vence a primeira por ordem. `CENTRAL_NEED_V1` — a necessidade central do cliente tem resposta própria, cruzada com as
 * conclusões finais. Ocorrência de conduta comparada pela PARTE descumprida. */
/** V14 (`SITUATION_SECTIONS_V1`): a análise declara as seções acionadas por SITUAÇÃO e se a situação aconteceu (com a fala); as linhas
 * dessas seções que ninguém avaliou vão à revisão como foco (`situationsInPlay`) e o que ela aponta segue como achado da revisão
 * (confirmação focal). Cobertura registra declaradas × aconteceram × mostradas × apontadas. */
/** V15 (depois da rodada real V14): a seção de uma situação é resolvida pela identidade — handles S-n escritos no texto ("D1:S33",
 * "S21 / S98 (…)") ou o título apresentado sem numeração (`sectionsOfReference`); na V14 nenhuma situação chegava à revisão. */
/** V16 (06/10/2026, `SOURCE_DEFINED_CONTENT_V1`): análise (prompt V11) e revisão (prompt V5) comparam o conteúdo dito (prazo, valor,
 * canal) com o que a fonte define. A investigação reaproveita uma chamada só pela versão desta lógica — sem a mudança de versão ela
 * reusaria as leituras que não conferiam o prazo. */
/** V17 (06/10/2026, `ARGUMENT_SCRIPTS_ALL_IN_FORCE_V1`): a análise passa a receber todos os argumentários vigentes no escopo (antes, só
 * os que cabiam em 30 mil caracteres, em ordem alfabética) — leitura diferente da mesma chamada. */
export const CALL_ANALYSIS_LOGIC_VERSION = "CALL_ANALYSIS_LOGIC_V17" as const
/** Contrato do modelo da análise de chamada (prompt + schema). V3 = itemNature, scenarioRole, descarte conferido contra o cenário
 * e nunca em grupo quando o item está ligado à necessidade do cliente ou a uma condição observada. */
/** V4 = a frase que abre uma lista não é critério sozinho: disposição para cada item, lido com a abertura. */
/** V5 = as quatro perguntas (ação exigida, aplicabilidade, evidência necessária/disponível, conclusão), obligations, argumentScripts e
 * duplicates. */
/** V6 = duplicidade por SENTIDO: texto igual não é a mesma exigência; duplicates declara condição, finalidade, escopo e modalidade. */
/** V7 = obrigação completa (lineRole: ação × condição da ação × conteúdo × opção), declaração ≠ conduta, conclusão que depende de
 * execução fora da fala, caminho "correto" só com todas as etapas verificáveis, itens do argumentário aplicável sempre avaliados. */
/** V8 = contrato `OBLIGATIONS_V1` (`obligation-analysis-prompt.ts`): necessidade do cliente → fontes que valem (principal e as demais)
 * → obrigações materiais completas → o que a conversa demonstra → orientação sustentada. Escolhido pela comparação focal de 02/10
 * (mesmo modelo, mesma entrada da V9) — o prompt é o MESMO que foi medido. O texto V7 continua em `call-analysis-prompt.ts`. */
/** V9 = pergunta 2 inclui as regras acionadas por SITUAÇÕES da conversa (solução depende de análise posterior, transferência, espera,
 * insatisfação) — o resto do contrato e o schema são os da V8 (`obligation-analysis-prompt.ts`). */
export const CALL_ANALYSIS_PROMPT_VERSION = "CALL_ANALYSIS_PROMPT_V9" as const
/** Extração estrutural dos critérios a partir da base publicada (seções, linhas, identidade). V2 = identidade entre versões por
 * comparação ESTRUTURAL (ordem/pré-requisito, condição, modalidade, responsável, canal, prazo, objeto) — as mesmas palavras em
 * outra ordem nunca herdam a identidade. V3 = a frase que abre a lista faz parte da regra e da identidade; limites máximo ×
 * mínimo × exato distintos; sem truncamento de palavras; preposições que mudam o papel mantidas. As identidades V1/V2 ficam no
 * histórico (nunca unidas às V3 por palpite; a revisão da extração registra a correspondência com proveniência). */
export const CRITERIA_EXTRACTION_VERSION = "KNOWLEDGE_CRITERIA_V3" as const
/** Investigação de indicador (localização, evidência, referência, conclusão). V2 = chave de EVIDÊNCIA (chamadas, transcrições,
 * memória, base, pares — não só o valor oficial), reuso pela chave pós-execução, evidência "não localizada" só com a memória que
 * já existe, e regra que mudou na base não orienta. V3 = investigação com FERRAMENTAS escolhidas pela IA para as perguntas que
 * continuam abertas (capacidades do Agent ∩ Workflow ∩ estratégia; modo FIXO da estratégia sem planejamento), análise de chamadas
 * pela MESMA análise da monitoria, resultado das ferramentas no diagnóstico (lacuna individual × grupo comparável, qualidade do
 * dado) e na mensagem; regra vigente por IDENTIDADE do critério. */
/** V4 = RECORTES que os resultados das ferramentas revelam (dia, horário, concentração — não só os assuntos do início) abrem
 * perguntas próprias, com estado (respondida, parcial, sem dados, sem ferramenta, orçamento, não material) avaliado pelo que o
 * resultado esclareceu; capacidades vazias = nenhuma ferramenta (o plano do CONTRATO da estratégia segue à parte); análise com
 * revisão pendente não fecha a investigação; interrompida pelo orçamento não é reutilizada. */
/** V5 (`INVESTIGATION_CLOSURE_V1`) = resultado do mês, comparação do mês com o grupo e qualidade do dado do período são CONTEXTO
 * de uma pergunta de recorte, nunca o encerramento dela; dia fora do padrão da medição diária abre recorte mesmo com o mês bom;
 * o planejador decide aprofundar ou parar — parar com pergunta de recorte aberta exige "resolvida por evidência do mesmo recorte"
 * (conferida pelo código) ou "não aprofundar" com justificativa (registrada como DECLINED, nunca como respondida); recorte não
 * examinado = `CHANGE_LOCATED_NOT_EXAMINED`, separado de "examinado sem causa". */
/** V6 (`ABSENCE_OF_PATTERN_V1`, rodada real V8): ausência de padrão nas chamadas analisadas nunca vira "sem desvios" — é limite
 * de amostra/cobertura, com universo, amostra e qualidade das análises; resultado dentro da meta não fecha a pergunta "há recorte
 * materialmente pior no período?" quando há ferramenta para olhar. */
/** V7 (`TOOL_RESULT_VIEW_V2` + `PLANNER_QUESTIONS_V1` + `ENGINE_BUDGET_V2`): resultados ao planejador sem corte bruto (listas por item,
 * o que faltou declarado, `inspect_result` para o restante), estado explícito de cada consulta, perguntas abertas pelo planejador a partir
 * de descobertas, fatos de comparabilidade do recorte por dia (desvio relativo, chamadas gravadas × volume medido), reserva da redação no
 * orçamento e notas ao colaborador sem o funcionamento técnico. */
/** V8 (`INVESTIGATION_CLOSURE_V4`, depois da rodada real V11): sem análise nova disponível (limite de análises, não o orçamento de IA),
 * a pergunta das chamadas de um recorte continua aberta para o que não chama modelo — memória, sinais e contexto dessas chamadas — e para
 * o planejador decidir (com justificativa) não aprofundar; só depois disso fica "sem análise". A análise de chamadas some da lista de
 * ferramentas do planejador quando não cabe nenhuma. */
/** V9 (`PRACTICE_ANCHOR_V1` + `REFERENCE_GROUP_V2`): padrões e práticas agregados pela linha-âncora da obrigação na base (a mesma
 * prática deixa de se espalhar entre identidades de obrigação), uma leitura por chamada em cada prática; grupo de referência pelo
 * assunto e, sem avaliações suficientes, pelo resultado oficial do indicador (com a limitação dita); mínimos da estratégia
 * respeitados; contrastes "o grupo também quase não cumpre" e "só o grupo tem avaliação" (boa prática dos colegas). */
/** V10 (`REFERENCE_STEP_V1` + `UNLOCATED_MEMORY_V2`, rodada real V13): o grupo de referência é um passo do diagnóstico quando a
 * estratégia liga a comparação (consulta à memória, sem modelo); o que a memória sabe das chamadas do período entra junto dos recortes
 * descobertos quando nenhum assunto foi localizado. */
/** V11 (`REFERENCE_GROUP_V3` + `REFERENCE_DURATION_V1`): chamadas de colegas analisadas também no grupo pelo resultado oficial (antes
 * só a memória existente), escolhendo, na ordem do resultado, quem tem chamada no assunto até os mínimos de chamadas e colegas, com
 * orçamento PRÓPRIO (`DEFAULT_MAX_PEER_CALL_ANALYSES`) — a referência não consome a amostra da pessoa; chamada de colega pendente ou com
 * falha só fica fora da referência. Indicador de duração: duração registrada média no assunto, pessoa × grupo (onde, nunca por quê). */
/** V12 (depois da rodada real V14): `PATTERN_CONFIRMATION_V1` — no assunto que piorou, etapa que falhou na amostra abaixo do mínimo de
 * padrão pede mais chamadas do mesmo assunto (contrato, orçamento da estratégia); referência analisa colegas até cobrir as práticas em que
 * a pessoa falha (não só o total de chamadas). */
/** V13 (05/10/2026, `PRACTICE_IDENTITY_V1`): padrões, referência dos colegas e confirmação de padrão agregados pela PRÁTICA organizada
 * pela leitura do modelo (a mesma conduta em linhas, seções, documentos ou argumentários diferentes) — antes pela linha-âncora. */
/** V14 (05/10/2026, `PERIOD_SAMPLE_V1`, achado nas execuções reais de dev): Denisy Feitoza (TMA set, 8 × 14 chamadas), Fernanda Nunes
 * Alves (ago, 2 × 6) e Icaro Elias (9 × 12) terminaram em INSUFFICIENT_DATA/CHANGE_LOCATED_NO_CAUSE com ZERO chamadas analisadas, mesmo
 * com a estratégia do TMA autorizando a análise — o volume não permitia comparar os períodos por assunto, nenhum recorte nascia e a
 * memória "não localizada" (`UNLOCATED_MEMORY_V2`) só lia o que já existia; o feedback ficava só com o número. Agora, quando a
 * localização por assunto não acontece POR VOLUME (período abaixo do mínimo de chamadas, ou nenhum assunto com o mínimo nos dois
 * períodos), a análise de chamadas está autorizada pelo contrato (estratégia publicada com a amostra ligada, especialista no domínio,
 * Workflow sem restringir — a estratégia é a do NASCIMENTO da execução, `STRATEGY_AT_BIRTH_V1`) e a pessoa tem pelo menos o mínimo
 * da estratégia em chamadas com transcrição no período, o motor analisa uma amostra DETERMINÍSTICA delas — o assunto com mais chamadas
 * primeiro, depois os demais em rodízio —, dentro do teto de análises (`maxInteractions` da estratégia), do teto de consultas e do
 * orçamento da execução. A evidência vira UMA entrada do período (`UNLOCATED`, `PERIOD_SAMPLE`): padrões são OBSERVAÇÃO do período,
 * nunca causa (`ATTRIBUTION_LIMIT` e a redação "não foi possível ligar isso à variação do indicador" mantidas) e nunca conta como exame
 * de um recorte que piorou (dia fora do padrão não examinado continua `CHANGE_LOCATED_NOT_EXAMINED`). No plano do contrato, o
 * passo de referência vale para o assunto que a amostra escolheu; análise de chamadas de colegas continua só com a comparação
 * autorizada (`PEER_ANALYSIS_AUTHORIZATION_V1`). Sem autorização, abaixo do mínimo ou com o assunto localizado: tudo como na V13. */
/** V15 (06/10/2026): `POPULATION_SIGNAL_V2` (sinal numérico com condição; a taxa de chamadas sinalizadas segue o sentido DECLARADO do
 * sinal, também no grupo de referência por assunto; a amostra do período começa pelas chamadas sinalizadas) e
 * `ZERO_BASELINE_MATERIALITY_V1` (variação a partir de 0 no período anterior é material — antes a taxa que saía de 0% nunca localizava o
 * assunto). Achado na execução real de dev da Larissa (Nota da URA e Reincidência de setembro): a localização marcava Segunda via e Reparo
 * como piora e o foco ficava vazio. */
/** V16 (06/10/2026, `CURRENT_RULES_AFTER_ANALYSIS_V1`): as regras em vigor são lidas DEPOIS das análises da execução — as práticas que
 * elas organizam deixam de parecer "regra que mudou na base" (o padrão de recapitulação da Reincidência da Larissa era descartado). */
/** V17 (16/10/2026, `SUBJECT_RESOLUTION_V2` + `INVESTIGATION_SLICES_V2`): o ASSUNTO das localizações, recortes, memória e grupo de
 * referência passa a ser o submotivo (sem submotivo, o motivo — quem não tem submotivo localiza exatamente como na V16); o MOTIVO vira
 * a dimensão `REASON` quando a estratégia a liga. */
export const INDICATOR_INVESTIGATION_LOGIC_VERSION = "INDICATOR_INVESTIGATION_V17" as const
/** Composição da mensagem (brief, redação, verificação, utilidade). V2 = contrato de confiança: justificativa, orientação e
 * "por que importa" do modelo são LEITURA (conferida contra os fatos antes de qualquer uso); o sistema só completa com regra
 * literal, status verificado ou leitura aprovada; reescrita do verificador não é aceita sem nova verificação. Prompts V4/V3 = a
 * regra vai com a frase que abre a lista e os outros itens da mesma lista (alternativa cumprida ≠ obrigação descumprida). */
/** V3 = nenhuma frase do sistema na conversa (fim do complemento "Ponto principal"/"a etapa não aparece"/"O procedimento orienta");
 * a mensagem é só texto do redator verificado; conjunto reconferido quando frases saem; sem mensagem útil e coerente = abstenção;
 * só os pontos comunicados contam como entregues. Prompt V5 = composição livre (organização, tom e extensão pelo caso), regra
 * atual × regra da época, afirmações proibidas pela estratégia. Verificação V4 = reavaliação pela regra atual não é culpa. */
/** V4 = `STRENGTH_SELECTION_V2` (o reconhecimento oferecido ao redator prioriza a conduta que respondeu à situação do caso —
 * regra condicional cuja condição a revisão encontrou nesta chamada, com a fala da condição — e não repete a mesma fala) e
 * `FEEDBACK_HEADING_V1` (título = assunto do atendimento; data como subtítulo; neutro sem assunto confiável). Prompts inalterados. */
/** V5 = ponto em aberto só de etapa DA CONVERSA com fala que a liga ao caso (execução em sistema vira limite de cobertura, nunca
 * lembrete ao redator); parte de regra composta como ponto próprio com a regra inteira; regras de argumentário com a origem e sem
 * virar material da base. */
/** V6 = título de item que é condição/conteúdo da ação vem com a frase que abre a lista; amostra sem padrão vai como limite (nunca
 * como fato de boa execução). */
/** V7 = o cartão resume o CONJUNTO FINAL: cartão que cita um ponto que o corpo deixou de comunicar é recusado (reescrita ou a frase
 * principal do corpo), para nenhuma conclusão retirada sobreviver numa superfície. */
/** V8 = `REFERENCE_PRACTICES_V1`: boas práticas do grupo de referência (P-n, agregadas, sem nomes) no brief do indicador. */
/** V9 = `STRENGTH_WITH_GOOD_RESULT_V1` (conduta consistente reconhecível com o resultado oficial bom, mesmo com um dia fora do padrão
 * examinado) e prática dos colegas que orienta pedida na reescrita quando nenhuma frase a usa (lacuna de utilidade; não bloqueia). */
/** V10 = `FEEDBACK_FIRMNESS_V1`: firmeza do ponto (ORIENT/CORRECT/INSIST) decidida pelo código, ponto que pede correção comunicado
 * sem frase de ajuste ou amaciado é lacuna pedida na reescrita; prática (âncora) de cada ponto no brief para histórico e orientação anterior. */
/** V11 (depois da rodada real V14): o ponto consolidado (caminho inadequado ou seção) mantém prática, tom e reincidência das etapas que
 * absorve — por prática, identificada pelo título. */
/** V12 (depois da validação V14C): etapa reincidente fica como ponto próprio (não é absorvida pelo caminho); prática em que os colegas de
 * melhor resultado cumprem e a pessoa não vira P-n mesmo quando é ponto de desenvolvimento (lacuna pedida se não for usada). */
/** V13 (05/10/2026): a mesma PRÁTICA (`PRACTICE_IDENTITY_V1`) julgada por mais de uma regra na chamada é um ponto só; repetição entre
 * frases decidida só pelo verificador (`repeats`) — o corte por palavras em comum (Jaccard) saiu. */
/** V14 (05/10/2026): `CONSOLIDATED_STEPS_V1` — o ponto consolidado leva cada etapa com os próprios fatos (status, falas ou ausência,
 * regra); histórico sem reincidência diz "foi cumprida em todas" (antes "não foi cumprida em 0"). */
/** V15 (05/10/2026): `SPEECH_EXAMPLE_V1` — exemplo de como dizer por ponto de desenvolvimento: proposto pelo redator, conferido na mesma
 * verificação (E-n) e só exibido nos detalhes ("Como melhorar") quando sustentado como fala concreta, sem conteúdo fora dos fatos. */
/** V16 (06/10/2026, titularidade): `RULE_SOURCES_V1` (uma regra por origem; o item "evitar" do argumentário nunca vira orientação),
 * caminho só vira ponto próprio com evidência própria (no contrato de obrigações cada conduta é um ponto), `PRACTICE_TITLE_V1` (título =
 * nome curto da prática), `ALL_DEVELOPMENTS_V1` (ponto de desenvolvimento não comunicado é lacuna pedida na reescrita) e
 * `STEP_DETAILS_V1` (cada etapa de um ponto consolidado com a própria prova nos detalhes). */
/** V17 (06/10/2026, 2ª rodada): `ADJUSTMENT_IN_CALL_V1` (ponto dito só como orientação futura = lacuna de reescrita),
 * `OFFICIAL_PHRASING_V1` (fraseologia oficial do argumentário nos detalhes sem exemplo do redator) e `OFFICIAL_RESULT_TABLE_V1`
 * (tabela do resultado oficial no texto do indicador, montada pelo sistema). */
/** V18 (06/10/2026): `LIST_CHECK_V1` (o verificador aponta relação de 3+ itens em texto corrido → lacuna de reescrita, nunca bloqueio)
 * e `BOLD_LIMIT_V1` (negrito com mais de 8 palavras volta a texto; um destaque por parágrafo de texto corrido). */
export const COMPOSITION_VERSION = "FEEDBACK_COMPOSITION_V18" as const
/** V6 = ordem de importância + ponto principal, pontos em aberto (O-n), sem superlativo de rotina, reavaliação dita com naturalidade,
 * junção de repetição mantendo o detalhe do caso, reconhecimento da parte feita de um ponto parcial. */
/** V7 = ponto em aberto nunca vira lembrete que insinua falha; sistema fora da conversa nunca é assunto; argumentário: paráfrase, "pode". */
/** V8 = sem vocabulário técnico do procedimento, ausência de desvio nunca é reconhecimento, reconhecimento da escolha (não da
 * sequência), resultado do indicador sem descrever as chamadas como boas. */
/** V9 = ações fora da conversa (notVerifiableByRecording) e itens da mesma lista não avaliados (notAssessedInSameList) como fatos: nunca
 * apresentados como feitos/base de elogio; reconhecimento não se estende à lista inteira. */
/** V10 = parte avaliada de obrigação mista (evaluatedPart) e necessidade central sem conclusão confirmada (centralNeedOpen) como fatos. */
/** V11 = `saidIn`: a fala que relatou a ação em sistema vai junto do limite — escrever como fala, nunca como fato apurado (rodada real V12). */
/** V12 = `referencePractices` (P-n): boa prática dos colegas como orientação ou contexto, nunca causa nem falta da pessoa. */
/** V13 (depois da rodada real V13, cenário C: só o número, nenhuma prática) = resultado bom vai além do número quando os fatos trazem
 * conduta da pessoa (S-n) e prática dos colegas (P-n); fatos técnicos das ferramentas só em palavras comuns. */
/** V14 = firmeza (corrigir sem amaciar, insistir com a data da orientação anterior, nunca julgar a pessoa) e falas de exemplo do padrão
 * do indicador valem só para a chamada delas (rodada V13: "cinco dias úteis… nas 4 chamadas"). */
/** V15 (validação V14D): firmeza por reincidência (`dueTo` RECURRENCE) — dizer que se repetiu, com os números do histórico. */
/** V16 (textos da V14B–D com o mesmo esqueleto repetido por ponto): a firmeza diz o QUE a pessoa precisa saber, nunca uma receita por
 * ponto — forma, ordem e agrupamento (pontos do mesmo momento juntos) ficam com o redator. */
/** V17 (avaliação dos textos de 05/10): etapas como fatos (steps), um assunto por parágrafo, ajuste sempre com o que aconteceu
 * nesta chamada, "o cliente" (nunca "a pessoa"), aspas curvas e aproximação do indicador sem jargão. */
/** V18 (05/10/2026): examples — fala ao cliente pronta, só com o conteúdo dos fatos (valor que não está nos fatos é apresentado sem ser
 * inventado), nada do que a regra pede para evitar, sem promessa; no indicador, sem o conteúdo de uma chamada de exemplo. */
/** V19 (06/10/2026): `suggestedPhrasing` (a fraseologia do argumentário de origem, `ARGUMENT_PHRASING_V1`) é a base do exemplo de como
 * dizer, com as lacunas preenchidas só pelos fatos; conteúdo dito diferente do que a regra define (prazo, valor, canal) é corrigido com o
 * que foi dito e o valor da regra (`SOURCE_DEFINED_CONTENT_V1`). */
/** V20 (06/10/2026): com fraseologia do argumentário, o exemplo de como dizer é proposto (lacuna de utilidade sem ele); protocolo,
 * telefone ou documento só das falas da chamada — o da regra é exemplo ilustrativo (`CALL_IDENTIFIER_INTEGRITY_V1`, também por código). */
/** V21 (06/10/2026): todo ponto de desenvolvimento é comunicado (a forma e a ordem são do redator); regra [evitar] é o que NÃO fazer;
 * `NARRATIVE_FORMATTING_V1` — frase pode ser item de lista (format) e destacar o essencial em **negrito** (o sistema monta o markdown). */
/** V22 (06/10/2026): relação de três ou mais itens da regra (documentos, dados a confirmar) sempre em lista; a reescrita mantém a
 * formatação das frases aprovadas (antes a lista dos documentos da titularidade voltou como frase corrida). */
/** V23 (06/10/2026): negrito curto e opcional; formatação nunca é obrigatória (texto corrido bem escrito é um bom retorno). */
export const COMPOSITION_PROMPT_VERSION = "FEEDBACK_COMPOSITION_PROMPT_V23" as const
/** V5 = avaliação da MENSAGEM inteira (transmite o ponto principal? vai além de narrar?), repetição × detalhe novo (addsInformation),
 * informação perdida na reescrita (lostInformation), superlativo de rotina = exagero, ponto em aberto nunca afirmado. */
/** V6 = lembrete que insinua falha não comprovada e ação de sistema apresentada como feita/não feita = OVERREACH. */
/** V7 = "sem desvios/sem problemas" a partir de amostra ou de ausência de padrão = OVERREACH; jargão do procedimento = não específico. */
/** V8 = ação de notVerifiableByRecording usada como base/consequência e elogio estendido à lista com notAssessedInSameList = OVERREACH. */
/** V9 = parte em sistema de uma obrigação mista apresentada como feita/falha e necessidade aberta dita como resolvida = OVERREACH. */
/** V10 = conteúdo de uma fala `saidIn` tomado como apurado/constatado (inclusive como premissa: "ao identificar a pendência…") = OVERREACH. */
/** V11 = prática dos colegas (P-n) como causa do resultado, falta insinuada sem avaliação da pessoa ou frequência além do número = erro. */
/** V12 = `firmnessRespected` na avaliação da mensagem; julgar a pessoa e "já foi orientado" sem base = erro; conteúdo de fala de exemplo
 * estendido ao padrão inteiro = OVERREACH. */
/** V13 (validação V14D): `firmnessRespected` falso quando um ponto reincidente é corrigido como se fosse a primeira vez. */
/** V14: `firmnessRespected` julga se a pessoa sai sabendo o que mudar, seja qual for a forma escolhida pelo texto. */
/** V15: status de cada etapa (steps) é fato; `firmnessRespected` exige que a pessoa saiba o que aconteceu (ou faltou) nesta chamada. */
/** V16: itens E-n (exemplo de como dizer) — conteúdo fora dos fatos, o que a regra pede para evitar, promessa e fala com lacuna ou
 * genérica (specific false) são recusados. */
/** V17: `suggestedPhrasing` é fato (texto oficial do argumentário) — um E-n que o adapta com as lacunas preenchidas pelos fatos é
 * sustentado; corrigir um conteúdo dito diferente do que a regra define, com o valor da regra, é sustentado. */
/** V18: identificador (protocolo, telefone, documento) fora das falas desta chamada = UNSUPPORTED_ADDITION, mesmo que esteja numa regra. */
/** V19: regra [evitar] apresentada como algo a fazer = CONTRADICTION; dizer que a pessoa fez o que ela descreve, com as falas, é sustentado;
 * negrito e item de lista são só apresentação. */
/** V20: `unlistedRelation` — frases com relação de 3+ itens em texto corrido que leriam melhor em lista (vazio é o normal). */
/** V21: a relação de itens dentro de uma orientação ("recapitule A, B, C e D") também conta (na V20 a exclusão de "orientação corrida"
 * deixou a recapitulação da portabilidade em texto corrido). */
export const VERIFICATION_PROMPT_VERSION = "FEEDBACK_VERIFICATION_PROMPT_V21" as const
export const COHERENCE_PROMPT_VERSION = "FEEDBACK_COHERENCE_PROMPT_V1" as const
