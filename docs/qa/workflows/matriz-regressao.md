# Matriz de regressão — jornadas críticas de Workflows

**Como usar:** repita depois de mudar o editor, a validação ou a publicação. Preencha `Resultado` (ok, falhou, n/a) e a data. "Automatizado" indica o teste que já cobre o item; ele não substitui olhar a tela nos itens de **V**isual.

**Ambiente:** `A` = instância com API simulada ([ambiente-simulado/](ambiente-simulado/README.md)). `R` = backend real com dados de teste, sem publicar nada ativo com efeito real. Itens marcados `R*` ainda não foram executados no backend real. **A tela simulada não prova a integração:** só `ok em R` conta para isso.

`I` = backend real em ambiente local isolado: worktree própria, banco próprio, portas próprias e nenhuma chave de IA. **A execução ali é real, mas nada foi implantado**, e as outras sessões não foram afetadas.

**Conferência em R de 04/11/2026:** API e frontend deste checkout, banco de desenvolvimento, sessão do próprio administrador, workflow de teste com gatilho Manual, nunca executado.

**Conferência em I de 04/11/2026 (itens 48 a 52):** WF-42, WF-43 e WF-44, na branch `claude/wf42-sino`, depois juntada em `10cc428f`, com conta de teste do próprio banco e nenhuma chave de IA.

**Conferência em I de 04/11/2026:** P5b, P5c e WF-41, com conta de teste do próprio banco. Workflows sem etapa de IA; nenhum uso de IA registrado. Os diálogos de Executar agora e de nova tentativa foram vistos de novo no código juntado (`5ba86346`).

