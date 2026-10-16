import { z } from "zod"
import { ANALYSIS_DIMENSIONS } from "./analysis-dimensions.js"
import { investigationCapabilitySchema, type InvestigationCapability } from "./capabilities.js"

/**
 * TOOL CATALOG — catálogo compartilhado das Tools de investigação (independente de UI).
 *
 * Cada Tool é pequena e determinística (exceto as duas que analisam conteúdo semântico de
 * transcrições, marcadas `usesLlm`, que mesmo assim devolvem evidência estruturada). A definição
 * aqui é a ÚNICA fonte para: declaração de function calling enviada ao modelo (`parameters`),
 * validação dos argumentos (`inputSchema`), agrupamento em capacidades (UI) e rótulos do trace.
 * O sujeito da investigação (colaborador, interação, período padrão) vem do runtime — o modelo
 * nunca escolhe "de quem" são os dados.
 */
export const TOOL_KEYS = [
  "get_indicator_snapshot",
  "compare_periods",
  "get_available_dimensions",
  "segment_indicator",
  "compare_population",
  "inspect_indicator_composition",
  "validate_data_quality",
  "detect_anomalies",
  "get_employee_history",
  "find_interactions",
  "get_interaction_context",
  "get_interaction_flags",
  "find_comparable_interactions",
  "analyze_interactions",
  "analyze_peer_patterns",
  "inspect_work_context",
  "query_knowledge",
  "recommend_support_materials",
  "synthesize_evidence",
] as const
export type ToolKey = (typeof TOOL_KEYS)[number]

/** Subconjunto do JSON Schema aceito pelo function calling do Gemini. */
export type ToolParameterSchema = {
  type: "object" | "string" | "number" | "integer" | "boolean" | "array"
  description?: string
  enum?: string[]
  items?: ToolParameterSchema
  properties?: Record<string, ToolParameterSchema>
  required?: string[]
}

/** O que a Tool precisa do contexto para estar disponível numa investigação. */
export type ToolRequirement = "SUBJECT" | "INTERACTIONS" | "INTERACTION" | "KNOWLEDGE"

