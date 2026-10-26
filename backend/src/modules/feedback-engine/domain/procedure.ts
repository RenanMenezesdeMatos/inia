import { createHash } from "node:crypto"
import { inlineEnumerationOf, isListLine } from "../../knowledge/domain/knowledge-list.js"
import { normalizeForLiteralQuote } from "../../knowledge/domain/knowledge-match.js"
import { closingSectionRoleOf, isExecutableSectionRole, sectionProcessRoleOf, type SectionProcessRole } from "../../knowledge/domain/section-roles.js"
import type { TranscriptProjection } from "../../investigation/domain/transcript-projection.js"
import { criterionItemsOf, FIELD_LABEL, isUnstructuredLegacy, scopeSpecificity, type ArgumentItemField, type ArgumentScriptSource, type GuidanceModality, type PointGroupMode } from "../../argument-scripts/domain/argument-script.js"

/**
 * PROCEDIMENTO COMPLETO DO CENÁRIO (domínio puro, determinístico, sem LLM).
 *
 * O diagnóstico depende de confrontar a condução com o procedimento INTEIRO que se aplica ao cenário — pré-requisitos,
 * ramificações, exceções, proibições e encerramento —, não só com os trechos que parecem com o que o operador falou (um
 * ranking lexical pela transcrição deixa invisível justamente a etapa esquecida). Aqui a base publicada vira estrutura:
 *
 *   documento (versão vigente na data da chamada) → seções (título, papel) → linhas numeradas [L-n] nas seções executáveis
 *
 * O papel da seção vem do TÍTULO (objetivo, conceitos, exemplos… costumam explicar o processo; procedimento, checklist, regras,
 * condições, alertas costumam ser executáveis) — é só uma PISTA estrutural (`SEMANTIC_AUDITABILITY_V1`): TODA linha recebe um handle
 * e é o MODELO quem decide, pela leitura da regra completa, o que é exigência no cenário (um título nunca decide sozinho que uma
 * linha não é etapa). O sistema verifica o que ele afirmar (citação, fonte, oportunidade).
 *
 * IDENTIDADE (`KNOWLEDGE_CRITERIA_V3`): `lineKey` = documento + título da seção + FRASE QUE ABRE A LISTA + texto normalizado (só
 * formatação) + ocorrência. Mesmo item sob a mesma abertura na mesma seção = mesma identidade em qualquer versão; item igual sob
 * outra abertura ("avaliar:" → "informar todas as opções:") = linha nova, cuja relação com a anterior é decidida pela
 * reconciliação (criteria-identity.ts), nunca por palpite. A chave V3 não coincide com a V2 (séries de extração distintas).
 */
export const OPERATOR_SPEAKERS = new Set(["OPERADOR", "ATENDENTE", "AGENTE"])
export const CUSTOMER_SPEAKERS = new Set(["CLIENTE"])

export type RulePerspective = "RULE_IN_FORCE_AT_CALL" | "CURRENT_RULE_REEVALUATION"
export type DocumentSelection = "SUBJECT_ANCHOR" | "RELEVANCE" | "INCLUDED_ALL"

/** Um documento publicado autorizado para o especialista, na versão escolhida para a chamada. */
export type SourceDocument = {
  documentId: string
  title: string
  version: number
  content: string
  contentHash: string
  perspective: RulePerspective
  selection: DocumentSelection
  relevance: number
}

/** Item de ARGUMENTÁRIO (estrutura do cadastro preservada: campo, obrigatoriedade, grupo, condição, identidade). */
export type ArgumentLineMeta = {
  scriptId: string
  scriptName: string
  version: number
  itemKey: string
  field: ArgumentItemField
  modality: GuidanceModality | null
  groupMode: PointGroupMode | null
  alternatives: string[] | null
  condition: string | null
  criterionKey: string
  identityBasis: "FIRST_SEEN" | "UNCHANGED" | "MODIFIED"
  previousCriterionKey: string | null
}

