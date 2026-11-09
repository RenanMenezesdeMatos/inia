# Exclusão lógica: tudo o que a INIA exclui

Levantamento de 06/11/2026, feito sobre todas as rotas `DELETE` e todos os `delete from` do código de produção (81 comandos, 33 rotas). Quem usa a tela: [Itens excluídos, na wiki](../../frontend/src/app/wiki/central-de-dados/page.tsx). Quem mexe no código: [central-de-dados-consulta.md](central-de-dados-consulta.md#itens-excluídos).

## A regra

Excluir um objeto de negócio não apaga nada. Ele sai das telas e da lógica, continua no banco e aparece em **Central de Dados › Consultar dados › Itens excluídos**, de onde volta.

- **Ter histórico não impede excluir** (decisão de 06/11/2026). Agent que já rodou, indicador com medições e flag com interações podem sair. O que barra é o uso de agora: Workflow ou política que cita, execução em andamento, produto dentro da categoria. Desativar continua existindo para quem só quer parar de usar.
- **Leitura de lógica usa a visão, leitura de histórico usa `_all`.** O item some do que vai rodar e dos painéis, e continua com o nome no que já aconteceu: execuções, conversas, diagnósticos, origem do feedback e Consultar dados. `record-cancellation-guards.test.ts` confere os leitores de histórico.
- **Chave estrangeira não barra mais.** Sem apagar, ela nunca dispara. Toda chave que antes impedia a exclusão virou conferência explícita, porque um registro vivo apontando para um pai escondido perderia o nome nas telas. Quem exclui o pai trava a linha antes de conferir, e quem restaura trava o pai, para as duas coisas não passarem uma pela outra. As duas exceções, de propósito: `interaction_feedback_generations.workflow_id` e `assistant_interaction_support_materials.orchestrator_id`, que antes davam erro 500 e agora preservam o histórico, que continua lendo a tabela real.
- **Restaurar nunca liga nada.** O objeto volta desligado, pausado ou encerrado, e quem restaura liga na tela dele, onde as validações de sempre acontecem.
- **Quem vê e restaura é quem pode gerenciar aquele tipo de objeto na organização inteira**, com a Consultar dados liberada. Ter a consulta não dá poder sobre Workflow, IA ou governança.

## Passaram a ser lógicos (migrations 175 e 177)

| Objeto | Tabela real | Antes, ao excluir | Trava que continua | Como volta |
| --- | --- | --- | --- | --- |
| Workflow | `workflows_all` | Apagava versões, execuções e eventos em cascata; com feedback gerado, dava erro 500 | Nenhuma: interrompe as execuções | Pausado, se não citar Agent, Orquestrador, indicador ou flag excluídos. Execuções interrompidas seguem bloqueadas e aceitam nova tentativa depois de ativar |
| Variável de Workflow | `workflow_variables_all` | Apagava | Citada no rascunho ou na versão publicada | Igual, se o Workflow estiver vivo |
| Agent | `agents_all` | Só sem uso; apagava versões, histórico e vínculo com bases | Execução em andamento, ou citado por Workflow ou Orquestrador | Desativado, se o domínio estiver vivo e o nome livre |
| Orquestrador | `assistant_orchestrators_all` | Apagava versões e vínculos, e o histórico das conversas perdia a referência; com material de apoio citado, dava erro 500 | Citado por Workflow (rascunho, versão vigente ou execução em andamento) | Desativado, se os Agents e domínios estiverem vivos |
| Argumentário | `argument_scripts_all` | Só sem uso em análise; apagava as versões | Nenhuma | Encerrado, se o domínio estiver vivo. Reativar cria versão nova |
| Domínio de negócio | `business_domains_all` | Apagava | Agent, Orquestrador, Argumentário ou checkpoint | Desativado, se o código estiver livre |
| Flag de canal | `channel_flags_all` | Só sem interação; apagava, e as análises de boas práticas dela iam junto | Citada por Workflow ou política de acompanhamento | Desativada, se o nome estiver livre |
| Indicador | `indicator_definitions_all` | Só sem histórico; apagava regras e glossário | Citado por Workflow ou política de acompanhamento, ou execução em andamento | Desativado, se o código estiver livre. A flag que apontava para ele não volta a apontar |
| Produto ou categoria | `product_catalog_nodes_all` | Só sem uso nenhum; apagava | Abrangência aberta de base, indício vigente ou em rascunho, ou produto dentro | Desativado, se o código estiver livre e a categoria viva |
| Indício de produto | `product_identification_criteria_all` | Só sem uso em análise; apagava as versões | Nenhuma | Encerrado, se os produtos dele estiverem vivos. Reativar cria versão nova |
| Assunto proibido | `prohibited_topics_all` | Apagava, com o texto na auditoria | Nenhuma | Desligado: a IA só volta a respeitar depois de ativar |
| Termo do glossário | `glossary_terms_all` | Apagava, com o texto na auditoria | Nenhuma | Desligado |
| Feriado | `organization_holidays_all` | Apagava | Nenhuma | Desligado: não muda o calendário até ativar |
| Cenário da INIA | `inia_scenes_all` | Apagava as imagens | Nenhuma | Sem período agendado e sem ser o padrão |
| Conexão de IA | `ai_connections_all` | Apagava modelos, preços e credencial | Política ativa ou em rascunho | Desabilitada, com os modelos que saíram junto. **A credencial foi revogada e não volta** |
| Modelo de IA | `ai_models_all` | Apagava os preços | Política ativa ou em rascunho | Desabilitado, se a conexão estiver viva |
| Orçamento de IA | `ai_budgets_all` | Apagava | Nenhuma | Desligado: não limita gasto até ligar |

`<nome>` virou uma visão que esconde os excluídos. Quem esquecer um filtro no futuro não vê excluído por engano. Nome e código ficam livres assim que o dono é excluído (índice único parcial); restaurar com o nome em uso é barrado até renomear.

## Já eram lógicos, e agora aparecem e voltam

| Objeto | Tabela | Como volta |
| --- | --- | --- |
| Base de conhecimento | `knowledge_documents` | Arquivada: a IA não consulta até publicar de novo |
| Regra de cálculo de indicador | `indicator_calculation_rules` | Desativada, se o indicador estiver vivo |
| Fonte de dados | `data_sources` | Pausada, com os conjuntos que saíram junto. **Credenciais e tokens não voltam**: são revogados ao excluir e de novo ao restaurar, porque fonte excluída antes de 15/10/2026 ainda os tinha vivos |
| Conjunto de dados | `data_feeds` | Pausado, se a fonte estiver viva e ninguém tiver virado a fonte oficial daquele dado. **Tokens próprios são revogados** ao excluir e não voltam |
| Report | `reports` | Inativo, sem entrega. **Só para quem o criou**, na aba Excluídos da tela de Reports, sem precisar da Consultar dados |

Os excluídos antes desta entrega aparecem sem "Excluído por", porque não guardavam quem excluiu.

## Continuam físicos, de propósito

| O quê | Onde | Por quê |
| --- | --- | --- |
| Rascunho descartado | Argumentário, indício, base, estratégia de diagnóstico, intervenção, política de acompanhamento e política de roteamento de IA | Nunca valeu. O descarte é a própria função do botão; a versão publicada é outra linha, e continua |
| Ligações regravadas ao salvar | Bases do Agent, especialistas e domínios do Orquestrador, escopos de base e de checkpoint, modelos da política de roteamento, imagens trocadas de um cenário | É o estado atual de um objeto versionado: a versão guarda a configuração da época |
| Definições provisórias | Checkpoint ambíguo sem versão, prática e tema sem membros | Nasceram só para um processamento, e nunca foram usadas |
| Substituição no tempo | Período de situação funcional cancelado pela carga, jornada criada e refeita no mesmo dia | Não é exclusão de objeto. A situação funcional tem fluxo e precedência próprios |
| Foto e capa substituídas | `person_profile_images` | Dado pessoal da própria pessoa: guardar a foto antiga iria contra o que ela pediu |
| Limpeza técnica | Sessões, tentativas de login, limites de uso, vagas de IA, desbloqueios de fonte, arquivos brutos vencidos, filas e read models | Não é dado de negócio, e cresceria sem fim |
| Retenção | `data-lifecycle`, `usage-retention` | Eliminação por política, ligada só por decisão. Excluir logicamente anularia a retenção |
| Só em teste ou instalação | Dataset sintético (recusa em produção), limpeza da instalação, reset da massa demo | Fora do uso normal |

Não existe exclusão de pessoa, Grupo ou Subgrupo: não há rota.

## Não atende à LGPD

O dado continua no banco. Excluir por aqui não atende a um pedido de eliminação de dado pessoal.

## O que olhar ao mexer nestas tabelas

- `alter table agents` falha na hora, porque `agents` é visão: altere `agents_all` e recrie a visão. O mesmo vale para `references agents(id)` em migration nova, que precisa apontar para `agents_all`.
- Coluna nova não aparece na visão até recriá-la. O erro é na hora, nunca silencioso.
- Visão não tem chave primária: `group by a.id` falha ao executar, e `record-cancellation-guards.test.ts` procura isso.
- `insert ... on conflict` vai em `_all`, com `where deleted_at is null` no alvo, porque o índice é parcial. A guarda também procura isso.
- `delete` pela visão não alcança excluído. O reset da massa demo e a limpeza de provas usam `_all`.
- Gatilho que compara `tg_table_name` precisa do nome novo. Foi o que quebraria o `inia_scene_images_consistency`, corrigido na migration 177.
- Leitura nova de histórico (o que já aconteceu) usa `_all`; leitura de lógica e de configuração usa a visão. Por código ou nome, `_all` pode trazer mais de uma linha: ordene por `(deleted_at is null) desc` e limite a uma.
- Serviço que grava pelo id de um objeto com exclusão lógica confere pela visão antes: a chave estrangeira aceita o excluído. Regra e glossário de indicador foram corrigidos assim.
- Objeto novo com exclusão lógica entra em `data-explorer/domain/deleted-items.ts`. A guarda recusa tabela com exclusão lógica fora do catálogo e `delete from` nelas em produção.
