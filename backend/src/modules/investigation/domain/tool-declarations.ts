import { ANALYSIS_DIMENSIONS } from "./analysis-dimensions.js"
import { toFunctionDeclaration, type ToolDefinition, type ToolKey, type ToolParameterSchema } from "./tool-catalog.js"

/**
 * MODEL TOOL DECLARATION (V1.3 — §17–21): o que o MODELO recebe para decidir QUANDO chamar uma
 * Tool e QUAL argumento semântico fornecer. É uma representação, não o catálogo: `ToolDefinition`
 * (tool-catalog.ts) continua sendo a única fonte de validação (Zod), rótulos, capacidades e
 * proveniência — nada do que o runtime injeta, valida ou já sabe precisa viajar no schema.
 *
 * - FULL: a declaração histórica (descrição integral + parâmetros integrais) — braço de controle.
 * - COMPACT: descrição curta (pergunta que a Tool responde + o que devolve), parâmetros comuns
 *   descritos UMA vez no prompt (período/indicador) e `indicatorCode` OPCIONAL quando há indicador
 *   em foco (o runtime injeta o indicador da investigação quando omitido — o modelo continua
 *   podendo pedir outro código do catálogo). Enums permanecem: são decisão semântica.
 */
export type ToolSchemaMode = "FULL" | "COMPACT"

export type ModelToolDeclaration = { name: string; description: string; parameters: ToolParameterSchema & { type: "object"; properties: Record<string, ToolParameterSchema> } }

export type DeclarationContext = { mode: ToolSchemaMode; /** Há indicador em foco (o runtime injeta `indicatorCode` quando omitido). */ indicatorInFocus: boolean }

const COMPACT_DESCRIPTIONS: Record<ToolKey, string> = {
  get_indicator_snapshot: "Situação do indicador no período: valor, meta, amostra, cobertura, fechamento oficial.",
  compare_periods: "Melhorou ou piorou? Período atual × referência (padrão: anterior de mesmo tamanho): diferença, variação e direção.",
  get_available_dimensions: "Por quais dimensões o indicador pode ser segmentado com os dados reais. Use antes de segmentar.",
  segment_indicator: "Onde o resultado está concentrado? Buckets por dimensão (valor, amostra, contribuição). Assunto/hora/flag medem as próprias interações (duração/volume).",
  compare_population: "Individual ou comum? Colaborador × população agregada do Subgrupo ou Grupo (diferença, tamanho). Nunca dados de pares individuais.",
  inspect_indicator_composition: "O que forma o indicador: componentes registrados (numerador/denominador, volume). NOT_SUPPORTED quando não há componentes.",
  validate_data_quality: "Dá para confiar? Amostra e cobertura × mínimos, atualidade, disponibilidade das fontes e status final.",
  detect_anomalies: "Recorrente ou pico isolado? Série diária com baseline, pontos atípicos e padrão (STABLE/ISOLATED_SPIKES/RECURRENT).",
  get_employee_history: "Evolução do indicador: OPERATIONAL (semanal na janela) ou OFFICIAL (fechamentos mensais). Nunca mistura as camadas.",
  find_interactions: "Interações do colaborador no recorte: referência (I1…), data/hora, assunto, canal, duração, flags presentes. Filtros: assunto, flag, período; ordem RECENT/LONGEST/SHORTEST; amostra distribuída no tempo por padrão em janela longa (sampling opcional).",
  get_interaction_context: "Contexto objetivo de UMA interação: data/hora, duração, assunto, canal, flags, tamanho da transcrição.",
  get_interaction_flags: "Flags que apareceram num conjunto de interações (contagem e em quais). Coexistência não é causa.",
  find_comparable_interactions: "Interações anônimas de OUTROS operadores (Subgrupo/Grupo) com o mesmo assunto — para comparar duração e para analyze_peer_patterns.",
  analyze_interactions: "Lê as transcrições indicadas (já sabe o objetivo e as lacunas da investigação) e devolve achados com trechos literais, contagem de transcrições analisadas com trecho verificado (limite inferior, não prevalência) e cobertura temporal; zero achados é válido.",
  analyze_peer_patterns: "Padrões nas interações comparáveis de melhor desempenho (amostra anônima) — 'na amostra analisada', nunca 'os melhores sempre'.",
  inspect_work_context: "Jornada no período: escala, situação funcional, ausências, dias programados × observados, disponibilidade das fontes.",
  query_knowledge: "Procedimento/conteúdo interno relevante para uma evidência: trechos pertinentes das bases autorizadas.",
  recommend_support_materials: "Seleciona até 3 materiais entre os candidatos reais desta investigação, com motivo específico.",
  synthesize_evidence: "Organiza o que já foi coletado (fatos, hipóteses sustentadas/não sustentadas, limitações) — não calcula nada novo.",
}

