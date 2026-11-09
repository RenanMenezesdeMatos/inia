# Achados — auditoria de Workflows (04/11/2026)

Fichas completas. O estado atual de cada achado está em [registro-de-achados.md](registro-de-achados.md).

As linhas citadas valem para o commit `69374087`, antes das correções desta rodada.

**Evidência**

- **[INT]** observado na interface real, em instância isolada com API simulada e dados fictícios.
- **[REAL]** observado na tela com o backend real e o banco de desenvolvimento (conferência da P1, 04/11/2026).
- **[COD]** confirmado por leitura do código ou do schema do banco.
- **[TST]** reproduzido em teste automatizado ou script.
- **[HIP]** hipótese ainda não confirmada.

**Gravidade**

- **Crítica:** perda de dados ou efeito errado em pessoas reais, sem aviso.
- **Alta:** bloqueia uma jornada ou induz a uma decisão errada com efeito real.
- **Média:** a tarefa termina, mas com esforço, confusão ou retrabalho.
- **Baixa:** atrito pontual ou de acabamento.

## A. Defeitos funcionais

### WF-01 · Etapa recém-adicionada impede salvar o rascunho

- **Gravidade:** Crítica. Bloqueia "salvar e continuar depois" no fluxo mais comum, e o erro não diz onde está o problema.
- **Frequência, alcance e confiança:** alta; todo criador de workflow; [TST] [COD].
- **Jornada e tela:** J5, J8 · Editor.
- **Evidência:**
  - O editor cria etapas com campos vazios: `workflow-editor-page.tsx:132,134,138,141`; `node-config/action-form.tsx:142`.
  - O `PUT /:id/draft` aplica o schema completo: `lifecycle-routes.ts:36`; `graph-schema.ts:251,297,308,332,362`; `output-schema.ts:47,51`.
  - O erro vira 400 "Dados inválidos.": `backend/src/main/app.ts:431`.
  - O script com o schema real recusou 6 de 10 etapas na forma em que nascem: Chamar agente, Orquestrador, Output, Política, Gerar feedback e Definir variável.
  - A Wiki promete o contrário: `app/wiki/workflows/criacao/page.tsx:45`.
