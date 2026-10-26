# Produtos e aplicabilidade — `PRODUCT_APPLICABILITY_V1`

Data: 21/10/2026 · migration `154_product_catalog.sql` · módulos `backend/src/modules/product-catalog` e
`backend/src/modules/feedback-engine/domain/product-applicability.ts`.

## O problema

Um mesmo motivo ("segunda via de fatura") existe em produtos diferentes — banda larga, IP dedicado, serviços digitais, SIP, DDR, FWT,
linha analógica, IoT, 0800… — e cada produto pode exigir um procedimento diferente. O motivo não determina o produto: a chamada pode dizer o
produto, dar indícios parciais, envolver vários produtos ou não dizer nada. Antes, uma regra de um produto podia ser cobrada (ou reconhecida)
numa chamada cujo produto ninguém estabeleceu.

**Regra: só se cobra ou reconhece uma regra cuja aplicabilidade está ESTABELECIDA para a solicitação.** Produto não identificado nunca é falha
do colaborador; nunca se escolhe o produto mais frequente; procedimentos de produtos diferentes nunca se misturam.

## Cadastro (Administração › Atendimento com IA › Agentes › Produtos, `/admin/product-catalog`)

Permissão `configuration.manage`; escrita só com escopo da organização inteira (como Domínios de negócio). API `/api/v1/admin/product-catalog`.
Serviço único `product-catalog/application/product-catalog-service.ts` (rota e prova usam o mesmo). Auditoria em `audit_logs`
(`PRODUCT_NODE_*`, `PRODUCT_CRITERION_*`, `PRODUCT_SCOPE_SET`).

**Para que serve**: o mesmo assunto tem orientações diferentes por produto. O cadastro diz à INIA quais bases valem para cada produto e como
reconhecer o produto na chamada, para ela ligar o pedido do cliente à orientação certa. **Bases × produtos não é 1×1**: uma base pode ser
geral (nenhum produto marcado — vale para todos), de um produto só ou de vários; marcar uma categoria vale para os produtos dela.

Termos da tela (21/10, reorganização) × backend: **categoria** = `FAMILY`; **indício** = critério de identificação
(`product_identification_criteria`); **"Confirma o produto"** (com "Confirma quando…") = `CONCLUSIVE` + `conclusiveWhen`; **"Apenas sugere"** =
`INDICATIVE`; **"De onde vem"** = documento da base e/ou referência; **base** = documento da base ou argumentário com
`product_scope_assignments`. Os prompts que vão ao modelo continuam com os termos antigos (contratos versionados — não mudam por renomeação).

Tela (21/10, simplificação): **uma tela só**, sem abas. Lista de produtos por categoria (seta para recolher; produtos menores; nenhum
código técnico — gerado pelo nome por `codeFromName`, travado depois). Cadastro: Nome, Categoria (opcional, criada no próprio seletor —
"Nova categoria…"), "Como o cliente e a operação chamam" (= `description`, lida pela análise no catálogo). No produto: Editar + menu ⋯
(Desativar/Ativar, Excluir); "Bases de conhecimento" (só deste / compartilhada / pela categoria — Adicionar base / Tirar); "Como reconhecer
na chamada" — indício em um passo (O que aparece na chamada, Confirma o produto quando… × Apenas sugere, De onde vem; "Mais detalhes":
outros produtos, situação, exceções, documento, nome na lista, início) com **Salvar e usar** (cria/salva + aprova) ou Salvar como rascunho.
O que falta para usar aparece antes do clique (`clueMissing`, mesma regra de `approvalIssuesOf`). **"Vale para"** de cada base e argumentário
também no editor deles (`ProductScopeField`/`ProductScopeCard`, `product-scope-field.tsx`; só aparece com produto ativo e acesso ao
cadastro), e a lista de bases ganha a coluna "Produtos".

| Registro | Regras |
|---|---|
| `product_catalog_nodes` (tipo, código `^[A-Z][A-Z0-9_]{1,39}$`, nome, descrição, categoria) | produto só dentro de categoria; sem ciclo; código travado quando usado; excluir só sem uso (senão desativar); desativar categoria exige produtos dela desativados |
| `product_identification_criteria` + `_versions` (indícios) | rascunho → aprovado (nunca retroativo — tolerância de 5 min; `effectiveFrom: null` = agora) → substituído; versão aprovada IMUTÁVEL (gatilho); encerrar = deixa de valer agora; reativar = nova versão a partir de agora; excluir só se nenhuma análise usou |
| `product_scope_assignments` (Vale para) | vale a partir de agora; a anterior termina, nunca é apagada nem reescrita (gatilho); sem marcação = todos os produtos |

