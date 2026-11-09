# Central de Dados: consultar dados

Aba **Consultar dados** em `/admin/data-hub?tab=explore`. Consulta visual e somente leitura dos dados importados e dos gerados pela aplicação, com exportação CSV. Não existe SQL livre. Nos conjuntos aprovados, quem tem permissão própria também pode [cancelar registros](#cancelar-registros): é a única ação que altera dado, e não passa pela sessão da consulta.

Código: `backend/src/modules/data-explorer` (rotas em `/api/v1/admin/data-explorer`) e `frontend/src/components/admin/data-hub/explorer`. Migrations: `173_data_explorer_indexes.sql` e `174_data_record_cancellations.sql`.

## Quem acessa

Permissão própria `data_hub.explore`, conferida no `app.ts` na frente do router inteiro, sempre com escopo de organização. Só dois papéis a têm:

| Papel | Conjuntos |
| --- | --- |
| Administrador geral | todos os 22 |
| Administrador de dados | 19. Ficam de fora **Uso de IA** (exige `ai.view`), **Casos de supervisão** e **Feedbacks** (exigem `indicators.view`), permissões que este papel não tem |

O papel `ADMINISTRADOR` não acessa, mesmo com escopo de organização. Sem a permissão, a resposta é 403 e a tentativa fica registrada, uma linha por conta a cada 10 minutos. Conjunto com permissão própria responde 404 para quem não a tem, igual a um conjunto que não existe: caso e feedback ligam uma pessoa à situação do acompanhamento dela, e a consulta não pode ser um caminho lateral para isso.

## O que está liberado

A lista permitida fica em código: `domain/explorer-datasets-imported.ts` e `domain/explorer-datasets-generated.ts`. Nada é descoberto no banco. Incluir um conjunto ou uma coluna é uma alteração revisada, e `explorer-catalog.test.ts` só aceita tabelas de uma lista fixa e recusa uma lista de colunas proibidas.

**Importados (14):** Colaboradores, Grupos, Subgrupos, Interações, Transcrições (só dados da carga), Flags das interações, Medições de indicador, Fechamento oficial por indicador, Fechamento oficial de PRV, Metas, Jornadas, Escalas de trabalho, Exceções de escala, Situação funcional por período.

**Gerados pela aplicação (8):** Casos de supervisão, Feedbacks, Workflows (inclusive os excluídos), Execuções de Workflow, Execuções de Agents, Uso de IA, Cargas da Central, Rejeições das cargas.

### Decisões sobre dado pessoal

| Regra | Como é aplicada |
| --- | --- |
| Nome da pessoa só em Colaboradores | Nos demais conjuntos, só a matrícula, a chave que as próprias cargas usam. Exceção: **Excluído por**, em Workflows, usa o nome quando quem excluiu não tem matrícula, porque é conta administrativa e a coluna ficaria vazia |
| Afastamento sensível (INSS, maternidade, paternidade) | Sai como `AFASTAMENTO_PROTEGIDO`. A máscara está na expressão SQL, então vale para exibir, filtrar, ordenar e exportar. O valor real não é aceito como filtro. Mesma regra de `leaveTypeVisible`: fora da cadeia de gestão, o tipo não aparece |
| Atestado | Sai como `MOTIVO_PROTEGIDO`, nas mesmas condições |
| Texto bruto da fonte | Fora: `raw_status`, `raw_reason`, `source_reference` |
| Transcrição | Só protocolo, matrícula, versão, idioma, confiança, tamanho e data. O texto nunca sai, porque tem dado pessoal de clientes |
| Conteúdo gerado | Fora: texto, indicador impactado, evidência e recomendação do feedback; título, resumo e causa raiz do caso (a IA escreve e cita a conduta da pessoa ou o caso do cliente); entrada, saída e erro de IA; saídas dos nós e variáveis de Workflow; quem pediu a chamada de IA |
| Rejeições das cargas | Fora a chave e a mensagem: repetem o tipo de afastamento e o texto bruto da fonte. Ficam carga, linha, campo e código, e o detalhe continua na tela da carga |
| Caso aberto por política | O indicador sai como `POLITICA_DE_ACOMPANHAMENTO`, sem a chave da política |
| Contas e credenciais | Nenhuma tabela de conta, papel, sessão, segredo ou token. Nenhum e-mail |
| Fora da lista | Conversas com a INIA, avaliações e contestações de feedback, intervenções e avaliações de política: têm permissão e separação de funções próprias |

Colunas com dado pessoal são marcadas na tela e aparecem em `personalColumns` na auditoria. `personal_data_access_log` não é gravado: ele registra a abertura de transcrição, conversa ou ficha de uma pessoa, e a consulta não abre nenhuma delas. A leitura em lote fica em `audit_logs`, por conjunto.

## Limites

Lugar único: `domain/explorer-limits.ts`, com variáveis `DATA_EXPLORER_*` em `config/env.ts`. Os limites que têm variável têm também um teto, que impede configurar "sem limite". Acima do limite a resposta é uma recusa com mensagem clara, nunca um resultado reduzido em silêncio.

| Limite | Valor inicial | Variável (teto) |
| --- | --- | --- |
| Registros por página, padrão | 25 | `DATA_EXPLORER_DEFAULT_PAGE_SIZE` (100) |
| Registros por página, máximo | 100 | `DATA_EXPLORER_MAX_PAGE_SIZE` (200) |
| Colunas por consulta | 30 | fixo |
| Condições / níveis de grupo / itens em lista | 12 / 3 / 50 | fixos |
| Tamanho de valor de filtro / da busca | 200 / 2 a 100 caracteres | fixos |
| Tempo de uma consulta ou contagem | 5 s | `DATA_EXPLORER_QUERY_TIMEOUT_MS` (15 s) |
| Espera por trava | 1 s | fixo |
| Teto da contagem | 10.000, depois responde "mais de" | `DATA_EXPLORER_COUNT_CAP` (100.000) |
| Consultas simultâneas, por conta / por organização | 2 / 4 | fixos |
| Consultas e contagens por minuto, por conta / por organização | 30 / 120 | `DATA_EXPLORER_QUERIES_PER_MINUTE` (300) / `..._ORGANIZATION` (1.200) |
| Leitura de metadados por minuto, por conta | 120 | fixo |
| Exportação: linhas / tamanho / tempo total | 20.000 / 20 MB / 60 s | `DATA_EXPLORER_EXPORT_MAX_ROWS` (100.000) / `_MAX_BYTES` (100 MB) / `_MAX_DURATION_MS` (300 s) |
| Exportações simultâneas, por conta / por organização | 1 / 2 | fixos |
| Exportações a cada 10 min, por conta / por organização | 5 / 15 | `DATA_EXPLORER_EXPORTS_PER_10_MINUTES` (60) / `..._ORGANIZATION` (200) |
| Registros por cancelamento | 10.000, acima disso é recusado, nunca feito em parte | `DATA_EXPLORER_CANCEL_MAX_ROWS` (100.000) |
| Registros marcados na tela por cancelamento | 100 | fixo |
| Tempo de cada comando / espera por linha travada, ao cancelar ou reativar | 30 s / 5 s | fixos |
| Cancelamentos simultâneos, por organização | 1 | fixo |
| Cancelamentos e reativações a cada 10 min, por conta / por organização | 10 / 30 | `DATA_EXPLORER_CANCELLATIONS_PER_10_MINUTES` (60) / `..._ORGANIZATION` (200). Prévias e lista de lotes contam como consultas |

Concorrência e frequência são contadas no PostgreSQL, então valem somando todas as APIs (ver [escala-e-operacao.md](memoria/escala-e-operacao.md)). O limite por conta vem antes do guard, para a tentativa negada também contar; o da organização vem depois, para uma conta sem permissão não esgotar o limite de quem tem.

## Como a consulta roda

1. O guard confere a sessão e a permissão no banco, a cada pedido.
2. `explorer-query.ts` valida o corpo. Campo desconhecido é recusado, inclusive `organizationId`. Conjunto, coluna, operador e ordenação só valem se existirem nos metadados; cada valor é conferido pelo tipo da coluna.
3. `explorer-compiler.ts` monta o SQL só com trechos fixos do catálogo. Todo valor vai como parâmetro, e a organização, vinda da sessão, é sempre `$1`.
4. `read-only-session.ts` abre uma transação `READ ONLY` e aplica os limites dentro dela: `statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout`, `work_mem` e nenhum worker paralelo. As vagas são travas consultivas de transação (`pg_try_advisory_xact_lock`): sem vaga, recusa na hora; se o processo cair, a vaga volta sozinha.
5. A resposta só sai depois de gravar em `audit_logs`. Sem registro, sem dado.

**Paginação:** por posição (coluna de ordenação + `id`), nunca OFFSET. Conjunto grande só ordena por coluna obrigatória da tabela principal, com índice (`explorer-catalog.test.ts` e a prova com `enable_sort = off` conferem).

**Busca:** só nos campos marcados. Em conjunto grande, só por igualdade; `ilike` só nos conjuntos limitados pelo tamanho da organização.

**Contagem:** só quando a pessoa pede, com teto. Nunca conta a tabela inteira.

**Cruzamentos:** não há junção escolhida pela pessoa. Cada conjunto tem junções N:1 fixas, que trazem rótulos como matrícula, indicador e Grupo e nunca multiplicam linhas, e toda junção confere a organização. Cruzamentos livres ficaram fora: aumentam o risco de consultas sem limite e de combinar dados que, separados, não identificam ninguém.

## Exportação CSV

Em fluxo, pela mesma lista permitida: um cursor do banco lido em lotes de 500, numa transação `REPEATABLE READ READ ONLY`, sem acumular em memória. UTF-8 com BOM, separador `;`, decimal com vírgula e instantes no fuso da organização.

Antes da primeira linha, duas conferências ainda podem responder com erro claro: o total com teto (acima do limite, 422 pedindo para restringir os filtros) e o registro de início na auditoria.

Depois de começar, se passar do tamanho ou do tempo, ou se o navegador parar de baixar, a conexão é cortada e o navegador acusa a falha. Nunca sai um arquivo incompleto que pareça completo. A auditoria registra o motivo.

Texto iniciado por `=`, `+`, `-`, `@`, inclusive depois de espaços ou caracteres de controle e nas variantes de largura total, recebe um apóstrofo. O mesmo vale depois de `,`, `;`, `|`, tabulação ou quebra de linha dentro do texto: um Excel com lista por vírgula partiria `Fulano,=1+1` em duas células, e as aspas do CSV não protegem nesse leitor. Só a coluna do tipo número fica de fora, depois de conferida como número.

**Sem processamento em segundo plano:** com N APIs e M workers, um arquivo temporário precisaria de armazenamento compartilhado, e a instalação não tem um. Guardar arquivos grandes no PostgreSQL pesaria mais que o benefício. Por isso a exportação tem limite e pede filtros mais restritos. Não há arquivo temporário.

## Cancelar registros

Levantamento que motivou a função: [central-de-dados-cancelamento-varredura.md](central-de-dados-cancelamento-varredura.md).

O registro cancelado continua no banco, aparece riscado e marcado como **Cancelado** na consulta e sai de toda a lógica. Vale para **Medições de indicador**, **Metas**, **Fechamento oficial por indicador** e **Fechamento oficial de PRV**. Pessoas, Grupos, situação funcional, feedbacks, casos, execuções, uso de IA e cargas nunca são canceláveis.

**Permissão:** `data_hub.cancel_records`, separada de consultar, só para Administrador geral e Administrador de dados, com escopo de organização. Sem ela, a tela nem recebe as chaves dos registros.

**Como funciona no banco:** cada tabela passou a se chamar `<nome>_all`, e o nome antigo é uma visão que esconde o cancelado. Quem lê não precisa lembrar de filtrar, nem hoje nem no futuro. Usam `_all` de propósito só a carga, a consulta e as 12 leituras de histórico que buscam a medição pelo id. `record-cancellation-guards.test.ts` confere isso no código-fonte. Coluna nova nessas tabelas: `alter table <nome>_all` e recriar a visão; a migration falha na hora se esquecer.

**Regras do cancelamento:**

- Exige registros marcados na tabela ou um filtro. Um filtro pode alcançar tudo de propósito, por exemplo quando o conjunto só tem aquele indicador. Nesse caso a prévia avisa, e o limite por vez continua valendo.
- A prévia e a confirmação usam a mesma função de alcance. A confirmação trava as linhas e confere a impressão digital dos ids: se os registros mudaram, mesmo mantendo a quantidade, recusa.
- Ninguém cancela nem reativa os próprios resultados: se o alcance, ou o lote a reativar, incluir uma medição, meta ou fechamento da pessoa, é recusado (`DATA_CANCEL_OWN_RECORDS`), e outro administrador precisa fazer. Vale também quando quem cancelou foi outra pessoa.
- Recusa com carga do mesmo tipo em andamento, e com execução de Workflow que o motor ainda vai rodar: `active` ou `waiting`, em Workflow ativo.
- Execução `blocked` ou de Workflow pausado não barra, porque pode nunca sair daí (uma nova tentativa cria outra execução, e a original fica bloqueada). A prévia avisa.
- Se uma execução com a medição cancelada voltar a rodar, o motor a bloqueia antes de qualquer etapa (`TRIGGERING_RECORD_CANCELLED`), com o motivo na tela. Sem isso, cada etapa reagia de um jeito: a Saída falhava, a Revisão humana ficava esperando sem ninguém avisado e a Condição seguia com o valor guardado. A nova tentativa só anda depois de a medição voltar a valer.
- Meta e fechamento não têm ligação direta com execução. Quem está em andamento passa a ler os dados sem aqueles registros, como aconteceria com uma carga.
- Motivo obrigatório, de 10 a 500 caracteres, sem caracteres invisíveis nem de controle, exceto quebra de linha. Fica no lote (`data_record_cancellations`) e o texto nunca vai para `audit_logs` nem para log.
- Tudo numa transação, com o registro na auditoria: sem auditoria, nada é cancelado.
- O que já aconteceu não é desfeito: feedback entregue, resultado de Workflow e evidência continuam como estavam. A prévia mostra as execuções e as evidências ligadas, inclusive as que citam vários registros no mesmo campo. Ela conta o que aponta direto para o registro: um feedback gerado sem citar a linha não aparece.

**Como o registro volta:**

- **Pela carga:** um registro cancelado que chega de novo volta a valer, mesmo com o mesmo valor, e conta como alterado. Em Medições, isso dispara os Workflows por Indicador de novo, e a prévia avisa. Se a origem continuar mandando um registro errado, ele volta: o cancelamento não bloqueia a origem.
- **Por Reativar:** é desfazer. O registro volta como estava, sem disparar Workflow. As regras de valor da carga não são repetidas, porque nada mudou no registro. Fica barrado se:
  - o código, a unidade, a direção ou a estratégia do indicador mudaram depois do cancelamento (o lote guarda os quatro), o que também fecha o desvio da trava semântica;
  - o indicador foi desativado ou não aceita mais aquele tipo de dado;
  - já existe uma medição ativa da mesma pessoa, indicador e granularidade no mesmo período, por exemplo trazida por outra origem. A chave da medição inclui a origem e o fim do período, e o cálculo não deduplica: o dia contaria duas vezes.

**Cadeias por chave**, provadas em `record-cancellation-proof.test.ts`. Cancelar não apaga nada, então nenhuma chave estrangeira dispara nem cascata:

| Cadeia | O que acontece |
| --- | --- |
| Medição → execução, artefato de feedback, execução manual | Continuam ligados à linha. A leitura de histórico usa `_all` |
| Execução parada → medição cancelada | O motor bloqueia antes de qualquer etapa |
| Excluir Workflow → execuções, versões, recados | Nada é apagado (ver "Workflow excluído") |
| Indicador → medição, meta, fechamento | A trava continua enquanto houver um ativo, e a mensagem diz qual. Excluir é recusado enquanto houver cancelado |
| Lote → registros | O banco recusa apagar o lote com registros presos a ele. Não há rota |
| Pessoa → lote (quem cancelou) | Pessoa não tem rota de exclusão. O reset da massa demo lista isso como bloqueio |
| Fechamento → PRV | Não há chave entre eles: cancelar um fechamento não muda a PRV |

**O que muda nas travas do indicador:** as dependências contam só o que está ativo. Com tudo cancelado, unidade, estratégia, código e medição diária podem ser alterados de novo. Excluir o indicador continua recusado (`INDICATOR_HAS_CANCELLED_RECORDS`, 409), porque os registros seguem presos a ele por chave estrangeira.

**Fluxo do caso do TMA**, provado de ponta a ponta em `record-cancellation-proof.test.ts`: filtrar as medições pelo indicador, cancelar, corrigir o indicador e reprocessar a carga ou enviar um arquivo novo. SFTP com o mesmo conteúdo é pulado: a origem precisa mandar um arquivo diferente.

**Na consulta:** o seletor de situação mostra todos, só os ativos ou só os cancelados, e o padrão é todos. Com cancelados na resposta, a coluna **Situação do registro** sempre vai junto, inclusive no CSV: sem ela, o arquivo misturaria o que vale com o que não vale.

**Não é eliminação de dado:** o registro continua guardado, então não atende a um pedido de eliminação pela LGPD.

**Medido** em 06/11/2026 na cópia com 1,6 milhão de medições: migration em menos de 1 s; cancelar 10.000 registros, 2 s; reativar 10.000, 0,3 s; primeira página de todos os registros, 0,015 ms; só os cancelados, 1 ms; lista de lotes, 1 ms.

## Workflow excluído

Excluir um Workflow não apaga nada. Ele sai das telas e para de rodar, e o histórico continua guardado. `workflows` é uma visão sobre `workflows_all` (migration 175), no mesmo desenho do cancelamento de registros.

| O que | Depois de excluir |
| --- | --- |
| Telas e rotas de Workflow | Não aparece. Abrir, alterar, publicar, pedir nova tentativa ou excluir de novo responde 404 |
| Gatilhos | Não disparam |
| Execução `active` ou `waiting` | Bloqueada com o motivo `WORKFLOW_DELETED`, sem rodar mais nada, e sai das Pendências |
| Execuções terminadas, versões, eventos e recados | Ficam guardados |
| Recado de voz ainda não ouvido | Deixa de ser oferecido, e a linha fica |
| Feedback e caso já entregues | Não mudam |
| Indicador e Agent que só ele usava | Ficam livres para alterar ou excluir |
| Nome | Pode ser usado em outro Workflow |
| Auditoria | `WORKFLOW_DELETED` em `audit_logs`, com o nome e quantas execuções foram interrompidas |

**Na Consultar dados:** o conjunto **Workflows** mostra todos, com a situação (Ativo, Pausado, Rascunho, Excluído), quantas execuções tiveram, quando e por quem foram excluídos (pela matrícula ou, em conta sem matrícula, pelo nome). **Execuções de Workflow** continua mostrando as execuções de um Workflow excluído, com o nome dele e a coluna **Workflow excluído em**. O desenho do fluxo, as saídas dos nós e o conteúdo dos recados seguem fora, pelas mesmas regras de dado pessoal.

**Restaurar:** em Itens excluídos, abaixo. Volta pausado, e as execuções interrompidas aceitam nova tentativa depois de ativar.

**Regra antiga de `claude/magical-taussig-a4d2a2`:** aquele branch recusava com 409 a exclusão de Workflow que gerou feedback e barrava Agent, Orquestrador, domínio e indicador pela chave estrangeira. A exclusão lógica substitui isso, então ele foi mesclado em 06/11/2026 sem trazer esse código (`-s ours`). A trava de Workflow citando Orquestrador, que foi decisão do usuário, já estava aqui.

## Itens excluídos

Excluir é lógico em todo objeto de negócio. O mapa completo, com o que continua físico e por quê, está em [central-de-dados-exclusao-logica.md](central-de-dados-exclusao-logica.md). A lista fica no seletor de conjuntos da Consultar dados, no grupo Excluídos, mas não é um conjunto: não passa pelo compilador de consultas, não exporta CSV e nunca vai ao servidor como código de conjunto.

**Rotas** (`/api/v1/admin/data-explorer`, atrás de `data_hub.explore`):

| Rota | O que faz | Limite |
| --- | --- | --- |
| `GET /deleted-items?type=&search=` | Os 100 mais recentes, dos tipos que a pessoa pode gerenciar. Busca no nome, com `position`: não há padrão vindo do cliente | Consulta |
| `GET /deleted-items/:type/:id/restoration` | Prévia: o que barra e como o item volta. Não altera nada | Consulta |
| `POST /deleted-items/:type/:id/restoration` | Restaura numa transação, com a linha travada, as conferências refeitas e a auditoria junto | Escrita, o mesmo do cancelamento |

**Quem vê e restaura:** cada tipo exige a permissão de quem gerencia aquele objeto, com escopo de organização (`data-explorer/domain/deleted-items.ts`). Administrador geral vê todos. Administrador de dados vê Fonte, Conjunto e os próprios Reports. Tipo que a pessoa não gerencia, id inválido e item de outra organização respondem igual, 404, como se não existissem. Report é só de quem criou, que também restaura pela tela de Reports (`GET /api/v1/reports/deleted`, `POST /api/v1/reports/:id/restore`).

**Decisão mais restritiva, registrada:** Restaurar não usa `data_hub.cancel_records`, que só fala de registros importados. Usar essa permissão daria ao Administrador de dados o poder de trazer de volta Workflow, Agent ou conexão de IA, que ele não administra.

**Duas pessoas ao mesmo tempo:** a linha fica travada na confirmação. A segunda recebe "não encontrado", porque o item já não está excluído. Restaurar também trava o objeto de que o item depende (`lockParentsSql`), e excluir domínio ou categoria trava a própria linha antes de conferir: quem chega depois espera e é barrado. Provado com duas conexões em `deleted-items-proof`.

**O que saiu junto aparece pelo principal:** modelos que saíram com a conexão e conjuntos que saíram com a fonte têm o mesmo instante de exclusão. Eles não aparecem na lista, e voltam com o principal. O que foi excluído antes, separadamente, continua na lista e continua excluído.

**Auditoria:** `DATA_HUB_DELETED_ITEMS_LIST` e `DATA_HUB_DELETED_ITEM_RESTORE_PREVIEW` só aparecem no Registro ao filtrar por elas. `DATA_HUB_DELETED_ITEM_RESTORED` sempre aparece, com tipo, id e nome. O termo buscado nunca é gravado.

## Auditoria

`audit_logs`, `entity_type = 'data_explorer'`, ações `DATA_HUB_EXPLORER_QUERY`, `_COUNT`, `_EXPORT_STARTED`, `_EXPORT_FINISHED`, `_DENIED`, `DATA_HUB_RECORDS_CANCEL_PREVIEW`, `_CANCEL_LIST`, `_CANCELLED`, `_REACTIVATION_PREVIEW` e `_REACTIVATED`. A lista de lotes é auditada como dado pessoal, porque traz o motivo escrito à mão e os nomes de quem cancelou e reativou.

Guarda: quem, conta, escopo, conjunto, duração, quantidade, resultado, código do erro, colunas pedidas, colunas com dado pessoal, colunas usadas nas condições, número de condições, se houve busca e ordenação.

Nunca guarda: valor de filtro, termo de busca, conteúdo de linha, identificador inventado pelo cliente ou `x-request-id`, que também vem do cliente.

A aba **Registro** mostra exportações, cancelamentos, reativações e tentativas negadas. Consultas, contagens, prévias e leituras da lista somam muitas linhas por sessão, então aparecem só ao filtrar por essa ação. Listar e descrever conjuntos não é registrado: não expõe dado, só metadados.

## SQL livre: não incluído

A entrega é só a consulta visual. Um editor SQL exigiria uma credencial exclusiva, com acesso só a objetos aprovados, e nada disso existe hoje:

- A API usa uma credencial só, dona das tabelas. Rodar SQL do usuário com ela está vetado.
- A instalação real roda com usuário sem superusuário e, em algumas, sem `CREATEROLE`: uma migration não consegue criar o papel restrito com garantia.
- O isolamento por organização e as máscaras ficam no SQL gerado pelo servidor. Com SQL livre, precisariam de visões próprias e RLS, e funções, subconsultas e múltiplos comandos teriam de ser tratados.

O que falta para rever a decisão: credencial exclusiva, visões aprovadas por organização, limites impostos pelo próprio banco ao papel e provas contra cada contorno.

## Índices (migration 173)

Onze índices `(organization_id, <coluna de ordenação> desc, id desc)`. Medido em 06/11/2026 numa cópia do banco de desenvolvimento, com 1,6 milhão de medições:

| O quê | Antes | Depois |
| --- | --- | --- |
| Primeira página de Medições, só a ordenação | 175 ms, varrendo 34 mil páginas | 0,04 ms, 4 páginas |
| Tamanho | | `idx_measurements_explorer`: 91 MB; os outros somam cerca de 8 MB |
| Tempo da migration nesse banco | | menos de 2 s no total |

Tempos pela rota, na mesma cópia: primeira página 13 ms, páginas seguintes 2 a 7 ms, filtro por indicador 1 ms, por matrícula 7 ms, contagem com teto 2 ms. O pior caso é um filtro raro sem índice (`valor > 999999`), que leu a tabela e levou 2,3 s. Em tabela maior ele esbarra nos 5 s, é interrompido e pede para restringir os filtros.

O índice de medições tem custo de escrita nas cargas. Foi aceito porque é a maior tabela e a mais consultada, e sem ele cada primeira página leria a organização inteira.

## Provas

- Unitários: `explorer-catalog.test.ts`, `explorer-query.test.ts`, `explorer-csv.test.ts` e, na interface, `data-explorer.test.tsx`.
- Contra o banco de teste real, com rotas, guard e limites: `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run data-explorer-proof record-cancellation-proof --no-file-parallelism`.
- Sem banco: `record-reactivation.test.ts` e `record-cancellation-guards.test.ts` (a carga não grava pela visão, histórico lê a tabela real, nada apaga Workflow de verdade, e cancelar exige permissão própria).
- Workflow excluído: `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run workflow-logical-deletion-proof --no-file-parallelism`.
- Itens excluídos, tipo por tipo e pelas rotas reais: `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run deleted-items-proof --no-file-parallelism`. Sem banco, `record-cancellation-guards.test.ts` recusa `delete from` nestas tabelas, tabela fora do catálogo, upsert pela visão e `group by` só pelo id.
- Revisão independente em 06/11/2026, com scripts de ataque contra as rotas reais: 7 achados, nenhum crítico, todos corrigidos e com teste. Os dois mais importantes eram texto escrito pela IA em caso e feedback, e a mensagem de rejeição contornando a máscara de afastamento.
- Terceira revisão independente, da exclusão lógica, no mesmo dia: 8 achados provados e 5 suspeitas, 923 comandos conferidos no banco por `PREPARE`. Os mais importantes: token de conjunto e credencial de fonte antiga voltavam a valer, e Workflow voltava citando Agent excluído. Corrigidos e com teste; o que ficou está em Limitações.
- Segunda revisão independente, do cancelamento, no mesmo dia: 15 achados provados, nenhum crítico de segurança. Os mais importantes: reativar podia contar o mesmo dia duas vezes, a trava semântica podia ser contornada pela direção, a prévia não via evidência com vários ids e `blocked` prendia o registro para sempre. Corrigidos e com teste; o que ficou está em Limitações.

## Limitações

- A consulta usa a conexão da aplicação. As proteções são a lista permitida, a parametrização e a transação somente leitura, sem credencial separada no banco.
- A página mostra o estado do momento: páginas seguintes podem refletir uma carga que terminou no meio. A exportação usa uma foto só.
- Filtro de texto é por igualdade exata, e a busca sem acento não existe.
- As opções de lista fechada são fixas no catálogo. Código novo em um domínio aparece na tabela, mas só vira opção de filtro depois de incluído.
- Cancelar não bloqueia a origem: um registro errado reenviado volta a valer.
- As telas de histórico mostram a execução normalmente, sem marcar que a medição foi cancelada. A marca aparece na consulta.
- Execução manual pode nascer no intervalo curto entre conferir a medição e gravar a execução. Se isso coincidir com um cancelamento, o motor a bloqueia antes de rodar qualquer etapa.
- O limite de cancelamentos por organização vem antes de conferir `data_hub.cancel_records`. Hoje não há papel com consulta sem cancelamento; se um for criado, uma conta dele poderia gastar esse limite.
- A massa demo ainda grava pela visão. Reseed com registro demo cancelado atualiza o valor e mantém o cancelamento. O guard de código não olha `demo-mass`.
- Consulta com `group by` pela chave primária não funciona em visão: o PostgreSQL exige as colunas. Foi o que quebrou a exclusão de Agent ao criar a visão de `workflows`, e só apareceu rodando.
- Lote além do 50º não aparece na tela. Os que ainda têm registros cancelados vêm primeiro, e a tela avisa quando há mais.
- Registro cancelado continua ocupando a chave dele no banco. Uma carga com outra chave cria outra linha, e a errada segue guardada e cancelada.
- Itens excluídos mostra só os 100 mais recentes do filtro, e avisa quando há mais. Não exporta CSV.
- Report excluído só volta para quem o criou. Quem tem a Consultar dados vê aqui também; os outros restauram na aba Excluídos da tela de Reports.
- Os excluídos antes da migration 177 aparecem sem "Excluído por".
- Numa fonte excluída antes de 15/10/2026, os conjuntos têm outro instante de exclusão: não voltam junto, e aparecem na lista para restaurar um a um.
- Exclusão de indicador e carga rodando juntas: a carga resolve o indicador antes de gravar, então uma medição pode entrar sob um indicador que acabou de ser excluído. Ela fica guardada e escondida, como o resto do histórico dele.
- API antiga sobre o esquema novo quebra (`group by` na exclusão de Agent, upsert de feriado) ou apaga de verdade pela visão. A troca é junto com a migration, com a INIA parada, como já manda o roteiro IT-INIA-015.
- A flag que apontava para um indicador excluído não volta a apontar depois de restaurá-lo, e o período agendado de um cenário restaurado não volta. É preciso configurar de novo.
- Diagnóstico de outro indicador que usa uma flag como sinal da população (`populationSignal`) não barra a exclusão dela: o sinal deixa de valer, como quando a flag é desativada.