export type ProcedureLine = {
  handle: string
  lineKey: string
  documentId: string
  documentHandle: string
  sectionHandle: string
  heading: string | null
  text: string
  kind: "LIST_ITEM" | "TEXT"
  /** Frase que ABRE a lista deste item (linha de texto terminada em ":" logo antes dos itens) — parte do sentido e da identidade. */
  leadIn: string | null
  /** Posição da linha no documento (0-based, estável dentro da versão). */
  position: number
  /** Linha que vem de um ARGUMENTÁRIO (não de um documento da base). */
  argument?: ArgumentLineMeta
}

/** Orientação "pode" de argumentário: opcional — feita, é iniciativa; não feita, nunca é desvio (a obrigatoriedade é do cadastro). */
export const isOptionalGuidance = (line: Pick<ProcedureLine, "argument">) => line.argument?.field === "GUIDANCE" && line.argument.modality === "MAY"

export type ProcedureSection = {
  handle: string
  documentHandle: string
  documentId: string
  heading: string | null
  level: number
  role: SectionProcessRole
  /** PISTA pelo título (não decide nada sozinha): seção que costuma ser etapa × que costuma explicar o processo. */
  executable: boolean
  closingRole: string | null
  lines: ProcedureLine[]
  /** Texto sem handle (só argumentários: condição, exemplo, referência — nunca exigência). */
  contextText: string[]
}

/** Metadados de um ARGUMENTÁRIO apresentado (versão vigente na data da chamada, escopo, campos que não viram critério). */
export type ArgumentDocumentMeta = {
  scriptId: string
  versionId: string
  name: string
  areaName: string | null
  scopeLabel: string
  trigger: string | null
  notApplicableWhen: string | null
  suggestedScript: string | null
  monitoringReference: string | null
  sourceDocumentId: string | null
  sourceDocumentTitle: string | null
  sourceReference: string | null
  subjectName: string | null
  scope: ArgumentScriptSource["scope"]
  /** Vigente na data da chamada × reavaliação pela regra atual (não estava vigente na data). */
  perspective?: RulePerspective
}

export type ProcedureDocument = {
  handle: string
  /** Base de conhecimento (D-n) × argumentário (G-n). */
  kind?: "KNOWLEDGE_DOCUMENT" | "ARGUMENT_SCRIPT"
  argument?: ArgumentDocumentMeta
  documentId: string
  title: string
  version: number
  contentHash: string
  perspective: RulePerspective
  selection: DocumentSelection
  sections: ProcedureSection[]
  /** `PRODUCT_APPLICABILITY_V1`: abrangência por produto REGISTRADA da fonte (só em modo produto; ausente = vale para qualquer produto). */
  productScopeLabel?: string | null
}

export type ProcedureContext = {
  documents: ProcedureDocument[]
  lines: Map<string, ProcedureLine>
  sections: Map<string, ProcedureSection>
  omitted: { documentId: string; title: string; reason: "BUDGET" }[]
  /** Argumentários vigentes no escopo que NÃO foram apresentados (sem nada a avaliar = conversão antiga sem estrutura; orçamento). */
  omittedScripts?: { scriptId: string; name: string; version: number; reason: "LEGACY_UNSTRUCTURED" | "BUDGET" }[]
  /**
   * `DUPLICATE_BY_MEANING_V1` — item de argumentário com o MESMO texto de uma linha de documento apresentado. É só uma COINCIDÊNCIA
   * de texto registrada (e anotada no prompt): texto igual não comprova a mesma obrigação (condição, finalidade, escopo e modalidade
   * podem ser outros). As duas linhas continuam avaliáveis; equivalência só pela leitura semântica da análise (`duplicates`).
   */
  sameText?: { scriptId: string; itemKey: string; lineHandle: string; text: string; sameAsHandle: string; sameAsLineKey: string; documentId: string }[]
  renderedChars: number
}

const HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/
const foldHeading = (text: string | null) => (text ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim()

export function lineKeyOf(documentId: string, heading: string | null, text: string, occurrence: number, leadIn: string | null = null): string {
  const key = ["V3", documentId, foldHeading(heading), leadIn ? normalizeForLiteralQuote(leadIn) : "", normalizeForLiteralQuote(text), String(occurrence)].join("|")
  return createHash("sha256").update(key).digest("hex").slice(0, 12)
}

/** Linhas estruturais de uma seção: cada linha física; enumeração "(1) … (2) …" dentro de uma linha vira um item por ordinal. */
function structuralLines(body: string[]): { text: string; kind: "LIST_ITEM" | "TEXT" }[] {
  const lines: { text: string; kind: "LIST_ITEM" | "TEXT" }[] = []
  for (const raw of body) {
    const text = raw.trim()
    if (text.length === 0) continue
    const inline = isListLine(text) ? null : inlineEnumerationOf(text)
    if (inline && inline.items.length >= 2) {
      if (inline.leadIn && inline.leadIn.trim().length > 0) lines.push({ text: inline.leadIn.trim(), kind: "TEXT" })
      for (const item of inline.items) lines.push({ text: `${item.marker} ${item.text}`.trim(), kind: "LIST_ITEM" })
      continue
    }
    lines.push({ text, kind: isListLine(text) ? "LIST_ITEM" : "TEXT" })
  }
  return lines
}

type ParsedSection = { heading: string | null; level: number; body: string[]; preamble: boolean }

function parseSections(content: string): ParsedSection[] {
  const sections: ParsedSection[] = []
  let current: ParsedSection = { heading: null, level: 0, body: [], preamble: true }
  let sawTitle = false
  for (const line of content.replace(/\r\n?/g, "\n").split("\n")) {
    const match = HEADING.exec(line)
    if (match) {
      const level = match[1]!.length
      // O primeiro "# Título" é o nome do documento — o que vem antes da primeira seção real é cabeçalho (metadados).
      if (level === 1 && !sawTitle && sections.length === 0 && current.body.every((entry) => entry.trim().length === 0)) {
        sawTitle = true
        continue
      }
      sections.push(current)
      current = { heading: match[2]!.trim(), level, body: [], preamble: false }
      continue
    }
    current.body.push(line)
  }
  sections.push(current)
  const filled = sections.filter((section) => section.heading !== null || section.body.some((line) => line.trim().length > 0))
  // Documento sem seções internas (ex.: um checklist curto): o corpo É o documento — papel pelo título, nunca "cabeçalho".
  return filled.every((section) => section.preamble) ? filled.map((section) => ({ ...section, preamble: false })) : filled
}

/**
 * Estrutura um conjunto de documentos em contexto do modelo. Handles são da EXECUÇÃO (D1.., S1.., L1..); a identidade
 * persistente é `lineKey`. O papel de uma seção sem papel próprio herda o do título-pai (nível menor); o cabeçalho de metadados
 * antes da primeira seção é contexto.
 */
export function buildProcedureContext(documents: readonly SourceDocument[], scripts: readonly ArgumentScriptSource[] = [], options: { scriptBudgetChars?: number } = {}): ProcedureContext {
  const context: ProcedureContext = { documents: [], lines: new Map(), sections: new Map(), omitted: [], renderedChars: 0 }
  let sectionCounter = 0
  let lineCounter = 0
  documents.forEach((source, documentIndex) => {
    const documentHandle = `D${documentIndex + 1}`
    const parsed = parseSections(source.content)
    const stack: { level: number; role: SectionProcessRole }[] = []
    const occurrences = new Map<string, number>()
    let position = 0
    const sections: ProcedureSection[] = []
    for (const section of parsed) {
      while (stack.length > 0 && stack[stack.length - 1]!.level >= section.level) stack.pop()
      const own = section.preamble ? "CONTEXT" : sectionProcessRoleOf(section.heading)
      const inherited = own === "UNKNOWN" ? stack[stack.length - 1]?.role ?? (section.heading ? "UNKNOWN" : sectionProcessRoleOf(source.title)) : own
      if (!section.preamble) stack.push({ level: section.level, role: inherited })
      sectionCounter += 1
      const handle = `S${sectionCounter}`
      const executable = isExecutableSectionRole(inherited)
      const built: ProcedureSection = {
        handle,
        documentHandle,
        documentId: source.documentId,
        heading: section.heading,
        level: section.level,
        role: inherited,
        executable,
        // Documento sem seções (ex.: "Checklist de Encerramento de Chamada"): o título do documento decide o papel.
        closingRole: closingSectionRoleOf(section.heading ?? "", source.title),
        lines: [],
        contextText: [],
      }
      // A abertura da lista vale para os itens seguidos que vêm logo depois dela (até a próxima linha de texto). Toda linha recebe
      // handle — inclusive de seção cujo título sugere contexto: o título é pista, quem decide se é exigência é a leitura.
      let leadIn: string | null = null
      for (const line of structuralLines(section.body)) {
        position += 1
        if (line.kind === "TEXT") leadIn = /:\s*$/.test(line.text) ? line.text.trim() : null
        const itemLeadIn = line.kind === "LIST_ITEM" ? leadIn : null
        const occurrenceKey = `${foldHeading(section.heading)}|${itemLeadIn ? normalizeForLiteralQuote(itemLeadIn) : ""}|${normalizeForLiteralQuote(line.text)}`
        const occurrence = occurrences.get(occurrenceKey) ?? 0
        occurrences.set(occurrenceKey, occurrence + 1)
        lineCounter += 1
        const procedureLine: ProcedureLine = { handle: `L${lineCounter}`, lineKey: lineKeyOf(source.documentId, section.heading, line.text, occurrence, itemLeadIn), documentId: source.documentId, documentHandle, sectionHandle: handle, heading: section.heading, text: line.text, kind: line.kind, leadIn: itemLeadIn, position }
        built.lines.push(procedureLine)
        context.lines.set(procedureLine.handle, procedureLine)
      }
      sections.push(built)
      context.sections.set(handle, built)
    }
    context.documents.push({ handle: documentHandle, kind: "KNOWLEDGE_DOCUMENT", documentId: source.documentId, title: source.title, version: source.version, contentHash: source.contentHash, perspective: source.perspective, selection: source.selection, sections })
  })
  if (scripts.length > 0) addArgumentScripts(context, scripts, { sectionCounter, lineCounter, budgetChars: options.scriptBudgetChars ?? ARGUMENT_SCRIPTS_BUDGET_CHARS })
  context.renderedChars = renderProcedureForModel(context).length + renderArgumentScriptsForModel(context).length
  return context
}

/** Orçamento do bloco de argumentários no prompt (o que não couber fica registrado — nunca some em silêncio).
 * `ARGUMENT_SCRIPTS_ALL_IN_FORCE_V1` (06/10/2026): 30 mil → 100 mil. Com 30 mil, os argumentários entravam em ORDEM ALFABÉTICA até o
 * corte (14 de 36 no dev): "Respeito e acolhimento…" e "Troca de titularidade…" nunca chegavam à análise, e a impaciência da operadora
 * e a fraseologia de titularidade ficaram fora do retorno. A aplicabilidade é decidida pela leitura da análise, não pela ordem do nome:
 * todos os vigentes no escopo entram (36 ≈ 81 mil caracteres). */
export const ARGUMENT_SCRIPTS_BUDGET_CHARS = 100_000
const foldText = (text: string) => normalizeForLiteralQuote(text)
const scopeLabelOf = (scope: ArgumentScriptSource["scope"]) => (scope.scopeType === "ALL_TEAMS" ? "todos os grupos" : scope.scopeType === "TEAM" ? `grupo ${scope.teamName ?? "—"}` : `subgrupo ${scope.subteamName ?? "—"}${scope.teamName ? ` (${scope.teamName})` : ""}`)

/**
 * ARGUMENTÁRIOS como fonte estruturada (G-n): seções por CAMPO (orientação, pontos obrigatórios por grupo, evitar) com handles nas
 * linhas avaliáveis; condição/gatilho, "quando não se aplica", argumentário sugerido e referência para a monitoria entram SEM handle
 * (nunca viram critério). Conversão antiga sem estrutura não entra (não cria obrigação nova). Item com o mesmo texto de uma linha de
 * documento apresentado CONTINUA com handle próprio (`DUPLICATE_BY_MEANING_V1`): a coincidência fica registrada e anotada, e só a
 * leitura semântica da análise — conferida pelo código — pode dizer que é a mesma exigência.
 */
function addArgumentScripts(context: ProcedureContext, scripts: readonly ArgumentScriptSource[], counters: { sectionCounter: number; lineCounter: number; budgetChars: number }) {
  let { sectionCounter, lineCounter } = counters
  const documentLinesByText = new Map<string, ProcedureLine>()
  for (const line of context.lines.values()) if (!documentLinesByText.has(foldText(line.text))) documentLinesByText.set(foldText(line.text), line)
  context.omittedScripts = []
  context.sameText = []
  const ordered = [...scripts].sort((a, b) => scopeSpecificity(a.scope) - scopeSpecificity(b.scope) || a.name.localeCompare(b.name, "pt-BR"))
  let used = 0
  let index = 0
  for (const script of ordered) {
    if (isUnstructuredLegacy(script.content)) {
      context.omittedScripts.push({ scriptId: script.scriptId, name: script.name, version: script.version, reason: "LEGACY_UNSTRUCTURED" })
      continue
    }
    const size = JSON.stringify(script.content).length + script.name.length
    if (used + size > counters.budgetChars && used > 0) {
      context.omittedScripts.push({ scriptId: script.scriptId, name: script.name, version: script.version, reason: "BUDGET" })
      continue
    }
    used += size
    index += 1
    const documentHandle = `G${index}`
    const sections: ProcedureSection[] = []
    const items = criterionItemsOf(script.content)
    const fields: { field: ArgumentItemField; title: (mode: PointGroupMode | null) => string; role: SectionProcessRole }[] = [
      { field: "GUIDANCE", title: () => FIELD_LABEL.GUIDANCE, role: "PROCEDURE_STEP" },
      { field: "REQUIRED_POINT", title: (mode) => (mode === "ANY" ? `${FIELD_LABEL.REQUIRED_POINT} — alternativas (basta uma que se aplique)` : `${FIELD_LABEL.REQUIRED_POINT} — todos exigidos quando a condição se aplica`), role: "CHECKLIST" },
      { field: "AVOID", title: () => FIELD_LABEL.AVOID, role: "WARNING" },
    ]
    let position = 0
    for (const spec of fields) {
      const ofField = items.filter((item) => item.field === spec.field)
      const groups = spec.field === "REQUIRED_POINT" ? [ofField.filter((item) => item.groupMode === "ALL"), ofField.filter((item) => item.groupMode === "ANY")] : [ofField]
      for (const group of groups) {
        if (group.length === 0) continue
        sectionCounter += 1
        const heading = spec.title(group[0]!.groupMode)
        const section: ProcedureSection = { handle: `S${sectionCounter}`, documentHandle, documentId: script.scriptId, heading, level: 2, role: spec.role, executable: true, closingRole: null, lines: [], contextText: [] }
        for (const item of group) {
          position += 1
          lineCounter += 1
          const identity = script.identities.get(item.itemKey)!
          const line: ProcedureLine = {
            handle: `L${lineCounter}`,
            lineKey: `ag:${identity.criterionKey}`,
            documentId: script.scriptId,
            documentHandle,
            sectionHandle: section.handle,
            heading,
            text: item.text,
            kind: "LIST_ITEM",
            leadIn: null,
            position,
            argument: { scriptId: script.scriptId, scriptName: script.name, version: script.version, itemKey: item.itemKey, field: item.field, modality: item.modality, groupMode: item.groupMode, alternatives: item.alternatives, condition: item.condition, criterionKey: identity.criterionKey, identityBasis: identity.basis, previousCriterionKey: identity.previousCriterionKey },
          }
          section.lines.push(line)
          context.lines.set(line.handle, line)
          const sameText = documentLinesByText.get(foldText(item.text))
          if (sameText && !sameText.argument) context.sameText.push({ scriptId: script.scriptId, itemKey: item.itemKey, lineHandle: line.handle, text: item.text, sameAsHandle: sameText.handle, sameAsLineKey: sameText.lineKey, documentId: sameText.documentId })
        }
        sections.push(section)
        context.sections.set(section.handle, section)
      }
    }
    context.documents.push({
      handle: documentHandle,
      kind: "ARGUMENT_SCRIPT",
      documentId: script.scriptId,
      title: script.name,
      version: script.version,
      contentHash: script.contentHash,
      perspective: script.perspective ?? "RULE_IN_FORCE_AT_CALL",
      selection: "INCLUDED_ALL",
      sections,
      argument: { perspective: script.perspective ?? "RULE_IN_FORCE_AT_CALL", scriptId: script.scriptId, versionId: script.versionId, name: script.name, areaName: script.areaName, scopeLabel: scopeLabelOf(script.scope), trigger: script.content.trigger, notApplicableWhen: script.content.notApplicableWhen, suggestedScript: script.content.suggestedScript, monitoringReference: script.content.monitoringReference, sourceDocumentId: script.sourceDocumentId, sourceDocumentTitle: script.sourceDocumentTitle, sourceReference: script.sourceReference, subjectName: script.subjectName, scope: script.scope },
    })
  }
}

const PERSPECTIVE_LABEL: Record<RulePerspective, string> = {
  RULE_IN_FORCE_AT_CALL: "versão vigente na data da chamada",
  CURRENT_RULE_REEVALUATION: "versão atual (não havia versão publicada vigente na data da chamada)",
}
const ROLE_LABEL: Partial<Record<SectionProcessRole, string>> = {
  PROCEDURE_STEP: "procedimento",
  CHECKLIST: "checklist",
  DECISION_RULE: "regra",
  CONDITION: "condição",
  WARNING: "alerta/proibição",
  UNKNOWN: "procedimento",
}

const ROLE_HINT: Partial<Record<SectionProcessRole, string>> = {
  OBJECTIVE: "o título sugere objetivo do processo",
  SCOPE: "o título sugere abrangência",
  CONTEXT: "o título sugere conceitos/contexto",
  RESULT_EXPECTATION: "o título sugere resultado esperado",
  REFERENCE: "o título sugere referências",
  EXAMPLE_SECTION: "o título sugere exemplos",
}

/**
 * Texto MODEL-FACING das BASES: documentos, seções [S-n] e linhas [L-n]. Toda linha tem handle; a seção cujo título sugere
 * contexto traz a pista ("confirme pela leitura") — a pista nunca decide sozinha que uma linha não é exigência.
 */
export function renderProcedureForModel(context: Pick<ProcedureContext, "documents">): string {
  const blocks: string[] = []
  for (const document of context.documents) {
    if (document.kind === "ARGUMENT_SCRIPT") continue
    blocks.push(`=== ${document.handle} · ${document.title} (versão ${document.version} · ${PERSPECTIVE_LABEL[document.perspective]}${document.productScopeLabel ? ` · ${document.productScopeLabel}` : ""}) ===`)
    for (const section of document.sections) {
      const title = section.heading ?? "(cabeçalho do documento)"
      if (section.lines.length === 0) continue
      const label = section.executable ? `${ROLE_LABEL[section.role] ?? "procedimento"}${section.closingRole ? " · encerramento" : ""}` : `${ROLE_HINT[section.role] ?? "o título sugere contexto"} — confirme pela leitura se alguma linha é exigência`
      blocks.push(`[${section.handle}] ${title} — ${label}`)
      blocks.push(section.lines.map((line) => `[${line.handle}] ${line.text}`).join("\n"))
    }
    blocks.push("")
  }
  return blocks.join("\n").trim()
}

const MODALITY_LABEL: Record<GuidanceModality, string> = { MUST: "deve", MAY: "pode — opcional: não fazer não é falha", UNSPECIFIED: "sem classificação" }

/** Texto MODEL-FACING dos ARGUMENTÁRIOS (G-n): campos com o significado de cada um; só itens avaliáveis têm handle [L-n]. */
export function renderArgumentScriptsForModel(context: Pick<ProcedureContext, "documents" | "sameText">): string {
  const blocks: string[] = []
  for (const document of context.documents) {
    const meta = document.argument
    if (document.kind !== "ARGUMENT_SCRIPT" || !meta) continue
    const when = document.perspective === "CURRENT_RULE_REEVALUATION" ? "versão atual — REAVALIAÇÃO: não estava vigente na data da chamada; o que ela apontar é orientação para as próximas chamadas, nunca descumprimento da época" : "vigente na data da chamada"
    blocks.push(`=== ${document.handle} · Argumentário "${meta.name}" (versão ${document.version} · ${when}${meta.areaName ? ` · área: ${meta.areaName}` : ""} · vale para: ${meta.scopeLabel}${document.productScopeLabel ? ` · ${document.productScopeLabel}` : ""}) ===`)
    if (meta.sourceDocumentTitle || meta.sourceReference) blocks.push(`Fonte de origem: ${[meta.sourceDocumentTitle, meta.sourceReference].filter(Boolean).join(" — ")}`)
    if (meta.subjectName) blocks.push(`Assunto do cadastro antigo: ${meta.subjectName}`)
    blocks.push(`CONDIÇÃO / GATILHO (situação a reconhecer na conversa inteira — não é busca de palavras): ${meta.trigger ?? "não informada"}`)
    if (meta.notApplicableWhen) blocks.push(`QUANDO NÃO SE APLICA: ${meta.notApplicableWhen}`)
    for (const section of document.sections) {
      blocks.push(`[${section.handle}] ${section.heading}`)
      const lines = section.lines.map((line) => {
        const meta = line.argument
        const modality = meta?.field === "GUIDANCE" && meta.modality ? `(${MODALITY_LABEL[meta.modality]}) ` : ""
        const condition = meta?.condition ? `(somente quando: ${meta.condition}) ` : ""
        const sameText = (context.sameText ?? []).find((entry) => entry.lineHandle === line.handle)
        // Coincidência de TEXTO com a base: anotada para a leitura comparar as duas fontes — nunca decidida aqui.
        const note = sameText ? ` — (mesmo texto de [${sameText.sameAsHandle}] na base: texto igual não é a mesma exigência; compare a condição, a finalidade, o escopo e a modalidade das duas fontes)` : ""
        return `[${line.handle}] ${modality}${condition}${line.text}${note}`
      })
      blocks.push([...lines, ...section.contextText].join("\n"))
    }
    if (meta.suggestedScript) blocks.push(`ARGUMENTÁRIO SUGERIDO (EXEMPLO de abordagem — não é texto obrigatório, nunca compare literalmente com a fala, não cria exigência): ${meta.suggestedScript}`)
    if (meta.monitoringReference) blocks.push(`REFERÊNCIA PARA A MONITORIA (ajuda a reconhecer a evidência esperada; não é uma regra a mais e não exige prova que a conversa não pode dar): ${meta.monitoringReference}`)
    blocks.push("")
  }
  return blocks.join("\n").trim()
}

/** Seções de ENCERRAMENTO (checklist, recapitulação, confirmação, encerramento) de um documento — pelo título. */
/**
 * Seções de ENCERRAMENTO exigidas na cobertura: as do documento do processo + as de documentos que SÃO, pelo próprio título,
 * um roteiro transversal de encerramento (ex.: "Checklist de Encerramento de Chamada", que vale para qualquer chamada). Seções de
 * encerramento de outros documentos de apoio continuam opcionais (o modelo pode avaliá-las; a cobertura não as cobra).
 */
export function closingSectionsOf(context: ProcedureContext, documentHandle: string): ProcedureSection[] {
  return context.documents
    .filter((document) => document.handle === documentHandle || closingSectionRoleOf("", document.title) !== null)
    .flatMap((document) => document.sections.filter((section) => section.executable && section.closingRole !== null && section.lines.length > 0))
}

// ---------------------------------------------------------------------------------------------
// Transcrição
// ---------------------------------------------------------------------------------------------

export type TranscriptStatus = "COMPLETE" | "INCOMPLETE" | "UNAVAILABLE"
/** Marcas de corte/perda que a PRÓPRIA fonte registra ("[inaudível]", "[trecho perdido]", "…" no fim) — formato da fonte, não significado. */
const TRUNCATION = /\[(?:\.{3}|…|[^\]]*(?:cortad|interrompid|incomplet|inaud[íi]vel|trecho\s+perdido)[^\]]*)\]|\((?:inaud[íi]vel|trecho\s+cortado)\)/iu
const CUT_ENDING = /(?:\.{3}|…|—|-)\s*$/
/** O turno traz uma marca de perda que a PRÓPRIA fonte registrou ("[inaudível]", "[trecho perdido]") — formato, não significado. */
export const turnHasLossMark = (text: string) => TRUNCATION.test(text)