Componentes: `components/admin/product-catalog/` — `product-directory.tsx` (lista + detalhe), `product-bases.tsx`, `product-clues.tsx`,
`node-form.tsx`, `node-picker.tsx`, `product-scope-field.tsx` (usado também em `admin/knowledge` e `admin/argument-scripts`) e as relações
puras em `catalog-relations.ts` (`basesOf`, `cluesOf`, `scopeKindOf`, `ancestorsOf`, `codeFromName`).

Nada do cadastro vira regex, prefixo ou lista de palavras: o indício é TEXTO que a análise lê. Os exemplos do pedido (899, 6999, quantidade
de dígitos, tronco chave) existem só nos testes, marcados como fictícios.

## Na análise de chamada (mesmo motor, mesmo contrato `OBLIGATIONS_V1`)

**Modo produto** só quando o cadastro VIGENTE NA DATA DA CHAMADA tem critério aprovado ou fonte apresentada com abrangência
(`loadProductCatalogAt` → `productContextOf`). Sem isso, prompt, schema, chaves e resultado são exatamente os de antes.

1. **Seleção das bases** (`document-selection.ts`): documentos com abrangência por produto não competem entre si pela relevância léxica (a
   palavra que aparece na conversa não escolhe o produto) — recebem a mesma relevância e ficam juntos; o catálogo inteiro vai à análise.
2. **Análise** (prompt `CALL_ANALYSIS_PROMPT_V12+PRODUCT_SCOPE_PROMPT_V1`): além do de sempre, recebe metadados (M-n), o catálogo (F-n/P-n)
   e os critérios aprovados (C-n), e as fontes com "vale para os produtos: …". Responde `requests` (Q-n: o que foi pedido, sobre qual objeto
   — conta, contrato, linha, produto, serviço —, status IDENTIFIED | FAMILY_ONLY | MULTIPLE_POSSIBLE | NOT_IDENTIFIED | CONFLICTING, alvos e
   evidências com tipo, trecho literal, critério aplicado + condições, legibilidade do número e RELAÇÃO com o pedido: objeto do pedido, outro
   objeto, hipótese, negação, corrigido depois) e, em cada obrigação, `request` + `productScope` (+ `commonAcrossSources`).
3. **Revisão independente** (`OBLIGATION_REVIEW_PROMPT_V6+PRODUCT_SCOPE_REVIEW_PROMPT_V1`): dá a PRÓPRIA leitura do produto de cada pedido e
   a leitura da abrangência de cada conclusão (`AGREES | DEPENDS_ON_PRODUCT | UNCLEAR`). Conclusão que já depende de produto não estabelecido
   pela análise não vai à revisão (a revisão só pode tornar a identificação mais restrita).
4. **Código** (`product-applicability.ts`, chamado por `verifyObligationAnalysis` ANTES da decisão da revisão): integridade (trecho literal,
   metadado e critério apresentados, critério aprovado e vigente), o que cada evidência PODE provar pelo tipo declarado e pelo cadastro —
   fala do cliente, metadado ou critério CONCLUSIVO com condições lidas como cumpridas e número legível ESTABELECEM; fala do operador, contexto,
   critério indicativo, número incerto (ou turno com marca de perda) e procedimento executado só INDICAM; a mesma fala do operador que é conduta
   de uma regra dependente de produto é circular —; produtos possíveis = interseção do que as evidências estabelecem (vazia = conflito); fica a
   leitura MAIS RESTRITA entre código, análise e revisão (pedido sem leitura da revisão = nada estabelecido).
5. **Efeito por regra**: abrangência = cadastro das fontes (interseção; união só com `commonAcrossSources`), estreitada pela leitura do texto e
   pela revisão (nunca alargada). `INDEPENDENT` (vale para qualquer produto) · `ESTABLISHED` (os possíveis estão todos na abrangência — basta a
   família quando ela determina a regra) · `OTHER_PRODUCT` (nenhum possível está na abrangência → NOT_APPLICABLE) · `SUSPENDED` (o resto:
   NOT_OBSERVABLE, aplicabilidade incerta, sem orientação, motivo `PRODUCT_APPLICABILITY_NOT_ESTABLISHED`). Fontes de produtos diferentes
   misturadas sem `commonAcrossSources` = abrangência incerta (suspensa).
