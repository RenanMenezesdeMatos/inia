import {
  BookOpen,
  BookOpenText,
  Bot,
  ChartNoAxesCombined,
  Compass,
  Database,
  FlaskConical,
  Inbox,
  LayoutGrid,
  Network,
  ShieldCheck,
  Waypoints,
  Workflow,
  type LucideIcon,
} from "lucide-react"

/**
 * Sitemap ÚNICO da Wiki da INIA — fonte da sidebar, dos breadcrumbs, do "anterior/próximo",
 * dos cards da Home e dos testes de rota (cada href aqui precisa ter um `page.tsx` real).
 *
 * A Wiki documenta a INIA como PRODUTO (do dado de entrada até a entrega ao usuário); o Workflow
 * Engine continua profundamente documentado, mas como uma das áreas — nunca a única.
 */
export type WikiPage = {
  href: string
  title: string
  /** Rótulo curto pra sidebar/breadcrumb quando o título completo é longo. */
  shortTitle?: string
  description: string
}

export type WikiSection = {
  id: string
  /** Numeração visual "01." … "12." — só pra leitura, nunca usada em rota. */
  number: string
  title: string
  icon: LucideIcon
  description: string
  pages: WikiPage[]
}

export const WIKI_HOME: WikiPage = { href: "/wiki", title: "Wiki INIA", shortTitle: "Início", description: "Documentação oficial da plataforma." }

