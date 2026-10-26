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
/** V18 (20/10/2026): análise (prompt V12, `OPTIONAL_GUIDANCE_RECOGNITION_V1`) registra a orientação "pode" feita como reconhecimento —
 * e o código descarta a obrigação só de "pode" lida como não feita ou em parte; revisão (prompt V6, `CONDITION_EVIDENCE_REQUIRED_V1`)
 * sempre responde a fala da condição. Leituras diferentes da mesma chamada: a investigação não reaproveita as da V17. */
/** V19 (21/10/2026, `PRODUCT_APPLICABILITY_V1`): com catálogo de produtos vigente na data da chamada, a análise separa as solicitações e
 * o produto sustentado pelas evidências de cada uma, a revisão dá a própria leitura, e o código só deixa cobrar ou reconhecer a regra
 * cuja aplicabilidade ficou estabelecida (suspensa = nem falha, nem acerto; de outro produto = não se aplica). Sem catálogo o
 * resultado é o mesmo da V18 (e as respostas pagas são reaproveitadas pela assinatura do pedido). */
/** V20 (21/10/2026): a transcrição para a IA mascara os números preservando o formato (`SUBJECT_PII_MASK_V2` — DDD e 1º dígito do
 * telefone, 3 primeiros dígitos e quantidade dos números longos), então toda chamada é lida sobre outro texto; com catálogo de produtos
 * (`PRODUCT_APPLICABILITY_V2`, prompts `PRODUCT_SCOPE_PROMPT_V2`/`PRODUCT_SCOPE_REVIEW_PROMPT_V2`) a fala do operador com contexto
 * compatível do cliente estabelece o produto, e com produto não estabelecido a análise traz a regra de cada produto possível. */
/** V21 (21/10/2026, `PRODUCT_APPLICABILITY_V2_1`): quando a mesma leitura marca um produto e a categoria dele, fica o produto — a
 * categoria não alarga a leitura para "qualquer produto da categoria"; evidência com o turno e sem o trecho usa o turno inteiro (texto da
 * gravação). Prompts `PRODUCT_SCOPE_PROMPT_V3`/`PRODUCT_SCOPE_REVIEW_PROMPT_V3`: o trecho só aponta o produto que ele mesmo distingue. */
/** V22 (21/10/2026, decisão do usuário, `PRODUCT_APPLICABILITY_V3`, prompts de produto V4): o operador dizer ou confirmar o produto
 * estabelece o produto sozinho — também na fala em que executa o procedimento —, salvo quando o que o cliente disse aponta para outro. */
export const CALL_ANALYSIS_LOGIC_VERSION = "CALL_ANALYSIS_LOGIC_V22" as const
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
/** V18 (22/10/2026, `PATTERN_EXAMPLE_CONTEXT_V1`): cada exemplo de um padrão guarda os produtos estabelecidos e a regra avaliada na
 * PRÓPRIA chamada — investigação gravada antes (sem esse contexto) não é reaproveitada para um retorno novo. As análises das chamadas
 * continuam reaproveitadas (versão própria). */
/** V19 (22/10/2026, `PRODUCT_IN_FEEDBACK_V1`): o exemplo leva o produto da SOLICITAÇÃO (não todos os da chamada), a regra com "Vale para",
 * "evitar" e "deve/pode", e o item do argumentário (a fala é a da versão que a chamada usou); colegas de referência comparados por produto. Cada regra com o "Vale para" da própria fonte (`ruleScopeNamesOf`, pelos documentos das linhas-fonte). */
export const INDICATOR_INVESTIGATION_LOGIC_VERSION = "INDICATOR_INVESTIGATION_V19" as const
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
/** V19 (20/10/2026): `LITERAL_ASTERISK_V1` — o saneamento do markdown da frase tira só o itálico de um asterisco (*assim*); asterisco
 * solto é conteúdo e fica (códigos como *7734#, que saíam sem o asterisco). */
/** V20 (20/10/2026): `ARGUMENT_REQUIREMENT_V1` — cada regra de argumentário leva se o item é obrigatório ("deve", ponto obrigatório na
 * fala) ou opcional ("pode"), do cadastro; a visão mostra a marca em "O processo orienta" e no reconhecimento só de item "pode". */
/** V21 (21/10/2026): `PLAIN_LANGUAGE_V1` — histórico do ponto com a proporção na frente ("não foi cumprida em 3 de 4 analisadas") e a
 * medida de leitura do texto entregue (`READABILITY_PT_V1`) na auditoria da composição — só para acompanhar, nunca meta nem trava. */
