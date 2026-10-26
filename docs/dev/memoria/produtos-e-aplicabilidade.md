# Memória — Produtos e aplicabilidade (`PRODUCT_APPLICABILITY_V1`)

> Doc completa: [produtos-e-aplicabilidade.md](../produtos-e-aplicabilidade.md). Ver também [motor-de-feedback.md](motor-de-feedback.md) e
> [conversa-voz-e-avatar.md](conversa-voz-e-avatar.md).

### Identificação contextual do produto e aplicabilidade antes do julgamento (2026-10-21, migration 154)

- **Regra**: uma regra só é cobrada ou reconhecida com a aplicabilidade ESTABELECIDA para a solicitação. Produto não identificado nunca é falha
  do colaborador; nunca o produto mais frequente; procedimentos de produtos diferentes nunca se misturam numa cobrança.
- **Cadastro** (`/admin/product-catalog`, menu Agentes › Produtos; `configuration.manage` com escopo da organização para escrever):
  produtos com categoria opcional; indícios (critérios de identificação no backend) em linguagem natural, versionados (rascunho → aprovado
  imutável → substituído; vigência nunca retroativa; encerrar/reativar; excluir só sem uso por análise); para quais produtos vale cada base
  (documento da base ou argumentário) com vigência própria e histórico imutável. Nada disso vira regex/prefixo/lista no código (prova
  estrutural no teste).
- **Tela reorganizada por produto (21/10, a pedido do usuário)**: o cadastro NÃO é "produtos que compartilham regras" — é o que liga o pedido
  à orientação certa. Bases × produtos não é 1×1: base geral (nenhum produto), de um produto ou de vários; categoria vale para os produtos
  dela. Aba Produtos = lista + detalhe (Bases de conhecimento: só deste / compartilhada / pela categoria; Como reconhecer na chamada: indícios);
  aba Bases de conhecimento = Geral × De um produto × De vários. Termos: família → categoria, critério → indício, conclusivo/indicativo →
  "Confirma o produto"/"Apenas sugere", fonte do critério → "De onde vem". Mensagens do backend acompanharam; prompts NÃO (contratos
  versionados — continuam dizendo família/critério ao modelo).
