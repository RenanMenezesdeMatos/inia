# Visual do app — superfícies, sinalização e kit

Memória da linha visual do app inteiro. Leia antes de mexer em `components/ui/` (kit), nos tokens de `app/globals.css` ou no
visual de uma tela.

## Origem (2026-11-10)

O responsável achou o Apoio com Anjo "muito branco, sem separação entre seções e grupos de campos, e a ação principal parecendo
link". Referência pedida: a Área do Cliente da Vivo logada no Chrome (observada só em leitura — central de faturas e início):
fundo branco com cartões de borda clara e raio de 16 px, rótulo de seção curto em caixa alta cinza, selo de estado tingido com
ícone, lista com ícone em círculo tingido e divisória, fundo cinza ao passar o mouse, botões em pílula, valor de destaque na cor
primária. Aplicado primeiro ao módulo Anjo (`docs/dev/memoria/apoio-com-anjo.md`, "Visual do módulo") e depois estendido ao app.

## Camada 1 — tokens e kit (2026-11-10)

- Tela de fundo da página em token próprio, `--canvas` (`#f4f2ee` no claro; igual ao `--background` no escuro; branco/preto no alto
  contraste), aplicado ao `body`, ao shell autenticado e ao `SidebarInset`: os cartões (`#fff`) se separam da página. O
  `--background` continua `#faf9f7` porque também é o fundo de elementos (campos, bolhas, controles) — na primeira tentativa ele
  mesmo virou cinza e os campos ficaram "cinza sobre cinza" (correção de 10/11).
- Campos com fundo branco explícito no claro: `Input`, `Textarea`, gatilho do `Select` e `Button` contornado usam `bg-card` (o
  escuro mantém `dark:bg-input/30`). Leitura com contraste em qualquer superfície (cartão, `muted`, página).
- `Card`: raio `rounded-2xl` (16 px).
- `Button`: todos em pílula (`rounded-full`), com um pouco mais de respiro lateral; dentro de `button-group` os cantos continuam
  retos entre si. Quem precisa de outro formato passa a classe (o `cn` mantém a da tela).
- `Badge`: tons suaves `success`, `warning`, `info` e `muted` (texto sempre presente; a cor não é a única informação).
- Cabeçalho de tabela: primeiro tingido (`bg-muted/50`, rótulo cinza); desde 2026-11-10, roxo da marca com texto branco (ver
  "Padrões de UI" abaixo).
- `components/ui/surface.tsx` (só apresentação): `SURFACE_CARD`, `toneSurface`, `toneChip`, `StatusChip`, `IconBadge`,
  `SectionLabel`, `PageHeader`. O módulo Anjo usa essas peças (o antigo `human-support/shared/support-ui.tsx` foi absorvido).

Efeito da camada 1 nas telas sem ajuste próprio é discreto (fundo, pílulas, tabelas, cantos). A separação forte vem da camada 2.

## Camada 2 — tela a tela

Primeira rodada (2026-11-10), pelas peças compartilhadas e pelas ferramentas:
- Os rótulos pequenos acima dos títulos das abas (Equipe, Indicadores/Performance, Calendário, Pendências, resumo da equipe e
  `MetricHero`) viraram `SectionLabel` (caixa alta).
- `AnalyticsEmptyState` (usado em ~27 telas) e `AnalyticsErrorState`: raio 16 px, fundo `muted/30`, ícone num círculo tingido
  (roxo no vazio; vermelho no erro; cinza no "sem acesso").
- Resumo da Equipe: blocos brancos com borda e ícone tingido pelo significado (dentro da referência = verde, abaixo = âmbar, em
  evolução = roxo, sem dados = cinza, aguardando ciência = âmbar, revisões = roxo); filtro ativo com borda e fundo primários.
- Diagnóstico, Boas práticas e Reports com `PageHeader` (ícone do seletor de área: Stethoscope, Lightbulb, FileBarChart2); o vazio
  de Reports passou a ser o `AnalyticsEmptyState` (título + descrição).

