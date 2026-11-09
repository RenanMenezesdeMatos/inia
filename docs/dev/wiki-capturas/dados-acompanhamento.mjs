// O que a tela do colaborador precisa para abrir o Acompanhamento com um feedback fictício. Nada aqui vem de dados reais.
const FEEDBACK_VIEW = {
  version: "FEEDBACK_VIEW_V1",
  heading: { title: "Dúvida sobre cobrança na fatura", subtitle: "Atendimento de hoje" },
  card: "O cliente saiu sem saber quando a cobrança seria revista.",
  greeting: "Caio, olhei o atendimento sobre a cobrança na fatura.",
  narrative: [
    "Você identificou a cobrança rapidamente e explicou o motivo com clareza. Esse cuidado continua valendo.",
    "O ponto a ajustar está no fechamento: o atendimento terminou sem dizer quando a revisão seria concluída, e o procedimento pede esse prazo. Informar o próximo passo evita que o cliente fique em dúvida depois de desligar.",
  ],
  developments: [
    {
      key: "prazo-de-retorno",
      title: "Informar o prazo da revisão",
      whatHappened: "A revisão foi aberta, mas o cliente não recebeu o prazo de retorno.",
      call: { kind: "QUOTES", quotes: [{ speaker: "OPERATOR", intro: "No encerramento, você disse:", text: "Pronto, já abri a revisão aqui. Mais alguma coisa?", truncated: false }] },
      adjustment: ["Depois de abrir a revisão, diga o prazo e como o cliente será avisado."],
      guidance: { rules: [{ text: "Informar prazo e canal de retorno ao registrar uma revisão de cobrança.", section: "Encerramento" }], avoid: [], examples: [] },
      sources: [{ documentId: "documento-ficticio", documentTitle: "Procedimento de revisão de cobrança (fictício)", section: "Encerramento", href: null }],
      whyItMatters: ["Sem o prazo, o cliente tende a ligar de novo para saber o andamento."],
      howToApply: null,
      suggestedResponse: "A revisão está aberta e o retorno sai em até 5 dias úteis, por SMS.",
      itemIndexes: [0],
    },
  ],
  maintain: null,
  attention: [],
  materials: [],
  context: "A nota do cliente foi o motivo da análise. Ela sozinha não diz o que aconteceu: a conversa é que sustenta o que está aqui.",
  kind: "MONITORING",
}

const agora = () => new Date().toISOString()

const overview = () => ({
  profile: { name: "Caio Exemplo", role: "OPERATOR", avatarUrl: null, jobTitle: "Operador de atendimento" },
  indicators: [],
  feedbacks: [
    {
      id: "feedback-ficticio",
      kind: "MONITORING",
      status: "PUBLISHED",
      summary: FEEDBACK_VIEW.card,
      impactedIndicator: "Nota da Pesquisa na URA",
      evidenceFound: "Pronto, já abri a revisão aqui. Mais alguma coisa?",
      observedBehavior: "O atendimento terminou sem informar o prazo da revisão.",
      relatedProcedure: "Procedimento de revisão de cobrança (fictício).",
      recommendation: "Depois de abrir a revisão, diga o prazo e como o cliente será avisado.",
      createdAt: agora(),
      occurredAt: agora(),
      acknowledgedAt: null,
      supportMaterials: [],
      feedbackView: FEEDBACK_VIEW,
      heading: FEEDBACK_VIEW.heading,
      origin: { family: "MONITORING", reason: "FLAG", label: "Nota da URA", iconKey: "clipboard-check" },
    },
  ],
  feedbacksNextCursor: null,
})

const contexto = () => ({
  viewer: { personId: "pessoa-ficticia", role: "OPERATOR", name: "Caio Exemplo" },
  defaultSubject: null,
  capabilities: { mode: "EMPLOYEE", canSeePrv: false, canSeeStructureSummary: false, canSeeDistribution: false, canSeeMembers: false, canDrillDown: false, groupingOptions: [], peopleTabLabel: null, tabs: ["FOLLOW_UP"] },
  pendingActionCount: 0,
  availablePeriods: [],
  currentPeriod: "2026-10",
})

const meuPerfil = () => ({
  personId: "pessoa-ficticia",
  registeredName: "Caio Exemplo",
  preferredName: "Caio",
  displayName: "Caio",
  addressName: "Caio",
  avatarUrl: null,
  avatarSource: "NONE",
  cover: { kind: "DEFAULT", preset: "aurora", imageUrl: null },
  professional: { jobTitle: "Operador de atendimento", teamName: "Atendimento (fictício)", matricula: null },
  updatedAt: null,
})

/** `undefined` = esta rota não é do Acompanhamento. */
export function acompanhamentoDoColaborador(path) {
  if (path === "/api/v1/operator/overview") return overview()
  if (path === "/api/v1/operator/feedbacks") return { items: overview().feedbacks, nextCursor: null }
  if (path === "/api/v1/analytics/context") return contexto()
  if (path === "/api/v1/me/profile") return meuPerfil()
  return undefined
}
