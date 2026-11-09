# Reports recorrentes — desenho e decisões (16/10/2026)

Pedido: transformar consultas que líderes fazem à INIA ("quem está no Q4?", "TOP 3 em Reincidência", "supervisores com pior PRV") em
reports recorrentes, configuráveis, entregues no Acompanhamento com visualização e análise da IA — sempre com dado atualizado,
no escopo de quem recebe.

## Princípios

- **O report guarda uma DEFINIÇÃO reproduzível**, nunca texto de chat: ferramenta da liderança (`INDICATOR_QUERY`, `WORKFORCE`,
  `INDICATOR_DIAGNOSIS`) + parâmetros válidos (indicadores por CÓDIGO, visão, agrupamento, filtros, ordenação, limite) + estrutura +
  período. A execução chama as MESMAS ferramentas do chat (`executeLeadershipTool`), com o MESMO cálculo e escopo.
- **Fixo × relativo**: estrutura `RECIPIENT` ("a estrutura de quem recebe", resolvida a cada execução — "minha equipe") ou `FIXED`
  (uma estrutura específica, validada contra o escopo de cada destinatário). Período `LAST_CLOSED` (última competência fechada e
  coberta, recalculada a cada execução), `LAST_N_CLOSED` (últimas N), `FIXED_MONTH` (AAAA-MM), `CURRENT` (período em curso pela
  medição diária: mês/semana/7 dias) ou `TODAY` (situação funcional na data da execução).
- **Período analisado ≠ frequência**: a agenda diz QUANDO roda; o período diz QUE dados entram.
- **Números vêm da aplicação**: o cartão da ferramenta, o conjunto de dados do gráfico e a comparação são calculados por código; a IA só
  interpreta valores fornecidos (nunca inventa número).

## Permissões

- **Líder** (lidera alguém ou tem `indicators.view` — a mesma regra da área Diagnóstico): cria reports só para si; vê e gerencia só os
  próprios; só estruturas do próprio escopo atual.
- **Papel "Report"** (`REPORT`, permissão nova `reports.distribute`, atribuível em organização, Grupo ou Subgrupo): cria reports para
  todos os usuários elegíveis, níveis hierárquicos, cargos (`job_title`), Grupos, Subgrupos ou pessoas — sempre recortado pelo escopo
  da atribuição. Distribuir NÃO dá acesso a dado: quem cria não vê o conteúdo entregue a outros (só o histórico da execução), e cada
  destinatário recebe só o que o escopo DELE alcança.
- **Revalidação a cada execução**: conta e pessoa do responsável ativas; distribuição ainda permitida; estrutura fixa ainda no escopo;
  destinatários resolvidos no momento (membros atuais de nível/cargo/Grupo/Subgrupo; conta e pessoa ativas); escopo de cada um
  calculado com a conta dele (`loadViewerScope`). Destinatário sem acesso à estrutura fixa ou sem estrutura própria (modo
  `RECIPIENT`) é registrado como não atendido — nunca recebe uma visão mais ampla.
- **Versões por escopo**: destinatários são agrupados pela chave de escopo (sujeito da estrutura + conjunto de membros); a consulta roda
  uma vez por chave; cada pessoa recebe uma única entrega por execução (chave única execução × pessoa).

## Agenda e execução

- Agenda: `DAILY` | `WEEKLY` (dias da semana) | `MONTHLY` (dia do mês ou último dia) em horários HH:mm no fuso da organização
  (`operations.timezone`, mostrado na tela). Dia inexistente no mês (ex.: 31 em abril): escolha explícita — **pular** aquele mês ou
  **usar o último dia**. Cálculo puro reaproveitando `schedule-recurrence.ts` (sem biblioteca de datas, como o resto do projeto).
- Worker (papel `worker`, serviço do Windows em produção): job exclusivo `report-schedule` (60 s) cria `report_runs` para reports
  ativos vencidos (`next_run_at <= now()`), chave única `(report_id, scheduled_for)`, e avança `next_run_at` por compare-and-swap.
  Atraso longo (worker parado) gera UMA execução para o último horário vencido — nunca uma avalanche. Job `report-runs` reivindica
  execuções com `for update skip locked` e lease; falha técnica volta à fila até 3 tentativas. Entregas: chave única
  `(run_id, scope_key)` e `(run_id, recipient_person_id)` — reprocessar nunca duplica.