- **V2 (21/10, pedido do usuário)**: fala do operador + contexto compatível do cliente estabelece o produto (sozinha só indica; nunca
  circular); transcrição para a IA com números de formato preservado (`SUBJECT_PII_MASK_V2`); produto não estabelecido → bloco
  "Depende do produto" em "Vale confirmar" com o texto literal da regra de cada produto possível (sistema, não redator). Lógica
  `CALL_ANALYSIS_LOGIC_V20`, prompts de produto V2, `PRODUCT_APPLICABILITY_V2`. Bug corrigido: aprovar indício sem data (null → 1970).
  Detalhe em [produtos-e-aplicabilidade.md](../produtos-e-aplicabilidade.md#v2-21102026-a-pedido-do-usuário--product_applicability_v2-lógica-call_analysis_logic_v20).
- **Dev (21/10, depois da V2)**: cadastrados e APROVADOS os produtos reais informados pelo usuário — categorias Fixa Básica, Móvel, Voz
  Avançada, Dados Avançados; produtos Linha analógica, Banda Larga, Linha Móvel, SIP, DDR, IP Dedicado, Colocation (nomes como a
  operação fala deles na descrição); indícios: conta 899 (Fixa Básica, confirma), fixo de 8 dígitos (linha analógica, só sugere),
  DDD + 9 dígitos com 9 (Linha Móvel, confirma), conta de 10 caracteres (Móvel/IP Dedicado/Colocation, só sugere), conta 699 (SIP,
  confirma), número da LP (Dados Avançados, confirma); origem "Regras informadas pela operação em 21/10/2026". O MODO PRODUTO ESTÁ
  LIGADO no dev; nenhuma base marcada para produto ainda (nenhuma regra suspensa até alguém marcar as bases).
- **Tela simplificada (21/10, pedido do usuário)**: uma tela só (sem abas), categorias recolhíveis, nenhum código técnico (gerado pelo
  nome), cadastro com Nome/Categoria (criada no seletor)/"Como chamam", menu ⋯ para desativar/excluir, indício em um passo ("Salvar e
  usar" = cria + aprova). "Vale para" também no editor da base e do argumentário e coluna "Produtos" na lista de bases. Recomendação dada
  ao usuário e aceita: produto só se cadastra em Produtos; a ligação base ↔ produto é o mesmo registro nos dois lugares.
- **Cenário TESTE PRODUTOS no dev (21/10)**: `backend/scripts/dev/larissa-scenario/produtos/` (`--configurar`, `--chamadas`, `--reset`)
  criou a categoria Soluciona TI/produto Vivo Soluciona TI, 20 bases, 6 argumentários (escopo: subgrupo da Larissa — entram em
  qualquer análise NOVA desse subgrupo), 2 agentes, 2 workflows manuais publicados e 15 chamadas da Larissa (SV01–SV08, RP01–RP07)
  com produto esperado e falhas plantadas. Avaliadas em 21/10 pelos workflows (lógica V20; ~US$ 4,27; RP06 sem análise — 4 falhas do
  provedor, `dead`); avise a sessão "Base de boas práticas" antes de analisar (ela usa a memória da Larissa nas recomposições).
  IT-INIA-005 v2.0 (`docs/manuais/it-inia-005/`: rascunho, capturar.mjs, passos) é gerada sobre esse cenário.
- **V2.1 (21/10, depois da avaliação; pedido: "corrigir e avaliar chamada por chamada, economizando")**: produto + categoria na mesma
  leitura = o produto; evidência só com o turno usa o turno inteiro; corroboração entre análise e revisão pelo mesmo turno; prompts de
  produto V3 (característica do cliente não aponta produto; regra geral nunca junta com a de um produto). `CALL_ANALYSIS_LOGIC_V21`,
  `PRODUCT_APPLICABILITY_V2_1`. Validação: `scripts/dev/larissa-scenario/produtos/avaliar.ts` (replay sem custo; modo pago só uma
  chamada por vez) → 14/14 identificações, 9/11 erros plantados, nenhum erro indevido; ~US$ 0,81 gastos. Nada reprocessado no banco.
  Detalhe e números em [produtos-e-aplicabilidade.md](../produtos-e-aplicabilidade.md#resultado-da-avaliação-21102026).
- **Commits 46ca7530 (V2.1 + cenário) e bd24b31a (IT-005 v2.0), 21/10, sem push.** Segunda rodada real (~US$ 1,75): RP06 conflito ok,
  SV04/RP03/RP05 ok, SV05 ok pela corroboração. Tetos de saída da análise (32.768) e da revisão (24.576) subidos — análises e revisões
  cortadas pelo raciocínio longo eram pagas e jogadas fora. Roteiro corrigido em RP05 (RVS1 não era falha) e SV04 (S2 parcial não
  previsto). Pendentes: regra geral juntada com a de um produto (2/3 rodadas da SV05; fica sem avaliação, nunca erro) e argumentários
  antigos do dev sem "Vale para" valendo para todos os produtos.
- **V3 (21/10, decisão do usuário)**: o operador DIZER ou confirmar o produto estabelece sozinho (também na fala da conduta), salvo quando o
  cliente aponta para outro produto; pergunta/hipótese/negação e procedimento sem dizer o produto não valem. `PRODUCT_APPLICABILITY_V3`,
  `CALL_ANALYSIS_LOGIC_V22`, prompts de produto V4. SV05 → SIP (real, ~US$ 0,26). No dev, 16 argumentários gerais marcados com "Vale
  para" pela API (Móvel ×8, Banda Larga ×4, IP Dedicado ×3, Fixa Básica ×1), vigentes desde 21/10 21:22; os 5 de processo (aplicativo, bloqueio, Vivo em Dia, Caixa Postal) ficam gerais por decisão do usuário
  (22/10): "Vale para" só para conteúdo de produto, nunca para tipo de cliente.
- **Exceção por produto dentro de base geral (22/10)**: teste real EX01–EX03 (`excecao.ts`, ~US$ 0,79) — a INIA entendeu as duas metades
  (exceção vale para o VSTI; fluxo geral não vale para ele; Banda Larga segue o fluxo geral). Sem mudança de código. Ressalva: a exceção da
  base não passa para argumentário geral do mesmo ponto (precisa da exceção no texto ou de "Vale para").
  Prompts V4 também cobrem: cliente confirmando a pergunta de sim ou não do operador (vale), "achei aqui" sem dizer o que achou (não
  vale), vários produtos na mesma ligação (evidência e regra por pedido; regra de produto nunca sem `request`) e regra geral "siga o
  procedimento do produto" (depende do produto). Chamadas SV09/SV10 em `chamadas-extras.ts`; validadas com o modelo real (~US$ 1,17).
  Obrigação MISTA com `outsideDependency` (fora de produto): resolvido em 22/10 no prompt da revisão V7 — ver motor-de-feedback.md.
- **Motor**: modo produto só com cadastro vigente NA DATA DA CHAMADA (critério aprovado ou fonte apresentada com abrangência); sem ele, prompt,
  schema, chave e resultado idênticos aos de antes. Análise (`CALL_ANALYSIS_PROMPT_V12+PRODUCT_SCOPE_PROMPT_V1`) devolve `requests` (Q-n) com
  objeto, status e evidências com relação ao pedido; obrigações com `request`/`productScope`/`commonAcrossSources`. Revisão
  (`+PRODUCT_SCOPE_REVIEW_PROMPT_V1`) lê de novo cada pedido e a abrangência de cada conclusão. Código (`product-applicability.ts`, dentro de
  `verifyObligationAnalysis`, ANTES da decisão da revisão): integridade + o que cada evidência pode provar (cliente/metadado/critério conclusivo
  com condições e número legível estabelecem; operador, contexto, indicativo, número incerto, procedimento executado só indicam; circularidade
  pela mesma fala de conduta) + leitura mais restrita entre código, análise e revisão + efeito por regra (INDEPENDENT/ESTABLISHED/OTHER_PRODUCT/
  SUSPENDED). Lógica `CALL_ANALYSIS_LOGIC_V19`; composição V22 / prompt V26 / verificação V24 (`productScope` como fato; frase que cobra regra
  suspensa = OVERREACH). Abstenção `INSUFFICIENT_EVIDENCE:PRODUCT_NOT_ESTABLISHED`.
- **Memória**: `call_assessments.product_identification` (fotografia por pedido, com versões do cadastro e efeito por regra; números com 4
  dígitos visíveis) e `verification.productApplicability` por critério. Diagnóstico mostra o produto e o grupo "Sem avaliação — depende do produto".
- **Chat**: sessão de feedback com produto indefinido usa o MESMO esclarecimento pelas bases (contexto da sessão = registro); escolha gravada com
  escopo `FEEDBACK_SESSION` e procedência `CHAT_CONFIRMATION` — nunca evidência da gravação, nada volta para a análise. Planejador
  `KNOWLEDGE_CLARIFICATION_PROMPTS_V3`: nunca pedir número completo quando o nome basta (V4, 21/10, outra sessão: orientação geral não encerra a questão — ver agentes-e-conhecimento).
- **Dev (21/10, antes da V2)**: migration 154 aplicada em `inia` e `inia_test` (o cadastro veio depois — ver acima). Nada medido com modelo real; nenhum feedback histórico reprocessado; nada publicado.
- **Coordenação**: implementado em paralelo com a sessão "Base de boas práticas" (linguagem simples) na mesma pasta — ela ficou com composição
  V21/prompt V25/verificação V23; estas mudanças com V22/V26/V24.

### Produto em todo feedback (2026-10-22, `PRODUCT_IN_FEEDBACK_V1`)

O que a análise da chamada estabelece sobre o produto agora chega a todo lugar que usa o feedback:
- **Monitoria:** o ponto é dito no pedido dele.
- **Indicador:** a fala de exemplo vem com o produto do pedido e a regra da própria chamada, e a fala do argumentário é a da versão daquela chamada.
- **Colegas e boas práticas:** comparados por produto.
- **"Ouvir com a INIA" e tela:** mostram o produto.
- **Obrigação das boas práticas:** a checagem lê o "Vale para" das fontes.

A regra continua a mesma: só conta o produto ESTABELECIDO. Detalhes em [motor-de-feedback.md](motor-de-feedback.md), [boas-praticas.md](boas-praticas.md) e [experiencia-do-colaborador.md](experiencia-do-colaborador.md).