/**
 * A transcrição permite julgar AUSÊNCIA? Só quando nenhum turno ficou fora do contexto, a fonte não registra perda e a última
 * fala não termina cortada. Transcrição incompleta nunca sustenta "não fez": vira "não foi possível observar".
 */
export function transcriptStatusOf(projection: TranscriptProjection): TranscriptStatus {
  if (projection.turns.length === 0) return "UNAVAILABLE"
  if (projection.truncatedTurns > 0) return "INCOMPLETE"
  if (projection.turns.some((turn) => TRUNCATION.test(turn.text))) return "INCOMPLETE"
  return CUT_ENDING.test(projection.turns[projection.turns.length - 1]!.text) ? "INCOMPLETE" : "COMPLETE"
}

export const turnNumberOf = (handle: string | null | undefined) => (handle ? Number.parseInt(handle.replace(/^T/i, ""), 10) : Number.NaN)

/**
 * CONTEXTO DE LISTA de cada item: a frase que ABRE a lista (a condição ou o verbo — "Quando o cliente já tiver pago…, avaliar:",
 * "Antes de encerrar, informar:") e os outros itens da MESMA lista. Um item fora desse contexto muda de sentido ("- Estorno;"
 * sozinho parece obrigação; na lista "avaliar: crédito, estorno, compensação…" é uma das alternativas).
 */
