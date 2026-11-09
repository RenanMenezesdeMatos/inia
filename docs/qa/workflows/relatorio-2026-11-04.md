# Auditoria de UX e QA — Workflows (04/11/2026)

## 1. Diagnóstico executivo

**A funcionalidade é tecnicamente sólida, mas ainda não é compreensível nem segura de usar sem conhecer a arquitetura.**

O motor, a validação de publicação, o rascunho × publicada e a confirmação de impacto da Agenda são bem resolvidos. O problema está na camada que a pessoa usa: a tela fala a língua da implementação, perde trabalho sem aviso e não responde com clareza "o que está rodando?".

| Perfil (ver §2) | Criar do zero | Adaptar modelo | Publicar com confiança | Acompanhar e diagnosticar |
|---|---|---|---|---|
| Administrador geral com conhecimento do motor | Consegue, com atrito | Consegue, sem ajuda da tela | Parcial | Consegue, lendo termos técnicos |
| Administrador geral sem conhecimento do motor | Difícil | Difícil | Não | Não |
| Administrador de grupo | Difícil, sem teste seguro | Difícil | Não | Parcial |
| Revisor (supervisão, gerência) em Pendências | Não se aplica | Não se aplica | Não se aplica | Bom para decidir; fora do escopo do editor |

Os cinco problemas mais importantes:

1. **Perda de trabalho.** Adicionar uma etapa e clicar em Salvar pode falhar com "Dados inválidos." (WF-01), e trocar de aba apaga as alterações (WF-02).
2. **Efeito real sem aviso.** A primeira publicação por Flag vai ao ar com um clique (WF-04), e uma revisão humana pode ser decidida com um clique, sem ver o conteúdo (WF-13).
3. **Estado invisível.** "Publicado" não diz se está rodando, nem se o rascunho difere do publicado (WF-05).
4. **Canvas que não se explica.** Sem o nome da etapa no card, sem rótulo nas ligações, com id técnico à vista (WF-14, WF-15).
5. **Publica e falha depois.** Referência removida passa na validação (WF-07), e revisão sem revisor fica parada para sempre (WF-08).

## 2. Públicos

Não há documento de personas. Derivado de `roles.ts`, das telas e dos exemplos da Wiki, portanto **hipótese** a confirmar com o produto.

| Público | Objetivo | Conhecimento necessário hoje | Permissão |
|---|---|---|---|
| Administrador geral | Criar, testar e publicar fluxos para toda a organização | Motor, contexto individual × consolidado, agentes | `workflows.manage` e `qa_lab.use`, na organização |
| Administrador de grupo | O mesmo, dentro do próprio grupo | O mesmo, sem QA Lab | `workflows.manage` no grupo; não vê fluxos de "Todos os grupos" |
| Revisor | Decidir o que vai ao colaborador | Nenhum sobre o motor | Destinatário do alerta; decide em Pendências |
| Colaborador | Receber o resultado | Nenhum | Nunca vê o editor |

## 3. Jornadas auditadas

Ambiente: instância real do frontend com API simulada e dados fictícios (ver §8). As jornadas J3, J11 e J15 foram avaliadas principalmente por código.

| # | Objetivo | Entrada | Etapas e decisões | Retorno da tela | Pontos de confusão | Achados |
|---|---|---|---|---|---|---|
| J1 | Entender para que serve | Menu Automação → Workflows | Ler a descrição, abrir um exemplo | Descrição só de flag; sem modelo de exemplo | Texto antigo; nada mostra um fluxo típico | WF-19, WF-31 |
| J2 | Criar do zero | "Novo workflow" | Nome, tipo de gatilho, valor, abrangência | Abre o editor com Gatilho → Fim | Diz "Pronto para publicar" num fluxo vazio | WF-19, WF-26 |
| J3 | Partir de um modelo | Não existe | Editar o próprio "Modelo · NN" | Nenhum | **Jornada inexistente**: adaptar altera o modelo | WF-28 |
| J4 | Gatilho, abrangência, população, modo | Nó Gatilho e Configurações | 4 seções, 3 formas de salvar | Selo "Configuração não publicada" | Termos próximos; salvamento misto | WF-19, WF-22 |
| J5 | Montar o fluxo | Paleta e canvas | Adicionar, ligar, mover, remover | Card, lista de problemas | "Ação" genérica; clique não abre; sem rótulos; sem desfazer | WF-09, WF-14, WF-15, WF-20, WF-21, WF-23, WF-33 |
| J6 | Configurar cada etapa | Painel lateral | Campos por tipo | Problemas no topo do painel | Id de pessoa; "Superfícies"; "Pendências" sem leitor | WF-10, WF-17, WF-18, WF-30 |
| J7 | Entender de onde vêm os dados | Seletores de origem | Escolher resultado anterior | "Resultado de: X" | Remover a etapa não avisa | WF-07, WF-14 |
| J8 | Salvar, sair e retomar | Salvar rascunho | Salvar | Toast | Falha com etapa incompleta; sai sem aviso | WF-01, WF-02, WF-03, WF-29 |
| J9 | Corrigir erros | "Ver problemas" | Abrir a etapa | Lista com navegação | Lista parcial; aspas vazias; jargão | WF-11, WF-15, WF-24, WF-25 |
| J10 | Entender o impacto | Publicar | Confirmar, às vezes | Diálogo só em Agenda ou mudança | Primeira publicação direta | WF-04, WF-05, WF-30 |
| J11 | Executar e testar | Executar agora; QA Lab no menu | Colaborador e dados | Estado real na execução manual: bom | Sem ponte para o QA Lab | WF-27 |
| J12 | Acompanhar | Abas Execuções e Resultados | Filtrar, expandir | Status; Resultados claros | Execuções com id e evento crus; sem "para quem" | WF-13, WF-16 |
| J13 | Corrigir um fluxo publicado | Editar → Publicar | Salvar, publicar | Execuções seguem na versão delas | Sem número da versão vigente, histórico ou volta | WF-05, WF-07, WF-28 |
| J14 | Pausar, duplicar, excluir | Interruptor só na lista; lixeira | Ligar/desligar; excluir | Sem aviso de congelamento | Sem duplicar; exclusão subinforma | WF-05, WF-06, WF-12, WF-28 |
| J15 | Recuperar-se | Nova tentativa; mensagens | Bloqueada → Nova tentativa | Bom em bloqueio | Falha técnica sem próximo passo claro | WF-08, WF-16 |