/** V22 (21/10/2026): `PRODUCT_APPLICABILITY_V1` — com catálogo de produtos, o brief leva o produto ESTABELECIDO de cada pedido e as regras
 * suspensas por produto não estabelecido (`productScope`); regra suspensa nunca vira ponto de desenvolvimento, reconhecimento nem ponto
 * em aberto (fica como limite de cobertura `PRODUCT_NOT_ESTABLISHED`) e, quando é central, o leitor vê uma nota neutra. */
/** V23 (21/10/2026): `LITERAL_QUOTES_V1` — fala citada pelo redator por referência ([[Q3]]) vira o texto exato da chamada; todo trecho entre
 * aspas tem de ser literal da chamada, da regra ou do argumentário (`QUOTE_NOT_LITERAL`, por código); o redator não escreve mais exemplo
 * de como dizer (o "como dizer" é só a fraseologia do argumentário, como está, lacunas incluídas); "como aplicar" e o "por que importa" da
 * análise saem dos detalhes (leitura de modelo nunca vai à tela). */
/** V24 (21/10/2026): `ANALYSIS_CONTEXT_ONLY_V1` — o redator recebe da análise só o CONTEXTO (situação do cliente e o que aconteceu em cada
 * ponto); a orientação sugerida e o "por que importa" dela deixam de ir ao redator e à reescrita (continuam gravados e conferidos), e a
 * linha técnica de como a chamada foi escolhida sai do contexto que ele lê. */
/** V25 (21/10/2026): `LITERAL_QUOTES_V1` — fala com mais de uma frase vai ao redator com as partes (Q3.1, Q3.2…) e [[Q3.2]] / [[Q3.1-2]]
 * coloca só essas frases, exatas (antes uma fala longa entrava inteira no texto). */
/** V26 (21/10/2026): `LITERAL_QUOTES_V1` — fala colada que já termina com pontuação final fecha a frase: o ponto do redator logo depois
 * dela sai (antes saía “…fraude.”.). A fala não muda; feedbacks já gravados ficam como estão. */
/** V27 (21/10/2026): `ALL_STRENGTHS_SHOWN_V1` — "O que manter" mostra todos os acertos confirmados (fala exata + afirmação do sistema),
 * também os que o texto não citou (etapa só declarada, só se citada); o acerto fora do texto não é marcado como entregue. */
/** V28 (21/10/2026): `RECOGNITION_MATERIALS_V1` — retorno sem ponto a ajustar mostra em "Materiais utilizados" os documentos da base dos
 * acertos confirmados (antes o bloco sumia). O material recomendado, gravado para a liderança, continua só o dos ajustes. */
/** V29 (22/10/2026): `BASE_PRACTICES_IN_TEXT_V1` — as práticas da base de boas práticas escolhidas para o caso (o mesmo bloco "Oportunidades
 * inspiradas em boas práticas") chegam ao redator e ao verificador como fatos B-n ANTES da redação; B-n só em GUIDANCE/CONTEXT; a fala
 * sugerida entra por [[B-n]], exata (`LITERAL_QUOTES_V2`); prática não usada é pedida na reescrita, sem bloquear; o bloco marca as
 * citadas (`citedInText`). Caso sem prática: mesmo caso, mesmo turno e mesma composição da V28. */
/** V30 (22/10/2026): `BASE_PRACTICES_IN_TEXT_V2` — o redator recebe a prática em palavras (o que fazer, onde aparece mais, o que as chamadas
 * da pessoa mostram), sem a frase técnica nem o nome do padrão; o verificador continua com a associação e os números. */
/** V31 (22/10/2026): `PATTERN_EXAMPLE_CONTEXT_V1` — cada fala de exemplo de um padrão do indicador vai com os produtos e a regra da PRÓPRIA
 * chamada (`productInThisCall`, `ruleInThisCall`); a regra da chamada entra como texto literal permitido. */
/** V32 (22/10/2026): `PRODUCT_IN_FEEDBACK_V1` — o ponto leva o produto do pedido (monitoria), a regra o "Vale para", a fala do argumentário
 * vem por chamada com o produto dela (indicador); pontos de produtos diferentes nunca se juntam; a tela mostra o produto. */
/** V33 (22/10/2026, `PRODUCT_IN_FEEDBACK_V1`): cada regra leva o "Vale para" da PRÓPRIA fonte (`ruleScopeNamesOf`) — a regra geral que a
 * obrigação juntou com a do produto deixa de aparecer como "Vale para <produto>" (na monitoria de IP Dedicado da Larissa, na V32, a regra
 * de "Reparo — regras gerais (todos os produtos)" saiu marcada como do IP Dedicado). */
