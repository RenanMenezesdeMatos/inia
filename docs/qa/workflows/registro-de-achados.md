# Registro de achados — Workflows

**Status:** `aberto` · `em andamento` · `corrigido` (implementado e com teste) · `conferido em simulação` (corrigido e visto na instância com API simulada) · `validado no backend` (prova com a API real e o banco de teste) · `validado` (visto funcionando na tela com o backend real) · `adiado` (com justificativa).

"Parcial" indica que parte do achado foi tratada e o restante depende da proposta citada. Fichas completas em [achados.md](achados.md); propostas em [propostas.md](propostas.md).

**A tela simulada não prova a integração.** Ela usa uma API em memória e serve só para ver a interface: nenhum achado passa a `validado` por causa dela.

**`validado` não significa implantado.** WF-07, WF-08, WF-41, WF-42, WF-43 e WF-44 foram vistos com o backend real num banco local isolado, sem implantação. A implantação depende da [verificação anterior](propostas.md#verificação-anterior-à-implantação).

Última atualização: 04/11/2026.

| Id | Achado | Tipo | Gravidade | Status | O que foi feito ou o que falta |
|---|---|---|---|---|---|
| WF-01 | Etapa recém-adicionada impede salvar | Defeito | Crítica | validado | P1 aplicada: rascunho incompleto salva e reabre; publicar, dry-run e QA Lab recusam apontando a etapa. Prova com a API real e o banco de teste, e conferência na tela com o backend real (salvar, recarregar, completar e publicar). QA Lab com rascunho incompleto: só em teste |
| WF-02 | Trocar de aba descarta alterações | Defeito | Crítica | conferido em simulação | Editor continua montado |
| WF-03 | Sair sem aviso | Defeito | Alta | conferido em simulação | Diálogo em links internos; aviso do navegador ao recarregar ou fechar. Voltar do navegador em navegação interna segue sem aviso (limite técnico) |
| WF-04 | Primeira publicação sem confirmação | Defeito | Alta | validado (gatilho Manual) | Diálogo em toda primeira publicação, com resumo; visto antes de qualquer `POST /publish`. Flag, Indicador e Agenda: só em simulação e em teste |
| WF-05 | Estado do fluxo invisível | Defeito | Alta | validado | "Rascunho — ainda não roda", "No ar", "Desativado — não roda", "Fluxo não publicado"; Publicar desabilitado sem novidade. Os quatro vistos com o backend real |
| WF-06 | Excluir subinforma e pode falhar | Defeito | Alta | conferido em simulação (parcial) | Texto, botão destrutivo e tratamento de erro. **FK e auditoria em P5** |
| WF-07 | Referência quebrada publica e falha | Defeito | Alta | validado | P5b: a publicação e o dry-run recusam origem que não existe ou não vem antes, com a etapa, e o editor mostra o mesmo. Versão antiga com a referência para ao rodar, com o motivo, sem entrega vazia. Visto com o backend real em ambiente isolado. Falta a verificação anterior à implantação |
| WF-08 | Revisão sem revisor parada para sempre | Defeito | Alta | validado | P5c: "Bloqueada — sem revisor", com o motivo; aviso a quem publicou e mantém acesso; contagem na lista; nova tentativa conferida. Visto com o backend real em ambiente isolado. Falta a verificação anterior à implantação |
| WF-09 | Saída ligada duas vezes | Defeito | Média | corrigido | `connectBranch` compara o handle canônico |
| WF-10 | Aguardar muda durante a digitação | Defeito | Média | corrigido | Unidade em estado próprio |
| WF-11 | Problema antigo esconde "não salvas" | Defeito | Média | corrigido | Ignora a resposta velha; "Validar de novo" em recusa do servidor |
| WF-12 | Decisão em workflow desativado | Defeito | Média | adiado | Exige backend (P5f) |
| WF-13 | Decisão em um clique | Defeito | Alta | conferido em simulação (parcial) | Confirmação com o efeito. **Onde se decide fica para P6** |
| WF-14 | Ligações sem seta e rótulo | Usabilidade | Alta | conferido em simulação | Rótulo por saída e seta, sem alterar o grafo salvo |
| WF-15 | Id técnico no card, nome ausente | Usabilidade | Alta | conferido em simulação | Nome em destaque; etapa nasce com nome; nenhuma mensagem com `""` |
| WF-16 | Execuções em língua de motor | Usabilidade | Alta | conferido em simulação (parcial) | Nomes e eventos em português, "Encerrada com falha", estado vazio útil, busca inútil removida. **Colaborador em P5g** |
| WF-17 | Pessoa por id digitado | Usabilidade | Alta | corrigido | `PersonPicker` com busca. Sem verificação em navegador: a tela precisa do cadastro real de pessoas |
| WF-18 | "Pendências" sem leitor | Usabilidade | Média | corrigido | Só aparece onde já estava; "Onde entregar" |
| WF-19 | Textos incorretos | Usabilidade | Média | conferido em simulação | Nova redação na lista, diálogo, painel, gatilho e Configurações |
| WF-20 | Paleta esconde ações | Usabilidade | Média | conferido em simulação | Itens próprios por ação, agrupados, sem palavras partidas |
| WF-21 | Enquadramento ilegível | Usabilidade | Média | conferido em simulação (parcial) | Minimapa e painel mais largo. **Organizar e modo foco em P4** |
| WF-22 | Quatro formas de salvar | Usabilidade | Média | adiado | Muda o modelo mental (P2) |
| WF-23 | Clique não abre a etapa | Usabilidade | Média | conferido em simulação | Clique abre; arrastar só move (ambos com interação real no navegador) |
| WF-24 | Lista de problemas parcial | Usabilidade | Média | adiado | Exige backend (P5a) |
| WF-25 | Mensagens com jargão | Usabilidade | Média | corrigido (parcial) | Editor ajustado. **Mensagens do backend em P5h.** Falta "camada de confiabilidade" em `structured-content-picker` e `feedback-action-forms` (P8) |
| WF-26 | Fluxo vazio "pronto" | Usabilidade | Média | validado | Estado próprio e orientação acima do canvas (ver WF-37). Visto com o backend real |
| WF-27 | Sem ponte para testar | Usabilidade | Média | conferido em simulação (parcial) | Botão "Testar" abre o QA Lab no workflow. **Teste para admin de grupo em P3** |
| WF-28 | Sem modelos, duplicar e versões | Usabilidade | Alta | adiado | Decisão de produto (P3, P7) |
| WF-29 | Última gravação apaga a outra | Defeito | Média | adiado | Exige backend (P5e) |
| WF-30 | Card e diálogo escondem o decisivo | Usabilidade | Média | conferido em simulação | Cargo no card; nome da ação; resumo do fluxo; diálogo correto para workflow desativado |
| WF-31 | Falta de permissão genérica | Usabilidade | Baixa | corrigido | Mensagem e link de volta no editor. A lista segue com o texto genérico |
| WF-32 | Telas menores | Visual | Média | conferido em simulação (parcial) | Palavras inteiras a 1024 px; em telefone, aviso e paleta acima do canvas (341×328 px). **Decisão de uso em telefone em P4** |
| WF-33 | Ligar só arrastando | Acessibilidade | Alta | conferido em simulação | "Próximo passo" no painel, com "Sem ligação". Ligação criada só com Enter, End e Enter no navegador. Sem leitor de tela real |
| WF-34 | Nomes, idioma e status | Acessibilidade | Média | conferido em simulação (parcial) | Voltar, nome da etapa, controles em português, `role="status"`. Sem leitor de tela real. Falta o "Close" em inglês no diálogo do kit (`components/ui/dialog.tsx`) |
| WF-35 | Documentação divergente | Documentação | Média | em andamento | Ver abaixo |
| WF-36 | Resumo de workflow Manual promete rodar para todos | Defeito | Média | validado | Agora diz "Uma execução por clique, para o colaborador escolhido em Executar agora". Visto com o backend real; `workflow-summary.test` |
| WF-37 | Orientação do fluxo vazio cobre os cards | Visual | Média | validado | Saiu de cima do canvas. Sem sobreposição a 1280×800 e 375×812, com o backend real |
| WF-38 | "Resultado completo de Resultado de:" | Usabilidade | Baixa | validado | Frase sem a repetição e sem "campos declarados". Vista com o backend real; `content-sources.test` |
| WF-39 | Etapas novas entram abaixo do Fim | Usabilidade | Média | aberto | A ligação do Gatilho passa por trás do Fim. Tratar com "Organizar" (P4) ou movendo o Fim ao adicionar |
| WF-40 | Abrir o painel corta cards e esconde o título do painel | Usabilidade | Média | aberto | O canvas encolhe sem recentralizar; o foco do primeiro campo rola o painel para baixo |
| WF-42 | Impedimento da nova tentativa fica fora da área visível | Usabilidade | Baixa | validado | O impedimento fica junto das ações, e só os detalhes rolam. Visto com o backend real em ambiente isolado, a 597×731, 1440×900 e 1440×500: bloqueado, carregando, erro, disponível, recusa e sucesso. Juntado em `10cc428f`, sem implantação |
| WF-41 | Origem em variável entrega sem o valor | Defeito | Alta | validado | Output, Revisão e Escalonar leem a variável, no formato do tipo; a publicação exige que uma etapa anterior a defina; sem valor, para com o motivo. O campo de texto do resultado estruturado tinha o mesmo defeito e também foi corrigido. Output por Notificação visto com o backend real em ambiente isolado; Chat, Revisão, Escalonar e Pendências em prova |
| WF-43 | Contagem do sino não respeita a permissão fora da lista | Defeito | Média | validado | Lista e contagem usam a mesma regra, a da aba Execuções, sem depender do limite da lista. Aviso de 40 dias, perda e recuperação de permissão vistos na tela em ambiente isolado; escopos, isolamento e estados em `blocked-notice-visibility-proof`. A migration 170 só melhora o desempenho e ainda não foi aplicada no banco de desenvolvimento. Juntado em `10cc428f`, sem implantação |
| WF-44 | Recusa por revisor ou conteúdo ausente não atualiza a prévia | Defeito | Média | validado | A P5c criou os dois códigos, mas o diálogo não os tratava: a tela ficava na prévia antiga, com Confirmar habilitado e um toast sobre as ações. Encontrado na conferência visual do WF-42; visto corrigido na tela. Juntado em `10cc428f`, sem implantação |

## Pendências da P5

P5b, P5c, WF-41, WF-42, WF-43 e WF-44 estão em `admin-list-standardization`, sem push e sem implantação. **WF-42, WF-43 e WF-44 estão concluídos no escopo implementado** (decisão de 04/11/2026), com as limitações do [relatório, §12 e §13](relatorio-2026-11-04.md#13-junção-do-wf-42-wf-43-e-wf-44). As pendências abaixo não reabrem esses achados. Seguem pendentes:

| Pendência | O que falta | Quando |
|---|---|---|
| Levantamento em homologação | Rodar `levantamento-p5.mjs` e registrar o resultado em [propostas.md](propostas.md#verificação-anterior-à-implantação). Não executado; os números de desenvolvimento não substituem | Antes de implantar |
| Migration 170 no banco de desenvolvimento | Não aplicar agora, por decisão de 04/11/2026. Só melhora o desempenho: o sino funciona sem ela | Quando autorizado |
| Desempenho do badge | Só há medição sintética ([relatório, §13](relatorio-2026-11-04.md#13-junção-do-wf-42-wf-43-e-wf-44)). Falta volume real e muitas pessoas consultando ao mesmo tempo | Em homologação, junto do levantamento |
| Toast sobre Cancelar | A 597 px, o toast de um erro genérico cobre Cancelar por alguns segundos, e a mensagem não fica no diálogo | Sem prazo definido |
| Foco depois do sucesso | O botão que abriu o diálogo some da linha, e o foco vai para o corpo da página | Sem prazo definido |
| Sino com sessão na API compartilhada | Não conferido depois da junção; não bloqueia a conclusão | Na próxima conferência com a sessão de uma pessoa |

## WF-35 · Documentação divergente

Corrigido nesta rodada: `docs/workflow-engine-wiki.md` (publicar, desativar, excluir) e as páginas `criacao`, `nodes`, `erros-limitacoes`, `human-review` e a visão geral de Workflows.

Ainda abertos, levantados por leitura de código:

| Onde | Divergência |
|---|---|
| `wiki/workflows/page.tsx:42-45,66,328`; `wiki-reference.ts:60-64` | Visão geral e catálogo ignoram o gatilho Manual |
| `wiki/workflows/triggers/page.tsx:69,77`; `execucao-manual/page.tsx:153` | Citam Filtro Populacional fora da Agenda |
| `wiki/workflows/nodes/page.tsx:106-108`; `wiki-reference.ts:167,169,179`; `fan-out-fan-in/page.tsx:178` | Dizem que só o Orquestrador roda depois de Consolidar |
| `wiki/workflows/outputs/page.tsx:54-58,68`; `human-review/page.tsx:42-44` | Ensinam a entregar o Agent direto, o que a publicação bloqueia |
| `wiki/workflows/outputs/page.tsx:63-66`; `node-config/output-form.tsx:73` | "O próprio operador" some em todo o Consolidado, inclusive depois de "Aplicar individualmente" |
| `wiki/workflows/conditions/page.tsx:61-75,91` | "Valor simples" não existe na tela; contradição sobre quartil operacional |
| `execucao-manual/page.tsx:181`; `feedback-action-forms.tsx:109,145` | Texto de "Gerar feedback" dizendo que espera o QA |
| `erros-limitacoes/page.tsx:36,93,119` | Diz que Chat e Avatar não têm tela |
| `erros-limitacoes/page.tsx:94`; `workflows/page.tsx:283` | Regras de ciclo e de saída ligada |
| `casos-praticos/workflows/page.tsx:41,62,72` | "Configurados no produto", "ao instalar" |
| `wiki/workflows/**`; mensagens | "Nó" × "etapa" convivem até decidir P8 |

## Não reproduzido

| Observação | Resultado |
|---|---|
| Duplo clique em Publicar envia duas publicações | Duas chamadas `click()` na mesma tarefa de script geraram 2 `POST`, mas um clique real encontra o botão desabilitado ("Verificando…", visto no navegador). Sem evidência de defeito com uso real |
| "Atalho da sidebar" para criar workflow | Não encontrado no menu; a frase saiu da Wiki |
| Botão redondo cobrindo o canto de "Publicar" a 1280×800 | É o botão do TanStack Query Devtools, que só existe em desenvolvimento. Não é defeito do produto |