- Desativar: `next_run_at = null` (nada novo agenda); execuções na fila são marcadas como ignoradas. Editar a agenda recalcula o
  próximo horário. Excluir: exclusão lógica (`deleted_at`), agenda cancelada; histórico e entregas preservados para auditoria.

## Atualização das bases (regra explícita)

Fontes por definição: fechamento oficial (`OFFICIAL_INDICATOR_PERFORMANCE`; + `PRV_PERFORMANCE` quando entra PRV), medição diária
(`INDICATOR_MEASUREMENTS`), situação funcional (`EMPLOYEES`/`EMPLOYEE_ABSENCES`), interações (`INTERACTIONS`, diagnóstico).

Marca d'água por fonte (metadado real): versão `OFFICIAL` de `analytics_versions` (muda a cada escrita no fechamento oficial),
maior `period_end` das medições dos membros, maior `started_at` das interações dos membros, frescor da situação funcional
(`resolveEmploymentStatusFreshness`), e o estado dos feeds da Central de Dados do contrato (`last_success_at`, `last_data_at`,
`computeFreshness`) para dizer o que está pendente e a última atualização conhecida.

Decisão por chave de escopo:
1. Sem cobertura (menos de 70% das pessoas da estrutura com dado no período) → **não encaminhado** (`INSUFFICIENT_COVERAGE`).
2. Situação funcional desatualizada (feed vencido) → **não encaminhado** (`STALE_SOURCES`).
3. Mesma competência/período da última entrega válida e nenhuma marca d'água avançou → **não encaminhado** (`STALE_SOURCES`):
   "Report não encaminhado: as bases necessárias ainda não foram atualizadas para o período configurado."
4. Marca avançou mas os dados deste report são idênticos aos da última entrega (impressão digital igual) → **não encaminhado**
   (`NO_CHANGE`) — dado igual nunca é apresentado como novo.
5. Caso contrário → **entrega válida** (com dados, ou legitimamente vazia: "nenhuma pessoa atende aos filtros" ≠ zero).

Acesso negado e falha técnica são estados próprios. Não encaminhado nunca apaga a última entrega válida (que mantém a data original).

## Comparação e análise

Comparação calculada por código, com a mesma definição, escopo e filtros: competência única → competência anterior (nova consulta);
últimas N em média → as N anteriores; mês a mês → primeiro × último mês do próprio conjunto; situação funcional → a entrega válida
anterior da mesma chave e versão; período em curso, recorrência e diagnóstico → sem comparação equivalente (explicado). Semântica por
coluna (% fora, Q4 e dispersão: menor é melhor; atingimento e PRV: maior é melhor; atingimento já vem ajustado à direção do
indicador). A IA (caso de uso próprio `REPORT_ANALYSIS`) recebe tabela, destaques e comparação prontos e escreve o resumo; falha da IA
preserva a entrega com "análise indisponível" e o job tenta de novo sem duplicar. Posse por entrega: uma chamada de IA por vez em
qualquer processo (reivindicação antes da chamada; só a tentativa vigente grava) — ver a memória da área.

## Chat

Depois de uma resposta com ferramenta elegível (consulta, força de trabalho, diagnóstico; análise e pessoas viram consulta
equivalente), o backend cria uma PROPOSTA (`report_proposals`) ligada à mensagem e oferece "Criar report desta consulta" (botão) com
uma linha de texto. Sem insistência: uma oferta a cada 3 respostas, nunca a mesma consulta duas vezes na conversa, nunca se já existe
report ativo igual. Aceite por clique ou por "sim" na resposta SEGUINTE (só vale para a proposta da última mensagem; texto e voz) →
abre `/reports/novo?proposta=<id>` com o rascunho; ativar exige revisar e salvar.
