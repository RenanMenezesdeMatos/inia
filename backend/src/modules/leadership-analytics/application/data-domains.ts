import type { VisibilityFilter } from "../../access/application/access-repository.js"
import type { Permission } from "../../access/domain/permissions.js"
import { accessCovers, hasAccessGrant, type ViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import type { DataChoiceCard, QueryTableCard } from "../domain/view-models.js"
import { parseStatistics, parseStringList, resolveFactPeriod, runFactQuery, type DimensionSpec, type Fact, type MeasureSpec, type Statistic } from "./fact-query.js"
import type { ResolvedStructure } from "./references.js"

/**
 * DOMÍNIOS DE DADO DA LIDERANÇA sobre o motor único (`fact-query.ts`): cada um é UMA ferramenta, com nome, descrição e dimensões
 * próprias, para a INIA não confundir qual chamar. O carregamento (SQL) fica em `domain-facts-loader.ts` e só recebe os membros da
 * estrutura resolvida no backend. Uso da INIA e Apoio com Anjo têm a permissão da TELA DE ORIGEM (`RESTRICTED_DOMAIN_PERMISSION`).
 *  - leadership_interactions: atendimentos/ligações registrados (volume, duração, motivo, canal, ocorrências como rechamada e nota da URA);
 *  - leadership_monitoring: monitoria das chamadas analisadas (critérios do procedimento cumpridos ou não, por assunto);
 *  - leadership_feedbacks: feedbacks publicados às pessoas (tipo, indicador, ciência, concordância);
 *  - leadership_cases: casos de acompanhamento (status, prioridade, indicador);
 *  - leadership_schedule: escala planejada (dias escalados e de folga, horário, horas, pausas planejadas, exceções);
 *  - leadership_workday: jornada por dia, pelo resolvedor único do dia (trabalhou, sem produção a classificar, falta confirmada, aguardando dado…);
 *  - leadership_communications: comunicados publicados que chegaram às pessoas (alcance; a leitura não é registrada);
 *  - leadership_inia_usage: uso da INIA pelas pessoas (perguntas, conversas, chat × voz);
 *  - leadership_support: pedidos de Apoio com Anjo (quantos, como terminaram, tempo até a primeira resposta — nunca o conteúdo).
 */

export type DataDomain = "INTERACTIONS" | "MONITORING" | "FEEDBACKS" | "CASES" | "SCHEDULE" | "WORKDAY" | "COMMUNICATIONS" | "INIA_USAGE" | "SUPPORT"
export type ChannelFlagSpec = { name: string; label: string; valueType: "BOOLEAN" | "NUMERIC" }
export type DomainFacts = { facts: Fact[]; truncated: boolean; flags?: ChannelFlagSpec[] }
export type DomainFactsLoader = (domain: DataDomain, personIds: string[], fromDate: string, toDateExclusive: string) => Promise<DomainFacts>

/** Teto de registros por consulta (o motor calcula em memória): acima disso, a resposta diz que usou só uma parte. */
export const MAX_DOMAIN_FACTS = 200_000

type DomainSpec = { title: string; dimensions: DimensionSpec[]; measures: MeasureSpec[]; methods: string[] }

function interactionsSpec(flags: readonly ChannelFlagSpec[]): DomainSpec {
  return {
    title: "Atendimentos",
    dimensions: [
      { key: "MOTIVO", label: "Motivo" },
      { key: "SUBMOTIVO", label: "Submotivo" },
      { key: "CANAL", label: "Canal" },
      ...flags.filter((flag) => flag.valueType === "BOOLEAN").map((flag) => ({ key: `OCORRENCIA:${flag.name}`, label: flag.label })),
    ],
    measures: [
      { key: "ATENDIMENTOS_POR_PESSOA", label: "Atendimentos por pessoa", kind: "COUNT_PER_PERSON", defaultStatistics: ["TOTAL", "MEDIA", "MEDIANA"] },
      { key: "DURACAO", label: "Duração do atendimento", kind: "SECONDS", defaultStatistics: ["MEDIA", "MEDIANA"] },
      ...flags.map((flag): MeasureSpec => (flag.valueType === "BOOLEAN" ? { key: flag.name, label: flag.label, kind: "RATE", defaultStatistics: [] } : { key: flag.name, label: flag.label, kind: "NUMBER", defaultStatistics: [] })),
    ],
    methods: ["Atendimento = interação registrada (início no período, data no fuso da organização). Duração = fim − início. Ocorrências (rechamada, nota da URA, transferência…) chegam calculadas junto da interação; % de uma ocorrência = atendimentos com a ocorrência registrada ÷ todos os atendimentos do recorte (sem registro conta como sem a ocorrência); TOTAL = quantos atendimentos tiveram a ocorrência."],
  }
}

const MONITORING_SPEC: DomainSpec = {
  title: "Monitoria das chamadas",
  dimensions: [
    { key: "ASSUNTO", label: "Assunto" },
    { key: "CRITERIO", label: "Critério" },
    { key: "SITUACAO", label: "Situação do critério" },
  ],
  measures: [
    { key: "CHAMADAS_POR_PESSOA", label: "Chamadas analisadas por pessoa", kind: "DISTINCT_PER_PERSON", defaultStatistics: ["TOTAL", "MEDIA"] },
    { key: "CUMPRIDO", label: "Critérios cumpridos", kind: "RATE", defaultStatistics: ["TAXA"] },
    { key: "NAO_CUMPRIDO", label: "Critérios não cumpridos", kind: "RATE", defaultStatistics: ["TAXA"] },
  ],
  methods: ["Avaliação vigente de cada critério do procedimento nas chamadas analisadas. % cumpridos e não cumpridos = sobre os critérios avaliáveis (cumprido, parcial, não cumprido); não aplicável e não observável ficam fora da taxa."],
}

const FEEDBACKS_SPEC: DomainSpec = {
  title: "Feedbacks publicados",
  dimensions: [
    { key: "TIPO", label: "Tipo" },
    { key: "INDICADOR", label: "Indicador impactado" },
    { key: "CIENCIA", label: "Ciência" },
    { key: "CONCORDANCIA", label: "Concordância" },
  ],
  measures: [
    { key: "FEEDBACKS_POR_PESSOA", label: "Feedbacks por pessoa", kind: "COUNT_PER_PERSON", defaultStatistics: ["TOTAL", "MEDIA"] },
    { key: "CIENCIA", label: "Com ciência", kind: "RATE", defaultStatistics: ["TAXA"] },
    { key: "DIAS_ATE_CIENCIA", label: "Dias até a ciência", kind: "NUMBER", defaultStatistics: ["MEDIANA"] },
    { key: "CONCORDA", label: "Concordam (entre os que responderam)", kind: "RATE", defaultStatistics: ["TAXA"] },
  ],
  methods: ["Feedback publicado no período (data da publicação), de indicador, de monitoria e de atendimento (entregas do motor de feedback). Ciência = confirmação do próprio colaborador com login e senha. Concordância = resposta registrada na ciência."],
}

const CASES_SPEC: DomainSpec = {
  title: "Casos de acompanhamento",
  dimensions: [
    { key: "STATUS", label: "Status" },
    { key: "PRIORIDADE", label: "Prioridade" },
    { key: "INDICADOR", label: "Indicador" },
  ],
  measures: [
    { key: "CASOS_POR_PESSOA", label: "Casos por pessoa", kind: "COUNT_PER_PERSON", defaultStatistics: ["TOTAL", "MEDIA"] },
    { key: "ABERTO", label: "Em aberto", kind: "RATE", defaultStatistics: ["TAXA"] },
    { key: "DIAS_EM_ABERTO", label: "Dias desde a abertura (abertos)", kind: "NUMBER", defaultStatistics: ["MEDIANA"] },
  ],
  methods: ["Caso de acompanhamento aberto no período (data de criação). Em aberto = status diferente de resolvido e encerrado."],
}

const SCHEDULE_SPEC: DomainSpec = {
  title: "Escala",
  dimensions: [
    { key: "ESCALA", label: "Tipo de escala" },
    { key: "SITUACAO", label: "Dia" },
    { key: "TURNO", label: "Turno" },
    { key: "ENTRADA", label: "Horário de entrada" },
    { key: "EXCECAO", label: "Exceção da escala" },
  ],
  measures: [
    { key: "DIA_ESCALADO", label: "Dias escalados para trabalhar", kind: "RATE", defaultStatistics: ["TOTAL", "TAXA"] },
    { key: "HORAS_ESCALADAS", label: "Horas escaladas no dia", kind: "NUMBER", defaultStatistics: ["MEDIA"] },
    { key: "PAUSAS_PLANEJADAS", label: "Minutos de pausa planejados no dia", kind: "NUMBER", defaultStatistics: [] },
    { key: "PESSOAS_COM_ESCALA", label: "Pessoas com escala informada", kind: "ANY_PER_PERSON", defaultStatistics: ["TAXA"] },
  ],
  methods: ["Escala informada pelo cliente por pessoa e dia (pode incluir datas futuras). Dia de exceção (folga, banco de horas, atestado…) conta como não escalado. Horas = fim − início do turno. Pausas planejadas = atividades escaladas do tipo pausa."],
}

const WORKDAY_SPEC: DomainSpec = {
  title: "Jornada",
  dimensions: [
    { key: "SITUACAO", label: "Situação do dia" },
    { key: "ESCALA", label: "Tipo de escala" },
    { key: "EXCECAO", label: "Exceção da escala" },
    { key: "CLASSIFICACAO", label: "Classificação do dia" },
    { key: "DIVERGENCIA", label: "Divergência em aberto" },
  ],
  measures: [
    { key: "PRODUZIU_NO_DIA_ESCALADO", label: "Dias escalados com produção", kind: "RATE", defaultStatistics: ["TAXA"] },
    { key: "SEM_PRODUCAO_NO_DIA_ESCALADO", label: "Dias escalados sem produção", kind: "RATE", defaultStatistics: ["TOTAL", "TAXA"] },
    { key: "PRODUCAO_NA_FOLGA", label: "Dias de folga com produção", kind: "RATE", defaultStatistics: ["TOTAL"] },
    { key: "ATENDIMENTOS_NO_DIA", label: "Atendimentos por dia trabalhado", kind: "NUMBER", defaultStatistics: ["MEDIA"] },
    { key: "DIVERGENCIA_ABERTA", label: "Dias com divergência em aberto", kind: "RATE", defaultStatistics: ["TOTAL"] },
  ],
  methods: ["Um registro = uma pessoa num dia do período, com a situação do dia decidida pela mesma regra do Calendário da equipe (situação funcional, admissão, exceção, escala, feriado e disponibilidade do dado). \"Dias escalados sem produção\" conta só o dia já encerrado, com as fontes fechadas, em que nada foi observado (pendência a classificar pela liderança) e a falta injustificada já confirmada. Férias, afastamento, ausência justificada, folga, feriado, dia em curso ou futuro, dado ainda não esperado e fonte atrasada ficam fora das taxas: dado ausente nunca é falta, e \"sem produção\" ainda não classificado não é falta."],
}

const COMMUNICATIONS_SPEC: DomainSpec = {
  title: "Comunicados recebidos",
  dimensions: [
    { key: "COMUNICADO", label: "Comunicado" },
    { key: "PUBLICO", label: "Público" },
  ],
  measures: [
    { key: "COMUNICADOS_POR_PESSOA", label: "Comunicados por pessoa", kind: "COUNT_PER_PERSON", defaultStatistics: ["TOTAL", "MEDIA"] },
    { key: "RECEBEU", label: "Pessoas que receberam algum", kind: "ANY_PER_PERSON", defaultStatistics: ["TAXA"] },
  ],
  methods: ["Comunicado da liderança NO AR (já publicado, dentro do período de exibição; agendado, arquivado e retirado ficam fora), publicado no período, que alcança a pessoa pela mesma regra do Acompanhamento: organização inteira, destinatários gravados (Grupo/Subgrupo) ou recorte (pelo cadastro atual). A leitura do comunicado não é registrada: não há como dizer quem leu."],
}

const INIA_USAGE_SPEC: DomainSpec = {
  title: "Uso da INIA",
  dimensions: [{ key: "CANAL", label: "Canal" }],
  measures: [
    { key: "PERGUNTAS_POR_PESSOA", label: "Perguntas à INIA por pessoa", kind: "COUNT_PER_PERSON", defaultStatistics: ["TOTAL", "MEDIA", "MEDIANA"] },
    { key: "CONVERSAS_POR_PESSOA", label: "Conversas por pessoa", kind: "DISTINCT_PER_PERSON", defaultStatistics: [] },
    { key: "USOU", label: "Pessoas que usaram a INIA", kind: "ANY_PER_PERSON", defaultStatistics: ["TAXA"] },
  ],
  methods: ["Pergunta = mensagem da pessoa à INIA (chat ou voz) no período. O conteúdo das conversas não entra no cálculo."],
}

const SUPPORT_SPEC: DomainSpec = {
  title: "Apoio com Anjo",
  dimensions: [{ key: "FIM", label: "Como terminou" }],
  measures: [
    { key: "PEDIDOS_POR_PESSOA", label: "Atendimentos de apoio por pessoa", kind: "COUNT_PER_PERSON", defaultStatistics: ["TOTAL", "MEDIA"] },
    { key: "PEDIU_APOIO", label: "Pessoas que pediram apoio", kind: "ANY_PER_PERSON", defaultStatistics: ["TAXA"] },
    { key: "TEMPO_ATE_RESPOSTA", label: "Tempo até a primeira resposta do Anjo", kind: "SECONDS", defaultStatistics: ["MEDIANA"] },
    { key: "DURACAO", label: "Duração do apoio", kind: "SECONDS", defaultStatistics: [] },
  ],
  methods: ["Atendimento de apoio humano (Anjo) iniciado no período para a pessoa. Só quantidades e tempos: o conteúdo da sala de apoio nunca é lido."],
}

export function domainSpec(domain: DataDomain, flags: readonly ChannelFlagSpec[] = []): DomainSpec {
  const specs: Record<Exclude<DataDomain, "INTERACTIONS">, DomainSpec> = { MONITORING: MONITORING_SPEC, FEEDBACKS: FEEDBACKS_SPEC, CASES: CASES_SPEC, SCHEDULE: SCHEDULE_SPEC, WORKDAY: WORKDAY_SPEC, COMMUNICATIONS: COMMUNICATIONS_SPEC, INIA_USAGE: INIA_USAGE_SPEC, SUPPORT: SUPPORT_SPEC }
  return domain === "INTERACTIONS" ? interactionsSpec(flags) : specs[domain]
}

/**
 * Domínios com a permissão da TELA DE ORIGEM (decisão de 19/11/2026): uso da INIA por pessoa = "Quem mais usa"; Apoio com Anjo = painel
 * do apoio. Sem a permissão a ferramenta não é declarada ao modelo e, se chegar, é recusada; com ela, só as pessoas do escopo da permissão.
 */
export const RESTRICTED_DOMAIN_PERMISSION = { INIA_USAGE: "ai.usage_ranking.view", SUPPORT: "human_support.coordinate" } as const satisfies Partial<Record<DataDomain, Permission>>
export type RestrictedDomain = keyof typeof RESTRICTED_DOMAIN_PERMISSION
/**
 * Onde a conta tem a permissão do domínio. `ownStructureIds` = a permissão com escopo "Minha estrutura" (a subárvore de quem tem o
 * papel) — só no uso da INIA, como a tela "Quem mais usa" aceita (DC-06); no Apoio com Anjo "Minha estrutura" não vale e nunca é preenchido.
 */
export type DomainGrant = VisibilityFilter & { ownStructureIds?: ReadonlySet<string> }
export type DomainAccess = Partial<Record<RestrictedDomain, DomainGrant>>
export const isRestrictedDomain = (domain: DataDomain): domain is RestrictedDomain => domain in RESTRICTED_DOMAIN_PERMISSION
/** A conta tem a permissão do domínio em algum escopo? Ausente = não (nega por padrão). */
export const domainAllowed = (access: DomainAccess | undefined, domain: DataDomain): boolean => !isRestrictedDomain(domain) || (access?.[domain] !== undefined && (hasAccessGrant(access[domain]) || access[domain].ownStructureIds !== undefined))
/** A permissão do domínio alcança esta pessoa? Organização/Grupo/Subgrupo da permissão ou, em "Minha estrutura", a própria subárvore. */
export const domainGrantCovers = (granted: DomainGrant, person: { id: string; teamId: string | null; subteamId: string | null }): boolean => accessCovers(granted, person) || (granted.ownStructureIds?.has(person.id) ?? false)

export const DOMAIN_OF_TOOL: Record<string, DataDomain> = { leadership_interactions: "INTERACTIONS", leadership_monitoring: "MONITORING", leadership_feedbacks: "FEEDBACKS", leadership_cases: "CASES", leadership_schedule: "SCHEDULE", leadership_workday: "WORKDAY", leadership_communications: "COMMUNICATIONS", leadership_inia_usage: "INIA_USAGE", leadership_support: "SUPPORT" }

/** Executa a consulta de um domínio. `error` = pedido fora do formato (vira issue). */
export async function runDomainQuery(
  scope: ViewerScope,
  /** `includeAnyRole`: a população é a própria pessoa da sessão, qualquer que seja o papel (ferramentas do operador). */
  input: { domain: DataDomain; structure: ResolvedStructure; args: Record<string, unknown>; load: DomainFactsLoader; lastClosedPeriod: string; now: Date; includeAnyRole?: boolean; domainAccess?: DomainAccess },
): Promise<{ card: QueryTableCard; resolvedTermFields?: string[] } | { choice: DataChoiceCard; summary: string } | { error: string }> {
  if (!domainAllowed(input.domainAccess, input.domain)) return { error: `Você não tem permissão para consultar ${domainSpec(input.domain).title.toLowerCase()} por aqui. Diga isso à pessoa; não estime nem use outro dado no lugar.` }
  const period = resolveFactPeriod(input.args, input.lastClosedPeriod)
  if ("error" in period) return { error: period.error }
  const granted = isRestrictedDomain(input.domain) ? input.domainAccess![input.domain]! : null
  const population = input.structure.resolved.members.filter((person) => (input.includeAnyRole || person.role === "OPERATOR") && person.active && (!granted || domainGrantCovers(granted, person)))
  const loaded = await input.load(input.domain, population.map((person) => person.id), period.from, period.toExclusive)
  const spec = domainSpec(input.domain, loaded.flags ?? [])
  const filters: Record<string, string[]> = {}
  for (const dimension of spec.dimensions) {
    if (dimension.key.startsWith("OCORRENCIA:")) continue
    const values = parseStringList(input.args[dimension.key.toLowerCase()])
    if (values.length > 0) filters[dimension.key] = values
  }
  // "com_ocorrencia": só atendimentos em que a ocorrência aconteceu (ex.: rechamada); aceita o nome ou o rótulo.
  for (const wanted of parseStringList(input.args.com_ocorrencia)) {
    const flag = (loaded.flags ?? []).find((item) => item.valueType === "BOOLEAN" && [item.name, item.label].some((value) => value.toLowerCase() === wanted.toLowerCase()))
    if (flag) filters[`OCORRENCIA:${flag.name}`] = ["sim"]
    else return { error: `Ocorrência "${wanted}" não existe. Ocorrências disponíveis: ${(loaded.flags ?? []).filter((item) => item.valueType === "BOOLEAN").map((item) => item.label).join("; ")}.` }
  }
  // Busca por TRECHO (motivo, submotivo, ocorrência): sem diferença de acento e maiúscula. Termo que aparece em mais de um campo sem o
  // campo dito pela pessoa = escolha da leitura (cartão DATA_CHOICE), nunca uma leitura escolhida pela IA.
  let facts = loaded.facts
  const criteria: string[] = []
  // `termo` sem `termo_em` que só apareceu em UM campo: o campo usado volta para quem chamou (a proposta de report o guarda — DC-04).
  let resolvedTermFields: string[] | null = null
  if (input.domain === "INTERACTIONS") {
    const narrowed = narrowByText(facts, input.args, loaded.flags ?? [], { structure: input.structure, periodNote: period.note, now: input.now })
    if ("error" in narrowed) return narrowed
    if ("choice" in narrowed) return narrowed
    facts = narrowed.facts
    criteria.push(...narrowed.criteria)
    if (narrowed.resolvedField) resolvedTermFields = [narrowed.resolvedField]
  }
  const measureKeys = parseStringList(input.args.medidas).map((value) => {
    const match = spec.measures.find((measure) => [measure.key, measure.label].some((candidate) => candidate.toLowerCase() === value.toLowerCase()))
    return match?.key ?? value
  })
  const unknownMeasures = measureKeys.filter((key) => !spec.measures.some((measure) => measure.key === key))
  if (unknownMeasures.length > 0) return { error: `Medida desconhecida: ${unknownMeasures.join(", ")}. Medidas disponíveis: ${spec.measures.map((measure) => `${measure.key} (${measure.label})`).join("; ")}.` }
  const groupBy = typeof input.args.agrupar_por === "string" ? input.args.agrupar_por : "ESTRUTURA"
  const statistics: Statistic[] | null = parseStatistics(input.args.estatisticas)
  const card = runFactQuery(scope, {
    domainTitle: spec.title,
    structure: input.structure,
    population,
    facts,
    dimensions: spec.dimensions,
    measures: spec.measures,
    groupBy,
    measureKeys,
    statistics,
    filters,
    periodNote: period.note,
    sort: { by: input.args.ordenar_por === "VALOR" ? "VALUE" : "GROUP", order: input.args.ordem === "ASC" ? "asc" : input.args.ordenar_por === "VALOR" ? "desc" : "asc" },
    limit: typeof input.args.limite === "number" ? input.args.limite : 100,
    // Ranking por valor de um campo do registro (critério, motivo…) com amostra mínima: 1 registro com 100% não lidera a lista.
    minimumRecords: typeof input.args.minimo_registros === "number" ? Math.max(0, input.args.minimo_registros) : input.args.ordenar_por === "VALOR" && !["ESTRUTURA", "PESSOA", "SUPERVISOR", "COORDENADOR", "GERENTE", "GERENTE_SENIOR", "GRUPO", "SUBGRUPO"].includes(groupBy) ? 5 : 0,
    methods: [`${spec.methods.join(" ")} População: operadores ativos da estrutura (${population.length}).`, `Medidas disponíveis: ${spec.measures.map((measure) => `${measure.key} (${measure.label})`).join("; ")}.`],
    limitations: criteria.length > 0 ? [`Recorte por trecho: ${criteria.join(" ou ")} (sem diferença de acento e maiúscula).`] : [],
    truncated: loaded.truncated,
    now: input.now,
  })
  return { card, ...(resolvedTermFields ? { resolvedTermFields } : {}) }
}

const foldText = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase()
export const TEXT_FIELDS = ["MOTIVO", "SUBMOTIVO", "OCORRENCIA"] as const
type TextField = (typeof TEXT_FIELDS)[number]
const FIELD_TEXT: Record<TextField, string> = { MOTIVO: "o motivo", SUBMOTIVO: "o submotivo", OCORRENCIA: "a ocorrência registrada" }

/**
 * Recorte de atendimentos por trecho de texto. `motivo_contem`/`submotivo_contem`: campo explícito. `termo` + `termo_em` (MOTIVO,
 * SUBMOTIVO, OCORRENCIA; vários = qualquer um deles): o campo dito. `termo` sem `termo_em`: procura nos três; achou em um só, usa esse;
 * em mais de um, devolve a escolha com a contagem de cada leitura (e a de "qualquer um deles").
 */
export function narrowByText(
  facts: Fact[],
  args: Record<string, unknown>,
  flags: readonly ChannelFlagSpec[],
  context: { structure: ResolvedStructure; periodNote: string; now: Date },
): { facts: Fact[]; criteria: string[]; resolvedField?: TextField } | { choice: DataChoiceCard; summary: string } | { error: string } {
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null)
  const matcher = (field: TextField, term: string) => {
    const wanted = foldText(term)
    if (field === "OCORRENCIA") {
      const matching = flags.filter((flag) => flag.valueType === "BOOLEAN" && [flag.name, flag.label].some((value) => foldText(value).includes(wanted)))
      return (fact: Fact) => matching.some((flag) => fact.measures[flag.name] === 1)
    }
    return (fact: Fact) => {
      const value = fact.dims[field]
      return typeof value === "string" && foldText(value).includes(wanted)
    }
  }
  const describe = (field: TextField, term: string) => `${FIELD_TEXT[field]} contém "${term}"`
  const criteria: string[] = []
  let current = facts
  for (const [field, key] of [["MOTIVO", "motivo_contem"], ["SUBMOTIVO", "submotivo_contem"]] as const) {
    const term = text(args[key])
    if (!term) continue
    current = current.filter(matcher(field, term))
    criteria.push(describe(field, term))
  }
  const term = text(args.termo)
  if (!term) return { facts: current, criteria }
  const declared = parseStringList(args.termo_em).map((value) => value.toUpperCase()).filter((value): value is TextField => (TEXT_FIELDS as readonly string[]).includes(value))
  if (declared.length > 0) {
    const tests = declared.map((field) => matcher(field, term))
    return { facts: current.filter((fact) => tests.some((test) => test(fact))), criteria: [...criteria, declared.map((field) => describe(field, term)).join(" ou ")] }
  }
  const counts = TEXT_FIELDS.map((field) => ({ field, count: current.filter(matcher(field, term)).length })).filter((item) => item.count > 0)
  if (counts.length === 0) return { error: `"${term}" não aparece no motivo, no submotivo nem nas ocorrências dos atendimentos do período. Diga isso à pessoa; não troque por outro termo.` }
  if (counts.length === 1) return { facts: current.filter(matcher(counts[0]!.field, term)), criteria: [...criteria, describe(counts[0]!.field, term)], resolvedField: counts[0]!.field }
  const total = current.length
  const share = (count: number) => `${count.toLocaleString("pt-BR")} atendimentos · ${total > 0 ? ((count / total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : "0"}% do período`
  const any = current.filter((fact) => counts.some((item) => matcher(item.field, term)(fact))).length
  const options = [
    ...counts.map((item) => ({ id: item.field, label: `${FIELD_TEXT[item.field].charAt(0).toUpperCase()}${FIELD_TEXT[item.field].slice(2)} contém "${term}"`.replace(/^O /, ""), detail: share(item.count), question: `Considere os atendimentos em que ${describe(item.field, term)} (${context.periodNote}).` })),
    { id: "QUALQUER", label: `Qualquer um deles (${counts.map((item) => FIELD_TEXT[item.field].replace(/^(o|a) /, "")).join(", ")})`, detail: share(any), question: `Considere os atendimentos em que ${counts.map((item) => FIELD_TEXT[item.field]).join(", ")} contém "${term}" — qualquer um deles (${context.periodNote}).` },
  ]
  const choice: DataChoiceCard = {
    type: "DATA_CHOICE",
    generatedAt: context.now.toISOString(),
    structure: context.structure.ref,
    title: `Onde procurar "${term}"?`,
    prompt: `"${term}" aparece em mais de um campo dos atendimentos. Escolha a leitura que você quer:`,
    scopeNote: `${context.structure.ref.label} · ${context.periodNote} · ${total.toLocaleString("pt-BR")} atendimentos no período`,
    options,
  }
  const summary = `Ambiguidade: "${term}" aparece em mais de um campo dos atendimentos (${context.periodNote}, ${total} atendimentos no total): ${options.map((option) => `${option.label} — ${option.detail}`).join("; ")}. A pessoa vai escolher a leitura no cartão. Responda em poucas linhas: diga que o termo aparece em mais de um campo, mostre estas opções com os números exatamente como estão e peça que escolha. Não escolha por ela nem calcule outra coisa agora.`
  return { choice, summary }
}
