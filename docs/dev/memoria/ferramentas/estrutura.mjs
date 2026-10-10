// Mapa da divisão do CLAUDE.md em memória por área (07/10/2026).
//
// Cada seção do CLAUDE.md antigo (cabeçalho `#`, `##` ou `###`) é reconhecida pelo INÍCIO do título e vai,
// inteira e sem edição, para o CLAUDE.md (categoria a) ou para um arquivo de área em docs/dev/memoria/
// (categorias b e c). Este arquivo só contém o mapa e os textos novos de organização (cabeçalhos dos arquivos
// e o índice); o conteúdo das seções vem sempre do CLAUDE.md de entrada.

export const CATEGORIES = {
  a: "regra/convenção permanente — fica no CLAUDE.md",
  b: "memória de uma área — útil quando se mexe nela",
  c: "histórico encerrado — versão substituída ou linha fechada",
};

// Seções que ficam no CLAUDE.md, na ordem em que aparecem na entrada.
export const CORE = [
  { prefix: "# INIA — instruções e memória do projeto", category: "a" },
  { prefix: "## Papel do assistente", category: "a" },
  { prefix: "## O produto", category: "a" },
  { prefix: "## Organização do código", category: "a" },
  { prefix: "## Memória arquitetural", category: "a" },
  {
    prefix: "### Múltiplas IAs especializadas",
    category: "a",
    why: "toda interação com qualquer IA é persistida — vale para qualquer código que fale com IA",
  },
  {
    prefix: "### Motor de agentes, gatilhos e execução",
    category: "a",
    why: "agente × gatilho, como cada tipo é acionado, provedor trocável, evidência literal",
  },
  {
    prefix: "### Acompanhamento × Pendências × Sino",
    category: "a",
    why: "três conceitos que nunca se misturam, conteúdo rico, Canvas do avatar, dados de demonstração só por seed",
  },
  {
    prefix: "### Domínios de negócio — catálogo administrável",
    category: "a",
    why: "nenhum módulo funcional conhece código de domínio",
  },
  {
    prefix: "### Catálogo de indicadores metadata-driven",
    category: "a",
    why: "nenhum módulo funcional conhece código de indicador",
  },
];

const s = (prefix, category) => ({ prefix, category });