Pendente: Calendário e Organograma em detalhe, feed do Acompanhamento, telas de detalhe (report, material) e a Administração —
por último, porque a pasta principal tem o ramo `admin-list-standardization` com alterações nas listas. Capturas antes/depois
de cada rodada ficam fora do Git (pasta temporária da sessão).

### Tabelas, seletores de data e painel do apoio (2026-11-10, a partir das regressões apontadas pelo responsável)

- **Tabelas**: a origem era a moldura feita à mão em cada tela (sem fundo, com `rounded-md/lg/xl/2xl` misturados); com o fundo de
  página próprio (`--canvas`), elas sumiram contra ele. Agora há UMA moldura no kit, `TABLE_FRAME` em `components/ui/table.tsx`
  (fundo de cartão, borda, `rounded-xl`, sombra leve, `overflow-hidden`; a rolagem horizontal fica no `table-container` interno, então
  os cantos continuam arredondados com tabela larga). Aplicada nas 56 tabelas que tinham moldura própria ou nenhuma (inclusive as
  listas da Administração, como Agentes, e a Central de Dados); tabela com rolagem vertical soma `max-h-* overflow-auto`. O cabeçalho
  (`bg-muted/60`) arredonda os cantos de cima também fora da moldura. Célula do kit não quebra linha: texto cortado usa `truncate`
  (reticências) com o texto inteiro no `title`, nunca `line-clamp` (cortava sem reticências — Agentes e Base de conhecimento).
- **Datas**: padrão = o do filtro de lista que já existia (botão contornado + calendário do kit em Popover). Viraram componentes do kit
  em `components/ui/date-picker.tsx`: `DatePicker` (data única) e `DateRangePicker` (período; `confirm` = rascunho com "Aplicar" para
  períodos obrigatórios, como o do painel do apoio; sem ele, aplica a cada clique, como nos filtros de lista). Atalhos de período (pedido
  do responsável em 2026-11-10) em TODO `DateRangePicker`: Hoje · Últimos 7 dias · Últimas 2 semanas · Último mês (30 dias até hoje)
  · Este mês · Mês passado (mês civil anterior) · Últimos 3 meses (90 dias) · Últimos 6 meses (180 dias, desde a 2ª rodada), contados
  do "hoje" de quem vê (`DATE_RANGE_PRESETS`,
  `presetRange`); um clique aplica e fecha, inclusive com `confirm` (atalho recusado pelo `validate` ou fora de `min`/`max` fica
  desabilitado com o motivo no `title`); o que coincide com o período atual fica marcado (`aria-pressed`); `presets={false}` tira.
  Ficam à esquerda (em cima no celular) só pela ordem visual (`order-first`): no DOM vêm depois do calendário, para o foco ao abrir
  continuar em "Ir para o mês anterior" como antes; o bloco do calendário é `relative` (a navegação de mês do `Calendar` é absoluta e
  caía sobre os atalhos). O filtro decorativo do Acompanhamento do operador (`operator-date-filter.tsx`, `Calendar` direto, sem efeito
  nos dados) ficou de fora. Valor sempre "AAAA-MM-DD"
  civil; exibição `dd/MM/aaaa`. O `Calendar` do kit usa por padrão o `ptBR` do `react-day-picker/locale` (meses, dias e rótulos de
  leitor de tela em português). Os 17 campos `type="date"` de 11 telas trocados; os 7 `datetime-local` e o 1 `month` ficaram nativos
  (escolhem horário/competência).

## Padrões de UI — catálogo dos elementos repetidos (decisões do responsável em 2026-11-10)

Pedido: "padronizar os elementos que se repetem e deixar registrado"; mapa feito pela leitura do frontend inteiro (agente de
levantamento, 10/11). Regra geral: o elemento repetido mora no kit (`components/ui/`) ou nas peças compartilhadas
(`components/admin/shared/list/`), e a tela só escolhe a variante. Decisões e onde já valem:

- **Paginação** — a de "Registro" (Central de Dados) é a única: `components/admin/shared/list/list-pagination.tsx`. Texto à
  esquerda "1–20 de 66 registros · página 1 de 4"; à direita "Por página" (10/20/50) e anterior · páginas com reticências · próxima.
  Aparece sempre que a lista tem itens. Variantes: `ListPagination` (total conhecido) e `CursorPagination` (o servidor avança por
  posição e não pula para a página N; anterior · página atual · próxima; total opcional, ex.: depois de "Contar registros");
  `stacked` empilha as duas partes em coluna estreita (lista ao lado do detalhe). Aplicada em: listas da Administração
  (`AdminListView`), Consultar dados, Contestações, Conversas com a INIA, Diagnóstico › Chamadas, Governança › Conferência das
  respostas, Resultados de Workflow (o "Por página" das pessoas de um disparo não fazia nada — corrigido), QA Lab › interações
  e linha do tempo da Monitoria de usabilidade. **"Carregar mais"** é outro padrão, para históricos e feeds que acumulam (a
  seleção do lado do detalhe não se perde): fica como está — pedidos e tentativas do painel do apoio, histórico do Anjo, conversas
  anteriores do operador; feeds com rolagem infinita e "Mensagens anteriores" nos chats também. Falta um rodapé único para ele.
- **Seletor de data** — `components/ui/date-picker.tsx` é o modelo único: `DateRangePicker` para período (atalhos Hoje · 7 dias ·
  2 semanas · Último mês · Este mês · Mês passado · 3 meses · 6 meses; "Limpar" no fim dos atalhos quando o filtro pode ficar
  vazio; `confirm` = "Aplicar" em período obrigatório) e `DatePicker` para uma data. Popover branco inteiro: o calendário não tem
  fundo próprio e ocupa a coluna até o separador dos atalhos (antes era um bloco cinza ao lado da coluna branca e parecia quebrado).
  Ninguém monta o `Calendar` direto: o filtro do Acompanhamento do operador (`operator-date-filter.tsx`, que continua sem filtrar o
  feed) e o QA Lab (tinha um seletor próprio "Hoje/7 dias/30 dias/personalizado/qualquer") passaram para o kit. Exceções que
  ficam nativas até o kit ter seletor de hora: 7 `datetime-local`, 1 `month` e 6 `time`.
- **Tabela** — `components/ui/table.tsx`: moldura `TABLE_FRAME` (agora também nas 5 que não tinham: Diagnóstico ×2, Materiais,
  Processos, membros do indicador) e **cabeçalho roxo da marca com texto branco em seminegrito** (token `topbar`, o roxo da barra
  superior nos dois temas — o `primary` do escuro é rosa e o cabeçalho ficaria berrante). A cor fica na célula (`TableHead`),
  então `TableHeader` com fundo próprio não apaga o padrão; caixa de seleção e botão de ordenar ficam claros sobre o roxo. Tabela
  de DADOS montada à mão usa `TABLE_HEAD_COLORS` (grade do calendário da equipe: "hoje" vira uma barra branca sob o dia). Ficam
  com visual próprio: gráficos em forma de tabela (mapa de calor e coorte da Monitoria de usabilidade) e tabelas DENTRO de
  conteúdo (Markdown das respostas, artigo da base, comparação de texto, tabelinhas do diagnóstico de PRV num feedback).
- **Confirmação** — `AlertDialog` (50 telas; nenhum `window.confirm`). Dialog só quando a confirmação pede campos (motivo,
  digitar o código).
- **Lista/Cards** — `ListViewToggle` (13 telas, já uniforme).
- **Cabeçalho de página** — `PageHeader` (`components/ui/surface.tsx`): ícone da área num quadrado tingido, `h1`, descrição e, à
  direita, as ações da página (ex.: "Novo agente"). Toda página de lista da Administração começa com ele e o conteúdo vem num
  `Card` abaixo (antes o título era um `CardTitle` — uma `div`, e a página ficava sem `h1`). Aplicado nas listas (Agentes,
  Argumentários, Domínios, Flags, Governança, Indicadores, Políticas de acompanhamento, Base de conhecimento, Produtos, Workflows,
  Orquestrador, Usuários e acessos, QA Lab, Calendário operacional) e em Central de Dados, IA, Monitoria de usabilidade, Cenário
  da INIA, Conversas, Contestações e Editar perfil. Detalhes (agente, orquestrador, fonte, feed, carga, pessoa) mantêm o `h1` com
  o nome do item e as ações dele na mesma linha.