/** V34 (22/10/2026): a fala do argumentário só leva produto (`suggestedResponseProduct` na tela, `forProduct` no redator) quando o
 * argumentário vale para produtos específicos (`phrasingProductOf`) — no TMA da Larissa (V33) a fala do argumentário geral de encerramento
 * saiu como "Para IP Dedicado" por ter vindo de uma chamada desse produto. */
/** V35 (22/10/2026, `BASE_PRACTICES_IN_TEXT_V3`): o fato B-n leva `result` (o que o resultado mede, pelo cadastro do indicador). */
/** V36 (22/10/2026, `BASE_PRACTICES_IN_TEXT_V4`): o fato B-n leva `howItHelps` (aprovado na revisão) no lugar de `result` (V35). */
export const COMPOSITION_VERSION = "FEEDBACK_COMPOSITION_V36" as const
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
/** V24 (20/10/2026): regra marcada [pode — opcional …] (`ARGUMENT_REQUIREMENT_V1`) nunca é apresentada como exigência; feita, é
 * reconhecida como iniciativa. */
/** V25 (21/10/2026): `PLAIN_LANGUAGE_V1` — SEM mudança no texto do redator (é o da V24). A seção de linguagem simples (uma ideia por frase,
 * palavras do dia a dia, lembrete no fim do turno) foi avaliada em 3 ensaios e retirada: as falas literais da chamada sumiam do texto e a
 * leitura não melhorou. O redator nunca mexe em trecho literal, regra, argumentário nem sugestão de como falar; ver motor-de-feedback.md. */
/** V26 (21/10/2026, `PRODUCT_APPLICABILITY_V1`): `productScope` — o redator diz o produto só quando estabelecido e nunca cobra, orienta
 * nem reconhece regra de `rulesNotEstablished`. */
/** V27 (21/10/2026): `LITERAL_QUOTES_V1` — falas com id e citação só pela referência; sem exemplo de como dizer (seção e campo `examples`
 * saem); linguagem simples como princípio (ordem direta, frases curtas, palavras do dia a dia, termos da operação como a regra escreve) e
 * lembrete no fim do turno. */
/** V28 (21/10/2026): `ANALYSIS_CONTEXT_ONLY_V1` — analysisReading é contexto (o que aconteceu), nunca o que fazer: o que fazer vem só da
 * regra; adjetivos e julgamentos da análise não vão para o texto. */
/** V29 (21/10/2026): a fala entra como fala de quem disse — o verbo de quem falou logo antes da referência — e só o trecho que importa
 * (a parte de uma fala longa); o lembrete do fim do turno diz o mesmo. */
/** V30 (21/10/2026): os acertos confirmados já aparecem nos detalhes ("O que manter") — o texto reconhece só a escolha que fez diferença
 * no caso; acerto de rotina (validação, saudação, despedida) fica nos detalhes. */
/** V31 (21/10/2026): introdução curta (uma ou duas frases, CONTEXT, no primeiro parágrafo): o que o cliente precisava nesta chamada e o
 * ponto principal do retorno — antes o texto abria direto na fala do primeiro ponto. */
/** V32 (21/10/2026): cada parágrafo abre dizendo de que momento da chamada fala, para ser entendido sozinho (na V31 um parágrafo abriu com
 * "Esse resumo da demanda…" sem resumo nenhum antes). */
/** V33 (21/10/2026): retorno sem ponto a ajustar é um reconhecimento — abre reconhecendo (pode
 * dar os parabéns, sempre junto com a conduta concreta — nunca "o atendimento inteiro seguiu tudo", que o verificador recusa com razão)
 * e destaca a escolha que mais fez diferença, com a fala; "acerto de rotina fica nos detalhes" vale só quando há o que
 * ajustar; a introdução diz o ponto principal pelo que aconteceu, nunca pelo título do ponto (no Colocation da Larissa, V32, o texto só
 * narrava e citava "as regras gerais de reparo"). */
/** V34 (22/10/2026): `BASE_PRACTICES_WRITER_RULES` no turno do caso que TEM prática da base (opcional, mesmo assunto, associação não é
 * causa, depois do que a regra pede; sem ponto a ajustar, os parabéns primeiro e no máximo uma no fim — decisão do usuário). O prompt de
 * sistema é o da V33; caso sem prática recebe o turno da V33, palavra por palavra. */
/** V35 (22/10/2026): prática da base dita no CONTEXTO do caso e em linguagem simples (o que fazer naquele momento, que quem tem melhor
 * resultado faz isso, para que serve pelo que a ação faz), sem período, contagem, porcentagem nem o nome do padrão; forma de exemplo. */