**Questionando a própria jornada.** A criação começa pedindo um grafo. Para quem só quer "avisar a supervisão quando a nota cair", o caminho natural é escolher um objetivo e ajustar um modelo. Os 22 modelos existem, mas só como rascunhos no banco de demonstração. Por isso a proposta P3 troca o ponto de partida. Polir o canvas não resolve esse problema: reduz o atrito de quem já está nele.

## 4. Documentação × interface × backend

Lista completa no registro (WF-35). As divergências de maior efeito:

| Documentação diz | Realidade | Onde |
|---|---|---|
| Editar Agenda "tem efeito imediato"; existe "despublicar" | Fica no rascunho até Publicar; não existe despublicar | `docs/workflow-engine-wiki.md:130-131` |
| Rascunho "pode ser salvo mesmo inválido" | Recusado com etapa incompleta | `app/wiki/workflows/criacao/page.tsx:45` |
| Excluir "interrompe execuções" | Apaga execuções de qualquer status e pode falhar | `criacao/page.tsx:83` |
| Revisão decidida "na aba Execuções" (tela) | O revisor decide em Pendências | `node-config/human-review-form.tsx:40` |
| "Gerar feedback" espera o QA | Nunca espera decisão humana | `nodes/page.tsx:159-160`; `generate-feedback-action.ts:14-17` |
| Só o Orquestrador roda depois de Consolidar | "Chamar agente" de síntese também roda, e os modelos usam | `nodes/page.tsx:106-108`; `PV/fan-out.ts:111` |
| Modelos "duplicáveis" | Não há duplicar | `erros-limitacoes/page.tsx:111` |
| 11 tipos de nó | São 12 | `nodes/page.tsx:11,34` |
| Agent indisponível tem "retry limitado" | Bloqueia e espera ação humana | `erros-limitacoes/page.tsx:30`; `engine.ts:299-318` |
| Output ao operador pode usar o Agent direto | Publicação exige "Gerar feedback" | `outputs/page.tsx:54-58`; `PV/reliable-feedback.ts:102-110` |

## 5. Referências e como se aplicam

Todas consultadas em 04/11/2026.

### Requisitos de acessibilidade (WCAG 2.2)