export const WIKI_SECTIONS: WikiSection[] = [
  {
    id: "introducao",
    number: "01",
    title: "Introdução",
    icon: Compass,
    description: "O que é a INIA, para quem ela existe, quem usa e como as peças se conectam.",
    pages: [
      { href: "/wiki/introducao", title: "O que é a INIA", description: "Objetivo, público, casos de uso, análise × automação × acompanhamento, papel da IA e das regras determinísticas." },
      { href: "/wiki/introducao/papeis", title: "Papéis e o que cada um vê", shortTitle: "Papéis", description: "Operador, Supervisor, Coordenador, Gerente, Gerente Sênior, Diretor e Administrador." },
      { href: "/wiki/introducao/como-as-pecas-se-conectam", title: "Como as peças se conectam", shortTitle: "Como tudo se conecta", description: "Base de Conhecimento → Agent → Orchestrator → Workflow → QA Lab → Revisão humana → Output → Acompanhamento/Pendências." },
    ],
  },
  {
    id: "estrutura",
    number: "02",
    title: "Pessoas e Estrutura",
    icon: Network,
    description: "Colaborador, hierarquia, Grupo × Subgrupo, escopo organizacional, drill-down, a aba Equipe/Estrutura e a aba Organograma do perfil.",
    pages: [
      { href: "/wiki/estrutura", title: "Pessoas e Estrutura", description: "Cadeia hierárquica com e sem Coordenador, Grupo × Subgrupo × hierarquia, escopo e drill-down." },
      { href: "/wiki/estrutura/equipe", title: "Equipe / Estrutura (aba de gestão)", shortTitle: "Equipe / Estrutura", description: "Resumo, membros, dentro/abaixo da referência, evolução, sem dados, acompanhamentos, revisões e ficha do colaborador." },
      { href: "/wiki/estrutura/minha-estrutura", title: "Estrutura organizacional (aba do perfil)", shortTitle: "Organograma", description: "Onde o colaborador está: cadeia de liderança real, Grupo/Subgrupo, estrutura imediata, integrantes, origem e visibilidade por permissão." },
      { href: "/wiki/estrutura/lideranca", title: "A INIA para quem lidera", shortTitle: "INIA para lideranças", description: "Onde atuar hoje, perguntas à INIA sobre a equipe e a estrutura, regras dos números, escopo de acesso e o caminho do consolidado ao detalhe." },
      { href: "/wiki/estrutura/reports", title: "Reports recorrentes", shortTitle: "Reports", description: "Consultas da INIA que viram entregas periódicas no Acompanhamento: chat ou tela, período × frequência, visualizações, permissões, atualização das bases e análise." },
    ],
  },
  {
    id: "indicadores",
    number: "03",
    title: "Indicadores e Performance",
    icon: ChartNoAxesCombined,
    description: "Indicador, meta, atingimento, peso, PRV, quartil oficial — e a experiência de Indicadores por papel.",
    pages: [
      { href: "/wiki/indicadores", title: "Indicadores e Performance", description: "Definição de indicador, direção desejada, valor × meta × atingimento, PRV, pesos, quartil oficial e competência." },
      { href: "/wiki/indicadores/analytics", title: "A área Indicadores (analytics)", shortTitle: "Área Indicadores", description: "Operador: PRV, indicadores, histórico, insights. Liderança: consolidado, distribuição, agrupar por, drill-down, tendências." },
      { href: "/wiki/indicadores/medicao-operacional", title: "Medição operacional × Fechamento oficial", shortTitle: "Medição operacional", description: "Medições diárias agregadas pela INIA (janelas, agregação por semântica, quartil operacional, evidência) × fechamento mensal oficial (atingimento, PRV, quartil e peso)." },
      { href: "/wiki/indicadores/configuracao", title: "Configuração de indicadores", shortTitle: "Configuração", description: "O catálogo como fonte de verdade: unidade, direção, medição operacional (estratégia, amostra, cobertura) e fechamento oficial. Novo indicador com semântica suportada é configuração, não desenvolvimento." },
    ],
  },
  {
    id: "experiencia",
    number: "04",
    title: "Experiência do Colaborador",
    icon: Inbox,
    description: "Acompanhamento, Ciência, Pendências, Revisão humana (decidir) e o sino de Notificações.",
    pages: [
      { href: "/wiki/acompanhamento", title: "Acompanhamento e Ciência", shortTitle: "Acompanhamento", description: "Conteúdo entregue para leitura: feedbacks, reconhecimentos, orientações, resultados de Workflow — e a confirmação formal de ciência." },
      { href: "/wiki/pendencias", title: "Pendências e Revisão humana", shortTitle: "Pendências", description: "O que exige uma decisão sua: aprovar, reprovar ou escalar uma revisão — e por que ler não é decidir." },
      { href: "/wiki/notificacoes", title: "Notificações (sino)", shortTitle: "Notificações", description: "Revisão aguardando decisão, novo acompanhamento e escalonamento — algo novo aconteceu." },
    ],
  },
  {
    id: "workflows",
    number: "05",
    title: "Workflow Engine",
    icon: Workflow,
    description: "Automação visual orientada por evento/dados: Trigger → Contexto → Condição → Ações/IA → Decisões → Outputs.",
    pages: [
      { href: "/wiki/workflows", title: "Workflow Engine — visão geral", shortTitle: "Visão geral", description: "O que é um Workflow, como pensar um, Escopo/Abrangência/Modo de avaliação, DRAFT × PUBLISHED e validação de publicação." },
      { href: "/wiki/workflows/criacao", title: "Como criar um Workflow", shortTitle: "Como criar", description: "Passo a passo no editor real: novo Workflow, nome, abrangência, gatilho, alvo, população, nodes, salvar, validar, QA Lab, publicar." },
      { href: "/wiki/workflows/triggers", title: "Triggers", description: "Flag de canal, Indicador, Agenda (calendário ou relativa ao expediente) e Manual. Chat e Avatar não são Trigger." },
      { href: "/wiki/workflows/execucao-manual", title: "Execução manual (Executar agora)", shortTitle: "Execução manual", description: "Gatilho Manual: criar, publicar e executar para um colaborador escolhido, com interação ou medição reais; acompanhamento, QA Lab e o exemplo de feedback no Avatar." },
      { href: "/wiki/workflows/nodes", title: "Nodes", description: "Todos os nodes reais do Builder, o contexto disponível em cada ponto do fluxo, Variáveis e Aguardar." },
      { href: "/wiki/workflows/conditions", title: "Conditions", description: "Regras determinísticas: TRUE / FALSE / SEM DADOS, fontes, períodos, histórico, comparação com Meta e período anterior." },
      { href: "/wiki/workflows/ranking", title: "Selecionar colaboradores e Ranking", shortTitle: "Ranking", description: "Por critério e Por ranking: VALUE, CHANGE, Melhores/Piores, partição por Grupo/Subgrupo, sem dados e empates." },
      { href: "/wiki/workflows/fan-out-fan-in", title: "Fan-out e Fan-in", description: "Aplicar individualmente (1 → N) e Consolidar resultados (N → 1), zero filhos e o Orchestrator pós-JOIN." },
      { href: "/wiki/workflows/human-review", title: "Revisão humana e Escalonar", shortTitle: "Revisão humana", description: "Por que existe, quando usar, Aprovar/Reprovar/Escalar, o que acontece com o Workflow e a diferença para Escalonar." },
      { href: "/wiki/workflows/outputs", title: "Outputs, destinatários e Surfaces", shortTitle: "Outputs e Surfaces", description: "QUEM + ONDE + O QUÊ: Output individual, consolidado, resolução organizacional do destinatário e as superfícies reais." },
      { href: "/wiki/workflows/erros-limitacoes", title: "Erros, limitações e evoluções", shortTitle: "Erros e limitações", description: "Comportamento real em exceções, o que ainda não fazemos e evoluções possíveis." },
    ],
  },
  {
    id: "agents",
    number: "06",
    title: "Agents",
    icon: Bot,
    description: "Especialistas de IA com objetivo, instruções e fontes de conhecimento autorizadas.",
    pages: [
      { href: "/wiki/agents", title: "Agents", description: "O que é, quando usar, quando não usar, como criar (campos reais), limites de atuação, abas, princípio do especialista e o catálogo oficial." },
      { href: "/wiki/agents/dominios-negocio", title: "Domínios de negócio", description: "Catálogo administrável das áreas de conhecimento que classificam Agents especialistas e restringem Orchestrators. Domínio ≠ Grupo, ≠ Base, ≠ Agent; novo domínio é configuração." },
      { href: "/wiki/agents/ferramentas-investigacao", title: "Ferramentas de investigação", description: "Como um Agent investiga os dados antes de concluir: capacidades, ferramentas que calculam fatos, IA que interpreta, restrição pelo Workflow, chat/avatar, trace auditável, qualidade e proveniência." },
    ],
  },
  {
    id: "orchestrators",
    number: "07",
    title: "Orchestrators",
    icon: Waypoints,
    description: "Coordenação de Agents: domínio, multidomínio e gerencial pós-JOIN.",
    pages: [{ href: "/wiki/orchestrators", title: "Orchestrators", description: "Os usos reais, roteamento, como criar (campos reais), 'Só workflows' e o catálogo oficial." }],
  },
  {
    id: "bases-conhecimento",
    number: "08",
    title: "Bases de Conhecimento",
    icon: BookOpen,
    description: "Documentos autorizados que os Agents consultam por trechos — e o contrato de conformidade de processo.",
    pages: [{ href: "/wiki/bases-conhecimento", title: "Bases de Conhecimento", description: "O que é uma base, como criar, Rascunho/Publicado, retrieval por trechos (lexical), orçamento, evidência e Conformidade de processo." }],
  },
  {
    id: "qa-lab",
    number: "09",
    title: "QA Lab",
    icon: FlaskConical,
    description: "Simulação de Workflows, Agents e Orchestrators com dados reais e zero efeito operacional.",
    pages: [{ href: "/wiki/qa-lab", title: "QA Lab", description: "Zero efeitos colaterais, DRAFT × PUBLISHED, snapshot, reexecução, controles, Parar antes da IA, orçamento, trace e rastro de conhecimento." }],
  },
  {
    id: "administracao",
    number: "10",
    title: "Administração e Segurança",
    icon: ShieldCheck,
    description: "Áreas administrativas reais, escopo, elegibilidade, validação no backend e segurança da camada de IA.",
    pages: [
      { href: "/wiki/administracao", title: "Administração", description: "As áreas do Admin que existem hoje e o que cada uma configura." },
      { href: "/wiki/administracao/politicas-de-acompanhamento", title: "Políticas de acompanhamento", description: "Tipos de intervenção, políticas versionadas, o nó do Workflow, relatório de inteligência, experiência do líder e avaliação de continuidade (sempre decisão humana)." },
      { href: "/wiki/administracao/ia-modelos", title: "IA / Modelos", description: "Conexões com providers de IA (inclusive modelo local), modelos, roteamento por função da INIA, fallback, custos, orçamentos e segurança das API keys." },
      { href: "/wiki/seguranca", title: "Segurança e Escopo", description: "Backend valida organização, hierarquia, escopo e capability; elegibilidade de Workflow; hierarquia de instruções da IA; observabilidade." },
    ],
  },
  {
    id: "central-de-dados",
    number: "11",
    title: "Central de Dados",
    icon: Database,
    description: "A porta única de entrada dos dados do cliente: fontes, feeds, contratos de dados, mapeamento, cargas, quarentena, linhagem, saúde × atualidade.",
    pages: [
      { href: "/wiki/central-de-dados", title: "Central de Dados", description: "Conceito, princípio 'sem integração por indicador', camadas, Fonte, Feed, Contrato de Dados, catálogo, mapeamento, validação, writers, cargas, quarentena, linhagem, saúde × atualidade e segurança." },
      { href: "/wiki/central-de-dados/conectores", title: "Conectores", description: "CSV, Excel, API Pull (auth, paginação, checkpoint), API Push (endpoint, token, Idempotency-Key), SFTP (host key, padrão, dedup) e o wizard Nova fonte." },
      { href: "/wiki/central-de-dados/guias", title: "Guias e troubleshooting", shortTitle: "Guias", description: "Como importar um CSV, conectar uma API, conectar um SFTP, entender uma carga com erros e os códigos de erro." },
    ],
  },
  {
    id: "casos-praticos",
    number: "12",
    title: "Casos Práticos",
    icon: LayoutGrid,
    description: "Guias integrados e os modelos de Workflow documentados a partir dos grafos reais.",
    pages: [
      { href: "/wiki/casos-praticos", title: "Guias integrados", description: "Como criar um Agent de Faturamento, vincular uma base, testar sem gastar IA, auditar uma chamada, publicar após aprovação, resumo gerencial." },
      { href: "/wiki/casos-praticos/workflows", title: "Modelos de Workflow", description: "Os 20 modelos práticos (22 instâncias, todos em rascunho) e os 10 Workflows operacionais executados como prova." },
    ],
  },
  {
    id: "glossario",
    number: "13",
    title: "Glossário",
    icon: BookOpenText,
    description: "Os termos do produto, com o mesmo significado usado em todas as telas.",
    pages: [{ href: "/wiki/glossario", title: "Glossário", description: "Abrangência, Alvo, População, PRV, Quartil, Fechamento, Agent, Orchestrator, Retrieval, Fan-out, Ciência, Pendência, QA Run, Snapshot, SEM DADOS…" }],
  },
]