6. **Desfecho**: nada útil sobra por causa do produto → `INSUFFICIENT_EVIDENCE` com `PRODUCT_NOT_ESTABLISHED` (o "Gerar feedback" se abstém com
   esse motivo); com pontos independentes → `PARTIAL` + `PRODUCT_DEPENDENT_POINTS_SUSPENDED`.

Lógica `CALL_ANALYSIS_LOGIC_V19` (sem catálogo, o resultado é o da V18; as respostas pagas são reaproveitadas pela assinatura do pedido).

### V2 (21/10/2026, a pedido do usuário) — `PRODUCT_APPLICABILITY_V2`, lógica `CALL_ANALYSIS_LOGIC_V20`

- **Fala do operador + contexto do cliente** (`withOperatorContext`): na operação, o operador nomeia o produto e o cliente dá o contexto
  (conta, linha, "a da minha casa"). A fala do operador que diz ou confirma o produto passa a SUSTENTAR quando o mesmo pedido tem
  contexto do cliente — fala dele, dado que ele informou ou metadado, que sustente ou só indique — e TODO esse contexto é compatível
  (aponta, entre outros, para o produto que o operador disse). Sozinha (o cliente não disse nada sobre o produto), continua só
  indicando: as regras do produto ficam sem avaliação, nunca viram erro. Não vale para a fala circular (a própria conduta avaliada),
  transcrição incerta, outro objeto ou procedimento executado. Contexto do cliente incompatível = vale o do cliente. Motivo gravado:
  `OPERATOR_WITH_CUSTOMER_CONTEXT`. Prompts `PRODUCT_SCOPE_PROMPT_V2` e `PRODUCT_SCOPE_REVIEW_PROMPT_V2` dizem o mesmo à análise e à
  revisão (a leitura mais restrita das três continua valendo).
- **Números com o formato preservado** (`SUBJECT_PII_MASK_V2`, `maskPreservingFormat`): a transcrição para a IA mantém DDD + 1º dígito
  do telefone e os 3 primeiros dígitos + a quantidade dos números longos (contas, LP); os prompts de produto explicam que o formato
  visível é confiável e que dígito escondido nunca é adivinhado. Sem isso, os indícios de formato (fixo × móvel) e de prefixo não
  tinham o que ler (o telefone virava `[TELEFONE]`). O colaborador e a liderança veem as citações já mascaradas.