| Critério | Nível | Aplicação |
|---|---|---|
| [2.1.1 Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard) | A | Posicionar e ligar etapas não depende do trajeto, então precisa de alternativa por teclado (WF-33) |
| [2.5.7 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements) | AA | Ligar etapas precisa de alternativa de clique. O exemplo do W3C de "ligar linhas" clicando nos dois itens se aplica (WF-33) |
| [2.4.11 Focus Not Obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum) | AA | Foco não pode ficar totalmente atrás de rodapés e painéis. A verificar quando o canvas muda de tamanho |
| [4.1.2 Name, Role, Value](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value) | A | Link só com ícone e campo sem rótulo falham (WF-34) |
| [4.1.3 Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages) | AA | "Salvo" e "N problemas" devem ser anunciados sem mover o foco (WF-34) |
| [3.1.2 Language of Parts](https://www.w3.org/WAI/WCAG22/Understanding/language-of-parts) | AA | Textos em inglês do React Flow numa página pt-BR (WF-34) |
| [3.3.3 Error Suggestion](https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion) | AA | Erro detectado com correção conhecida precisa sugeri-la (WF-01, WF-25) |
| [1.4.1 Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color) | A | Saída e estado não podem depender só de cor (WF-14) |

### Recomendações de usabilidade (Nielsen Norman Group)

| Fonte | Aplicação |
|---|---|
| [10 heurísticas](https://www.nngroup.com/articles/ten-usability-heuristics/) | Estado visível (WF-05), linguagem do usuário (WF-16, WF-19), controle e saída (WF-02, WF-03), prevenção (WF-07), recuperação (WF-01) |
| [Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) | Dois níveis como limite prático. "Staged disclosure" se complica quando as etapas dependem entre si, que é o caso de gatilho × modo × população: por isso P2 não propõe um assistente rígido |
| [Error Message Guidelines](https://www.nngroup.com/articles/error-message-guidelines/) | Mensagem perto da origem, sem jargão, com próximo passo e preservando o que foi digitado (WF-01, WF-25) |
| [Slips](https://www.nngroup.com/articles/slips/) | Restrições e bons padrões: novo nó com nome, opções incompatíveis fora da lista (WF-15, WF-18) |
| [User Mistakes](https://www.nngroup.com/articles/user-mistakes/) | Prévia antes de ação difícil de reverter; respeitar o modelo mental (WF-04, resumo do fluxo) |
| [Confirmation Dialogs](https://www.nngroup.com/articles/confirmation-dialog/) | Confirmar só o que é sério e irreversível, citar o item e rotular o botão com a ação. Por isso republicar sem mudança continua direto e Excluir ganha texto específico (WF-04, WF-06, WF-13) |

### Referências de mercado (avaliadas, não copiadas)

| Produto | O que fazem | Adequação para a INIA |
|---|---|---|
| [n8n: salvar e publicar](https://docs.n8n.io/build/understand-workflows/save-and-publish-workflows) | Salva sozinho; Publicar só habilita com mudança; produção usa a versão publicada; restaurar não afeta produção | **Adotar:** Publicar sem novidade desabilitado (WF-05) e, por decisão, salvar sozinho (P2) |
| [n8n: depurar execução](https://docs.n8n.io/workflows/executions/debug) | "Debug in editor" copia os dados da execução para o editor | **Avaliar depois:** pode expor dados pessoais; exige regra de acesso. Não adotar agora |
| [Zapier: rascunhos e versões](https://help.zapier.com/hc/en-us/articles/9693520498445-Create-Zap-drafts-and-versions) | Um rascunho por vez; versão numerada, com autor e data; novo rascunho a partir de versão antiga | **Adotar em P7:** a INIA já guarda a versão; falta mostrar |
| [Zapier: testar etapas](https://help.zapier.com/hc/en-us/articles/18811411817741-Test-Zap-steps) | Testar ação é real e pode alterar dados | **Não adotar:** o QA Lab da INIA já isola efeitos, o que é melhor para dados de pessoas |
| [Power Automate: erros](https://learn.microsoft.com/power-automate/troubleshoot-flow-errors) | Guia por sintoma; etapa com falha destacada na execução | **Adotar:** organizar a falha por etapa em Execuções (WF-16) e sintoma na Wiki |
| [Make: execuções incompletas](https://help.make.com/manage-incomplete-executions) | Corrigir e tentar de novo, a partir da execução parada | **Já comparável:** "Nova tentativa" cobre o caso de bloqueio |
| [React Flow: acessibilidade](https://reactflow.dev/learn/advanced-use/accessibility) | Foco, seleção e movimento por teclado; `ariaLabelConfig` | **Adotar:** textos em português. A página não afirma conexão por teclado, daí o formulário de WF-33 |

## 6. Obstáculos para adoção e uso recorrente

1. **Medo de publicar.** Sem resumo claro e sem teste para quem não é administrador geral.
2. **Ponto de partida errado.** Canvas vazio em vez de um modelo adaptável.
3. **Vocabulário interno.** "Output", "Superfícies", "Ação", "matriculou", "enrollment", ids técnicos.
4. **Falta de confiança no salvamento.** Quatro formas de salvar e perda ao trocar de aba.
5. **Diagnóstico difícil depois de publicar.** Execuções não dizem para quem nem por quê, em português.

Os achados priorizados, com gravidade, frequência, alcance e confiança, estão em [achados.md](achados.md).

## 7. Recomendações e plano

Propostas maiores, com antes/depois e critérios de aceite, em [propostas.md](propostas.md).

| Etapa | Conteúdo | Risco | Depende de |
|---|---|---|---|
| 1 | Correções de frontend desta rodada: perda de dados, estado, canvas legível, textos, acessibilidade | Baixo | Nada |
| 2 | Backend: problemas acumulados, referências, revisor e exclusão (P5). O rascunho tolerante (P1) já foi aplicado | Médio | Revisão em banco |
| 3 | Modelos e duplicar (P3); versões (P7) | Médio | Decisão de produto |
| 4 | Salvamento único e configuração sem Sheet (P2); organizar e modo foco (P4) | Médio | Teste com usuários |
| 5 | Medir com os indicadores e repetir a auditoria | Baixo | Instrumentação |

## 8. Limitações da auditoria

- **Login real só na conferência da P1.** A leitura da senha demo e a criação de contas temporárias foram negadas pela política de permissão desta sessão, e nada foi contornado. A auditoria observou a interface em instância isolada com **API simulada**; o que dependia do banco veio de leitura de código ou do schema, e está marcado assim. Depois, o próprio administrador entrou, e a P1 foi conferida com o backend real (§10).
- **Sem efeitos reais.** Nada foi executado ou excluído no ambiente de desenvolvimento. A única publicação foi a do workflow de teste com gatilho Manual (§10), desligado ao final. A exclusão com FK foi avaliada lendo o catálogo, sem executá-la.
- **Consultas de leitura ao banco de dev.** Contagens e definições de constraint, sem dados pessoais. Uma tentativa de criar contas temporárias falhou numa transação que não foi confirmada; conferi em seguida que nenhuma linha ficou gravada.
- **Sem usuários.** Nenhuma entrevista ou teste com pessoas. Compreensão é hipótese (achados, seção F).
- **Tecnologia assistiva.** Avaliação por código, DOM e teclado, sem leitor de tela real.
- **Tamanho de tela.** As medidas usaram emulação no painel do navegador.
- **Não coberto a fundo.** `Selecionar colaboradores` com ranking, Política de acompanhamento e a aba Resultados com dados.
- **Sessões paralelas.** Outras sessões editavam o mesmo checkout. As mudanças de backend além da P1 ficaram para depois, pois salvar arquivos em `backend/src` reinicia a API de desenvolvimento compartilhada.

## 9. Melhorias implementadas

Sem migration e sem mudar regra de negócio. Tudo no frontend, exceto a P1, aprovada depois do diagnóstico, que mudou o salvamento do rascunho no backend. O estado de cada achado está em [registro-de-achados.md](registro-de-achados.md).

| Antes | Depois | Achados |
|---|---|---|
| Trocar de aba ou sair apagava alterações sem aviso | Editor continua montado; diálogo "Sair sem salvar?"; "Alterações não salvas" sempre visível | WF-02, WF-03 |
| Salvar etapa incompleta respondia "Dados inválidos." | Rascunho incompleto salva e reabre; o que falta aparece na lista de problemas; publicar, dry-run e QA Lab recusam apontando a etapa | WF-01 |
| Primeira publicação por Flag sem aviso | Diálogo com quando começa, para quem roda, o que acontece, quem recebe e quando termina | WF-04, WF-30 |
| "Publicado" para tudo; Publicar sempre habilitado | "Rascunho — ainda não roda", "No ar", "Desativado — não roda", "Fluxo não publicado"; Publicar desabilitado sem novidade e em fluxo vazio | WF-05, WF-26 |
| Card com id técnico; ligações sem seta nem rótulo; `de ""` nas mensagens | Nome da etapa, tipo real, setas, "Sim", "Não", "Aprovado"…; minimapa a partir de 8 etapas | WF-14, WF-15, WF-21, WF-30 |
| Clique não abria a etapa; "Ação" genérica na paleta; palavras partidas | Clique abre; ações pelo nome, agrupadas e com uma linha sobre cada uma | WF-20, WF-23 |
| Ligar só arrastando; remover ligação só com tecla | "Próximo passo" no painel, com teclado e "Sem ligação" | WF-33 |
| Remover etapa em uso sem aviso; referência quebrada publicava | Confirmação citando as dependentes; bloqueio no editor | WF-07 |
| Execuções com id, `node_advanced`, "Desistiu", busca inútil | Nome da etapa, evento em português, "Encerrada com falha", estado vazio orientando | WF-16 |
| Decidir revisão em um clique | Confirmação com o efeito de cada decisão | WF-13 |
| Pessoa por id digitado; "Superfícies"; "Pendências" sem leitor | Busca por nome; "Onde entregar"; opção sem leitor fora da seleção nova | WF-17, WF-18 |
| Excluir: "execuções serão interrompidas" | Diz que apaga o histórico, com a contagem, o que permanece e a alternativa | WF-06 |
| Controles em inglês; voltar e nome da etapa sem rótulo | Português; nomes acessíveis; `role="status"` | WF-34 |
| Sem caminho para testar | "Testar" abre o QA Lab com o workflow escolhido, para quem tem permissão | WF-27 |
| Textos antigos ou errados, na tela e na Wiki | Nova redação; Wiki de criação refeita para seguir a tela | WF-19, WF-35 |
| Saída ligada duas vezes; Aguardar mudando na digitação; problema antigo escondendo "não salvas" | Corrigidos | WF-09, WF-10, WF-11 |

### Evidências de validação

- Instância isolada com API simulada, com interação real onde indicado: clique, arrasto e teclado no canvas e no painel; capturas a 1440×900, 1024×768 e 375×812. **A instância simulada mostra a interface, mas não prova a integração com o backend.**
- Testes nas áreas afetadas (Workflows, schemas de administração, QA Lab e Wiki): 56 arquivos e 679 testes passando na execução final. Antes das mudanças, Workflows e schemas somavam 33 arquivos e 437 testes. `eslint` sem problemas nos arquivos alterados e `tsc --noEmit` sem erros.
- Paridade no backend: `validate-workflow-for-publish.parity` e `official-model-workflows` passaram sem alteração no backend.
- **Na suíte completa do frontend, rodada antes dos últimos ajustes, 2 testes fora de Workflows falharam** (`feedback-review` e `usability-page`; 2.237 passaram). Os dois passaram quando rodados isoladamente, em arquivos sem mudança nesta rodada. Tratado como instabilidade sob carga, não investigado a fundo.
- Console da instância: o React Flow avisou uma vez que o contêiner estava sem largura e altura. Sem efeito visível nas telas conferidas; não comparado com a versão anterior.

## 10. Conferência integrada da P1

**Quando e como:** 04/11/2026, com a API e o frontend deste checkout e o banco de desenvolvimento, na sessão do próprio administrador, no navegador do app. **Isto substitui a tela simulada como prova da P1.**

**Workflow de teste:** `9fe18060-b63c-4916-a93e-6c1c417366b0`, "QA P1 · Rascunho incompleto (sem efeito)", gatilho Manual, criado pela tela e nunca executado.

| Passo | Observado na tela | Conferido na API ou no banco |
|---|---|---|
| Adicionar "Chamar agente" e "Output" em branco e salvar | "Rascunho salvo."; "2 problemas"; Publicar desabilitado | `PUT /draft` 200; `agentId` e `source` gravados vazios |
| Recarregar | Cards e problemas iguais; "Salvo"; sem erro de carga | `GET` 200 |
| Completar agente, destino, conteúdo e ligações, e salvar | "Pronto para publicar" | `POST /validate` 200; 0 versões; 0 execuções |
| Publicar | Diálogo real antes de qualquer `POST /publish`, com "Nada é executado ao publicar"; depois "No ar", "Sem alterações" e Publicar desabilitado | 1 versão; 0 execuções; 0 usos de IA; 0 avisos do workflow |
| Editar o rascunho no ar: etapa em branco, salvar, recarregar | "No ar" + "Fluxo não publicado"; "Salvo · alterações ainda não publicadas"; Publicar desabilitado; card "Agente ainda não escolhido" | `PUT` 200; **mesmo `active_version_id` e mesmo hash do grafo**; 4 etapas no ar × 5 no rascunho |
| Publicar direto na API com o rascunho incompleto | — | `POST /publish` 422, "Em "Chamar agente", escolha o agente.", com `nodeId`; `/validate` `valid:false`; continuou 1 versão |
| Remover etapas sem salvar e sair | Orientação do fluxo vazio, medida a 1280×800 e 375×812 | Banco inalterado: 5 etapas no rascunho |
| Desligar pelo interruptor | "Desativado — não roda"; Executar agora explica "O workflow está desativado" | `active = false`; mesma versão; 0 execuções; 0 usos de IA |

**Resultado:** WF-01, WF-04 (com gatilho Manual), WF-05 e WF-26 passam a `validado`.

**Achados novos:** WF-36, WF-37 e WF-38, corrigidos e vistos na tela; WF-39 e WF-40, abertos.

**Não coberto nesta conferência**

- Publicar por Flag, Indicador ou Agenda, pois teria efeito real.
- "Executar agora" até o fim, pois chamaria IA e avisaria uma pessoa.
- QA Lab com rascunho incompleto (só em teste).
- Arrasto real no canvas, aviso do navegador ao recarregar com alterações não salvas, e conta com escopo de grupo.

**Testes na árvore exata de cada commit** (cópia limpa, sem os arquivos das outras sessões)

- Só a P1: `tsc` do backend sem erros; 1.083 testes passando em QA Lab, `workflows/application`, paridade, modelos oficiais e `draft-graph`; provas `workflow-incomplete-draft-proof` e `workflow-draft-configuration-proof` passando no banco de teste; 437 testes do frontend em Workflows e schemas.
- Com o editor e a Wiki: `tsc` e `eslint` do frontend sem erros; 660 testes passando em Workflows, QA Lab, schemas e Wiki; 486 de paridade, modelos e `draft-graph`.
- A suíte completa do frontend não foi repetida nesta conferência.

**Estado final do workflow de teste:** desligado, 1 versão, 0 execuções, rascunho com a etapa em branco. Pode ser excluído quando não for mais útil.

**Console:** dois `ERR_CONNECTION_REFUSED` ficaram registrados na aba, sem origem identificada. Nenhum recurso da página recarregada falhou, e a API reiniciou durante a sessão, o que pode explicá-los.

## 11. Implementação da P5b, P5c e WF-41

**Autorização:** implementar sem acessar o Azure, sem implantar, sem push e sem chamadas pagas de IA. O levantamento em homologação passou a ser verificação anterior à implantação.

**Onde está:** em `admin-list-standardization`, no merge `5ba86346` de 04/11/2026, sem push e sem implantação. A worktree e a branch auxiliar foram removidas depois de confirmado que não guardavam nada exclusivo.

### O que mudou

| Item | Comportamento agora |
|---|---|
| Publicação (P5b) | Publicar e dry-run recusam, com a etapa, origem que não existe ou não vem antes em Output, Condição, Revisão e Escalonar. O editor mostra o mesmo |
| Conteúdo ausente (D2) | Output e Escalonar encerram com o motivo, sem entregar nada. Revisão bloqueia: ninguém decide sem ver o conteúdo |
| Origem em variável (WF-41) | Chega a Output, Revisão, Escalonar e detalhe de Pendências, no formato do tipo. A publicação exige que uma etapa anterior a defina, e o seletor só oferece essas |
| Revisão sem revisor (P5c) | "Bloqueada — sem revisor", com o caso e a orientação. Revisor inativo não passa a vez a quem está acima (D3). Escalonar também deixa de avisar quem está inativo |
| Aviso (D1) | Quem publicou a versão vigente e mantém acesso recebe, mesmo sendo o colaborador da execução; quem perdeu o acesso não recebe. Sem o nome do colaborador |
| Nova tentativa | A prévia confere a causa de novo e impede confirmar enquanto ela continuar. Na mesma versão, continua da etapa, sem repetir o que já rodou |
| Telas | Motivo certo em Execuções, Executar agora e nova tentativa; contagem de bloqueadas na lista; aviso no sino, levando à aba Execuções |

**Efeito além do pedido:** um campo de texto escolhido do resultado estruturado tinha o mesmo defeito da variável, e também passou a chegar. O rótulo de bloqueio em Resultados deixou de dizer "agente inativo".

### Validação em ambiente local isolado

Worktree própria, banco `inia_p5_qa` copiado do banco de teste, API e tela em `127.0.0.1` nas portas 3543 e 3510, sem chave de IA, sem segredos de IA na cópia e com os workflows copiados desligados. Entrei com uma conta de teste que existe nos fixtures do projeto. O banco e os servidores foram removidos ao final.

| Passo na tela | Resultado |
|---|---|
| Executar agora, para colaboradora sem Supervisor | Execução `blocked`, motivo `HUMAN_REVIEW_NO_REVIEWER`, caso `NO_ONE_IN_CHAIN`, 0 tentativas |
| Lista de workflows | "1 bloqueada", separada de "em execução" |
| Sino | "Execução bloqueada: …", com a etapa e o motivo, sem o colaborador; 2 bloqueios no dia geraram 1 aviso |
| Clicar no aviso | Abre o workflow na aba Execuções, com "Bloqueada — sem revisor" e a orientação |
| Nova tentativa sem corrigir | Mostra o motivo, e "Confirmar" fica desabilitado |
| Corrigir a hierarquia e confirmar | Continua da revisão, com aviso à supervisão; a execução original continua bloqueada |
| Output com variável | O seletor mostra a variável; a supervisão recebeu o valor exato |
| Rascunho com origem removida | "Vem de uma etapa que não existe mais" na lista de problemas; Publicar desabilitado; `POST /publish` 422 com `nodeId` |

**A tela achou o que os testes não acharam:** o diálogo de Executar agora dizia "o agente está inativo" numa revisão sem revisor. Corrigi e cobri com teste, e depois conferi na tela (ver "Conferência depois da junção").

**Sem efeito fora do ambiente isolado:** 0 usos de IA registrados na hora da validação; nenhum dado de teste no banco de desenvolvimento. A API compartilhada reiniciou às 11:57, no mesmo segundo em que outra sessão salvou arquivos em `backend/src` do checkout principal; esta rodada não escreveu nele.

### Testes

| Verificação | Resultado |
|---|---|
| Backend, suíte completa | 487 arquivos e 5.342 testes passando; 92 arquivos e 565 testes pulados, que são sobretudo provas que exigem `INIA_DB_PROOF` |
| Provas no banco de teste | `workflow-broken-reference-proof` 25, `workflow-human-review-no-reviewer-proof` 33, `manual-run-proof` 2, `workflow-draft-configuration-proof` 1, `workflow-incomplete-draft-proof` 1, `workflow-results-proof` 5, `workflow-engine-concurrency-proof` 6, `bell-queries-proof` 1, `agent-lifecycle-proof` 9: todas passando |
| Frontend, suíte completa | 207 arquivos e 2.246 testes passando; 1 pulado |
| `tsc`, `eslint`, `typecheck:scripts` | Sem erros |
| `next build` | Terminou com sucesso |

- **Os 8 testes pendentes foram escritos e passam:** QA Lab com origem ausente, QA Lab sem revisor, aviso fora do Acompanhamento, Consolidar com filha bloqueada, filha bloqueada na nova tentativa, nova tentativa em versão diferente, contagem na lista e na tabela, e abertura por `?tab=enrollments`.
- **Testes existentes que mudaram:** o "best-effort" de `human-review-executor.test.ts` agora exige o bloqueio. Fixtures de QA Lab e do router tinham revisão sem revisor ou origem inexistente, e foram corrigidas.
- **Instabilidade:** numa primeira rodada completa, `assistant-router-structured-output` falhou uma vez (401 em vez de 409). Passou nas duas repetições isoladas e na rodada completa final; não foi investigado.
- **Ajuste depois das suítes:** o último ajuste foi só de tipo numa fixture de teste; depois dele repeti `tsc`, `manual-run-dialog` e `next build`, e não as suítes completas.

### Conferência depois da junção

No código juntado (`5ba86346`), de novo em banco e portas isolados, sem IA, com uma colaboradora sem Supervisor na hierarquia:

| Tela | O que apareceu |
|---|---|
| Executar agora | "Bloqueada"; "Este colaborador não tem o cargo pedido na hierarquia. Ajuste a hierarquia ou o revisor da etapa e solicite uma nova tentativa."; "Nada foi entregue — a execução parou antes da entrega." |
| Nova tentativa | "A execução original continua “Bloqueada — sem revisor”"; "Parou em “Revisão da supervisão” — este colaborador não tem o cargo pedido na hierarquia."; impedimento "Não é possível confirmar agora", com a mesma causa; "Confirmar nova tentativa" desabilitado |

**A mensagem corresponde ao bloqueio por falta de revisor**, e nenhum dos dois diálogos cita agente inativo. Nesta conferência a nova tentativa não foi confirmada; a confirmação depois de corrigir a hierarquia foi vista na validação anterior.

**Observação (WF-42):** a 597×731, o impedimento fica abaixo da área visível do diálogo, e "Confirmar" aparece desabilitado sem o motivo à vista até rolar. O motivo do bloqueio, porém, aparece no topo. Tratado no [§12](#12-wf-42-e-contagem-do-sino).

### Limitações

- **Verificação em homologação não executada.** O Azure não foi acessado. Os números de desenvolvimento não dizem o que acontece lá.
- **Só provado por teste, sem ver na tela:** perda de permissão, publicador que é o colaborador, demais casos sem revisor, versão antiga com referência, QA Lab, fan-out, Escalonar e Revisão com variável, e Chat com variável.
- **Avatar com variável não testado.** Chat foi provado até a gravação da mensagem.
- **Fluxos sem IA.** Os resultados anteriores à revisão foram semeados na execução, e não produzidos por um agente. Nada confirma o comportamento com IA real nesta rodada.
- **Dados de teste.** A cópia do banco de teste não tem o volume nem a hierarquia da operação.
- **Tela estreita.** A conferência visual foi numa área de 597 px de largura. Outras larguras não foram vistas nesta rodada.
- **Contagem do sino.** Só os avisos da lista do sino são conferidos com a permissão: um aviso mais antigo que ela pode seguir contando nos não lidos até a pessoa marcar tudo como lido. Tratado no [§12](#12-wf-42-e-contagem-do-sino).
- **Risco aceito em D2.** Um fluxo com ramos que entregava o aviso vazio passa a parar com motivo, e o levantamento não detecta esse caso.
- **Sem usuários.** Os textos novos não foram avaliados com pessoas.

## 12. WF-42 e contagem do sino

Duas correções autorizadas, com um defeito novo encontrado na conferência (WF-44). Foram feitas na branch `claude/wf42-sino`, a partir de `2915c209`, e juntadas depois ([§13](#13-junção-do-wf-42-wf-43-e-wf-44)). **Sem push e sem implantação.**

### O que mudou

| Item | Antes | Agora |
|---|---|---|
| Diálogo de nova tentativa (WF-42) | A 597×731, "Confirmar" desabilitado, com o motivo no fim da área que rola | Só os detalhes rolam. Situação e ações ficam fixas, e o aviso aparece uma vez, junto da ação |
| Contagem do sino (WF-43) | Só os 20 itens da lista eram conferidos com a permissão; a contagem incluía todos | Lista, contagem, marcar como lido e marcar tudo usam a mesma regra da aba Execuções, sem depender do limite da lista |
| Recusa do servidor (WF-44) | Revisor ou conteúdo ausente depois de abrir: toast sobre as ações, prévia antiga e "Confirmar" habilitado | Prévia nova, impedimento junto da ação, foco em "Confirmar" e nenhum toast |

O badge lê só os workflows dos avisos daquela pessoa, sem o grafo. Os alcances só são carregados quando ela tem aviso desse tipo. A migration 170 cria um índice parcial para esse tipo de aviso. Nada é marcado como lido para esconder a diferença.

### Conferência visual

Com o backend real, em ambiente local isolado: worktree própria, banco `inia_wf42`, portas 3543 e 3510, `GEMINI_API_KEY` vazia e conta de teste do próprio banco. A API compartilhada não foi reiniciada. Tudo abaixo foi visto na tela e medido na página.

**Diálogo**

| Estado | Janela | O que apareceu |
|---|---|---|
| Bloqueado | 597×731 | Diálogo de 16 a 715 px, dentro da janela; detalhes rolam; aviso uma vez, logo acima de "Confirmar"; botão com `aria-disabled` e descrito pelo aviso; foco inicial em Cancelar |
| Bloqueado | 1440×900 | Diálogo de 126 a 775 px; aviso e ações à vista |
| Bloqueado | 1440×500 | Depois de recarregar, diálogo de 16 a 484 px, com 468 px de altura máxima; detalhes rolam; aviso e ações à vista |
| Teclado | 597×731 | Tab vai de Cancelar a "Confirmar" e depois aos detalhes; Enter em "Confirmar" bloqueado não envia nada; End rola os detalhes até o fim, sem esconder aviso nem ações |
| Carregando | 597×731 | "Conferindo a versão, os agentes e os destinos…" junto das ações; sem detalhes; "Confirmar" bloqueado, Cancelar disponível. Atraso simulado no navegador |
| Erro ao carregar | 597×731 | Mensagem junto das ações; sem detalhes; "Confirmar" bloqueado, Cancelar disponível. Resposta 500 simulada no navegador |
| Disponível | 597×731 e 1440×900 | Sem aviso; "Confirmar" habilitado; sem descrição |
| Recusa: revisor ausente | 597×731 | Hierarquia desfeita com o diálogo aberto; 409; impedimento junto da ação; foco em "Confirmar"; nenhum toast; aviso uma vez |
| Recusa: dados mudaram | 597×731 | Versão 2 publicada com o diálogo aberto; 409; prévia passa à versão 2 e a "Recomeça do início"; "Os dados mudaram desde que você abriu"; foco em "Confirmar", que segue disponível; nenhuma tentativa criada |
| Erro genérico ao confirmar | 597×731 | Diálogo aberto, foco em "Confirmar", toast do app. Resposta 500 simulada no navegador |
| Sucesso | 1440×900 | Diálogo fecha; "Nova tentativa iniciada."; tentativa criada, aguardando na revisão |

**Sino**, com a conta de teste, um aviso recente, um aviso de 40 dias e 56 avisos de outros tipos, mais novos que o antigo:

| Situação | Sino | Lista | No banco |
|---|---|---|---|
| Com permissão | "58 não lidas" | 20 itens: o aviso recente aparece e o de 40 dias fica fora, mas conta | 2 avisos não lidos |
| Permissão retirada | "56 não lidas" | 20 itens, nenhum aviso de execução bloqueada; a pessoa sai da área de administração | Os 2 continuam não lidos |
| Permissão recuperada | "58 não lidas" | Igual à primeira linha | 2 avisos não lidos |

### Testes automatizados

Rodados contra o banco isolado, recriado limpo da cópia do banco de teste antes da rodada.

| Verificação | Resultado |
|---|---|
| Backend: `tsc`, `typecheck:scripts`, `eslint` | Sem erros |
| Backend: suíte completa | 487 arquivos e 5342 testes passaram; 93 arquivos e 589 testes pulados, as provas que exigem `INIA_DB_PROOF` e outros já condicionados |
| `blocked-notice-visibility-proof` (nova) | 24 passaram |
| `workflow-human-review-no-reviewer-proof` | 33 passaram |
| `workflow-broken-reference-proof` | 25 passaram |
| `conversational-delivery-proof` | 7 passaram |
| `workday-reconciliation-proof` | 13 passaram |
| `agent-lifecycle-proof` | 9 passaram |
| `workflow-engine-concurrency-proof` | 6 passaram |
| `workflow-results-proof` | 5 passaram |
| `manual-run-proof` | 2 passaram |
| `bell-queries-proof`, `workflow-draft-configuration-proof`, `workflow-incomplete-draft-proof` | 1 passou em cada |
| Frontend: `tsc` | Sem erros |
| Frontend: `eslint` | Sem erros; 1 aviso, em arquivo que esta rodada não alterou |
| Frontend: suíte completa | 208 arquivos e 2252 testes passaram; 1 pulado |
| `next build` | Terminou sem erro e gerou `.next/BUILD_ID` |

**Os testes falham sem a correção:**

- Sem a regra na contagem, 11 dos 24 testes da prova do sino falham.
- Sem os dois códigos na lista de recusas, os 2 testes novos do diálogo falham.
- Com os arquivos restaurados, todos voltaram a passar.

O que a prova do sino cobre e a tela não viu:

- Administrador de organização, grupo e subgrupo, com a aba Execuções como referência.
- Mistura de avisos permitidos e não permitidos.
- Workflow removido, desligado ou sem versão; etapa removida; chave fora do formato.
- Isolamento entre destinatários e entre organizações.
- Avisos lidos, resolvidos e expirados, e os demais tipos de aviso.
- Marcar como lido e marcar tudo sem acesso.
- Custo: nenhuma consulta devolve o grafo, e o índice aparece no plano.

### WF-44, encontrado na tela

Nos testes, a recusa só cobria códigos que já estavam na lista. Na tela, com a hierarquia desfeita depois de abrir, o servidor respondeu 409 e a prévia continuou a antiga, com "Confirmar" habilitado e um toast sobre as ações. A P5c havia criado os dois códigos no backend sem incluí-los na lista do diálogo. Esse defeito está em `admin-list-standardization` desde a junção da P5 (`5ba86346`) e saiu de lá com a junção do [§13](#13-junção-do-wf-42-wf-43-e-wf-44).

### Limitações

- **Junção.** Quando esta seção foi escrita, nada estava juntado. O estado atual está no [§13](#13-junção-do-wf-42-wf-43-e-wf-44).
- **Dados alterados direto no banco isolado.** A hierarquia, a versão 2, a retirada da permissão e o aviso de 40 dias foram preparados por SQL, e não pela tela. A publicação e a administração de acessos não fizeram parte desta conferência.
- **Respostas simuladas.** Carregando, erro ao carregar e erro genérico ao confirmar usaram atraso ou 500 injetados no navegador.
- **Toast genérico.** A 597 px, o toast de um erro genérico cobre Cancelar por alguns segundos, e a mensagem não fica no diálogo. É o componente global de avisos do app; não foi alterado.
- **Foco depois do sucesso.** O botão que abriu o diálogo some da linha, e o foco vai para o corpo da página. Não foi alterado.
- **Leitor de tela real não usado.** Foram conferidos foco, ordem do Tab e atributos de acessibilidade.
- **Medição logo depois de redimensionar.** A primeira leitura a 1440×500 ainda vinha da altura anterior e mostrou o diálogo fora da janela. A leitura seguinte, sem recarregar, e a leitura depois de recarregar mostram o diálogo dentro dela. A troca de tamanho numa janela real não foi medida separadamente.
- **Só em prova ou teste, sem ver na tela:** os itens da lista acima e a recusa por conteúdo ausente.
- **Volume.** O custo foi conferido pelas consultas e pelo plano, num banco pequeno. Não houve medição de tempo com o volume da operação.
- **Fluxo sem IA.** O workflow de teste não tem etapa de agente, e nenhuma chamada paga foi feita.
- **Sem usuários.** A nova organização do diálogo não foi avaliada com pessoas.

## 13. Junção do WF-42, WF-43 e WF-44

Commit de junção `10cc428f`, em `admin-list-standardization`, às 14:28:55 de 04/11/2026. **Sem push, sem implantação, sem acesso ao Azure e sem chamadas pagas de IA.**

### Antes de juntar

| Conferência | Resultado |
|---|---|
| Checkout | Em `2915c209`, a base da branch. 147 entradas de alterações de outras sessões, nada preparado para commit e nenhum arquivo da branch entre elas. A lista ficou idêntica antes e depois da junção |
| Uso do que mudou | Nenhum arquivo alterado por outras sessões usa as funções que a branch alterou |
| Número 170 | Livre em todas as branches e worktrees. A 169 é de outra sessão, sem commit. Nenhum ajuste foi preciso |
| Teste em andamento | **Havia um.** Às 14:25, outra sessão rodava um script de interface com login na API compartilhada. A junção esperou 120 s seguidos sem navegador automatizado, sem execução em posse e sem login novo (14:28:38), com nova conferência imediatamente antes |

O critério não enxerga uma pessoa navegando só com leituras: havia conexões abertas do Chrome na API, e conexão aberta não diz se alguém está testando.

### Ordem da validação

O commit de junção foi criado primeiro numa cópia limpa, onde a validação começou. O checkout avançou para esse mesmo commit, sem criar outro, quando a API ficou sem teste, com a validação ainda em andamento. O resultado final saiu depois da junção, e o commit é o mesmo.

### Validação do commit integrado

Worktree limpa em `10cc428f`, banco descartável copiado do banco de teste, com a 170 aplicada só nele, e sem chave de IA.

| Verificação | Resultado |
|---|---|
| Backend: `tsc` e `typecheck:scripts` | Sem erros |
| Backend: notificações, workflows, entrega conversacional, pendências e QA Lab | 67 arquivos e 1344 testes passaram; 15 arquivos e 120 testes pulados, entre eles as provas rodadas abaixo |
| `blocked-notice-visibility-proof` | 24 passaram |
| `workflow-human-review-no-reviewer-proof` | 33 passaram |
| `workflow-broken-reference-proof` | 25 passaram |
| `workday-reconciliation-proof` | 13 passaram |
| `agent-lifecycle-proof` | 9 passaram |
| `conversational-delivery-proof` | 7 passaram |
| `workflow-engine-concurrency-proof` | 6 passaram |
| `workflow-results-proof` | 5 passaram |
| `manual-run-proof` | 2 passaram |
| `bell-queries-proof`, `workflow-draft-configuration-proof`, `workflow-incomplete-draft-proof` | 1 passou em cada |
| Frontend: `tsc` | Sem erros |
| Frontend: workflows, schemas administrativos e notificações | 51 arquivos e 557 testes passaram |

A árvore do commit de junção é idêntica à de `f517398e`, onde as suítes completas, `eslint` e `next build` passaram ([§12](#12-wf-42-e-contagem-do-sino)). Por isso eles e a conferência visual não foram repetidos.

### API compartilhada depois do reinício

- **Reinício:** 1 s depois da junção, às 14:28:56, com o processo 83912 trocado pelo 3105.
- **Respostas:** `/health` ok e `/ready` pronto às 14:29. A rota do sino sem sessão responde 401, e a tela de login em `:3000`, 200.
- **Outro reinício, sem relação com a junção:** às 14:34:31 a API trocou de novo de processo (5988), quando outra sessão salvou `governance-router.ts`, no mesmo segundo pelo horário do arquivo. Às 14:34:42 `/ready` já respondia pronto; depois disso, a API respondeu pronta de novo.
- **Execuções:** nenhuma ficou com posse vencida.
- **Sino com sessão: não conferido.** O painel do navegador não tinha sessão nessa porta, e credenciais não foram usadas.
- **O que foi feito no lugar:** as consultas novas, pelo código juntado, rodaram no banco de desenvolvimento em transação somente leitura desfeita no fim. Responderam em poucos milissegundos para quem tem até 366 avisos. Esse banco não tem aviso desse tipo, então o caminho com aviso só foi exercitado em prova e na tela isolada do §12.

### A aplicação depende da migration 170?

**Não para funcionar. A migration só melhora o desempenho.**

- Ela cria um índice parcial, sem coluna nem dado novo, e nenhum código de produção cita esse índice.
- Num banco sem o índice, 23 dos 24 testes do sino passam. O único que falha é o que confere o plano de execução. As outras 41 provas rodadas nesse banco (`bell-queries`, revisão sem revisor e entrega conversacional) passam.
- A API compartilhada iniciou e ficou pronta sem ele.

Mediana de 30 execuções, com volume sintético, no computador local:

| Pessoa | Consulta | Sem o índice | Com o índice |
|---|---|---|---|
| 400 avisos, com avisos desse tipo | Ler os workflows dos avisos | 0,25 ms | 0,16 ms |
| 400 avisos, com avisos desse tipo | Contar não lidos | 0,40 ms | 0,37 ms |
| 400 avisos, com avisos desse tipo | Lista | 0,65 ms | 0,52 ms |
| 50 mil avisos, nenhum desse tipo | Ler os workflows dos avisos | 9,71 ms | 0,13 ms |
| 50 mil avisos, nenhum desse tipo | Contar não lidos | 4,08 ms | 4,00 ms |
| 50 mil avisos, nenhum desse tipo | Lista | 0,72 ms | 0,52 ms |

O ganho aparece na leitura dos workflows e só pesa com histórico muito grande. Uma pessoa com 50 mil avisos e também muitos avisos desse tipo não foi medida.

Dois efeitos fora da aplicação:

- **Provas de banco.** Elas recusam banco com migration pendente. Quem rodar prova num banco sem a 170 precisa antes de `npm run db:migrate:test`.
- **Implantação.** `npm run update` aplica as pendentes. O índice é criado sem `concurrently`, então bloqueia escritas em `alerts` durante a criação. Vale olhar o tamanho da tabela em homologação.

Estado dos bancos:

| Banco | Migration 170 |
|---|---|
| `inia` (desenvolvimento) | Não aplicada, por decisão desta etapa |
| `inia_test` (teste compartilhado) | Aplicada às 14:29:56, um minuto depois da junção, e **não por esta sessão**. Origem não identificada. Hipótese: outra sessão rodou prova pelo checkout, e a recusa pede esse comando |
| Bancos descartáveis desta validação | Removidos |

As worktrees temporárias e a branch `claude/wf42-sino` foram removidas depois de conferir que não restava commit exclusivo. A ponta da branch era `f517398e`.

### Decisão de 04/11/2026

**WF-42, WF-43 e WF-44 estão concluídos no escopo implementado**, e as limitações do §12 e deste §13 continuam valendo. A migration 170 não será aplicada no banco de desenvolvimento agora, porque não impede o funcionamento. A conferência do sino com sessão na API compartilhada continua pendente e não bloqueia essa conclusão.

### Pendências

| Pendência | Situação | Quando |
|---|---|---|
| Levantamento anterior à implantação | `levantamento-p5.mjs` não executado; números de desenvolvimento não substituem | Antes de implantar |
| Migration 170 no banco de desenvolvimento | Não aplicar agora, por decisão de 04/11/2026; não impede o uso | Quando autorizado |
| Desempenho do badge | Só há a medição sintética acima. Sem medição com volume real nem com muitas pessoas consultando ao mesmo tempo. O índice não muda a contagem, de cerca de 4 ms com 50 mil avisos | Em homologação, junto do levantamento |
| Toast sobre Cancelar | A 597 px, o toast de um erro genérico cobre Cancelar por alguns segundos, e a mensagem não fica no diálogo. É o componente global de avisos | Sem prazo definido |
| Foco depois do sucesso | O botão que abriu o diálogo some da linha, e o foco vai para o corpo da página | Sem prazo definido |
| Sino com sessão na API compartilhada | Não conferido; não bloqueia a conclusão | Na próxima conferência com a sessão de uma pessoa |