const COMPACT_PERIOD: ToolParameterSchema = { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] }

/** Linha única do prompt (COMPACT) descrevendo os parâmetros comuns — em vez de repeti-los em cada schema. */
export function renderCommonParametersNote(context: DeclarationContext): string {
  const period = "Parâmetros comuns: `period {from,to}` em AAAA-MM-DD (datas locais inclusivas) — omita para o período padrão desta investigação"
  const indicator = context.indicatorInFocus ? "; `indicatorCode` — omita para o indicador em foco (só códigos do catálogo)" : "; `indicatorCode` — código do catálogo"
  return `${period}${indicator}; `+"`interactionIds`/`interactionId` recebem as referências I1, I2… devolvidas por find_interactions/find_comparable_interactions."
}

function compactParameter(name: string, schema: ToolParameterSchema): ToolParameterSchema {
  if (name === "period" || name === "currentPeriod") return COMPACT_PERIOD
  if (name === "referencePeriod") return { ...COMPACT_PERIOD, description: "Omita para o período imediatamente anterior, de mesmo tamanho." }
  if (name === "indicatorCode") return { type: "string" }
  if (name === "interactionIds") return { type: "array", items: { type: "string" } }
  if (name === "interactionId") return { type: "string", description: "Omita para a interação desta investigação." }
  if (name === "dimension") return { type: "string", enum: [...ANALYSIS_DIMENSIONS] }
  if (schema.enum) return { type: schema.type, enum: schema.enum }
  if (name === "objective") return { type: "string", description: "O que procurar." }
  if (name === "query") return { type: "string" }
  if (name === "subject") return { type: "string", description: "Assunto: código canônico (canonicalSubject) ou bruto exato (subject)." }
  if (name === "flag") return { type: "string", description: "Nome da flag." }
  if (name === "limit") return { type: "integer" }
  if (name === "filters") return { type: "object", properties: { subject: { type: "string" }, flag: { type: "string" } } }
  return schema
}

export function toModelDeclaration(tool: ToolDefinition, context: DeclarationContext): ModelToolDeclaration {
  if (context.mode === "FULL") return toFunctionDeclaration(tool)
  const properties: Record<string, ToolParameterSchema> = {}
  for (const [name, schema] of Object.entries(tool.parameters.properties ?? {})) properties[name] = compactParameter(name, schema)
  const required = (tool.parameters.required ?? []).filter((name) => !(name === "indicatorCode" && context.indicatorInFocus))
  return { name: tool.key, description: COMPACT_DESCRIPTIONS[tool.key], parameters: { type: "object", properties, ...(required.length > 0 ? { required } : {}) } }
}

/** Argumentos que o runtime completa quando o modelo os omitiu (COMPACT): só o indicador em foco. */
export function injectRuntimeDefaults(tool: ToolDefinition, args: Record<string, unknown>, context: { indicatorCode: string | null }): Record<string, unknown> {
  if (!context.indicatorCode) return args
  const wantsIndicator = Boolean(tool.parameters.properties?.indicatorCode)
  if (!wantsIndicator || typeof args.indicatorCode === "string") return args
  return { ...args, indicatorCode: context.indicatorCode }
}