export type ListContext = { leadIn: string | null; siblings: string[] }
export function listContextOf(context: Pick<ProcedureContext, "sections">): Map<string, ListContext> {
  const out = new Map<string, ListContext>()
  for (const section of context.sections.values()) {
    let group: ProcedureLine[] = []
    const flush = () => {
      for (const line of group) out.set(line.lineKey, { leadIn: line.leadIn, siblings: group.filter((other) => other !== line).map((other) => other.lineKey) })
      group = []
    }
    for (const line of section.lines) {
      if (line.kind === "LIST_ITEM") {
        group.push(line)
        continue
      }
      flush()
    }
    flush()
  }
  return out
}

/**
 * ABERTURAS DE LISTA → itens (`LIST_OPENING_V1`): a linha de texto que abre uma lista ("Antes de encerrar, informar:", "Quando o
 * cliente já tiver pago…, avaliar:") e os itens logo abaixo dela. A abertura não é um critério sozinho — qualifica cada item; uma
 * conclusão dada à abertura vale para a LISTA e só pode ser conferida com os itens à vista (chave = lineKey da abertura).
 */
export function listOpeningsOf(context: Pick<ProcedureContext, "sections">): Map<string, ProcedureLine[]> {
  const out = new Map<string, ProcedureLine[]>()
  for (const section of context.sections.values()) {
    section.lines.forEach((line, index) => {
      if (line.kind !== "TEXT") return
      const items: ProcedureLine[] = []
      for (const next of section.lines.slice(index + 1)) {
        if (next.kind !== "LIST_ITEM" || next.leadIn !== line.text) break
        items.push(next)
      }
      if (items.length > 0) out.set(line.lineKey, items)
    })
  }
  return out
}

