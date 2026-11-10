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
- `TableHeader` tingido (`bg-muted/50`) e `TableHead` com rótulo discreto (`text-xs font-semibold text-muted-foreground`).
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
  períodos obrigatórios, como o do painel do apoio; sem ele, aplica a cada clique, como nos filtros de lista). Valor sempre "AAAA-MM-DD"
  civil; exibição `dd/MM/aaaa`. O `Calendar` do kit usa por padrão o `ptBR` do `react-day-picker/locale` (meses, dias e rótulos de
  leitor de tela em português). Os 17 campos `type="date"` de 11 telas trocados; os 7 `datetime-local` e o 1 `month` ficaram nativos
  (escolhem horário/competência).