/** V36 (22/10/2026): exampleQuotes — a fala é dita pela regra da própria chamada, nunca pela de outra chamada ou produto do padrão (no TMA
 * da Larissa a fala do prazo da Banda Larga, certa, saiu como erro do IP Dedicado). */
/** V37 (22/10/2026): `product` no ponto, [vale para: …] na regra e `forProduct` na fala sugerida — cada ponto no pedido dele, nunca a regra
 * ou a fala de um produto aplicada a outro. Prática da base com `product` (`BEST_PRACTICE_SELECTION_V2`) só se liga a ponto, fala ou chamada desse produto. */
/** V38 (22/10/2026, `BASE_PRACTICES_IN_TEXT_V3`, pedido do usuário): a prática pode ser ligada ao indicador pelo efeito DIRETO da ação
 * naquilo que o resultado mede ("esse tempo sai da chamada, que é o que o Tempo Médio de Atendimento mede"), nunca prometendo o resultado. */
/** V39 (22/10/2026, `BASE_PRACTICES_IN_TEXT_V4`, decisão do usuário): substitui a ligação "pelo efeito direto" da V38 — como a prática
 * ajuda no resultado, só com `howItHelps` (aprovado na revisão), com as palavras do redator e sem ir além; sem ele, não ligar. */
export const COMPOSITION_PROMPT_VERSION = "FEEDBACK_COMPOSITION_PROMPT_V39" as const
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
/** V22: regra [pode — opcional …] apresentada como exigência ou falta = OVERREACH; reconhecê-la como iniciativa, com as falas, é sustentado. */
/** V23 (`PLAIN_LANGUAGE_V1`): paráfrase mais simples que troca a ação da regra (o quê, quem, onde) ou um termo da operação escrito na regra
 * ("conta" no lugar de "faturamento") = UNSUPPORTED_ADDITION; palavra do dia a dia no lugar de palavra formal, com a mesma ação, é sustentada. */
/** V24 (`PRODUCT_APPLICABILITY_V1`): produto afirmado sem estar em `identified` = UNSUPPORTED_ADDITION; frase que cobra, orienta ou reconhece
 * regra de `rulesNotEstablished` (ou trata o produto não confirmado como falha) = OVERREACH. */
/** V25 (`LITERAL_QUOTES_V1`): as falas entre aspas foram coladas pelo sistema — julga o uso da fala, não a grafia; itens E-… (exemplo de
 * como dizer) deixam de existir; fala ao cliente escrita na frase que não é a do argumentário = UNSUPPORTED_ADDITION. */
/** V26 (22/10/2026, `BASE_PRACTICES_IN_TEXT_V1`): `BASE_PRACTICES_VERIFIER_RULES` no turno do caso que TEM prática da base — prática como
 * regra, falta ou causa = OVERREACH; dizer o que a pessoa faz com you nulo = CONTRADICTION. Sem prática, o turno da V25. */
/** V27 (22/10/2026): `whereItShowsUp` (comparação em palavras) conferido contra a associação; "para que serve" pelo que a própria ação faz
 * é sustentado, efeito em resultado, nota ou satisfação é OVERREACH. */
/** V28 (22/10/2026): ligar uma fala de exemplo à regra ou ao produto de OUTRA chamada do padrão = CONTRADICTION. */
/** V29 (22/10/2026): ponto no pedido de outro produto, regra [vale para: …] aplicada a outro produto ou fala de um produto usada para outro
 * = CONTRADICTION; prática da base com `product` ligada a ponto, fala ou chamada de outro produto = CONTRADICTION. */
/** V30 (22/10/2026, `BASE_PRACTICES_IN_TEXT_V3`): efeito direto da própria ação naquilo que o resultado mede (`result`) = SUPPORTED;
 * prometer o resultado ou efeito que a ação não produz por si = OVERREACH. */
/** V31 (22/10/2026, `BASE_PRACTICES_IN_TEXT_V4`): `howItHelps` é fato aprovado — dizer como a prática ajuda como nele = SUPPORTED; ir além,
 * ligar sem ele ou prometer o resultado = OVERREACH (substitui o "efeito direto" da V30, que derrubou a frase no TMA da Larissa). */
export const VERIFICATION_PROMPT_VERSION = "FEEDBACK_VERIFICATION_PROMPT_V31" as const
export const COHERENCE_PROMPT_VERSION = "FEEDBACK_COHERENCE_PROMPT_V1" as const