// Arquivos de área, na ordem do índice. `history: true` = lista "Histórico" do índice.
export const AREAS = [
  {
    file: "motor-de-feedback.md",
    title: "Motor de feedback (FEEDBACK_ENGINE_V1)",
    summary:
      "caminho atual de “Gerar feedback”: análise de chamada com revisão, investigação de indicador, práticas e temas, firmeza, entrega única, memória do motor, diagnóstico da liderança e registro das rodadas pagas.",
    related: ["../feedback-engine.md", "../diagnostic-bootstrap.md"],
    notes: [
      "O primeiro item da seção diz que o motor substitui seções “mantidas abaixo” no `CLAUDE.md`. Elas agora estão em [historico-feedback-v15-v16.md](historico-feedback-v15-v16.md) e [historico-monitoria-v17.md](historico-monitoria-v17.md). A exceção é “Feedback por Flag V2”, que está em [experiencia-do-colaborador.md](experiencia-do-colaborador.md).",
    ],
    sections: [s("### Motor de feedback — FEEDBACK_ENGINE_V1", "b")],
  },
  {
    file: "diagnostico-de-indicador.md",
    title: "Diagnóstico de indicador — estratégia por indicador",
    summary:
      "estratégia de diagnóstico por indicador (versões, rascunho × publicada, pino no nascimento, “Testar diagnóstico”, sinal da população) e as execuções de diagnóstico anteriores ao motor de feedback.",
    related: [],
    notes: [
      "A seção do motor de feedback ([motor-de-feedback.md](motor-de-feedback.md)) diz que ele substitui o caminho confiável/QA das versões V1.5.x–V1.7.x. Ela também mostra que o motor continua lendo a estratégia publicada do indicador. Exemplos: `STRATEGY_AT_BIRTH_V1`, `PERIOD_SAMPLE_V1` e `POPULATION_SIGNAL_V2`.",
    ],
    sections: [
      s("### V1.6.1 — Diagnóstico do indicador e coaching com base", "c"),
      s("### V1.6.2 — Estratégia de diagnóstico do indicador", "b"),
      s("### Indicator Diagnosis V2 — estratégia configurável", "b"),
    ],
  },
  {
    file: "experiencia-do-colaborador.md",
    title: "Experiência do colaborador — Acompanhamento e aplicação de feedback",
    summary:
      "narrativa do feedback e “Entenda este feedback”, timeline e ocultação lógica do Acompanhamento, “Ouvir com a INIA” (aplicação de feedback e consultas na sessão), ciência com login e senha, “Este conteúdo foi útil?” e cabeçalho do item.",
    related: [],
    notes: [
      "A seção do motor de feedback ([motor-de-feedback.md](motor-de-feedback.md)) lista “Feedback por Flag V2” entre os caminhos que o motor substitui. O view model `FEEDBACK_VIEW_V1` descrito aqui continua sendo o que o motor gera (“`generateFeedback` … → `FEEDBACK_VIEW_V1`”). Por isso a seção ficou nesta área, e não no histórico.",
      "As seções seguem a ordem do assunto, não a data. “Aplicação de feedback conversacional” vem antes de “Confirmação de ciência” porque cita essa seção com “ver abaixo”.",
    ],
    sections: [
      s("### Feedback por Flag V2 — narrativa de supervisor", "b"),
      s("### Aplicação de feedback conversacional", "b"),
      s("### Confirmação de ciência com login e senha", "b"),
      s("### Avaliação do feedback no Acompanhamento", "b"),
    ],
  },
  {
    file: "conversa-voz-e-avatar.md",
    title: "Conversas, voz e avatar da INIA",
    summary:
      "conversas persistidas com a INIA e monitoramento da gestão, recados de Workflow no Chat e no Avatar (com a voz do recado), avatar Mentora (modelo, lip-sync PT-BR, animação, laboratório) e Cenário da INIA.",
    related: ["../../architecture/ADR-006-conversational-avatar.md"],
    notes: [],
    sections: [
      s("### Conversas com a INIA — chat em conversas persistidas", "b"),
      s("### Avatar da INIA — modelo Mentora", "b"),
      s("### Workflow Outputs V1 — Chat + Avatar", "b"),
      s("### Cenário da INIA — fundo atrás do avatar", "b"),
    ],
  },
  {
    file: "perfil-e-navegacao.md",
    title: "Perfil pessoal, cabeçalho global e navegação",
    summary:
      "perfil pessoal (nome preferido, foto, capa), cabeçalho global e seletor de área, abas do perfil e acesso à área de Diagnóstico.",
    related: [],
    notes: [],
    sections: [s("### Perfil pessoal e cabeçalho global", "b")],
  },
  {
    file: "workflows.md",
    title: "Workflows — modelos, publicação, execução e resultados",
    summary:
      "Workflows-modelo e validação de publicação (DRAFT válido, destinatário pela estrutura, editor), gatilho Manual “Executar agora”, worker concorrente com posse da matrícula e aba Resultados com correlação do uso de IA.",
    related: ["../workflows-modelo.md", "../../workflow-engine-wiki.md"],
    notes: [],
    sections: [
      s("### Workflows-modelo: DRAFT válido, destinatários e editor", "b"),
      s("### V1.5.13 — Resultados do Workflow + correlação do uso de IA", "b"),
      s("### Gatilho Manual — \"Executar agora\"", "b"),
      s("### Motor de Workflow — execução concorrente e posse da matrícula", "b"),
    ],
  },
  {
    file: "agentes-e-conhecimento.md",
    title: "Agents, Orquestradores, base de conhecimento e materiais de apoio",
    summary:
      "Agents especialistas por domínio, busca na base de conhecimento, Orquestradores e suas políticas, resultado estruturado do Orquestrador e materiais de apoio.",
    related: ["../auditoria-agents-orchestrators-2026-09.md"],
    notes: [
      "A seção “(histórico) Material de apoio recomendado no Feedback — fundação” vem depois de “Material de apoio — capacidade comum de resposta”, que é a “seção acima” citada por ela.",
    ],
    sections: [
      s("### Camada de IA: especialistas por domínio, retrieval de KB e orquestradores", "b"),
      s("### Resultado estruturado do Orquestrador", "b"),
      s("### Material de apoio — capacidade comum de resposta", "b"),
      s("### (histórico) Material de apoio recomendado no Feedback — fundação", "c"),
    ],
  },
  {
    file: "investigacao.md",
    title: "Investigação — Tools para Agents e evolução V1.1–V1.3.4.2",
    summary:
      "Tools de investigação para Agents e a evolução V1.1–V1.3.4.2 (eficiência, Zero-ID, gating fail-closed, suficiência da evidência, recall, integridade literal, semântica temporal).",
    related: ["../massa-demo.md"],
    notes: ["A continuação (V1.4.x) está em [investigacao-v14.md](investigacao-v14.md)."],
    sections: [
      s("### Tools de investigação operacional para Agents", "b"),
      s("### Investigação V1.1 —", "b"),
      s("### Investigação V1.2 —", "b"),
      s("### Investigação V1.3 —", "b"),
      s("### Investigação V1.3.1 —", "b"),
      s("### Investigação V1.3.2 —", "b"),
      s("### Investigação V1.3.3 —", "b"),
      s("### Investigação V1.3.4 —", "b"),
      s("### Investigação V1.3.4.1 —", "b"),
      s("### Investigação V1.3.4.2 —", "b"),
    ],
  },
  {
    file: "ia-provedores-e-custos.md",
    title: "IA — provedores, modelos, roteamento e custos",
    summary:
      "provedores, conexões e modelos de IA, policies de roteamento por Use Case, segredos, uso, custo e orçamento.",
    related: [
      "../ai-providers.md",
      "../../architecture/ADR-008-ai-providers-routing-e-custos.md",
      "../jev-typesafe-checkpoint.md",
    ],
    notes: [],
    sections: [s("### AI Providers, Modelos, Roteamento e Custos V1", "b")],
  },
  {
    file: "indicadores-e-estrutura.md",
    title: "Indicadores, Equipe e organograma",
    summary:
      "analytics compartilhado de Indicadores e Equipe (escopo, PRV, atingimento consolidado, comparação operacional) e o organograma “Minha estrutura” (métricas gerenciais, “Ir até mim”).",
    related: ["../../architecture/ADR-007-catalogo-de-indicadores-metadata-driven.md"],
    notes: [
      "As regras do catálogo de indicadores metadata-driven ficaram no `CLAUDE.md`, porque valem para qualquer módulo.",
    ],
    sections: [
      s("### Indicadores e Equipe/Estrutura — analytics compartilhado", "b"),
      s("### Aba \"Minha estrutura\" no perfil", "b"),
    ],
  },
  {
    file: "central-de-dados-e-instalacao.md",
    title: "Central de Dados, calendário operacional e instalação",
    summary:
      "Central de Dados (fontes, feeds, contratos, quarentena, lineage), situação funcional, escala e calendário operacional, disponibilidade × classificação, conector de banco externo, instalação e publicação em Windows/IIS.",
    related: [
      "../central-de-dados-ingestao.md",
      "../central-de-dados-bancos-externos.md",
      "../../instalacao/dois-servidores-windows.md",
    ],
    notes: [
      "A seção “Catálogo de indicadores metadata-driven”, que ficou no `CLAUDE.md`, cita a Central de Dados com “ver seção própria”: é a primeira seção deste arquivo.",
    ],
    sections: [
      s("### Central de Dados — porta única de entrada dos dados do cliente", "b"),
      s("### Central de Dados — bancos de dados externos + instalação reproduzível", "b"),
    ],
  },
  {
    file: "acesso.md",
    title: "Acesso — contas, papéis, permissões e primeiro login",
    summary:
      "contas × papéis × permissões × escopos, delegação, liberação de acesso com senha temporária e primeiro login.",
    related: [],
    notes: [],
    sections: [
      s("### Modelo de acesso — contas × papéis × permissões × escopos", "b"),
      s("### Liberação de acesso e primeiro login", "b"),
    ],
  },
  {
    file: "massa-demo-e-holdout.md",
    title: "Massa demo e holdout de avaliação",
    summary:
      "massa demo grande (`db:seed:demo`, população e lotes de diagnóstico, gabarito isolado) e o holdout independente `inia_holdout_v2`.",
    related: ["../massa-demo.md"],
    notes: [],
    sections: [
      s("### Massa demo grande", "b"),
      s("### DIAGNOSTIC_HOLDOUT_V2 — holdout independente para generalização", "b"),
    ],
  },
  {
    file: "wiki.md",
    title: "Wiki geral da INIA",
    summary: "`/wiki` como documentação oficial do produto: sitemap, catálogos cobertos pelo tipo, testes de links e âncoras.",
    related: [],
    notes: [],
    sections: [s("### Wiki geral da INIA", "b")],
  },
  {
    file: "monitoria-de-usabilidade.md",
    title: "Monitoria de usabilidade",
    summary: "coleta no navegador e no servidor, painel, permissões, flags, worker e provas.",
    related: ["../monitoria-usabilidade.md", "../monitoria-usabilidade-catalogo.md"],
    notes: [],
    sections: [s("### Monitoria de usabilidade", "b")],
  },
  {
    file: "investigacao-v14.md",
    title: "Investigação V1.4.x — descoberta semântica",
    history: true,
    summary:
      "(linha encerrada) descoberta semântica V1.4.0–V1.4.8f: frames, findings, patterns, candidatos de afirmação, atribuição de resultado, variância da extração.",
    related: [
      "../investigation-v14-closure.md",
      "../semantic-prompt-contract-hygiene.md",
      "../jev-typesafe-checkpoint.md",
    ],
    notes: [
      "A última seção registra “Linha V1.4.x encerrada”. O código continua no módulo `investigation` e as versões anteriores estão em [investigacao.md](investigacao.md).",
    ],
    sections: [
      s("### Investigação V1.4.0 —", "c"),
      s("### Investigação V1.4.1 —", "c"),
      s("### Investigação V1.4.2 —", "c"),
      s("### Investigação V1.4.3 —", "c"),
      s("### Investigação V1.4.4 —", "c"),
      s("### Investigação V1.4.5 —", "c"),
      s("### Investigação V1.4.6 —", "c"),
      s("### Investigação V1.4.6.1 —", "c"),
      s("### Investigação V1.4.6.8 —", "c"),
      s("### Investigação V1.4.8f —", "c"),
    ],
  },
  {
    file: "historico-feedback-v15-v16.md",
    title: "Histórico — feedback de atendimento e caminho confiável (V1.4.9 a V1.6.0)",
    history: true,
    summary:
      "(substituído pelo motor de feedback) feedback de atendimento V1 e caminho confiável V1.5.x–V1.6.0: redator, revisão/QA, política de autonomia, entrega no Acompanhamento e “Gerar feedback” no Workflow.",
    related: [],
    notes: [
      "Segundo a seção do motor de feedback ([motor-de-feedback.md](motor-de-feedback.md)), o caminho confiável/QA destas seções foi substituído por ele. As seções continuam aqui para quem precisa ler artefatos antigos.",
      "No `CLAUDE.md`, estas seções ficavam misturadas com outras que continuam em uso. Essas foram para as respectivas áreas: “V1.5.13 — Resultados do Workflow” está em [workflows.md](workflows.md); V1.6.1, V1.6.2 e “Indicator Diagnosis V2” estão em [diagnostico-de-indicador.md](diagnostico-de-indicador.md).",
    ],
    sections: [
      s("### InteractionFeedback V1 — camada estrutural", "c"),
      s("### V1.5.0 — Controlled Feedback Integration", "c"),
      s("### V1.6.0 — Monitoria PROCESS-CENTRIC com base verificada", "c"),
    ],
  },
  {
    file: "historico-monitoria-v17.md",
    title: "Histórico — monitoria por processo V1.7.x, Checkpoint Registry e Monitoring Architecture V2",
    history: true,
    summary:
      "(substituído pelo motor de feedback) monitoria por processo V1.7.1–V1.7.4, Checkpoint Registry e Monitoring Architecture V2.",
    related: ["../monitoring-architecture-v2.md"],
    notes: [
      "Segundo a seção do motor de feedback ([motor-de-feedback.md](motor-de-feedback.md)), o caminho confiável/QA destas seções foi substituído por ele, inclusive o Checkpoint Registry e a Monitoring Architecture V2. As seções continuam aqui para quem precisa ler artefatos antigos.",
      "No `CLAUDE.md`, “Feedback por Flag V2” e “Conversas com a INIA” ficavam entre estas seções. Hoje estão em [experiencia-do-colaborador.md](experiencia-do-colaborador.md) e [conversa-voz-e-avatar.md](conversa-voz-e-avatar.md).",
    ],
    sections: [
      s("### V1.7.1 — Omissão verificada", "c"),
      s("### V1.7.1a —", "c"),
      s("### V1.7.1b —", "c"),
      s("### V1.7.1c —", "c"),
      s("### V1.7.1d —", "c"),
      s("### V1.7.1e —", "c"),
      s("### V1.7.1f —", "c"),
      s("### V1.7.1g —", "c"),
      s("### V1.7.1h —", "c"),
      s("### V1.7.1i —", "c"),
      s("### V1.7.1j —", "c"),
      s("### V1.7.1k —", "c"),
      s("### V1.7.1l —", "c"),
      s("### V1.7.1m —", "c"),
      s("### V1.7.1n —", "c"),
      s("### V1.7.1o —", "c"),
      s("### V1.7.1p —", "c"),
      s("### V1.7.2 —", "c"),
      s("### Checkpoint Registry Foundation", "c"),
      s("### V1.7.3 —", "c"),
      s("### V1.7.4 —", "c"),
      s("### Monitoring Architecture V2", "c"),
    ],
  },
];