- **Voltar** — `BackLink` (`components/ui/back-link.tsx`) é o único: botão fantasma pequeno com seta, **acima** do cabeçalho,
  com o nome de para onde volta ("Agentes", "Fontes", "Workflows", "Perfil"), nunca "Voltar para a lista". `href` navega;
  `onClick` volta dentro da mesma tela (lista ↔ detalhe no celular). Substituiu 4 estilos (link cinza, botão fantasma, só o
  ícone no editor de Workflow, "Voltar à lista").
- **Estados** — `components/ui/states.tsx`: `EmptyState` (tracejado, ícone, título, descrição, ação), `ErrorState` (vermelho
  claro com "Tentar novamente"; `forbidden` = cinza com cadeado e sem nova tentativa), `InlineError` (a falha numa linha, para
  cartão pequeno, campo ou diálogo) e `LoadingState` (esqueleto, nunca só "Carregando…"). `Analytics*State` e `List*State`
  continuam com a mesma API, desenhados por estes. O rótulo é sempre **"Tentar novamente"** (era "Tentar de novo" em parte das
  telas). Ficam: "Tentar de novo e reativar" da base arquivada (é outra ação, com confirmação) e o recado de voz do chat do
  operador (arquivo da outra frente).
- **Telas de erro** (2026-11-11) — `components/error-states/`: `ErrorScreen` é a única tela de falha, com a arte de cada estado
  (`public/brand/error-states/`: 400 quebra-cabeça, 401 crachá, 403 cancela, 404 cabo, 500 servidor, sem conexão roteador/celular
  alternados por ocorrência). `variant="page"` quando a navegação/fluxo está bloqueado (fronteiras `error.tsx`/`global-error.tsx`,
  `not-found.tsx`, sem conexão sobreposto); `variant="contextual"` dentro de painel. Erro contextual de consulta continua no
  `ErrorState` do kit, com a faixa `FailureSupport` no slot `support` (código, referência, "Copiar detalhes para suporte" e, quando a
  pessoa não resolve, "Procure o administrador…"). Texto sempre em HTML; a arte é decorativa (`alt=""`) e some se não carregar.
  Conferência visual: `/dev/estados-de-erro` (só com `INIA_ERROR_STATES_PREVIEW=ON`).

### Mapa do que ainda se repete com variações (prioridade pelo impacto visível; não feito nesta rodada)

1. **Estados** — feito o kit e a troca dos blocos de erro/"tentar de novo" (acima); faltam as ~140 frases "Nenhum…" soltas que
   ainda são `<p>` simples em vez de `EmptyState`.
2. **Rótulo de seção e seções de formulário** — `SectionLabel` em 13 arquivos × 114 rótulos em caixa alta feitos à mão (6+
   variações); ~17 `Section/Block` locais, `<legend>` com 8 estilos, formulários com um `Card` por seção.
3. **Selos de situação** — `StatusChip` (só no apoio), `Badge` em 138 arquivos com cores fixas em 21, `StatusPill` da Central de
   Dados (outro sistema de tons) e ~35 `*Badge` locais.
4. **Barras de filtro** — `ListToolbar` em 27 telas; cópias na Equipe, Monitoria de usabilidade, painel do apoio, ranking de IA,
   Consultar dados, Calendário operacional e Modelos; "Qualquer…" × "Todos os…".
5. **Outros** — 9+ blocos de indicador (KPI) diferentes; busca sem o visual da busca de lista em 6 seletores; "…" × "...".

Fora desta rodada por pertencer à outra frente ativa no mesmo worktree: paginação e cabeçalhos de `human-support/**`
(pedidos, tentativas e histórico do Anjo continuam com "Carregar mais"; os `TableHeader className="bg-muted/50"` de lá já não
mudam nada).