export const WIKI_PAGES: WikiPage[] = [WIKI_HOME, ...WIKI_SECTIONS.flatMap((section) => section.pages)]

export function findWikiSection(href: string): WikiSection | undefined {
  return WIKI_SECTIONS.find((section) => section.pages.some((page) => page.href === href))
}

export function findWikiPage(href: string): WikiPage | undefined {
  return WIKI_PAGES.find((page) => page.href === href)
}

/** Página anterior e próxima na ordem de leitura do sitemap (Home não entra na sequência). */
export function wikiNeighbors(href: string): { previous: WikiPage | null; next: WikiPage | null } {
  const ordered = WIKI_SECTIONS.flatMap((section) => section.pages)
  const index = ordered.findIndex((page) => page.href === href)
  if (index === -1) return { previous: null, next: null }
  return { previous: ordered[index - 1] ?? null, next: ordered[index + 1] ?? null }
}

/** Breadcrumb: Wiki › Seção › Página (a página raiz da seção não repete a seção). */
export function wikiBreadcrumbs(href: string): { label: string; href: string | null }[] {
  const section = findWikiSection(href)
  const page = findWikiPage(href)
  if (!section || !page) return [{ label: WIKI_HOME.title, href: null }]
  const sectionRoot = section.pages[0]!
  const crumbs: { label: string; href: string | null }[] = [{ label: WIKI_HOME.shortTitle ?? WIKI_HOME.title, href: WIKI_HOME.href }]
  if (sectionRoot.href === page.href) {
    crumbs.push({ label: section.title, href: null })
  } else {
    crumbs.push({ label: section.title, href: sectionRoot.href }, { label: page.shortTitle ?? page.title, href: null })
  }
  return crumbs
}
