# Memória — Wiki geral da INIA

> Seções movidas sem edição do `CLAUDE.md` em 07/10/2026. Critérios e mapa completo em [README.md](README.md).

### Wiki geral da INIA (reestruturada 2026-09-16)

`/wiki` é a documentação oficial da plataforma como PRODUTO — não mais "Wiki do Workflow Engine". 13 áreas (Introdução, Pessoas e Estrutura, Indicadores e Performance, Experiência do Colaborador, Workflow Engine, Agents, Orchestrators, Bases de Conhecimento, QA Lab, Administração e Segurança, Central de Dados, Casos Práticos, Glossário), 35 páginas (contagem derivada do sitemap — não atualizar à mão a cada página). Fontes únicas: sitemap em `frontend/src/components/wiki/wiki-nav.ts` (sidebar, breadcrumbs, anterior/próximo, Home e testes de rota derivam dele); catálogos com cobertura garantida pelo tipo em `wiki-reference.ts` (`Record<FlowNodeType | OutputSurface | NotificationKind | PlatformRole | TriggerKind, …>` — um node/surface novo no schema quebra o typecheck se não for documentado); catálogo de IA continua em `ai-catalog-data.ts`; glossário em `glossary-data.ts`. Regra: documentar SÓ o que existe (limitações ficam em "Limitações atuais"); rótulos de UI copiados das telas (labels importados dos schemas quando existem); nunca UUID, credencial demo, transcrição privada ou nome real. Testes em `app/wiki/wiki-pages.test.tsx` renderizam todas as páginas e validam cada link interno/âncora, o índice de cada página, o catálogo (Agents/Orquestradores/KBs/20 modelos) e a ausência de dados sensíveis. Rotas antigas `/wiki/ia-conhecimento` e `/wiki/indicadores-equipe` são `permanentRedirect`. Layout: shell único (`wiki-shell.tsx`), TOC "Nesta página" vira coluna só em `xl`; abaixo disso é barra fixa DENTRO do `<main>` (sticky precisa de pai alto).

### Aprenda na prática: demonstrações guiadas de Workflows (2026-11-05)

`/wiki/workflows/exemplos` ensina o módulo por problemas do dia a dia: galeria por objetivo, seis jornadas completas e demonstração guiada de cada uma. Os guias de cada nó e modalidade ficam na página de Nodes (`#no-<tipo>`, `#gatilho-<modalidade>`, `#acao-<tipo>`), para não haver uma segunda documentação. Código em `frontend/src/components/wiki/workflow-demo/`; roteiro por exemplo em `examples/`; guias em `node-guides.ts` (`Record` por tipo: nó novo sem guia quebra o typecheck).

**Regra:** é uma simulação de apresentação. Um desfecho é uma lista de cenas já escritas; trocar de desfecho troca a lista. Nada avalia regra, interpreta grafo, chama API, IA ou o QA Lab (`demo-catalog.test.ts` confere no código-fonte). O estado local só guarda etapa e desfecho.

**Fidelidade é testada, não prometida:**
- `demo-graphs.ts` guarda cada exemplo como o editor grava. `backend/.../wiki-demo-graphs.parity.test.ts` passa cada grafo pela validação do botão Publicar e pela do editor. Mudou a regra de publicação e um exemplo deixou de valer: o teste quebra.
- O mesmo teste prova os limites que a Wiki afirma (Agenda + "Gerar feedback" de monitoria e Agenda + "Avaliação de processo" não publicam). Se o produto passar a aceitar, o exemplo "dois momentos do dia" e o texto dele mudam juntos.
- `demo-catalog.test.ts`: cada desfecho anda só por ligações reais do grafo; todo rótulo e toda opção marcada existem no código do editor; as prévias passam no schema do Acompanhamento; todos os nós e ações oferecidos são ensinados.

**Limites do produto que moldaram os exemplos** (conferidos no código em 05/11/2026):
- Dois horários na Agenda são disparos independentes (um slot por horário e colaborador). Com Agenda, a monitoria só existe como `Chamar agente` + fonte "Amostra de chamadas (monitoria)" + Output direto, sem o motor de feedback. A amostra é sorteada a cada execução (`order by random()`), sem controle do que já foi analisado, e só o resultado da ÚLTIMA chamada amostrada segue adiante; por isso o exemplo usa 1. Sem chamada no período, o nó não produz conteúdo e o Output encerra a execução com falha (`WORKFLOW_CONTENT_MISSING`), sem saída "sem chamadas". Uma Condição não resolve: `sourcePath` sobre resultado inteiro ou ausente falha em vez de cair em Não.
- A nota URA é a flag numérica `nota_ura` (uma chamada, Sim/Não) ou o indicador "Nota da Pesquisa na URA" (agregado, Sim/Não/Sem dados). A escala vem de quem envia o dado.

**Prints:** `frontend/public/wiki-capturas/workflows/`, com o manifesto `demo-shots.json` e as marcações calculadas pela tela. Regerar: `docs/dev/wiki-capturas/README.md`. Mudou um formulário do editor: regere, porque nenhum teste compara a imagem com a tela. Verificação: `demo-player.test.tsx` cobre navegação, reinício, desfechos, teclado, âncoras e ausência de chamadas de rede.