export type ToolDefinition = {
  key: ToolKey
  capability: InvestigationCapability
  label: string
  description: string
  parameters: ToolParameterSchema
  inputSchema: z.ZodTypeAny
  requires: ToolRequirement[]
  usesLlm: boolean
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data no formato AAAA-MM-DD")
const periodSchema = z.object({ from: dateSchema, to: dateSchema }).optional()
const indicatorCodeSchema = z.string().trim().min(1).max(40)
const periodParameter: ToolParameterSchema = {
  type: "object",
  description: "Período analisado (datas locais, inclusivas). Omita para usar o período padrão desta investigação.",
  properties: { from: { type: "string", description: "AAAA-MM-DD" }, to: { type: "string", description: "AAAA-MM-DD" } },
  required: ["from", "to"],
}
const indicatorParameter: ToolParameterSchema = { type: "string", description: "Código do indicador (ex.: o indicador desta investigação). Só códigos do catálogo." }
const interactionIdsParameter: ToolParameterSchema = { type: "array", description: "Referências das interações devolvidas por find_interactions/find_comparable_interactions (ex.: [\"I1\", \"I2\"]).", items: { type: "string" } }

export const TOOL_CATALOG: ToolDefinition[] = [
  {
    key: "get_indicator_snapshot",
    capability: "INDICATOR_ANALYSIS",
    label: "Consultar indicador",
    description: "Situação de um indicador do colaborador no período: valor pela semântica oficial do catálogo, unidade, direção desejada, meta vigente, amostra, cobertura e fechamento oficial (quando existir). Oficial e operacional nunca se misturam.",
    parameters: { type: "object", properties: { indicatorCode: indicatorParameter, period: periodParameter }, required: ["indicatorCode"] },
    inputSchema: z.object({ indicatorCode: indicatorCodeSchema, period: periodSchema }),
    requires: ["SUBJECT"],
    usesLlm: false,
  },
  {
    key: "compare_periods",
    capability: "INDICATOR_ANALYSIS",
    label: "Comparar períodos",
    description: "Melhorou ou piorou? Compara o período atual com um período de referência (padrão: o período anterior de mesmo tamanho) e devolve diferença absoluta, relativa, direção da mudança e sentido de performance — calculados pela aplicação, nunca pelo modelo.",
    parameters: { type: "object", properties: { indicatorCode: indicatorParameter, currentPeriod: periodParameter, referencePeriod: { ...periodParameter, description: "Período de referência. Omita para o período imediatamente anterior, de mesmo tamanho." } }, required: ["indicatorCode"] },
    inputSchema: z.object({ indicatorCode: indicatorCodeSchema, currentPeriod: periodSchema, referencePeriod: periodSchema }),
    requires: ["SUBJECT"],
    usesLlm: false,
  },
  {
    key: "get_available_dimensions",
    capability: "SEGMENTATION",
    label: "Dimensões disponíveis",
    description: "Por quais dimensões este indicador pode ser segmentado com os dados reais (dia, dia da semana, semana, assunto, motivo, canal, hora, flag) e o que cada recorte mede. Use antes de segmentar — dimensão indisponível é indisponível.",
    parameters: { type: "object", properties: { indicatorCode: indicatorParameter, period: periodParameter }, required: ["indicatorCode"] },
    inputSchema: z.object({ indicatorCode: indicatorCodeSchema, period: periodSchema }),
    requires: ["SUBJECT"],
    usesLlm: false,
  },
  {
    key: "segment_indicator",
    capability: "SEGMENTATION",
    label: "Segmentar",
    description: "Onde o resultado está concentrado? Buckets por dimensão (valor pela semântica do indicador, amostra, cobertura, contribuição). Recortes por assunto/motivo/hora/flag usam a métrica das próprias interações (duração/volume registrados) quando compatível — a resposta diz explicitamente qual métrica foi segmentada.",
    parameters: { type: "object", properties: { indicatorCode: indicatorParameter, dimension: { type: "string", description: "Dimensão (ver get_available_dimensions).", enum: [...ANALYSIS_DIMENSIONS] }, period: periodParameter, filters: { type: "object", description: "Filtros opcionais sobre interações.", properties: { subject: { type: "string", description: "Assunto: código canônico (canonicalSubject) ou bruto exato (subject)" }, reason: { type: "string", description: "Motivo: código canônico (canonicalReason) ou bruto exato (reason)" }, flag: { type: "string", description: "Nome da flag" } } } }, required: ["indicatorCode", "dimension"] },
    inputSchema: z.object({ indicatorCode: indicatorCodeSchema, dimension: z.enum(ANALYSIS_DIMENSIONS), period: periodSchema, filters: z.object({ subject: z.string().optional(), reason: z.string().optional(), flag: z.string().optional() }).optional() }),
    requires: ["SUBJECT"],
    usesLlm: false,
  },
  {
    key: "compare_population",
    capability: "OPERATIONAL_COMPARISON",
    label: "Comparar com a estrutura",
    description: "Isso é individual ou também ocorre na população comparável? Compara o colaborador com o Subgrupo ou o Grupo dele (valor agregado da população, diferença, amostra, tamanho da população). Sempre agregado — nunca expõe dados de pares individuais; população pequena demais é recusada.",
    parameters: { type: "object", properties: { indicatorCode: indicatorParameter, reference: { type: "string", description: "SUBGROUP = Subgrupo do colaborador; GROUP = Grupo.", enum: ["SUBGROUP", "GROUP"] }, period: periodParameter }, required: ["indicatorCode", "reference"] },
    inputSchema: z.object({ indicatorCode: indicatorCodeSchema, reference: z.enum(["SUBGROUP", "GROUP"]), period: periodSchema }),
    requires: ["SUBJECT"],
    usesLlm: false,
  },
  {
    key: "inspect_indicator_composition",
    capability: "INDICATOR_ANALYSIS",
    label: "Composição do indicador",
    description: "O que está formando este indicador? Componentes reais registrados (numerador/denominador, volume, amostra) pela semântica do catálogo. Indicador sem componentes devolve NOT_SUPPORTED — nunca inventa partes.",
    parameters: { type: "object", properties: { indicatorCode: indicatorParameter, period: periodParameter }, required: ["indicatorCode"] },
    inputSchema: z.object({ indicatorCode: indicatorCodeSchema, period: periodSchema }),
    requires: ["SUBJECT"],
    usesLlm: false,
  },
  {
    key: "validate_data_quality",
    capability: "INDICATOR_ANALYSIS",
    label: "Validar qualidade do dado",
    description: "Existe evidência suficiente para confiar? Amostra × mínimo do catálogo, cobertura × mínima, atualidade e disponibilidade das fontes, fontes faltantes e o status final (SUFFICIENT, INSUFFICIENT_SAMPLE, INSUFFICIENT_COVERAGE, STALE, SOURCE_DELAY, AVAILABILITY_UNKNOWN).",
    parameters: { type: "object", properties: { indicatorCode: indicatorParameter, period: periodParameter }, required: ["indicatorCode"] },
    inputSchema: z.object({ indicatorCode: indicatorCodeSchema, period: periodSchema }),
    requires: ["SUBJECT"],
    usesLlm: false,
  },
  {
    key: "detect_anomalies",
    capability: "INDICATOR_ANALYSIS",
    label: "Detectar picos e recorrência",
    description: "Recorrente ou pico isolado? Série diária do indicador com baseline (mediana), desvio robusto e classificação por ponto (NORMAL/ATYPICAL/ANOMALY) e padrão da série (STABLE/ISOLATED_SPIKES/RECURRENT). Método determinístico e explicável.",
    parameters: { type: "object", properties: { indicatorCode: indicatorParameter, period: periodParameter }, required: ["indicatorCode"] },
    inputSchema: z.object({ indicatorCode: indicatorCodeSchema, period: periodSchema }),
    requires: ["SUBJECT"],
    usesLlm: false,
  },
  {
    key: "get_employee_history",
    capability: "INDICATOR_ANALYSIS",
    label: "Histórico do colaborador",
    description: "Como o indicador evoluiu? Série temporal coerente: OPERATIONAL = medições diárias agregadas por semana na janela; OFFICIAL = fechamentos mensais oficiais (valor, atingimento, quartil) como fornecidos. Nunca mistura as duas camadas.",
    parameters: { type: "object", properties: { indicatorCode: indicatorParameter, layer: { type: "string", description: "OPERATIONAL (diário/semanal) ou OFFICIAL (fechamentos mensais).", enum: ["OPERATIONAL", "OFFICIAL"] }, period: periodParameter }, required: ["indicatorCode", "layer"] },
    inputSchema: z.object({ indicatorCode: indicatorCodeSchema, layer: z.enum(["OPERATIONAL", "OFFICIAL"]), period: periodSchema }),
    requires: ["SUBJECT"],
    usesLlm: false,
  },
  {
    key: "find_interactions",
    capability: "INTERACTION_ANALYSIS",
    label: "Buscar interações",
    description: "Quais interações estão relacionadas a este recorte? Lista (limite seguro) com id, data/hora, assunto (e motivo, quando há submotivo), canal, duração e flags presentes, ordenável por RECENT, LONGEST, SHORTEST. Só filtros que existem: assunto, motivo, flag, período. A amostra é escolhida pela estratégia (padrão decidida pelo runtime pela pergunta e pelo tamanho da janela: janela longa com pergunta de padrão = distribuída no tempo).",
    parameters: { type: "object", properties: { period: periodParameter, subject: { type: "string", description: "Assunto: código canônico (canonicalSubject) ou bruto exato (subject) — ver buckets de SUBJECT." }, reason: { type: "string", description: "Motivo: código canônico (canonicalReason) ou bruto exato (reason) — ver buckets de REASON." }, flag: { type: "string", description: "Nome da flag presente na interação." }, orderBy: { type: "string", enum: ["RECENT", "LONGEST", "SHORTEST"] }, limit: { type: "integer", description: "Máximo de interações (padrão 10, teto 25)." }, sampling: { type: "string", enum: ["RECENT", "TEMPORAL_STRATIFIED", "SUBJECT_STRATIFIED", "FLAG_STRATIFIED"], description: "Só se quiser outra estratégia que não a padrão do runtime." } } },
    inputSchema: z.object({ period: periodSchema, subject: z.string().optional(), reason: z.string().optional(), flag: z.string().optional(), orderBy: z.enum(["RECENT", "LONGEST", "SHORTEST"]).optional(), limit: z.number().int().positive().optional(), sampling: z.enum(["RECENT", "TEMPORAL_STRATIFIED", "SUBJECT_STRATIFIED", "FLAG_STRATIFIED"]).optional() }),
    requires: ["SUBJECT"],
    usesLlm: false,
  },
  {
    key: "get_interaction_context",
    capability: "INTERACTION_ANALYSIS",
    label: "Contexto da interação",
    description: "Contexto objetivo de UMA interação: data/hora, duração, assunto, canal, flags com valores e tamanho da transcrição. Só dados reais.",
    parameters: { type: "object", properties: { interactionId: { type: "string", description: "Referência da interação (ex.: I1); omita para a interação desta investigação." } } },
    inputSchema: z.object({ interactionId: z.string().uuid().optional() }),
    requires: ["SUBJECT"],
    usesLlm: false,
  },
  {
    key: "get_interaction_flags",
    capability: "INTERACTION_ANALYSIS",
    label: "Flags do conjunto",
    description: "Quais sinais/flags apareceram neste conjunto de interações (contagem por flag e em quais interações). Coexistência não é causa.",
    parameters: { type: "object", properties: { interactionIds: interactionIdsParameter, period: periodParameter } },
    inputSchema: z.object({ interactionIds: z.array(z.string().uuid()).max(50).optional(), period: periodSchema }),
    requires: ["SUBJECT"],
    usesLlm: false,
  },
  {
    key: "find_comparable_interactions",
    capability: "INTERACTION_ANALYSIS",
    label: "Interações comparáveis",
    description: "Interações de OUTROS operadores do mesmo Subgrupo/Grupo com o mesmo assunto (e canal) na janela — população determinística e anônima (ids sem nome), para comparação de duração e para analyze_peer_patterns. Respeita população mínima.",
    parameters: { type: "object", properties: { subject: { type: "string", description: "Assunto das interações de referência: código canônico (canonicalSubject) ou bruto exato (subject); sem canônico, só igualdade exata." }, reference: { type: "string", enum: ["SUBGROUP", "GROUP"] }, period: periodParameter, limit: { type: "integer", description: "Máximo de interações (padrão 12, teto 25)." } }, required: ["subject"] },
    inputSchema: z.object({ subject: z.string().min(1), reference: z.enum(["SUBGROUP", "GROUP"]).optional(), period: periodSchema, limit: z.number().int().positive().optional() }),
    requires: ["SUBJECT"],
    usesLlm: false,
  },
  {
    key: "analyze_interactions",
    capability: "INTERACTION_ANALYSIS",
    label: "Analisar transcrições",
    description: "Analisa o conteúdo das transcrições indicadas em camadas: por interação, observações (necessidades do cliente e se foram resolvidas, perguntas × respostas, ações e afirmações do operador, compromissos, sinais do cliente, afirmações sobre procedimento) e findings (forças, atritos, necessidades não resolvidas, questões procedimentais); entre interações, PATTERNS com evidência literal, contagem de transcrições analisadas com evidência verificada (limite inferior — nunca prevalência no período), nível de suporte e cobertura temporal. Recebe o objetivo e as lacunas abertas; zero achados é resposta válida. Amostra limitada (8).",
    parameters: { type: "object", properties: { interactionIds: interactionIdsParameter, objective: { type: "string", description: "O que esta análise deve responder para a investigação (uma frase; a pergunta, não uma lista de itens)." } }, required: ["interactionIds", "objective"] },
    inputSchema: z.object({ interactionIds: z.array(z.string().uuid()).min(1).max(25), objective: z.string().min(5).max(400) }),
    requires: ["SUBJECT"],
    usesLlm: true,
  },
  {
    key: "analyze_peer_patterns",
    capability: "INTERACTION_ANALYSIS",
    label: "Padrões nas comparáveis",
    description: "Que padrões aparecem nas interações comparáveis com melhor desempenho (duração menor, por regra determinística)? Analisa a amostra anônima e devolve padrões com evidência — 'na amostra analisada', nunca 'os melhores sempre'. Sem nomes de colegas.",
    parameters: { type: "object", properties: { subject: { type: "string", description: "Assunto das interações comparáveis." }, objective: { type: "string", description: "O que procurar nas interações de referência." }, reference: { type: "string", enum: ["SUBGROUP", "GROUP"] }, period: periodParameter }, required: ["subject", "objective"] },
    inputSchema: z.object({ subject: z.string().min(1), objective: z.string().min(5).max(400), reference: z.enum(["SUBGROUP", "GROUP"]).optional(), period: periodSchema }),
    requires: ["SUBJECT"],
    usesLlm: true,
  },
  {
    key: "inspect_work_context",
    capability: "WORK_CONTEXT",
    label: "Jornada operacional",
    description: "Escala, situação funcional, ausências, exceções, dias programados × observados, disponibilidade/atraso das fontes e classificações no período — pelo Calendário Operacional. Explica se o contexto (não a pessoa) afeta o resultado.",
    parameters: { type: "object", properties: { period: periodParameter } },
    inputSchema: z.object({ period: periodSchema }),
    requires: ["SUBJECT"],
    usesLlm: false,
  },
  {
    key: "query_knowledge",
    capability: "KNOWLEDGE",
    label: "Consultar Base de Conhecimento",
    description: "Qual procedimento/conteúdo interno é relevante para esta evidência? Retrieval nas bases autorizadas para este Agent: documento, título, trechos pertinentes. Nada fora das bases autorizadas.",
    parameters: { type: "object", properties: { query: { type: "string", description: "Evidência/situação a consultar (texto curto)." } }, required: ["query"] },
    inputSchema: z.object({ query: z.string().min(3).max(600) }),
    requires: ["KNOWLEDGE"],
    usesLlm: false,
  },
  {
    key: "recommend_support_materials",
    capability: "SUPPORT_MATERIALS",
    label: "Recomendar materiais de apoio",
    description: "Seleciona até 3 materiais entre os CANDIDATOS reais desta investigação (bases já recuperadas para este Agent ou consultadas por query_knowledge), com motivo específico. Só ids candidatos; título, link e autorização são da aplicação.",
    parameters: { type: "object", properties: { selections: { type: "array", items: { type: "object", properties: { materialId: { type: "string" }, reason: { type: "string", description: "Por que ajuda ESTE caso (20–280 caracteres)." } }, required: ["materialId", "reason"] } } }, required: ["selections"] },
    inputSchema: z.object({ selections: z.array(z.object({ materialId: z.string(), reason: z.string() })).max(10) }),
    requires: ["KNOWLEDGE"],
    usesLlm: false,
  },
  {
    key: "synthesize_evidence",
    capability: "INDICATOR_ANALYSIS",
    label: "Organizar evidências",
    description: "Não calcula nada novo: organiza o que já foi coletado nesta investigação — fatos (dos resultados das Tools), hipóteses sustentadas e não sustentadas (como o Agent declarar), limitações e referências. Use antes de concluir para nada se perder.",
    parameters: { type: "object", properties: { supportedHypotheses: { type: "array", items: { type: "string" }, description: "Hipóteses que os fatos coletados sustentam (cite o fato)." }, unsupportedHypotheses: { type: "array", items: { type: "string" }, description: "Hipóteses consideradas e NÃO sustentadas pelos fatos." }, limitations: { type: "array", items: { type: "string" } } } },
    inputSchema: z.object({ supportedHypotheses: z.array(z.string().max(300)).max(10).optional(), unsupportedHypotheses: z.array(z.string().max(300)).max(10).optional(), limitations: z.array(z.string().max(300)).max(10).optional() }),
    requires: [],
    usesLlm: false,
  },
]

const byKey = new Map(TOOL_CATALOG.map((tool) => [tool.key, tool]))

export function findTool(key: string): ToolDefinition | null {
  return byKey.get(key as ToolKey) ?? null
}

/** Tools liberadas por um conjunto de capacidades (ordem do catálogo). */
export function toolsForCapabilities(capabilities: readonly InvestigationCapability[]): ToolDefinition[] {
  const set = new Set(capabilities.map((capability) => investigationCapabilitySchema.parse(capability)))
  return TOOL_CATALOG.filter((tool) => set.has(tool.capability))
}

/** Declaração no formato do function calling do Gemini. */
export function toFunctionDeclaration(tool: ToolDefinition): { name: string; description: string; parameters: ToolParameterSchema & { type: "object"; properties: Record<string, ToolParameterSchema> } } {
  return { name: tool.key, description: tool.description, parameters: { ...tool.parameters, type: "object", properties: tool.parameters.properties ?? {} } }
}