- **Reproduzir:** adicionar "Ação" ou "Output" sem preencher → Salvar rascunho.
- **Atual:** toast e rodapé dizem só "Dados inválidos.", sem etapa nem campo. O trabalho fica só na memória do navegador.
- **Esperado:** rascunho incompleto é salvo. Enquanto isso não existir, a tela diz qual etapa e qual campo faltam e leva até lá.
- **Impacto:** quem precisa consultar a configuração de um agente não consegue salvar antes de sair.
- **Solução:** rascunho tolerante, com o schema completo só na publicação (P1, aplicada em 04/11/2026). Com dado inválido que não é branco, a tela nomeia a etapa e o campo.
- **Aceite:** salvar com qualquer etapa recém-criada funciona, reabrir mostra o mesmo, e publicar recusa apontando a etapa.
- **Validação:** `draft-graph.test.ts`; `workflow-incomplete-draft-proof` (API real e banco de teste); na tela com o backend real em 04/11/2026 [REAL], ver [relatório](relatorio-2026-11-04.md#10-conferência-integrada-da-p1). QA Lab com rascunho incompleto ficou só em teste.

### WF-02 · Trocar de aba descarta as alterações sem aviso

- **Gravidade:** Crítica. Perda silenciosa de trabalho.
- **Frequência, alcance e confiança:** alta, pois consultar Execuções durante a edição é natural; todo editor; [INT] [COD].
- **Jornada e tela:** J8, J12 · Editor.
- **Evidência:** `workflow-editor-page.tsx:628-645`. O conteúdo inativo da aba é desmontado. Observado: 3 nós e "Salvar" habilitado → Execuções → Editor → 2 nós e "Salvar" desabilitado.
- **Reproduzir:** adicionar uma etapa → aba Execuções → aba Editor.
- **Atual:** a etapa some, sem nenhum aviso.
- **Esperado:** o canvas e as alterações continuam como estavam.
- **Impacto:** retrabalho e desconfiança no editor.
- **Solução:** manter o editor montado e apenas oculto ao trocar de aba.
- **Aceite:** adicionar, trocar de aba e voltar mantém a etapa e "Salvar" habilitado.
- **Validação:** `workflow-editor-page.test.tsx`; navegador.

### WF-03 · Voltar, navegar ou fechar a página sem aviso de alterações não salvas

- **Gravidade:** Alta.
- **Frequência, alcance e confiança:** média; todo editor; [COD].
- **Jornada e tela:** J8 · Editor.
- **Evidência:** não há `beforeunload` nem guarda de navegação em `components/admin/workflows`, em `hooks` ou no botão de voltar (`workflow-editor-page.tsx:535-539`).
- **Atual:** a pessoa sai e perde o que fez.
- **Esperado:** pergunta antes de sair: "Continuar editando" ou "Sair sem salvar".
- **Solução:** `beforeunload` para recarregar e fechar; interceptar links internos com diálogo.
- **Limite aceito:** o botão Voltar do navegador só é coberto pelo aviso do próprio navegador quando a página é descarregada.
- **Aceite:** com alteração pendente, clicar num link interno abre o diálogo; sem alteração, navega direto.
- **Validação:** `use-unsaved-changes-guard.test.tsx`; navegador.

### WF-04 · Primeira publicação por Flag, Indicador ou Manual acontece sem confirmação

- **Gravidade:** Alta. Põe no ar um fluxo que pode gastar IA e entregar conteúdo a pessoas reais, com um clique e sem explicação.
- **Frequência, alcance e confiança:** alta; todo workflow novo desses tipos; [INT] [COD].
- **Jornada e tela:** J10 · Editor.
- **Evidência:**
  - `use-publish-flow.ts:16-18` só abre o diálogo com mudança de configuração, confirmação exigida ou primeira publicação de Agenda.
  - Workflow novo nasce ativo: `migrations/022_workflows.sql:12`.
  - Observado: `POST /publish` direto e o toast "Workflow publicado.".
- **Atual:** nada diz que a próxima interação já dispara o fluxo.
- **Esperado:** a primeira publicação sempre mostra o que começa a valer, quando dispara, para quem e quem recebe.
- **Solução:** abrir o diálogo em toda primeira publicação, com o resumo do fluxo.
- **Aceite:** primeira publicação de qualquer gatilho abre o diálogo; republicar só o fluxo continua direto.
- **Validação:** `publish-flow.test.tsx`; navegador.

### WF-05 · A tela não distingue "no ar", "desativado" e "rascunho diferente do publicado"

- **Gravidade:** Alta. A pergunta central ("o que está rodando?") fica sem resposta.
- **Frequência, alcance e confiança:** alta; todos; [INT] [COD].
- **Jornada e tela:** J10, J13, J14 · Lista e Editor.
- **Evidência:**
  - O selo mostra só Publicado ou Rascunho: `workflow-editor-page.tsx:543-545`; `workflows-page.tsx:210-219`.
  - Só a configuração tem aviso de pendência; o grafo não: `workflow-editor-page.tsx:556-574`.
  - Depois de publicar, observado: "Pronto para publicar" e Publicar habilitado, mesmo sem nada novo.
  - O interruptor aparece ligado em rascunho nunca publicado, com o rótulo "Desativar workflow" (observado).
  - A Wiki descreve "alterações não publicadas": `app/wiki/workflows/page.tsx:263-264`.
  - O motor congela execuções de workflow inativo (`engine.ts:94-98,113`), e o editor não mostra esse estado.
- **Atual:** "Publicado" vale tanto para um fluxo rodando quanto para um desligado.
- **Esperado:** um estado único e legível: "Rascunho — ainda não roda", "No ar", "Desativado — não roda", além de "Alterações não publicadas".
- **Solução:** `workflow-run-state.ts`, usado na lista e no editor; comparar rascunho salvo × versão publicada; desabilitar Publicar quando não há nada novo.
- **Aceite:** os 4 estados aparecem corretamente; sem diferença, Publicar fica desabilitado e o rodapé diz que está publicado.
- **Validação:** `workflow-run-state.test.ts`; navegador.

### WF-06 · Excluir informa pouco, apaga o histórico e pode falhar com erro interno

- **Gravidade:** Alta. Ação irreversível com informação incompleta.
- **Frequência, alcance e confiança:** baixa, mas de alto impacto; todos; [COD].
- **Jornada e tela:** J14 · Lista e Editor.
- **Evidência:**
  - Texto atual: "Execuções em andamento serão interrompidas." (`workflows-page.tsx:146`; `workflow-editor-page.tsx:602`).
  - O `DELETE` não verifica nada nem grava auditoria: `lifecycle-routes.ts:198-207`.
  - Cascata em versões, execuções, variáveis e disparos manuais.
  - A FK de `interaction_feedback_generations` é `NO ACTION` (consultada no banco de dev, sem executar a exclusão), e há 1 linha com `workflow_id` lá. A exclusão desse workflow falharia, e o código 23503 não é mapeado (`app.ts:459-478`), virando "Erro interno.".
  - No editor, não há tratamento de erro: `workflow-editor-page.tsx:607-610`.
- **Atual:** a pessoa não sabe que perde Execuções e Resultados.
- **Esperado:** dizer o que será apagado e o que permanece, com quantidade, e propor "Desativar" como alternativa.
- **Solução:**
  - Agora: novo texto, botão destrutivo e tratamento de erro no editor.
  - Backend (P5): mapear a FK para 409 com mensagem, gravar auditoria e avaliar arquivamento em vez de exclusão.
- **Aceite:** o diálogo cita a contagem de execuções em andamento, o histórico apagado e a alternativa; uma falha mantém a tela e mostra o erro.
- **Validação:** teste de componente; revisão da rota.

### WF-07 · Etapa removida deixa referência quebrada que publica e falha em execução

- **Gravidade:** Alta. O erro só aparece quando o fluxo já está rodando com pessoas reais.
- **Frequência, alcance e confiança:** média; quem edita fluxo publicado; [COD] e editor em [TST].
- **Jornada e tela:** J7, J13 · Editor.
- **Evidência:**
  - A remoção não avisa: `workflow-editor-page.tsx:361-366,444`.
  - Output e Condição com origem removida passam no editor (`WV/outputs.ts:29-31,55`; `WV/conditions.ts:77-94`) e na publicação (`PV/outputs.ts:31-33,74-76`; `PV/conditions.ts:263-292`).
  - Em execução: falha em `output-executor.ts:337`, `node-handlers.ts:355-359`; a revisão pede decisão sem conteúdo em `human-review-executor.ts:71-77`.
- **Esperado:** avisar antes de remover; bloquear a publicação enquanto houver referência quebrada, apontando a etapa.
- **Solução:**
  - Agora: `graph-references.ts` lista quem depende da etapa; confirmação ao remover; nova regra local sobre a origem removida.
  - Backend (P5): espelhar a regra, pois hoje só o editor bloqueia.
- **Aceite:** remover uma etapa usada abre confirmação citando as dependentes; a referência quebrada aparece como problema na etapa e impede Publicar.
- **Validação:** `graph-references.test.ts`; `workflow-validation.test.ts`.

### WF-08 · Revisão humana sem revisor encontrado fica parada para sempre, sem aviso

- **Gravidade:** Alta. Execução invisível e parada.
- **Frequência, alcance e confiança:** baixa a média, conforme a qualidade da hierarquia; [COD].
- **Jornada e tela:** J6, J12 · Execução.
- **Evidência:**
  - `human-review-executor.ts:68-69` só falha quando sobra apenas o próprio colaborador.
  - Lista vazia não notifica ninguém e a espera vai até 2999 (`node-handlers.ts:43,560`).
  - A fila de Pendências filtra pelo destinatário do alerta (`pending-actions-repository.ts:84`).
  - Escalonar, no mesmo caso, falha com motivo (`escalate-executor.ts:50-53`).
- **Esperado:** falhar com motivo legível, como Escalonar, e aparecer em Execuções como problema.
- **Solução:** alterar o backend (P5). Exige decisão, pois um teste registra o comportamento atual como "best-effort".
- **Aceite:** revisor não resolvido leva à falha visível com o motivo.
- **Validação:** teste do executor e prova com banco.

### WF-09 · A mesma saída ligada duas vezes perde uma das ligações em silêncio

- **Gravidade:** Média.
- **Frequência, alcance e confiança:** baixa; [COD] [TST].
- **Jornada e tela:** J5 · Canvas.
- **Evidência:** `onConnect` compara o handle cru (`workflow-editor-page.tsx:292-296`), então `always` e `always::right` não colidem. Ao salvar, os dois viram `always` (`graph-mappers.ts:43-47,56`), e o motor usa só a primeira aresta (`graph-schema.ts:614-615`).
- **Atual:** duas linhas no canvas, uma delas sem efeito.
- **Esperado:** cada saída tem um único destino; a ligação nova substitui a anterior.
- **Solução:** comparar pelo handle canônico.
- **Aceite:** ligar a mesma saída pelo ponto lateral substitui a ligação anterior.
- **Validação:** `graph-mappers.test.ts`.

### WF-10 · O campo de Aguardar muda de unidade e de valor durante a digitação

- **Gravidade:** Média. Pode salvar uma duração diferente da pretendida.
- **Frequência, alcance e confiança:** média; quem usa minutos; [COD] [TST].
- **Jornada e tela:** J6 · Painel.
- **Evidência:** a unidade é inferida da duração a cada alteração (`node-config/wait-form.tsx:14-23`). Digitar `605` em minutos passa por `60`, que vira "1 Horas"; o próximo dígito resulta em 15 horas.
- **Esperado:** a unidade escolhida permanece.
- **Solução:** guardar a unidade em estado local.
- **Aceite:** digitar 605 minutos grava 605 minutos.
- **Validação:** `wait-form.test.tsx`.

### WF-11 · Problema antigo do servidor esconde "Alterações não salvas", e não há como revalidar

- **Gravidade:** Média.
- **Frequência, alcance e confiança:** média; [COD].
- **Jornada e tela:** J9 · Rodapé do editor.
- **Evidência:** `backendIssue` continua vindo do cache com a consulta desabilitada (`use-publish-validation.ts:61`). "Validar de novo" só existe em `error` (`workflow-issues-panel.tsx:53-63`). Quem corrige a causa em outra tela (agente, hierarquia) não tem como revalidar, porque Salvar fica desabilitado sem alteração.
- **Solução:** ignorar o problema do servidor enquanto há alteração pendente; oferecer "Validar de novo" também em `invalid`.
- **Aceite:** com alteração pendente, o rodapé informa que falta salvar; com recusa do servidor, há botão de revalidar.
- **Validação:** `use-publish-validation.test.tsx`; `workflow-issues-panel.test.tsx`.

### WF-12 · Decidir uma revisão em workflow desativado diz que continua, mas nada anda

- **Gravidade:** Média.
- **Frequência, alcance e confiança:** baixa; [COD].
- **Jornada e tela:** J6, J14 · Pendências.
- **Evidência:** Pendências não filtra por `active` (`pending-actions-repository.ts:134`), a decisão não confere `active` (`submit-human-review-decision.ts:29-50`), a mensagem diz que o fluxo continua (`human-review-sheet.tsx:54`), e o motor não pega execuções desse workflow (`engine.ts:94-96`).
- **Esperado:** informar que a decisão fica registrada e o fluxo retoma quando o workflow for reativado.
- **Solução:** backend devolve o estado e a tela ajusta a mensagem (P5).
- **Aceite:** com workflow inativo, a mensagem diz que a retomada depende da reativação.
- **Validação:** teste de rota e de componente.

### WF-13 · Decidir uma revisão com um clique, sem ver o conteúdo, na aba Execuções

- **Gravidade:** Alta. A decisão é definitiva e pode entregar conteúdo ao colaborador.
- **Frequência, alcance e confiança:** média; quem tem `workflows.manage`; [INT] [COD].
- **Jornada e tela:** J12 · Execuções.
- **Evidência:** `workflow-enrollments-tab.tsx:64-82` envia a decisão no clique, sem confirmação e sem conteúdo. A rota aceita qualquer gestor do escopo, mesmo não sendo o revisor designado (`enrollment-routes.ts:129-138`). "A primeira decisão vale" (`submit-human-review-decision.ts:24-27`). Os botões ficam junto das linhas da tabela.
- **Esperado:** confirmar com o efeito de cada decisão e indicar Pendências como lugar normal de revisão.
- **Solução:**
  - Agora: confirmação com o caminho que será seguido.
  - Decisão (P6): manter ou retirar a decisão desta aba.
- **Aceite:** nenhum clique envia decisão sem confirmação; o diálogo cita a decisão e o que acontece depois.
- **Validação:** `workflow-enrollments-tab.test.tsx`.

## B. Usabilidade

### WF-14 · Ligações sem seta e sem rótulo de saída

- **Gravidade:** Alta para fluxos médios e grandes.
- **Frequência, alcance e confiança:** alta; [INT] [COD].
- **Jornada e tela:** J5, J7 · Canvas.
- **Evidência:** `graph-mappers.ts:29-34` não define rótulo nem seta; observado 0 rótulos em 13 ligações. A saída só é identificada no rodapé do card de origem.
- **Atual:** no meio do canvas, não dá para saber qual linha é "Sim" e qual é "Não", nem o sentido do fluxo.
- **Esperado:** cada ligação de uma etapa com várias saídas mostra o nome da saída, e toda ligação mostra o sentido.
- **Solução:** rótulo derivado, nunca persistido, e seta.
- **Aceite:** Condição e Revisão humana mostram os rótulos; o grafo salvo não muda.
- **Validação:** `edge-presentation.test.ts`; navegador.

### WF-15 · O card mostra o id técnico e não mostra o nome da etapa

- **Gravidade:** Alta.
- **Frequência, alcance e confiança:** alta; [INT] [COD].
- **Jornada e tela:** J5, J9 · Canvas e lista de problemas.
- **Evidência:**
  - `workflow-node.tsx:65-68` mostra o tipo e o id (UUID em etapa nova); observado `Gatilho | trigger | ...`.
  - O nome editado no painel não aparece no card.
  - Etapa nova nasce com `label: ""` (`workflow-editor-page.tsx:313`).
  - Observado na lista de problemas: `Ligue a saída "Não" de "" ao próximo passo`, sem identificar a etapa.
- **Esperado:** nome da etapa em destaque, tipo como apoio, nunca id técnico, nunca mensagem com aspas vazias.
- **Solução:** novo nó nasce com nome; o card mostra o nome; a validação recebe nomes de exibição para rascunhos antigos em branco.
- **Aceite:** nenhum UUID no card; nenhuma mensagem com `""`.
- **Validação:** `workflow-node.test.tsx`; navegador.

### WF-16 · A aba Execuções fala a língua do motor e não responde "para quem"

- **Gravidade:** Alta.
- **Frequência, alcance e confiança:** alta; [INT] [COD].
- **Jornada e tela:** J12, J15 · Execuções.
- **Evidência:**
  - "Nó atual" mostra o id (`workflow-enrollments-tab.tsx:224`).
  - Eventos crus: `node_advanced`, `human_review_requested` (linhas 169-170). As traduções existem só em `manual-run-dialog.tsx:63-83`.
  - "Desistiu" (`workflow.schema.ts:400`).
  - "Próxima avaliação" aparece em execução concluída (observado).
  - A busca só compara o id do nó (`enrollment-routes.ts:66`), e o texto sugere buscar "pelo nó atual".
  - Estado vazio: "Nenhuma interação matriculou neste workflow ainda", mesmo sem publicação.
  - A API não traz o colaborador, exceto em execução manual.
- **Esperado:** nome da etapa, evento em português, estado claro, estado vazio orientando o próximo passo e, com P5, a pessoa.
- **Solução:**
  - Agora: nomes e rótulos; retirar a busca inútil; "Encerrada com falha"; "—" em execução terminada; estado vazio conforme o workflow.
  - Backend (P5): incluir colaborador e busca por nome.
- **Aceite:** nenhum UUID nem nome de evento técnico na lista expandida.
- **Validação:** `workflow-enrollments-tab.test.tsx`; navegador.

### WF-17 · "Pessoa específica" exige digitar um identificador interno

- **Gravidade:** Alta, para quem usa a opção.
- **Frequência, alcance e confiança:** baixa nos modelos (0 de 22), mas sem saída quando necessária; [COD].
- **Jornada e tela:** J6 · Painel de Output, Revisão humana e Escalonar.
- **Evidência:** `node-config/output-form.tsx:104-113`; `node-config/hierarchical-target-picker.tsx:74-82`. O rótulo é "Id da pessoa", com texto livre.
- **Esperado:** buscar a pessoa pelo nome.
- **Solução:** `node-config/person-picker.tsx`, com busca.
- **Aceite:** escolher por nome grava o id; id desconhecido é sinalizado.
- **Validação:** `person-picker.test.tsx`.

### WF-18 · Oferece "Pendências" como destino, embora ninguém leia

- **Gravidade:** Média.
- **Frequência, alcance e confiança:** média; [COD].
- **Jornada e tela:** J6 · Painel de Output.
- **Evidência:** `workflow-graph.schema.ts:350`; o aviso em `node-config/output-form.tsx:132-136` admite "não tem consumidor real". Nenhum dos 22 modelos usa a opção.
- **Esperado:** não oferecer para seleção nova; manter visível quando já escolhida, para poder remover. "Superfícies" vira "Onde entregar".
- **Solução:** filtro na própria tela e novos textos.
- **Aceite:** "Pendências" só aparece quando já está selecionada.
- **Validação:** teste de componente.

### WF-19 · Textos incorretos, desatualizados ou com jargão

- **Gravidade:** Média. É a primeira impressão do produto.
- **Frequência, alcance e confiança:** alta; [INT] [COD].
- **Jornada e tela:** J1, J4, J6.
- **Evidência:**

| Onde | Hoje | Problema |
|---|---|---|
| `workflows-page.tsx:349-350` | "quando uma flag chega… definir uma configuração" | Omite 3 gatilhos, Revisão, Output; cita ação legada |
| `workflows-page.tsx:392` | "flags, indicadores ou horários" | Omite Manual |
| `node-config-panel.tsx:115` | "dispara um enrollment por operador do escopo" | Jargão; errado em Consolidado |
| `node-config/human-review-form.tsx:40` | "na aba Execuções" | O revisor decide em Pendências |
| `node-palette.tsx:32` | "clique para adicionar no centro" | Entra abaixo da última etapa |
| `workflows-page.tsx:105` | "Grupo" | O restante da tela usa "Abrangência" |
| `workflow-settings-sheet.tsx:299` | "Orchestrators" | Inglês |
| `workflow-settings-sheet.tsx:333-335` | Manual cai em "Colaborador da medição" | Errado para colaborador ou interação |
| `trigger-fields.tsx:72-75` | "Evento de interação", "Evento de medição" | Não diz quando começa |

- **Solução:** nova redação.
- **Aceite:** nenhuma das frases permanece.
- **Validação:** testes de componente; leitura em navegador.

### WF-20 · A paleta esconde as ações e quebra palavras no meio

- **Gravidade:** Média.
- **Frequência, alcance e confiança:** alta; [INT] [COD].
- **Jornada e tela:** J5 · Editor.
- **Evidência:**
  - `node-palette.tsx:7` lista "Ação" como item genérico; "Chamar agente", "Gerar feedback", "Escalonar" e "Definir variável" só surgem depois de adicionar. A Wiki e as mensagens usam esses nomes.
  - Observado a 1440 px: "Orquestra/dor", "acompan/hamento".
  - Observado a 1024 px, com paleta de 72 px: "Agu/ard/ar".
- **Esperado:** encontrar a ação pelo nome, com uma linha sobre o que ela faz, e sem palavras partidas.
- **Solução:** itens próprios por ação, agrupados; palavras inteiras; largura mínima maior.
- **Aceite:** os quatro itens de ação aparecem, cada um criando a etapa com a ação já escolhida.
- **Validação:** `node-palette.test.tsx`; navegador em 1024 e 1440 px.

### WF-21 · Em fluxos médios, o enquadramento inicial fica ilegível

- **Gravidade:** Média a alta. O próprio catálogo de modelos cai nesse caso.
- **Frequência, alcance e confiança:** alta; [INT].
- **Jornada e tela:** J5, J7 · Canvas.
- **Evidência:** Modelo 14 (12 etapas) a 1440×900: canvas 810×548 px, zoom 0,21, card 47×29 px. Mediana dos modelos: 8 etapas; máximo: 12. Sem minimapa; 280 px acima do canvas.
- **Esperado:** orientação em fluxos maiores.
- **Solução:**
  - Agora: minimapa a partir de 8 etapas; painel de configuração mais largo.
  - Proposta (P4): "Organizar" automático e modo foco.
- **Aceite:** minimapa presente a partir de 8 etapas.
- **Validação:** navegador com fluxo de 12 e 42 nós.

### WF-22 · Quatro maneiras diferentes de salvar na mesma tela

- **Gravidade:** Média.
- **Frequência, alcance e confiança:** alta; [COD].
- **Jornada e tela:** J4, J8 · Editor e Configurações.
- **Evidência:**
  - Gatilho salva sozinho: `trigger-fields.tsx:686`.
  - Nome salva ao sair do campo: `workflow-editor-page.tsx:185`.
  - Abrangência tem botão próprio: `workflow-settings-sheet.tsx:304-306`.
  - Alvo e População dependem de outro botão: `workflow-settings-sheet.tsx:475-479`.
  - O canvas depende de "Salvar rascunho".
- **Esperado:** um modelo só. Referência: n8n salva sozinho e Publicar é a única ação com efeito.
- **Solução:** proposta P2, por mudar o modelo mental.
- **Aceite:** ver P2.
- **Validação:** teste com usuários.

### WF-23 · Um clique não abre a configuração da etapa

- **Gravidade:** Média.
- **Frequência, alcance e confiança:** alta; [COD]; texto da Wiki em `criacao/page.tsx:39,44`.
- **Jornada e tela:** J5 · Canvas.
- **Evidência:** `workflow-editor-page.tsx:436-441`. Um clique só seleciona; o caminho real (duplo clique ou Enter) não aparece em nenhum lugar.
- **Esperado:** clicar na etapa abre a configuração, como a Wiki já descreve.
- **Solução:** clique abre o painel; arrastar não abre.
- **Aceite:** clicar abre; arrastar só move.
- **Validação:** navegador.

### WF-24 · A lista de problemas nunca é a lista completa

- **Gravidade:** Média.
- **Frequência, alcance e confiança:** média; [COD].
- **Jornada e tela:** J9 · Rodapé.
- **Evidência:** o dry-run para no primeiro erro (`validate-workflow-for-publish.ts:31-34`) e só roda sem problema local. Há 29 códigos só no backend. Alguns não têm etapa para abrir: `ORCHESTRATOR_SCOPE_FORBIDDEN`, `RECIPIENT_NOT_FOUND` e outros.
- **Atual:** "2 problemas" pode virar outros depois de salvar, um por vez.
- **Esperado:** todos os problemas de uma vez.
- **Solução:** proposta P5, com o backend acumulando erros.
- **Aceite:** ver P5.
- **Validação:** teste de paridade ampliado.

### WF-25 · Mensagens de validação com enum e termos internos

- **Gravidade:** Média.
- **Frequência, alcance e confiança:** média; [COD].
- **Jornada e tela:** J9.
- **Evidência:**
  - Enum cru: `PV/conditions.ts:100,134`; `WV/conditions.ts:137`; `PV/fan-out.ts:486-488`.
  - Inglês e jargão: "Orchestrator", "Join", "fan-out", "Condition", "dado canônico", "camada de confiabilidade".
  - "Espera" na mensagem, mas "Aguardar" na paleta (`WV/trigger-context.ts:73`).
  - "Histórico do indicador" não existe como opção na tela (`PV/fan-out.ts:123`).
- **Solução:**
  - Agora: ajustes no editor.
  - P5: mesmas correções nas mensagens do backend.
- **Aceite:** nenhuma mensagem do editor com enum cru ou "Espera".
- **Validação:** `workflow-validation.test.ts`.

### WF-26 · Fluxo vazio aparece como "Pronto para publicar"

- **Gravidade:** Média.
- **Frequência, alcance e confiança:** alta em workflow novo; [INT].
- **Jornada e tela:** J2, J10.
- **Evidência:** workflow recém-criado (Gatilho → Fim) mostra "Pronto para publicar" com Publicar habilitado (observado).
- **Esperado:** indicar que o fluxo ainda não faz nada e qual é o próximo passo.
- **Solução:** estado próprio, com orientação inicial no canvas e Publicar desabilitado.
- **Aceite:** Gatilho → Fim não habilita Publicar e mostra a orientação.
- **Validação:** `workflow-issues-panel.test.tsx`; navegador.

### WF-27 · Não há ponte entre o editor e o teste

- **Gravidade:** Média.
- **Frequência, alcance e confiança:** alta; [COD].
- **Jornada e tela:** J11 · Editor e QA Lab.
- **Evidência:** nenhum link do editor para `/admin/simulate`; o QA Lab não aceita workflow pela URL (`workflow-lab.tsx:109`). Só o Administrador geral tem `qa_lab.use` (`roles.ts:22`), e o admin de grupo não tem nenhuma forma de teste sem efeito.
- **Solução:**
  - Agora: botão "Testar" para quem pode, abrindo o workflow já selecionado.
  - Decisão (P3): teste para admin de grupo.
- **Aceite:** o botão abre o QA Lab com o workflow selecionado e não aparece sem permissão.
- **Validação:** teste de componente; navegador.

### WF-28 · Sem modelos utilizáveis, sem duplicar e sem histórico de versões

- **Gravidade:** Alta para adoção.
- **Frequência, alcance e confiança:** alta; [COD].
- **Jornada e tela:** J3, J13, J14.
- **Evidência:**
  - `docs/dev/workflows-modelo.md:55`: "Ainda não existe UX de criar a partir de modelo".
  - A Wiki promete "duplicáveis" (`erros-limitacoes/page.tsx:111`); não há rota nem botão.
  - Nenhuma rota lista versões ou volta a uma anterior.
- **Atual:** para adaptar um modelo, a pessoa edita o próprio modelo.
- **Solução:** propostas P3 e P7.
- **Aceite:** ver propostas.
- **Validação:** teste com usuários.

### WF-29 · Duas pessoas editando: a última gravação apaga a outra

- **Gravidade:** Média.
- **Frequência, alcance e confiança:** baixa; [COD].
- **Jornada e tela:** J8.
- **Evidência:** `lifecycle-routes.ts:42-46` grava sem conferir versão.
- **Solução:** proposta P5, com revisão no `PUT /draft` e aviso 409.
- **Aceite:** gravação concorrente recebe aviso e nada é perdido.
- **Validação:** teste de rota.

### WF-30 · Cards e diálogo escondem informação decisiva

- **Gravidade:** Média.
- **Frequência, alcance e confiança:** alta; [INT] [COD].
- **Jornada e tela:** J6, J10.
- **Evidência:**
  - "Cargo específico — Acompanhamento" não diz qual cargo (`node-visuals.ts:465`).
  - "Ação" não diz qual ação.
  - Com workflow desativado e gatilho por Flag, o diálogo afirma que as próximas interações "passam a usar esta configuração" (`go-live-impact-dialog.tsx:44-46`), o que é falso nesse estado.
  - "Quem revisa" ou "quem recebe" nunca aparece resumido no workflow.
- **Solução:** card com cargo e nome da ação; diálogo conforme `goesLive`; resumo "quando começa, para quem, o que acontece, quem recebe, quando termina".
- **Aceite:** o card mostra o cargo; o resumo responde às 5 perguntas.
- **Validação:** `node-visuals.test.ts`; `workflow-summary.test.ts`.

### WF-31 · Falta de permissão aparece como falha genérica

- **Gravidade:** Baixa a média.
- **Frequência, alcance e confiança:** baixa; [COD] e [INT] para o caso de erro.
- **Jornada e tela:** J1 · Lista e Editor.
- **Evidência:** `app/(app)/admin/workflows/page.tsx` não tem guarda; o texto é "Não foi possível carregar…" (`workflows-page.tsx:388`; `workflow-editor-page.tsx:626`). No editor, o cabeçalho fica em skeleton permanente (linha 619).
- **Solução:** mensagem clara com caminho de volta no editor.
- **Aceite:** com erro, sem skeleton, com link para a lista.
- **Validação:** teste de componente.

## C. Visual

### WF-32 · Editor se degrada em telas menores

- **Gravidade:** Média em 1024 px; baixa em telefone, onde não é uso previsto ([HIP]).
- **Frequência, alcance e confiança:** média; [INT].
- **Jornada e tela:** todas · Editor.
- **Evidência:** a 1024×768, canvas 583×416, paleta 72 px, card do fluxo grande ilegível. A 375×812, paleta 30 px e canvas 286×408, sem aviso. O painel de configuração abre com 236 px a 1440 px.
- **Solução:** largura mínima da paleta, painel mais largo, aviso abaixo de 768 px. `regras-produto-ui-ux.md` pede responsividade em toda tela, então editar em telefone precisa de decisão (P4).
- **Aceite:** sem palavras partidas a 1024 px; o aviso aparece em telefone.
- **Validação:** navegador nos três tamanhos.

## D. Acessibilidade

### WF-33 · Ligar etapas e remover ligações dependem de arrastar ou de tecla

- **Gravidade:** Alta. Requisito WCAG 2.2 AA (2.5.7) e A (2.1.1).
- **Frequência, alcance e confiança:** alta para quem usa teclado ou tem dificuldade motora; [COD]. A documentação do React Flow não afirma que há conexão por teclado.
- **Jornada e tela:** J5 · Canvas.
- **Evidência:** handles só por arrasto ou clique (`workflow-node.tsx:52-58,102-133`); remover ligação só selecionando e usando Delete (`workflow-editor-page.tsx:444`).
- **Esperado:** alternativa por formulário.
- **Solução:** seção "Próximo passo" no painel: um seletor por saída, com a opção "Sem ligação".
- **Aceite:** ligar e desligar qualquer saída só com teclado.
- **Validação:** `next-step-fields.test.tsx`; teclado no navegador.

### WF-34 · Nomes acessíveis, idioma e status

- **Gravidade:** Média. Requisitos 4.1.2 (A), 3.1.2 (AA) e 4.1.3 (AA).
- **Frequência, alcance e confiança:** alta para tecnologia assistiva; [INT] [COD].
- **Jornada e tela:** Editor.
- **Evidência:**
  - Voltar sem nome (observado: `aria-label` nulo): `workflow-editor-page.tsx:535-539`.
  - Campo de nome da etapa sem rótulo: `node-config-panel.tsx:65-69`.
  - Controles e instruções em inglês: "Zoom In", "Fit View", "Press enter or space to select a node".
  - Rodapé de status sem `role="status"`, exceto em validação.
  - Erro só por cor em parte do card: o ícone `AlertTriangle` não tem nome.
- **Solução:** rótulos, `ariaLabelConfig` em português, `role="status"`.
- **Aceite:** verificação por DOM sem nome vazio; textos em português.
- **Validação:** teste de componente; `read_page` no navegador.

## E. Documentação

### WF-35 · Documentação divergente da tela e do backend

- **Gravidade:** Média. Quem segue a Wiki pode montar um fluxo que a publicação recusa, ou procurar um comportamento que não existe.
- **Frequência, alcance e confiança:** alta para quem aprende pela Wiki; [COD].
- **Jornada e tela:** todas · Wiki e `docs/workflow-engine-wiki.md`.
- **Evidência:** relatório, §4, e a lista aberta em [registro-de-achados.md](registro-de-achados.md).
- **Solução:** corrigir a Wiki junto com cada mudança da tela; revisar as páginas restantes depois das decisões P1, P3 e P8, para não reescrever duas vezes.
- **Aceite:** cada item da lista resolvido; o passo a passo de criação executável na tela, do início ao fim.
- **Validação:** seguir a Wiki literalmente na tela (matriz).

## Achados da conferência com o backend real (04/11/2026)

Só apareceram com dados reais e numa sessão real. Linhas citadas valem para o estado anterior à correção.

### WF-36 · Resumo de workflow Manual promete rodar para todos

- **Gravidade:** Média. O diálogo de publicação sugeria um disparo em massa que não existe.
- **Frequência, alcance e confiança:** todo workflow Manual; [REAL] [COD].
- **Jornada e tela:** J10 · Diálogo de publicar e Resumo.
- **Evidência:** `describeAudience` em `workflow-summary.ts` usava "todos os colaboradores elegíveis" para qualquer gatilho individual.
- **Atual:** "Uma execução por colaborador: todos os colaboradores elegíveis".
- **Esperado:** dizer que roda uma vez por clique, para o colaborador escolhido.
- **Solução e validação:** texto próprio para Manual; `workflow-summary.test.ts`; visto na tela.

### WF-37 · Orientação do fluxo vazio cobre os cards

- **Gravidade:** Média. A primeira tela de um workflow novo escondia o Gatilho.
- **Frequência, alcance e confiança:** todo workflow novo; [REAL].
- **Jornada e tela:** J5 · Editor.
- **Evidência:** o painel sobre o canvas cobria o card Gatilho a 1280×800. Embaixo, ficava com 141 px de largura a 375×812 e cobria Gatilho e Fim, pois o painel do React Flow se limita à metade do canvas.
- **Esperado:** orientação legível, sem cobrir nada.
- **Solução e validação:** a orientação saiu de cima do canvas e fica logo acima dele. Medido com o backend real: nenhuma sobreposição nos dois tamanhos.

### WF-38 · "Resultado completo de Resultado de:"

- **Gravidade:** Baixa.
- **Frequência, alcance e confiança:** toda etapa com origem de agente, em Output, Revisão e Escalonar; [REAL].
- **Jornada e tela:** J6 · Painel da etapa.
- **Atual:** "Publicando o resultado completo de Resultado de: Agente… — sem campos declarados pra escolher."
- **Solução e validação:** "Publicando o resultado completo de Agente…: esta origem não separa o resultado em campos."; `content-sources.test.ts`; vista na tela.

### WF-39 · Etapas novas entram abaixo do Fim

- **Gravidade:** Média. O desenho sugere um fluxo que termina antes de começar.
- **Frequência, alcance e confiança:** todo workflow novo montado pela paleta; [REAL] [COD].
- **Jornada e tela:** J5 · Canvas.
- **Evidência:** `addNodeAtDefaultPosition` em `workflow-editor-page.tsx` soma 220 px à etapa mais baixa, e o Fim nasce logo abaixo do Gatilho. Com o fluxo ligado, a ligação do Gatilho até a primeira etapa passa por trás do Fim.
- **Esperado:** o Fim fica depois da última etapa.
- **Solução proposta:** ao adicionar, a nova etapa assume a posição do Fim e ele desce, ou tratar com "Organizar" (P4). Só muda posição, sem efeito na versão publicada.
- **Aceite:** adicionar 3 etapas pela paleta nunca deixa o Fim acima delas.

### WF-40 · Abrir o painel corta cards e esconde o título do painel

- **Gravidade:** Média.
- **Frequência, alcance e confiança:** comum em telas de até 1280 px; [REAL]. A causa é hipótese [HIP] até reproduzir com o painel medido.
- **Jornada e tela:** J6 · Editor.
- **Evidência:** ao abrir o painel de 360 px, o canvas encolhe sem mudar o enquadramento, e os cards à direita ficam cortados. Numa etapa em branco, o foco no campo de busca rola o painel, e "Excluir nó" e o título ficaram fora da área visível (`top` negativo no DOM).
- **Observação não esclarecida:** duas vezes, clicar num card com o painel aberto, usando a referência da ferramenta do navegador, caiu no fundo do canvas e fechou o painel. Com o painel fechado, o mesmo card abriu normalmente. Pode ser só efeito da ferramenta; não foi reproduzido com o mouse.
- **Esperado:** a etapa selecionada e o título do painel continuam visíveis.
- **Solução proposta:** centralizar a etapa quando ela ficar fora da área visível, como a lista de problemas já faz, e não rolar o painel ao focar o primeiro campo.
- **Aceite:** a 1280×800, abrir qualquer etapa mantém o card e o título do painel visíveis.

## Achado da preparação dos testes da P5 (04/11/2026)

### WF-41 · Origem em variável entrega sem o valor

- **Gravidade:** Alta. Na Revisão, a pessoa decide sem ver o valor que deveria avaliar.
- **Frequência, alcance e confiança:** só quem escolhe uma variável como conteúdo; nenhuma versão no ar em dev usa isso; [TST] [COD].
- **Jornada e tela:** J6 · Painel de Output, Revisão e Escalonar.
- **Evidência:**
  - A tela oferece "Variável: X" e diz "Publicando o valor atual da variável" (`structured-content-picker.tsx:80-81,151`).
  - `resolveSource` só conhece `nodeOutputs` (`output-executor.ts:68`), e é o que os três usam (`output-executor.ts:221`, `human-review-executor.ts:71`, `escalate-executor.ts:61`). Condição e Definir variável usam `resolveContextValue`, que lê variáveis.
  - Prova `workflow-broken-reference-proof`: Output com `variables.<id>` entregou "Um workflow gerou uma saída relacionada a Colaboradora Prova P5b.", sem o valor. Revisão e Escalonar também saíram sem ele.
- **Esperado:** o valor da variável chega a quem recebe.
- **Por que importa para a P5:** sem esta correção, a regra de D2 faria esses fluxos pararem, em vez de entregarem o valor.
- **Solução:** a mesma leitura de Condição nos três, com o valor no formato do tipo, e a publicação exigindo que uma etapa anterior defina a variável (P5b). O seletor só oferece essas variáveis.
- **Também corrigido:** o campo de texto escolhido do resultado estruturado sofria o mesmo defeito, pois valor simples não virava texto.
- **Aceite:** os testes de `variables.<id>` da prova passam, para texto, número e verdadeiro/falso, e variável sem valor para com o motivo.
- **Validação:** `workflow-broken-reference-proof`; `node-references.parity`; Output por Notificação na tela com o backend real, em ambiente isolado.

## Achados da conferência da P5 (04/11/2026)

**Evidência destas três fichas:** o que está como [INT] foi visto com o backend real, em ambiente local isolado (worktree, banco `inia_wf42` e portas próprias, sem chave de IA). As linhas citadas valem para `2915c209`.

### WF-42 · Impedimento da nova tentativa fica fora da área visível

- **Gravidade:** Baixa. O servidor já recusava a confirmação, mas a pessoa não sabia por quê sem rolar.
- **Frequência, alcance e confiança:** toda nova tentativa com impedimento, em janela baixa; [INT] [COD].
- **Jornada e tela:** Aba Execuções · diálogo "Nova tentativa da execução".
- **Evidência:** a 597×731, "Confirmar" aparecia desabilitado e o aviso ficava no fim da área que rola (`retry-dialog.tsx`, impedimentos dentro do corpo rolável).
- **Esperado:** quem não pode confirmar vê o motivo junto da ação, sem rolar.
- **Solução:**
  - Cabeçalho, situação e ações ficam fixos, e só os detalhes rolam, numa região com nome e foco de teclado.
  - Uma região só anuncia carregando, erro, recusa e impedimento, então o aviso não se repete.
  - "Confirmar" usa `aria-disabled` e aponta para essa região. Assim o foco fica no botão quando uma recusa o desabilita, e o motivo é lido junto.
- **Aceite:** em todos os estados, o diálogo cabe na janela e as ações ficam à vista; com impedimento, o aviso aparece uma vez e Enter não envia nada.
- **Validação:**
  - Testes: `retry-dialog.test`, `workflow-enrollments-tab.test`.
  - Tela: a 597×731, 1440×900 e 1440×500, descrita no [relatório, §12](relatorio-2026-11-04.md#12-wf-42-e-contagem-do-sino).

### WF-43 · Contagem do sino não respeita a permissão fora da lista

- **Gravidade:** Média. O número prometia um aviso que a pessoa não conseguia encontrar nem resolver.
- **Frequência, alcance e confiança:** quem perdeu `workflows.manage` e tem aviso de execução bloqueada mais antigo que os 20 itens da lista; [COD] [TST].
- **Jornada e tela:** Sino.
- **Evidência:** a permissão só era conferida nos 20 itens da lista. `countUnread` contava todos os avisos da pessoa, inclusive os que ela não pode mais ver.
- **Esperado:** a mesma regra decide o que aparece e o que conta, sem marcar nada como lido.
- **Solução:**
  - A consulta lê os workflows dos avisos da pessoa, sem o grafo, e confere cada um com `canManageScope`, a regra da aba Execuções.
  - A lista, a contagem, marcar como lido e marcar tudo usam o mesmo resultado.
  - Os alcances só são carregados quando a pessoa tem aviso desse tipo.
  - A migration 170 cria um índice parcial só para esse tipo de aviso.
- **Aceite:** a [matriz de regressão](matriz-regressao.md), itens 52 a 56.
- **Validação:** `blocked-notice-visibility-proof` no banco isolado e sino na tela, com aviso de 40 dias.

### WF-44 · Recusa por revisor ou conteúdo ausente não atualiza a prévia

- **Gravidade:** Média. A tela seguia oferecendo uma confirmação que o servidor recusaria de novo, sem atualizar o que mostrava.
- **Frequência, alcance e confiança:** a causa volta com o diálogo aberto, como a hierarquia alterada por outra pessoa; [INT] [COD].
- **Jornada e tela:** Aba Execuções · diálogo "Nova tentativa da execução".
- **Evidência:**
  - Na tela, o servidor respondeu 409 com a prévia nova. O status ficou vazio, "Confirmar" continuou habilitado e a mensagem apareceu só num toast, sobre as ações.
  - `WORKFLOW_RETRY_REVIEWER_MISSING` e `WORKFLOW_RETRY_CONTENT_MISSING` (P5c, `workflow-retry.ts`) não estavam em `WORKFLOW_RETRY_HANDLED_CODES` (`workflow-retry.schema.ts`). Os demais impedimentos da prévia já estavam.
- **Esperado:** a mesma resposta das outras recusas: prévia nova, impedimento junto da ação, sem toast.
- **Solução:** os dois códigos entraram na lista.
- **Aceite:** com a recusa, o impedimento aparece uma vez, o foco fica em "Confirmar", o botão não confirma e nada é criado.
- **Validação:** `workflow-enrollments-tab.test`, nos dois códigos; revisor ausente visto na tela. Conteúdo ausente só em teste.

## F. Hipóteses que exigem pesquisa com usuários

| Id | Hipótese | Como validar |
|---|---|---|
| H1 | A maioria dos administradores quer adaptar um modelo, não desenhar um grafo do zero | Entrevista e teste com 5 administradores; `workflow_versions` por origem depois de P3 |
| H2 | "Abrangência", "Alvo da avaliação" e "População" são entendidos como conceitos diferentes | Teste de compreensão: pedir para explicar com as próprias palavras |
| H3 | "Agente" × "Orquestrador" é clara para quem configura | Teste de escolha com cenários |
| H4 | Admin de grupo precisa testar antes de publicar | Entrevista; pedidos de suporte |
| H5 | "Output" é menos claro que "Entregar resultado" | Teste A/B de rótulo em protótipo |
| H6 | A aba Execuções é usada por quem desenha o fluxo, e Pendências por quem revisa | Monitoria de uso, com a coleta ligada só para essa área |
| H7 | Telefone não é um dispositivo real para editar fluxos | Confirmar com o produto |