- **"Depende do produto" no feedback**: com produto não estabelecido, a análise traz a obrigação de CADA fonte dos produtos possíveis
  sobre o mesmo ponto; o brief agrupa as regras suspensas pelos produtos da abrangência (`productScope.byProduct`, nomes do cadastro
  gravado) e a visão do feedback ganha, em "Vale confirmar", um bloco montado pelo sistema com o texto LITERAL de cada fonte ("A
  chamada não deixou claro qual era o produto… não contam como erro nem como acerto. O que o procedimento de cada produto pede:"). Nunca
  passa pelo redator; o verificador continua recusando frase que cobre ou oriente essas regras. O feedback continua acontecendo com os
  processos comuns a todos; sem nenhum ponto avaliado, a abstenção `PRODUCT_NOT_ESTABLISHED` continua.
- **Correção**: aprovar indício sem data mandava `effectiveFrom: null`, que virava 01/01/1970 e era recusado como retroativo
  (`z.coerce.date()` com `null`); agora `null` = a partir de agora. A prova de banco passou a mandar `null` como a tela.

### V2.1 (21/10/2026, depois da avaliação das 15 chamadas) — `PRODUCT_APPLICABILITY_V2_1`, lógica `CALL_ANALYSIS_LOGIC_V21`

Correções saídas da primeira avaliação real do cenário TESTE PRODUTOS (abaixo); todas estruturais, nenhuma por palavras:

- **Produto + a categoria dele na mesma leitura = o produto** (`mostSpecificHandles`, nas evidências sem critério cadastrado e nos alvos
  declarados pela análise e pela revisão). "Os ramais do DDR" lido como [DDR, Voz Avançada] somava as folhas da categoria e virava "SIP
  ou DDR" (só a categoria); a categoria só fica quando nenhum produto dela está na mesma lista.
- **Evidência só com o turno** (`quoteFromTurn`): o modelo às vezes aponta o turno e não copia o trecho (a revisão fazia isso com
  frequência) e a evidência caía como `NO_QUOTE` — a leitura mais restrita derrubava o produto para "não identificado". Agora o trecho é
  o turno inteiro, tirado da gravação pelo código (o falante é o do turno, não o declarado). Sem turno continua `NO_QUOTE`.
- **Corroboração entre os leitores** (`corroborated`): uma evidência que estabelece só continua estabelecendo quando a outra leitura
  independente também estabelece, pelo MESMO turno (ou metadado), algo compatível. Cada leitor "achando" o produto numa fala diferente
  só indica (`NOT_CORROBORATED_BY_OTHER_READER`, motivo do pedido `ESTABLISHING_EVIDENCE_NOT_CORROBORATED`). Nas 13 chamadas
  corretas os dois leitores sempre compartilharam um turno; na SV05 cada um usou uma fala diferente.
- **Prompts `PRODUCT_SCOPE_PROMPT_V3` / `PRODUCT_SCOPE_REVIEW_PROMPT_V3`**: `supports` = só o que AQUELE trecho aponta por si (nome ou
  apelido, dado lido por um indício, descrição que só cabe no produto); característica do cliente (empresa, pessoa física, ramo, porte)
  ou falar só "da conta" não aponta produto nem categoria, salvo indício cadastrado; o produto que só o operador disse nunca vai para o
  trecho do cliente; regra que vale para todos os produtos nunca junta com a de um produto numa obrigação (junto, ela ficava sem
  avaliação enquanto o produto não se estabelece — o código registra `GENERAL_WITH_PRODUCT_SOURCES` quando acontece). `turn`
  obrigatório no schema da evidência (nulo só para METADATA).

### V3 (21/10/2026, decisão do usuário) — o operador dizer o produto basta — `PRODUCT_APPLICABILITY_V3`, lógica `CALL_ANALYSIS_LOGIC_V22`

"Se o operador fala o produto, deve ser considerado que o atendimento é para aquele produto" — o objetivo é associar a chamada ao produto
e, por ele, à base de conhecimento. Substitui a regra da V2 de que a fala do operador sozinha só indicava.

- A fala do operador que DIZ ou CONFIRMA o produto do pedido estabelece o produto (`OPERATOR_NAMED_PRODUCT`), também quando é a mesma
  fala em que ele executa o procedimento ("vou enviar a segunda via do seu X…").
- Continua não valendo: pergunta, hipótese ou negação do operador ("é o X ou o Y?"); procedimento executado SEM dizer o produto; número
  ou contexto lido pelo operador na fala da conduta (circular); transcrição incerta.
- O que o CLIENTE disse apontando para outro produto prevalece: a fala do operador não é promovida (fica o que o cliente estabeleceu, ou
  nenhum). A corroboração entre análise e revisão (mesma fala) continua valendo.
- Prompts `PRODUCT_SCOPE_PROMPT_V4` / `PRODUCT_SCOPE_REVIEW_PROMPT_V4`. "Depende do produto" continua para quando ninguém diz o produto.
- Validação: SV05 (só a operadora diz "SIP") → SIP, pelos dois leitores na mesma fala; regras gerais e de Voz Avançada avaliadas
  (~US$ 0,26). Replay sem custo das demais: nenhuma mudou.
- **Confirmação, "achei aqui" e vários produtos** (mesma versão V4 dos prompts, antes do commit):
  - pergunta de sim ou não do operador que o cliente CONFIRMA ("é a sua banda larga?" → "É sim") = o cliente confirmou o produto
    (evidência do cliente, na resposta); "não sei" ou "não" não confirma;
  - depois de pergunta não confirmada, "achei aqui", "localizei" sem dizer o que achou não estabelece produto nenhum;
  - a mesma ligação pode ter pedidos de produtos diferentes: cada evidência vai para o pedido do objeto a que se refere (o produto de
    um pedido não passa para outro, salvo mesmo objeto); regra de produto sempre com o `request` do pedido desse produto (nunca
    `null` com mais de um pedido) e uma obrigação por pedido; a mesma conduta pode estar certa para um produto e errada para o outro;
  - regra geral que só manda "seguir o procedimento do produto" depende do produto (productScope = as famílias): sem produto fica
    suspensa, nunca vira erro.
- Chamadas de teste novas (`chamadas-extras.ts`, depois das 15 primeiras na fila): SV09 (celular + "a outra de casa", confirmada com
  "É sim"; procedimento da Banda Larga usado no celular) e SV10 ("É o SIP?" → "Não sei" → "Achei aqui"). Resultado real (~US$ 1,17 em
  4 rodadas): SV09 → Q1 Linha Móvel, Q2 Banda Larga nas duas rodadas, regra de cada produto só no pedido dele, "valor e vencimento"
  ligado ao pedido certo depois do ajuste; SV10 → não identificado nas duas, regras dos produtos suspensas, "siga o procedimento do
  produto" deixou de ser cobrada.
- **Fora de produto, ainda em aberto (regra do motor)**: numa obrigação MISTA (falar + executar no sistema), se a revisão marca
  `outsideDependency`, `obligationReadingOf` (`call-review.ts`) não confirma a conclusão, mesmo quando o que se julga é só a parte dita
  ("informar o canal e o prazo"). Na 1ª rodada da SV09 o erro plantado (procedimento da Banda Larga no celular) foi cobrado; na 2ª a
  revisão marcou a dependência e ele virou "não observável". Vale para toda monitoria — RESOLVIDO em 22/10 no prompt da revisão (V7):
  em MIXED a marca é sobre a parte dita; contrariar canal/prazo fixados pela fonte não depende de fora (ver memória do motor).

## Cenário de teste no desenvolvimento (TESTE PRODUTOS, 21/10/2026)

`backend/scripts/dev/larissa-scenario/produtos/` — conteúdo FICTÍCIO para testar o cadastro de ponta a ponta (e base dos prints da
IT-INIA-005 v2.0). `conteudo.ts` tem o mapa das regras por produto (chaves S1…, LA1…, RVS3…); `chamadas-segunda-via.ts` e
`chamadas-reparo.ts`, as 15 chamadas da Larissa Monteiro com o produto que a INIA deve concluir e as falhas plantadas.

- Configuração pela API (`--configurar`): categoria Soluciona TI + produto Vivo Soluciona TI; 20 bases publicadas (segunda via e reparo;
  "Vale para" geral, por categoria, por produto e por vários produtos de categorias diferentes); 6 argumentários publicados; agentes
  "TESTE PRODUTOS · Especialista de segunda via" (Faturamento) e "… de reparo" (Suporte Técnico), cada um ligado SÓ às bases do seu
  processo; workflows MANUAIS publicados "TESTE PRODUTOS · Feedback de segunda via (manual)" e "… de reparo (manual)" (agente →
  Gerar feedback → Acompanhamento). Tudo com alcance só no subgrupo "Diagnóstico IA — Operadores com gravações".
- Chamadas (`--chamadas`): direto no banco, ids determinísticos, sem ingestão (nada dispara sozinho), com horário LOGO DEPOIS da
  configuração — o motor lê cadastro, bases e argumentários vigentes na hora da chamada e nada é retroativo; o comando recusa se as
  chamadas ainda não tiverem "terminado".
- `--reset` remove chamadas (as não analisadas), workflows, agentes, argumentários e bases do cenário (o produto fica).
- O motor lê as bases LIGADAS AO AGENTE do workflow (não pelo assunto); argumentários entram pelo escopo (grupo/subgrupo).
- `avaliar.ts`: avalia as chamadas SEM GRAVAR NADA (banco só de leitura, memória em camada, composição bloqueada). Modo `replay`
  (padrão, sem custo) reaplica a lógica atual às respostas já pagas — valida mudança de CÓDIGO; `--modo revisao` (só a revisão vai ao
  modelo) e `--modo completa` (análise + revisão) avaliam UMA chamada, salvam as respostas pagas e aceitam `--respostas` no replay.

### Resultado da avaliação (21/10/2026)

Primeira rodada pelos workflows (lógica V20, prompts V2): 15 chamadas, ~US$ 4,27 (análise ~US$ 3,58); 5 identificações certas, 5
perdidas por `NO_QUOTE`, 3 só com a categoria, 1 lida errada (SV05), RP06 sem análise (4 falhas/timeout do provedor, marcada `dead`).
Nenhuma regra de produto virou erro indevido; erros plantados cobrados: 2 de 11.

Depois da V2.1 (replay sem custo das respostas gravadas + ~US$ 0,81 pagos em 4 chamadas, uma por vez — revisão da RP03 e da SV06, duas
análises completas da SV05): 14 de 14 identificações como o esperado (a SV05 com o prompt V3; com as respostas antigas do prompt V2 os
dois leitores leem "conta da empresa" como SIP). Erros plantados cobrados: 9 de 11 (LA1, S2, RLM2, RLM3, RVS2, R4 da RP05, RDDR2 + R4
da RP03, SIP1); ficaram de fora R4 na RP02 e RVS1 na RP05 (o modelo disse "não se aplica" — leitura da conduta, não de produto).
Nenhuma regra de produto virou erro indevido. As avaliações gravadas no banco (e os feedbacks entregues) continuam as da primeira rodada:
nada foi reprocessado.

Segunda rodada real (21/10/2026, depois do commit da V2.1; ~US$ 1,75, uma chamada por vez, `avaliar.ts --modo completa`, prompts V3):

| Chamada | Esperado | Resultado | Regras |
|---|---|---|---|
| RP06 | conflito (internet × conta 699) | CONFLICTING Banda Larga/SIP | regras de Banda Larga, SIP e Voz Avançada suspensas; nenhuma cobrada |
| SV04 | Linha Móvel | IDENTIFIED Linha Móvel | achou uma falha PARCIAL que o roteiro não previa (regra geral 4: "oriente a atualizar o cadastro"; ela orientou a encaminhar) — roteiro corrigido |
| RP03 | DDR | IDENTIFIED DDR | RDDR2 + R4 cobrados |
| RP05 | Vivo Soluciona TI | IDENTIFIED Vivo Soluciona TI | RVS2 + R4 cobrados; suporte remoto lido como inviável (notebook não liga) — o roteiro tinha plantado RVS1 por engano e foi corrigido |
| SV05 | não identificado (regra até a V2.1) | NOT_IDENTIFIED (3ª rodada) | a revisão de novo leu "conta da empresa" como SIP; a corroboração barrou. Pela V3 o esperado passou a SIP (ver acima) |

- **Teto de saída** (`engine-meter.ts`): a RP06 nunca tinha sido analisada porque a análise raciocinou 23,6 mil tokens e parou no teto
  (24.576, saída + raciocínio) — e outras duas análises do cenário pagaram em dobro pelo mesmo motivo. `CALL_ANALYSIS` → 32.768 e
  `CALL_REVIEW` 12.288 → 24.576 (a revisão do conflito também foi cortada). Com os tetos novos, as duas etapas da RP06 terminaram.
- **Ainda acontece — regra geral junto com a de um produto**: em 2 de 3 rodadas da SV05 o modelo juntou "valide o titular" (geral) com
  "confirme o CNPJ e o nome do gestor" (Voz Avançada), apesar do prompt V3; com o produto não estabelecido, a geral fica sem avaliação
  (nunca vira erro; `GENERAL_WITH_PRODUCT_SOURCES` no registro). Quando a regra geral depende do produto ("prazo do produto", "testes
  do produto"), juntar é o certo. Desde a V3 só pesa quando NINGUÉM diz o produto (com o produto estabelecido, a obrigação é avaliada).
- **Argumentários antigos sem "Vale para"** no dev ("Internet fixa: equipamento e luzes", "Problema técnico no serviço fixo — suporte e
  acompanhamento de reparo", "Franquia de internet…", alcance em todos os grupos) valem para qualquer produto, como manda a regra, e
  entram em toda análise do escopo: na RP06 cobraram perguntas de modem; na RP03 (DDR), "acompanhar pelo aplicativo". Correção de
  cadastro, não do motor — FEITA em 21/10 pela API da tela (auditada, vigente a partir de 21:22, sem efeito retroativo): 8 de suporte
  móvel/franquia/roaming → categoria Móvel; "Internet fixa" ×3 e "Wi-Fi e navegação fixa" → Banda Larga; "Link dedicado" ×3 → IP
  Dedicado; "Problema técnico no serviço fixo" → categoria Fixa Básica (mantido por decisão do usuário em 22/10). Ficam GERAIS, por
  decisão do usuário (22/10): "Segunda via de fatura ou parcelamento — consulta pelo aplicativo", "Serviço bloqueado — pagamento com
  cartão…", "Serviço bloqueado após pagamento…", "Contas em atraso — Vivo em Dia" e "Procedimento com impacto na Caixa Postal" — são de
  processo, não de produto (empresas também usam aplicativo e compram produtos básicos). Critério: "Vale para" só quando o conteúdo é de
  um produto; processo ou tipo de cliente fica geral. As cobranças do argumentário de segunda via nas SV09/SV10 (confirmar fatura ×
  parcelamento, orientar pelo aplicativo) estavam corretas pelo texto dele.


### Exceção por produto dentro de uma base geral (teste real de 22/10/2026)

Pergunta do usuário: um processo de segunda via vale para todos os produtos do "grupo A" e abre uma exceção para o VSTI (canal Y). A INIA
entende as duas metades — a exceção vale para o VSTI e o fluxo geral NÃO vale para ele? Teste em `excecao.ts` / `excecao-conteudo.ts`
(base "processo do grupo A" com "Vale para" Fixa Básica + Soluciona TI, seção "Exceção — Vivo Soluciona TI": os itens 2–4 do fluxo geral
não valem, encaminhar à Central de Contratos TI em até 5 dias úteis; agente de teste ligado só a ela; chamadas EX01–EX03 posteriores à
base). Resultado com o modelo real, uma rodada por chamada (~US$ 0,79), sem mudança de código:

| Chamada | O que a operadora faz | Resultado |
|---|---|---|
| EX01 — VSTI | segue a exceção (certo) | VSTI; exceção reconhecida (o encaminhamento em si, no sistema, fica "não observável"); os itens 2–4 do fluxo geral nem viram obrigação (não valem para o VSTI); titular e protocolo reconhecidos |
| EX02 — VSTI | segue o fluxo geral (errado) | VSTI; exceção COBRADA; o fluxo geral não é reconhecido como acerto |
| EX03 — Banda Larga | segue o fluxo geral (certo) | Banda Larga; itens 1, 2, 3 e 5 reconhecidos (lidos como "valem para a Fixa Básica" — o grupo sem o VSTI); exceção não se aplica |

- A leitura é do modelo (a abrangência pelo texto da seção), não do cadastro: funcionou nas três, mas é uma rodada por chamada.
- A exceção escrita numa BASE não vale para um ARGUMENTÁRIO geral que trata do mesmo ponto: na EX01 o argumentário geral de teste
  ("confirmar o canal cadastrado antes de enviar") foi cobrado num VSTI, onde o canal é a Central; na EX02 o modelo tirou sozinho os
  itens conflitantes ("a exceção do procedimento se sobrepõe"). Para não depender disso, o argumentário que trata do mesmo ponto precisa
  da mesma exceção no texto ou de um "Vale para" que deixe o produto de fora.

## Composição e verificação (`FEEDBACK_COMPOSITION_V22`, prompt V26, verificação V24)

Regra suspensa nunca vira ponto de desenvolvimento, reconhecimento nem ponto em aberto (orientar sobre ela misturaria produtos): fica como
limite de cobertura `PRODUCT_NOT_ESTABLISHED`. O redator e o verificador recebem `productScope` como FATO: o produto estabelecido (nome do
cadastro), quantos pedidos ficaram sem produto e o texto literal das regras suspensas. Afirmar produto não estabelecido = UNSUPPORTED_ADDITION;
cobrar, orientar ou reconhecer regra suspensa (inclusive "da próxima vez") ou tratar o produto não confirmado como falha = OVERREACH — a frase
sai. Ponto central suspenso → nota neutra ao colaborador em "Para entender este retorno" (nenhum detalhe de auditoria na mensagem).

## Rastreabilidade (memória)

- `call_assessments.product_identification` (jsonb) e `feedback_analysis_runs.result.productApplicability`: fotografia — catálogo usado (nós,
  versões dos critérios com hash, abrangências), por pedido as leituras da análise e da revisão, o status final, os produtos possíveis, cada
  evidência com origem (`RECORDING` | `SYSTEM_METADATA`), papel e motivo, conflitos e limitações, e o efeito em cada regra (antes/depois).
  Números longos ficam só com os 4 primeiros dígitos (`maskIdentifiers`) — a transcrição continua sendo a fonte; nada é logado.
- `call_criterion_assessments.verification.productApplicability` por regra.
- Mudança posterior no cadastro (renomear, desativar, nova versão de critério, nova abrangência) não muda nenhuma análise gravada; uma análise
  nova da mesma chamada usa o cadastro como valia NA DATA da chamada (nada é retroativo).

## Liderança e Resultados

- Diagnóstico › detalhe da chamada: selo por pedido no topo, contagem "dependem do produto", grupo próprio "Sem avaliação — depende do
  produto" (nunca em "Sem conclusão" nem em desvios), nota em cada ponto e, na aba Cenário, "Produto do atendimento" com as evidências, o
  critério (versão, conclusivo/indicativo), por que só indicou, a limitação do número e as regras que ficaram sem avaliação ou não se aplicam.
- Resultados do Workflow: o detalhe da abstenção mostra o motivo em palavras.

## Chat

- Chat de quem atende: o esclarecimento pelas bases já perguntava o produto quando as bases diferem (prompt `KNOWLEDGE_CLARIFICATION_PROMPTS_V3`
  acrescenta: nunca pedir número completo de conta/contrato/linha/protocolo/documento quando o nome basta).
- Conversa sobre um feedback ("Ouvir com a INIA" e dúvidas): o registro publicado leva `product` (o que a gravação estabeleceu e os pontos
  pendentes). Quando o produto ficou indefinido — e só então —, a sessão usa o MESMO esclarecimento pelas bases, com o registro como contexto: a
  IA pergunta só se a orientação pedida depende do produto; a resposta orienta a conversa, é apresentada como "o que você informou" e fica
  gravada em `tool_calls` com escopo `FEEDBACK_SESSION` e procedência `CHAT_CONFIRMATION` (o monitoramento de conversas mostra a marca). Nada da
  conversa volta para a análise da chamada nem muda o feedback publicado. Sem orquestrador, o modelo da sessão segue a regra
  `PRODUCT_CONFIRMATION_RULE` (texto), sem formulário.

## Provas

- `feedback-engine/domain/product-applicability.test.ts` (29 cenários, zero IA): produto explícito, paráfrase, negação, família, identificador
  compatível com dois produtos, ausência com avaliação independente, abstenção, dois produtos/duas solicitações, outro contrato/hipótese,
  leitura adversarial, correção posterior, conflito com regra comum, número cortado/reconstruído/parcial, critério fora da vigência, procedimento
  executado e circularidade, fala do operador sozinha, revisão que não confirma/não lê/estreita/incerta, leitura nunca alarga o cadastro, visão
  da liderança, mascaramento, contrato sem catálogo idêntico e prova estrutural (nenhum produto/prefixo no código).
- `feedback-engine/application/product-applicability-pipeline.test.ts`: caminho completo com modelo falso — contrato com produto, revisão,
  memória, brief, verificador barrando frase que cobra regra suspensa, abstenção rastreável, sem catálogo idêntico.
- `product-catalog/domain/product-catalog.test.ts`; prova de banco `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run product-catalog-proof`.
- Chat: `realtime-router-feedback-product.test.ts`, `knowledge-clarification/application/feedback-session-clarification.test.ts`,
  `feedback-application/domain/product-confirmation.test.ts`.
- Frontend: `product-catalog-page.test.tsx`, `call-assessment-product.test.tsx`, `admin-sidebar.test.tsx`.

## Limitações conhecidas

- Nada foi medido com modelo real: a qualidade da identificação (leitura de negação, hipótese, outro contrato, condição do critério) depende
  da análise e da revisão; o código só aplica consequências e integridade.
- Metadado registrado (assunto/motivo/submotivo) conta como evidência que estabelece quando a leitura o liga ao pedido — na operação, ele pode
  ser tabulado pelo próprio operador.
- Com o mascaramento de PII ligado, só CPF pontuado vira `[CPF]`; 11 dígitos sem pontuação mantêm o formato (3 primeiros + quantidade).
  Indício que dependa de um dígito além dos 3 primeiros (ou do DDD + 1º dígito no telefone) não tem o que ler: fica como limitação.
- O bloco "Depende do produto" só fica completo quando a análise traz a regra de cada produto possível (pedido no prompt V2); uma regra
  que a análise não listou não aparece.
- Itens do catálogo não têm versão própria (só critérios e abrangências); a fotografia da análise guarda o que valia.
- Pela voz, a sessão de feedback segue a regra em texto (sem formulário de esclarecimento por produto).
- Nenhum feedback histórico foi reprocessado; nada foi publicado no Azure.