| # | Jornada | Passos | Esperado | Amb. | Automatizado | Resultado 04/11/2026 |
|---|---|---|---|---|---|---|
| 1 | Entender | Abrir a lista | Descrição cita os 4 gatilhos; estado por workflow | A | — | ok em A |
| 2 | Criar | Novo workflow; deixar em branco | "Criar" desabilitado até nome e gatilho completos | A, R | — | ok em A; criação ok em R |
| 3 | Fluxo vazio **V** | Abrir recém-criado | "Ainda não faz nada"; orientação acima do canvas, sem cobrir cards; Publicar desabilitado | A, R | `workflow-editor-page` | ok em R, a 1280×800 e 375×812 |
| 4 | Adicionar etapa | Clicar em "Gerar feedback" na paleta | Etapa criada com a ação e o nome; painel aberto | A, R | `node-palette` | ok em R (Chamar agente, Output); "Gerar feedback" só em teste |
| 5 | Ligar por arrasto **V** | Arrastar saída até outra etapa | Ligação com seta; rótulo se houver várias saídas | R* | `edge-presentation` | não executado com arrasto real |
| 6 | Ligar sem arrastar | Próximo passo, teclado | Ligação criada; "Sem ligação" remove | A, R | `next-step-fields` | ok em A, com teclado real; ligação ok em R |
| 7 | Mesma saída duas vezes | Ligar pelo ponto lateral uma saída já ligada | Substitui a anterior | A | `edge-presentation` | teste ok |
| 8 | Configurar | Clicar na etapa | Painel abre; arrastar não abre | A | — | ok em A, com clique e arrasto reais |
| 9 | Salvar incompleto | Chamar agente sem agente → Salvar → reabrir | Salva; reabre igual; o que falta segue na lista e Publicar fica desabilitado | A, R | `draft-graph`; `workflow-incomplete-draft-proof`; `workflow-editor-page` | **ok em R**: `PUT` 200, branco gravado, recarregar mostra o mesmo |
| 9b | Publicar incompleto pela API | `POST /publish` e `/validate` com rascunho incompleto | 422 e `valid:false`, com a etapa; nenhuma versão criada | R | `workflow-incomplete-draft-proof` | **ok em R**: 422 "Em "Chamar agente", escolha o agente." e `nodeId`; versões continuaram em 1 |
| 9c | Completar e publicar | Completar a etapa → salvar → publicar | Dry-run "Pronto para publicar"; publica; nenhuma execução | R | `workflow-incomplete-draft-proof` | **ok em R** |
| 9d | Rascunho de workflow no ar | Publicado → adicionar etapa em branco → salvar → recarregar | Versão no ar intacta; "Fluxo não publicado"; Publicar desabilitado | R | `workflow-draft-configuration-proof` | **ok em R**: mesmo id de versão e mesmo hash do grafo; 4 etapas no ar × 5 no rascunho |
| 10 | Trocar de aba | Editar → Execuções → Editor | Alterações continuam | A | `workflow-editor-page` | ok em A |
| 11 | Sair | Editar → link interno | Diálogo; "Continuar editando" é o foco inicial | A | `use-unsaved-changes-guard` | ok em A |
| 12 | Recarregar | Editar → recarregar | Aviso do navegador | R* | `use-unsaved-changes-guard` | teste ok |
| 13 | Remover usada | Remover etapa usada por outra | Confirmação citando as dependentes | A | `graph-references` | ok em A (pelo painel); tecla Delete não executada |
| 14 | Referência quebrada **V** | Rascunho com origem removida | Problema na etapa; Publicar desabilitado | A, I | `workflow-validation`; `workflow-validation.p5b` | **ok em I**: "vem de uma etapa que não existe mais" na lista de problemas |
| 15 | Corrigir erro | Ver problemas → clicar | Etapa selecionada e centralizada | A | `workflow-issues-panel` | ok em A (lista) |
| 16 | Recusa do servidor | Dry-run inválido | Etapa apontada; "Validar de novo" | R* | `workflow-issues-panel` | teste ok |
| 17 | Primeira publicação | Flag nunca publicada → Publicar | Diálogo com resumo; só publica ao confirmar | A, R* | `workflow-editor-page`; `publish-flow` | ok em A; **ok em R com gatilho Manual**; Flag não publicada em R (efeito real) |
| 18 | Agenda com impacto | Publicar com catch-up | "Dispara agora"; exige "Entendi" | R* | `publish-flow` | teste ok |
| 19 | Sem novidade | Publicado sem mudança | Publicar desabilitado; rodapé explica | A, R | `workflow-editor-page` | **ok em R** |
| 20 | Fluxo alterado | Editar e salvar publicado | "Fluxo não publicado" | A, R | `workflow-editor-page` | **ok em R** |
| 21 | Desativado | Interruptor desligado | "Desativado — não roda"; diálogo não promete execução; Executar agora explica o impedimento | A, R | `workflow-run-state`; `publish-flow` | **estado e Executar agora ok em R**; diálogo de publicar só em teste |
| 22 | Executar | Executar agora | Estado real; link para Execuções | I | `manual-run-dialog` | **ok em I**, em workflow sem IA; execução com IA não rodada (chamada paga) |
| 23 | Testar | "Testar" no editor | QA Lab com o workflow escolhido; some sem permissão | R* | — | link ok em A; **QA Lab não aberto** |
| 24 | Acompanhar | Execuções, expandir | Nomes e eventos em português; "—" se terminada | A | `workflow-enrollments-tab` | ok em A |
| 25 | Decidir revisão | Aprovar em Execuções | Confirmação; nada enviado antes | A | `workflow-enrollments-tab` | ok em A |
| 26 | Bloqueada | Nova tentativa | Prévia e confirmação | I | `workflow-enrollments-tab`; `workflow-human-review-no-reviewer-proof` | **ok em I**: sem correção, confirmar fica desabilitado; corrigida a hierarquia, continua da revisão |
| 27 | Excluir | Lixeira | Diz o que se perde, com contagem | A | — | ok em A (sem confirmar) |
| 28 | Permissão | Abrir sem `workflows.manage` | Menu oculto; mensagem clara | R* | `workflow-editor-page` | teste ok para o editor; **sem conta real** |
| 29 | Admin de grupo | Conta com escopo | Só grupos dele; sem "Todos os grupos" | R* | — | não executado |
| 30 | Fluxo grande **V** | 42 etapas | Minimapa; sem sobreposição | A | — | minimapa ok em A (12 etapas); legibilidade segue limitada (P4) |
| 31 | 1024×768 **V** | Editor e problemas | Palavras inteiras; rodapé acessível | A | — | ok em A |
| 32 | 375×812 **V** | Editor | Aviso; paleta acima do canvas; sem rolagem lateral | A | — | ok em A: canvas 341×328 px |
| 33 | Falha de rede | Salvar com API fora | Mensagem; nada se perde | A | `save-draft-error` | teste ok |
| 34 | Referência pela API | `/validate` e `/publish` com origem removida ou que vem depois | `valid:false` e 422, com a etapa; nenhuma versão | I | `node-references.parity`; `workflow-broken-reference-proof` | **ok em I** |
| 35 | Versão antiga com referência | Rodar versão publicada antes da regra | Output e Escalonar encerram com o motivo; Revisão bloqueia; nenhum aviso vazio | Banco de teste | `workflow-broken-reference-proof` | ok em prova; não visto na tela |
| 36 | Revisão sem revisor **V** | Executar para quem não tem o cargo acima | "Bloqueada — sem revisor", com o motivo e a orientação; nada de espera | I | `workflow-human-review-no-reviewer-proof`; `enrollment-format.p5c` | **ok em I** |
| 37 | Cada caso sem revisor | Revisor inativo, inativo com outro acima, pessoa inativa, revisão anterior não decidida, só o colaborador | Bloqueia com o caso certo; não sobe na cadeia | Banco de teste | `workflow-human-review-no-reviewer-proof` | ok em prova; só o primeiro caso visto na tela |
| 38 | Aviso a quem publicou **V** | Bloquear → sino → clicar | Workflow, etapa e motivo, sem o colaborador; abre Execuções; 2 bloqueios no dia, 1 aviso | I | `workflow-human-review-no-reviewer-proof`; `notification-target.p5c`; `workflow-editor-page` | **ok em I** |
| 39 | Sem acesso ao workflow | Publicou e perdeu a permissão, ou só tem outro grupo, ou está sem conta | Não recebe; a execução bloqueia igual; aviso antigo some | Banco de teste, I | `workflow-human-review-no-reviewer-proof`; `blocked-notice-visibility-proof` | ok em prova, pela API do sino; perda de permissão vista na tela em I (item 52). Outro grupo e sem conta, só em prova |
| 40 | Publicou e é o colaborador | Publicador com acesso é o colaborador da execução | Recebe o aviso, sem dados a mais | Banco de teste | `workflow-human-review-no-reviewer-proof` | ok em prova; não visto na tela |
| 41 | Contagem de bloqueadas **V** | Lista de workflows com execução bloqueada | "1 bloqueada", separada de "em execução" | I | `workflows-page.p5c` | **ok em I** (tabela); cartão só em teste |
| 42 | Origem em variável **V** | Definir variável → Output com a variável | Seletor mostra a variável; o aviso traz o valor | I | `workflow-broken-reference-proof`; `workflow-validation.p5b` | **ok em I** (Notificação); Chat, Revisão, Escalonar e Pendências só em prova |
| 43 | Tipo e disponibilidade | Variável número, verdadeiro/falso, sem valor, em branco, não definida antes | Número no formato brasileiro; Sim/Não; sem valor para com o motivo; publicar recusa a não definida antes | Banco de teste | `workflow-broken-reference-proof`; `node-references.parity` | ok em prova; não visto na tela |
| 44 | Pendências e Acompanhamento | Execução bloqueada | Não vira pendência; aviso fora do Acompanhamento | Banco de teste | `workflow-human-review-no-reviewer-proof` | ok em prova, pela API |
| 45 | QA Lab | Simular revisão sem revisor e origem ausente | Falha com o motivo; aviso só como efeito simulado | Banco de teste | `workflow-human-review-no-reviewer-proof`; `workflow-broken-reference-proof` | ok em prova; tela do QA Lab não aberta |
| 46 | Fan-out | Filha bloqueada na revisão | Consolidar conta como não chegou, com o motivo; nova tentativa na mesma versão e em versão nova | Banco de teste | `workflow-human-review-no-reviewer-proof` | ok em prova; não visto na tela |
| 47 | Verificação anterior à implantação | `levantamento-p5.mjs` em homologação | Resultado registrado em `propostas.md` | Homologação | — | **não executado**; nesta etapa o Azure não foi acessado |
| 48 | Impedimento junto da ação **V** | Nova tentativa com impedimento, a 597×731, 1440×900 e 1440×500 | Diálogo cabe; só os detalhes rolam; aviso uma vez, junto de "Confirmar"; Cancelar à vista | I | `retry-dialog` | **ok em I** |
| 49 | Estados do diálogo **V** | Carregando, erro ao carregar, confirmação disponível | Situação junto das ações; "Confirmar" não envia sem prévia; disponível sem aviso | I (carregando e erro com resposta simulada no navegador) | `retry-dialog` | **ok em I** |
| 50 | Recusa do servidor **V** | Com o diálogo aberto: hierarquia muda, ou nova versão é publicada | Prévia nova; impedimento ou "Os dados mudaram" junto da ação; foco em "Confirmar"; sem toast; nenhuma tentativa criada | I | `workflow-enrollments-tab` | **ok em I**; conteúdo ausente só em teste |
| 51 | Teclado no diálogo **V** | Tab entre as ações e os detalhes; Enter em "Confirmar" bloqueado; End nos detalhes | Enter não envia nada; a descrição aponta para o motivo; rolar não esconde aviso nem ações | I | `retry-dialog` (parte) | **ok em I**; leitor de tela real não usado |
| 52 | Sino com aviso fora da lista **V** | Aviso de 40 dias e mais de 20 mais novos; retirar e devolver a permissão | Conta com permissão; sem ela, some da contagem e da lista e segue não lido no banco; ao recuperar, volta igual | I | `blocked-notice-visibility-proof` | **ok em I**: 58, depois 56, depois 58 |
| 53 | Sino: escopos | Administrador de organização, grupo e subgrupo | Mesma resposta da aba Execuções | Banco isolado | `blocked-notice-visibility-proof` | ok em prova; não visto na tela |
| 54 | Sino: workflow indisponível | Removido, chave fora do formato, desligado, sem versão, etapa removida | Removido e chave inválida não aparecem nem contam, sem erro; os demais seguem visíveis para quem administra | Banco isolado | `blocked-notice-visibility-proof` | ok em prova; não visto na tela |
| 55 | Sino: isolamento | Aviso de outra pessoa; workflow e aviso de outra organização | Nunca aparecem nem contam | Banco isolado | `blocked-notice-visibility-proof` | ok em prova; não visto na tela |
| 56 | Sino: leitura e resolução | Não lido, lido, resolvido e expirado, com e sem permissão; marcar tudo sem acesso; demais tipos | Regras de sempre com permissão; sem ela, nada aparece nem conta e nada é marcado como lido; demais tipos não mudam | Banco isolado | `blocked-notice-visibility-proof` | ok em prova; não visto na tela |

## Verificações automáticas

Rode em `frontend/`:

```bash
npx vitest run src/components/admin/workflows src/schemas/admin
```

```bash
npx eslint src/components/admin/workflows src/schemas/admin/workflow-validation
```

```bash
npx tsc --noEmit -p .
```

Rode em `backend/`, sem precisar de servidor:

```bash
npx vitest run validate-workflow-for-publish.parity node-references.parity official-model-workflows draft-graph
```

Prova com o banco de teste, sem efeito no banco (transação desfeita):

```bash
INIA_DB_PROOF=1 NODE_ENV=test npx vitest run workflow-incomplete-draft-proof workflow-broken-reference-proof workflow-human-review-no-reviewer-proof blocked-notice-visibility-proof
```
