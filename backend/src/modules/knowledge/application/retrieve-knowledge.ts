import type { Database } from "../../../infrastructure/database/pool.js"
import { chunkKnowledgeDocument, type KnowledgeChunk } from "../domain/knowledge-chunking.js"
import { canonicalSubjectSql, rawSubjectSql } from "../../interactions/domain/interaction-subject.js"
import { selectPrimaryProcessDocument, type PrimaryProcessSelection } from "../domain/primary-process.js"
import { closingSectionRoleOf, isExecutableSectionRole, sectionProcessRolesOf, type ClosingSectionRole, type SectionProcessRole } from "../domain/section-roles.js"
import { applyCheckpointGovernance, buildProcessCheckpointCatalog, publicCatalogOf, renderExcerptWithCheckpoints, type CheckpointGovernanceSnapshot, type ProcessCheckpointCatalog } from "../../reliable-feedback/domain/checkpoint-catalog.js"
import { loadCheckpointGovernance } from "../../checkpoint-registry/application/checkpoint-governance-loader.js"
import { DEFAULT_RETRIEVAL_BUDGET, acronymsKeyOf, buildKnowledgeIndex, documentAnchors, estimateTokens, queryStandsAlone, complementSelection, rankChunks, selectWithinBudget, tokenize, wordsSharedWith, type KnowledgeIndex, type RankedChunk, type RetrievalBudget, type TokenizeOptions } from "../domain/lexical-retrieval.js"
import { expandAcronyms, type AcronymExpansion, type GlossaryAcronym } from "../domain/query-acronyms.js"
import { liveKnowledgeVersion } from "./live-knowledge-version.js"


/**
 * Base AUTORIZADA ≠ conteúdo colocado no prompt. Um agente pode consultar N bases (as vinculadas
 * em `agent_knowledge_documents`); numa request específica só entram os trechos pertinentes à
 * pergunta/transcrição daquela chamada. Esta é a única porta de entrada de conteúdo de KB num
 * prompt — `buildSystemPrompt` nunca lê `knowledge_versions` diretamente.
 *
 * Isolamento por código, não por prompt: a query só enxerga documentos vinculados a ESTE agente,
 * publicados, não excluídos e da organização — uma base que existe no sistema mas não foi
 * autorizada para o agente é invisível aqui, independentemente do que o modelo peça.
 */
export type AuthorizedKnowledgeDocument = { id: string; title: string; chars: number }

export type RetrievedKnowledgeExcerpt = {
  documentId: string
  documentTitle: string
  heading: string
  excerpt: string
  score: number
  /** V1.7.1d — posição do trecho no documento (proveniência por trecho; ausente em rastros anteriores). */
  chunkIndex?: number
}

export type KnowledgeRetrievalMode =
  /** Nenhuma base autorizada para o agente. */
  | "NONE"
  /** Bases pequenas o suficiente para caber inteiras no orçamento — recuperação seria só custo. */
  | "FULL"
  /** Só os trechos pertinentes à consulta entraram no prompt. */
  | "RETRIEVAL"
  /** Havia bases, mas nenhum trecho passou do limiar de relevância — o prompt sai sem conteúdo
   * de KB (e diz isso ao modelo), nunca com um documento "aleatório" para preencher. */
  | "NO_MATCH"

export type KnowledgeTrace = {
  mode: KnowledgeRetrievalMode
  authorizedDocuments: AuthorizedKnowledgeDocument[]
  retrieved: RetrievedKnowledgeExcerpt[]
  /** Caracteres de KB efetivamente colocados no prompt. */
  injectedChars: number
  /** Estimativa (≈ chars / 3,5) — o número oficial vem do `usageMetadata` do modelo. */
  estimatedTokens: number
  /** Soma de caracteres de TODAS as bases autorizadas — o que seria injetado sem retrieval. */
  authorizedChars: number
  budget: RetrievalBudget
  /** Siglas do Glossário geral encontradas na pergunta e expandidas para a busca (ex.: PJ → Pessoa jurídica). */
  queryExpansion?: AcronymExpansion[]
  /** Processos (documentos) cujo TÍTULO casou com o assunto da pergunta — a busca procurou o detalhe dentro deles. */
  anchoredDocuments?: { documentId: string; documentTitle: string }[]
  /** Mais de um processo pode ser o assunto da pergunta e nada no texto decide: a resposta deve perguntar qual antes de orientar. */
  ambiguousProcesses?: { documentId: string; documentTitle: string }[]
  /** V1.7.1d — o que o PLANO DE COBERTURA acrescentou além do ranking (ausente quando não foi pedido). */
  coverage?: KnowledgeCoverageTrace
  /** V1.7.1n — etapas avaliáveis marcadas no prompt ([CP-…]) para a avaliação de processo (ausente fora dela). */
  checkpointCatalog?: ProcessCheckpointCatalog
  /** Checkpoint Registry — o que o registry governou nesta execução (documentos governados, etapas ATIVAS). Persistido: a
   * verificação em "Gerar feedback" aplica exatamente o mesmo recorte. Ausente = nenhum documento governado. */
  checkpointGovernance?: CheckpointGovernanceSnapshot
  /** V1.7.1n — resumo do catálogo no rastro persistido (o catálogo completo não é gravado). */
  /** Resumo persistido do catálogo. `required`/`requiredRefs` = obrigatórias NO PROCESSO; V1.7.3: `mustAssess`/`mustAssessRefs` = plano da avaliação. */
  checkpointSummary?: { version: string; presented: number; required: number; optional: number; supportOnly: number; requiredRefs: string[]; mustAssess?: number; mayAssess?: number; mustAssessRefs?: string[]; coveragePlan?: boolean }
  /** Conversa — o que a pergunta da PESSOA acrescentou à busca pela pergunta do roteamento (ausente fora da conversa). */
  askerQuestion?: AskerQuestionRetrievalTrace
}

/**
 * PERGUNTA DA PESSOA NA BUSCA (conversa: chat e voz). O especialista recebe a pergunta que o ROTEAMENTO do Orquestrador
 * escreveu, e a busca usava só ela: em 22/10/2026 a reescrita "…? Passo a passo e procedimentos." tirou da busca a seção
 * "31. Informações obrigatórias na contestação" que "Como faço para registrar a contestação da fatura de um cliente?" traz,
 * e a resposta disse que a base não detalhava o registro — as palavras que o roteamento ACRESCENTOU diluíram a busca. Agora a
 * busca da pergunta do roteamento continua como sempre e corre ao lado uma segunda, com a última pergunta da pessoa reduzida às
 * palavras que o roteamento também usou (`wordsSharedWith`: sai o que só ele acrescentou e também a saudação, a cortesia e o
 * assunto que ele mandou para outro especialista). A segunda só COMPLEMENTA a primeira (`complementSelection`): nada da
 * primeira sai, e entram no máximo 4 trechos, só dos documentos que a primeira já escolheu, sob o mesmo teto de caracteres. O
 * roteamento continua dizendo o assunto de cada especialista — numa pergunta com dois assuntos, cada um recebe o seu. Menos de 2
 * palavras em comum (`queryStandsAlone`: "e o prazo?") não abre a segunda busca.
 * A dúvida de processo (`ambiguousProcesses`) continua só pela pergunta do roteamento, que já leu a conversa.
 */
export const ASKER_QUESTION_RETRIEVAL_VERSION = "ASKER_QUESTION_RETRIEVAL_V1" as const
export type AskerQuestionRetrievalTrace = {
  version: typeof ASKER_QUESTION_RETRIEVAL_VERSION
  /** COMPLEMENTED = a segunda busca rodou (pode não ter acrescentado nada); TOO_SHORT = menos de 2 palavras em comum com o roteamento. */
  outcome: "COMPLEMENTED" | "TOO_SHORT"
  /** Trechos que só a segunda busca trouxe. */
  added: { documentId: string; documentTitle: string; heading: string; chunkIndex: number }[]
  /** Trechos da segunda busca em documentos que a primeira não escolheu — não entram. */
  otherDocuments: number
  /** Trechos da segunda busca, dos mesmos documentos, que passaram do teto (4 trechos ou o de caracteres). */
  overLimit: number
}

/**
 * V1.7.1d — PLANO DE COBERTURA (determinístico, com orçamento próprio — nunca "a base inteira"). O ranking lexical escolhe os
 * trechos parecidos com a conversa; o plano garante que, numa chamada que chega à FASE DE FECHAMENTO, o especialista também veja
 * as seções que avaliam essa fase:
 *   1. o PROCESSO identificado → todas as suas seções de fechamento (checklist, recapitulação, confirmação de entendimento,
 *      encerramento). V1.7.1m: o processo é o DOCUMENTO PRIMÁRIO (`primary-process.ts`: assunto estruturado da interação
 *      ancorado no título — nunca o maior score do ranking, que no smoke V1.7.1l elegeu a diretriz transversal "Jeito Vivo" e
 *      deixou de fora a "Recapitulação obrigatória" do procedimento específico); 2+ ancorados = ambíguo, todos entram (nenhum
 *      escolhido em silêncio); nenhum = só as checklists;
 *   2. as CHECKLISTS das outras bases vinculadas ao especialista (diretrizes transversais: Jeito de Atender, Checklist de
 *      Encerramento…), que valem por estrutura do atendimento e não por coincidência de palavras.
 * Nada é acrescentado quando o ranking já trouxe o trecho; o orçamento de cobertura para o resto.
 */
export const KNOWLEDGE_COVERAGE_VERSION = "KNOWLEDGE_COVERAGE_V1" as const
export type KnowledgeCoveragePhase = "CLOSING"
export type KnowledgeCoverageRequest = { phases: readonly KnowledgeCoveragePhase[]; /** V1.7.1m — assunto estruturado da interação (motivo registrado): identifica o documento primário do processo. */ subject?: string | null }
export const DEFAULT_COVERAGE_BUDGET = { maxChunks: 6, maxChars: 6_000 } as const
export type KnowledgeCoverageTrace = {
  version: typeof KNOWLEDGE_COVERAGE_VERSION
  /** V1.7.1m — como o documento primário foi (ou não) escolhido; ausente em rastros anteriores. */
  primaryProcess?: PrimaryProcessSelection
  phases: KnowledgeCoveragePhase[]
  processDocument: { documentId: string; documentTitle: string } | null
  added: { documentId: string; documentTitle: string; heading: string; chunkIndex: number; role: ClosingSectionRole; reason: "PROCESS_CLOSING_SECTION" | "TRANSVERSAL_CHECKLIST" }[]
  skippedForBudget: number
}

export type KnowledgeRetrievalResult = {
  /** Bloco pronto para o prompt (títulos exatos após `###`, um trecho por seção). */
  promptBlock: string
  trace: KnowledgeTrace
}

/** `organizationId`: a organização do Agent (do registro) — a base só entra quando é da mesma organização dele. `versionId`: a
 * versão publicada de onde veio o texto (`knowledge_versions.id`) — identidade estável de uma fonte citada. */
type PublishedDocumentRow = { id: string; title: string; content: string; version: number; versionId: string; documentType: string; organizationId: string }
/** O que identifica o conteúdo sem trazê-lo: a versão publicada (`knowledge_versions.id`) nunca tem o texto alterado. */
type PublishedDocumentHeader = Omit<PublishedDocumentRow, "content">

/**
 * BASES DO AGENT EM CACHE, por processo. Antes, cada busca (chat, voz, ferramentas de investigação, prompt do especialista e
 * do Orquestrador — várias por mensagem) trazia do banco o texto INTEIRO de todas as bases, refazia os trechos, os papéis das
 * seções e a tokenização de tudo. Agora cada busca confere no banco só QUAIS versões publicadas estão vinculadas (consulta
 * leve, sem o texto) e reaproveita o que já foi montado para exatamente essas versões; o texto só vem quando algo mudou.
 * Sempre fresco com N processos: a conferência é por chamada, nunca por tempo.
 */
export type AgentKnowledgeSnapshot = {
  key: string
  documents: PublishedDocumentRow[]
  chunks: KnowledgeChunk[]
  rolesByDocument: Map<string, ReturnType<typeof sectionProcessRolesOf>>
  /** Índice por conjunto de siglas do Glossário (as siglas mudam a tokenização). */
  indexes: Map<string, KnowledgeIndex>
}
const MAX_CACHED_AGENTS = 64
const MAX_INDEXES_PER_AGENT = 4
const snapshotsByAgent = new Map<string, AgentKnowledgeSnapshot>()

async function loadAuthorizedDocumentHeaders(db: Database, agentId: string): Promise<PublishedDocumentHeader[]> {
  const result = await db.query<PublishedDocumentHeader>(
    `select kd.id, kd.title, kd.document_type "documentType", kv.id "versionId", kv.version, a.organization_id "organizationId"
     from agent_knowledge_documents akd
     join knowledge_documents kd on kd.id = akd.knowledge_document_id
     join agents a on a.id = akd.agent_id
     join lateral (${liveKnowledgeVersion("kd.id", "id, version")}) kv on true
     where akd.agent_id = $1 and kd.organization_id = a.organization_id and kd.deleted_at is null and kv.status = 'PUBLISHED'
       -- Mesma regra do cadastro do Agent (assertKnowledgeDocumentsCompatible), conferida a CADA busca: base que passou a valer
       -- só para outro Grupo sai da recuperação na hora, sem esperar alguém salvar o Agent (achado AI-05 da auditoria de 17/10/2026).
       and (a.scope_type = 'ALL_TEAMS' or exists (
         select 1 from knowledge_document_org_scopes os left join subteams st on st.id = os.subteam_id
          where os.knowledge_document_id = kd.id
            and (os.scope_type = 'ALL_TEAMS' or coalesce(os.team_id, st.team_id) = coalesce(a.team_id, (select ast.team_id from subteams ast where ast.id = a.subteam_id)))))
     order by kd.title`,
    [agentId],
  )
  return result.rows
}

/** Bases publicadas e autorizadas de UM Agent, montadas (trechos + papéis) e em cache pela versão — também usada pelo catálogo do
 * esclarecimento (`knowledge-catalog.ts`), que une as bases de vários especialistas. */
export async function loadAgentKnowledgeSnapshot(db: Database, agentId: string): Promise<AgentKnowledgeSnapshot> {
  const headers = await loadAuthorizedDocumentHeaders(db, agentId)
  const key = headers.map((header) => `${header.organizationId}|${header.id}|${header.versionId}|${header.title}`).join("\n")
  const cached = snapshotsByAgent.get(agentId)
  if (cached && cached.key === key) {
    snapshotsByAgent.delete(agentId)
    snapshotsByAgent.set(agentId, cached)
    return cached
  }
  const contents = headers.length === 0
    ? new Map<string, string>()
    : new Map((await db.query<{ id: string; content: string }>(`select id, content from knowledge_versions where id = any($1::uuid[])`, [headers.map((header) => header.versionId)])).rows.map((row) => [row.id, row.content]))
  const documents = headers.flatMap((header) => {
    const content = contents.get(header.versionId)
    return content === undefined ? [] : [{ ...header, content }]
  })
  const snapshot: AgentKnowledgeSnapshot = {
    key,
    documents,
    chunks: documents.flatMap((document) => chunkKnowledgeDocument(document)),
    rolesByDocument: new Map(documents.map((document) => [document.id, sectionProcessRolesOf(document.content, document.title)])),
    indexes: new Map(),
  }
  // Versão trocada entre as duas consultas (publicação no meio): o conteúdo veio pelas versões da chave, mas a lista pode
  // ter ficado incompleta — não guarda, a próxima busca monta de novo.
  if (documents.length === headers.length) {
    snapshotsByAgent.delete(agentId)
    snapshotsByAgent.set(agentId, snapshot)
    while (snapshotsByAgent.size > MAX_CACHED_AGENTS) snapshotsByAgent.delete(snapshotsByAgent.keys().next().value!)
  }
  return snapshot
}

function knowledgeIndexOf(snapshot: AgentKnowledgeSnapshot, options: TokenizeOptions): KnowledgeIndex {
  const acronymsKey = acronymsKeyOf(options)
  const cached = snapshot.indexes.get(acronymsKey)
  if (cached) return cached
  const index = buildKnowledgeIndex(snapshot.chunks, options)
  snapshot.indexes.set(acronymsKey, index)
  while (snapshot.indexes.size > MAX_INDEXES_PER_AGENT) snapshot.indexes.delete(snapshot.indexes.keys().next().value!)
  return index
}

/** Só para testes: esquece as bases montadas. */
export function clearKnowledgeSnapshotCache(): void {
  snapshotsByAgent.clear()
}

/**
 * V1.7.1l — ESPAÇO DE CANDIDATOS da avaliação de processo: com `markProcessRoles`, o trecho de seção NÃO executável (objetivo,
 * abrangência, conceitos, resultado esperado, referência, exemplos — `section-roles.ts`) chega ao especialista rotulado como
 * CONTEXTO DO PROCEDIMENTO. O conteúdo continua no prompt (o especialista pode saber qual é o objetivo do procedimento); ele só
 * não é oferecido como etapa. Seções executáveis e desconhecidas saem exatamente como antes.
 */
const CONTEXT_ROLE_LABEL: Partial<Record<SectionProcessRole, string>> = {
  OBJECTIVE: "objetivo do procedimento",
  SCOPE: "abrangência",
  CONTEXT: "conceitos",
  RESULT_EXPECTATION: "resultado esperado",
  REFERENCE: "referência",
  EXAMPLE_SECTION: "exemplos",
}
/** `governanceSubjectPersonId`: colaborador da execução — o registry aplica o ESCOPO das definições (Grupo/Subgrupo).
 * `askerQuestion`: conversa — a última pergunta da pessoa, unida à busca pela `query` (ver `ASKER_QUESTION_RETRIEVAL_VERSION`). */
export type KnowledgePresentationOptions = { markProcessRoles?: boolean; governanceSubjectPersonId?: string | null; askerQuestion?: string | null }

type CheckpointMarks = ReturnType<typeof buildProcessCheckpointCatalog>
function formatExcerpt(chunk: RankedChunk, role: SectionProcessRole | null = null, marks: CheckpointMarks | null = null): string {
  const context = role && !isExecutableSectionRole(role) ? ` · CONTEXTO DO PROCEDIMENTO (${CONTEXT_ROLE_LABEL[role]}) — explica o processo, não é etapa avaliável` : ""
  const section = chunk.heading ? `[Seção: ${chunk.heading}${context}]\n` : context ? `[${context.slice(3)}]\n` : ""
  // V1.7.1n — etapas avaliáveis marcadas no próprio trecho ("[CP-…] - [ ] Forneci protocolo?"): a identidade é do sistema.
  const text = marks ? renderExcerptWithCheckpoints({ documentId: chunk.documentId, documentTitle: chunk.documentTitle, heading: chunk.heading, excerpt: chunk.text, chunkIndex: chunk.index }, marks) : chunk.text
  return `${section}${text}`
}

/** Agrupa por documento preservando a ordem original dos trechos — a IA lê "### Título" uma vez
 * e, abaixo, as seções pertinentes na ordem em que aparecem no documento. */
function formatPromptBlock(selected: RankedChunk[], roleOf: ((chunk: RankedChunk) => SectionProcessRole) | null = null, marks: CheckpointMarks | null = null): string {
  const byDocument = new Map<string, RankedChunk[]>()
  for (const chunk of selected) {
    const list = byDocument.get(chunk.documentId) ?? []
    list.push(chunk)
    byDocument.set(chunk.documentId, list)
  }
  return [...byDocument.values()]
    .map((chunks) => {
      const ordered = [...chunks].sort((left, right) => left.index - right.index)
      return `### ${ordered[0]!.documentTitle}\n${ordered.map((chunk) => formatExcerpt(chunk, roleOf ? roleOf(chunk) : null, marks)).join("\n\n")}`
    })
    .join("\n\n")
}

export async function retrieveKnowledgeForAgent(
  db: Database,
  agentId: string,
  query: string,
  budget: RetrievalBudget = DEFAULT_RETRIEVAL_BUDGET,
  coverage: KnowledgeCoverageRequest | null = null,
  presentation: KnowledgePresentationOptions = {},
): Promise<KnowledgeRetrievalResult> {
  const snapshot = await loadAgentKnowledgeSnapshot(db, agentId)
  const { documents, rolesByDocument } = snapshot
  const roleOf = presentation.markProcessRoles ? (chunk: RankedChunk) => rolesByDocument.get(chunk.documentId)?.(chunk.heading) ?? "UNKNOWN" : null
  const authorizedDocuments = documents.map((document) => ({ id: document.id, title: document.title, chars: document.content.length }))
  const authorizedChars = authorizedDocuments.reduce((sum, document) => sum + document.chars, 0)
  const baseTrace = { authorizedDocuments, authorizedChars, budget }

  if (documents.length === 0) {
    return { promptBlock: "", trace: { ...baseTrace, mode: "NONE", retrieved: [], injectedChars: 0, estimatedTokens: 0 } }
  }

  const { chunks } = snapshot

  // V1.7.1n — catálogo das etapas avaliáveis dos trechos que entram no prompt (a MESMA função da verificação). Obrigatória só
  // com o plano de cobertura do fechamento ativo (a chamada chegou ao fim).
  const contentById = new Map(documents.map((document) => [document.id, document.content]))
  // Checkpoint Registry: num documento GOVERNADO só as etapas ATIVAS (no escopo do colaborador) são marcadas no prompt.
  // Organização do Agent (todas as bases autorizadas são dela — ver loadAuthorizedDocumentHeaders).
  const organizationId = documents[0]!.organizationId
  const governance = presentation.markProcessRoles ? await loadCheckpointGovernance(db, organizationId, documents.map((document) => ({ id: document.id, version: document.version })), { agentId, personId: presentation.governanceSubjectPersonId ?? null }) : null
  const catalogOf = (selected: readonly RankedChunk[]) => presentation.markProcessRoles
    ? applyCheckpointGovernance(buildProcessCheckpointCatalog({ excerpts: selected.map((chunk) => ({ documentId: chunk.documentId, documentTitle: chunk.documentTitle, heading: chunk.heading, excerpt: chunk.text, chunkIndex: chunk.index })), contentOf: (id) => contentById.get(id), subject: coverage?.subject ?? null, coveragePlan: Boolean(coverage?.phases.includes("CLOSING")) }), governance)
    : null
  const governanceTrace = governance ? { checkpointGovernance: governance } : {}

  // Bases pequenas cabem inteiras: recuperar seria só custo e risco de perder contexto.
  if (authorizedChars <= budget.maxTotalChars) {
    const full = chunks.map((chunk) => ({ ...chunk, score: 1 }))
    const marks = catalogOf(full)
    return {
      promptBlock: formatPromptBlock(full, roleOf, marks),
      trace: { ...baseTrace, mode: "FULL", retrieved: full.map(toExcerpt), injectedChars: authorizedChars, estimatedTokens: estimateTokens(authorizedChars), ...(marks ? { checkpointCatalog: publicCatalogOf(marks) } : {}), ...governanceTrace },
    }
  }

  // Siglas do glossário: "PJ" vira termo próprio e a definição entra na busca ("pessoa jurídica"); a pergunta original
  // não muda — só o que a busca procura.
  const glossary = await loadGlossaryAcronyms(db, organizationId)
  const tokenizeOptions: TokenizeOptions = { acronyms: new Set(glossary.map((entry) => entry.acronym)) }
  const index = knowledgeIndexOf(snapshot, tokenizeOptions)
  const search = (text: string) => {
    const expansion = expandAcronyms(text, glossary)
    // Termos que vieram SÓ da expansão (não estavam na pergunta): ajudam a achar o documento, pesam pouco na seção.
    const originalTerms = new Set(tokenize(text, tokenizeOptions))
    const contextTerms = new Set(expansion.expansions.flatMap((entry) => tokenize(entry.definition)).filter((term) => !originalTerms.has(term)))
    return { expansion, selected: selectWithinBudget(rankChunks(expansion.searchQuery, index, { ...tokenizeOptions, contextTerms }), budget) }
  }
  const primary = search(query)
  const anchors = documentAnchors(primary.expansion.searchQuery, chunks, tokenizeOptions)
  const ambiguous = ambiguousProcessesOf(anchors)
  // Conversa: a última pergunta da pessoa, nas palavras em comum com a `query`, complementa a seleção (ver ASKER_QUESTION_RETRIEVAL_VERSION).
  const askerQuestion = presentation.askerQuestion?.trim() || null
  const askerWords = askerQuestion ? wordsSharedWith(askerQuestion, query, tokenizeOptions) : ""
  const asker = queryStandsAlone(askerWords, tokenizeOptions) ? search(askerWords) : null
  const complement = asker ? complementSelection(primary.selected, asker.selected, budget) : null
  const ranked = complement ? complement.selected : primary.selected
  const expansions = primary.expansion.expansions
  const askerTrace: AskerQuestionRetrievalTrace | null = askerQuestion
    ? { version: ASKER_QUESTION_RETRIEVAL_VERSION, outcome: complement ? "COMPLEMENTED" : "TOO_SHORT", added: (complement?.added ?? []).map((chunk) => ({ documentId: chunk.documentId, documentTitle: chunk.documentTitle, heading: chunk.heading, chunkIndex: chunk.index })), otherDocuments: complement?.otherDocuments ?? 0, overLimit: complement?.overLimit ?? 0 }
    : null
  const planned = coverage && coverage.phases.includes("CLOSING") ? planClosingCoverage(chunks, ranked, coverage) : null
  const selected = planned ? [...ranked, ...planned.chunks] : ranked
  const injectedChars = selected.reduce((sum, chunk) => sum + chunk.text.length, 0)
  const marks = catalogOf(selected)
  return {
    promptBlock: formatPromptBlock(selected, roleOf, marks),
    trace: {
      ...baseTrace,
      mode: selected.length > 0 ? "RETRIEVAL" : "NO_MATCH",
      retrieved: selected.map(toExcerpt),
      injectedChars,
      estimatedTokens: estimateTokens(injectedChars),
      ...(expansions.length > 0 ? { queryExpansion: expansions } : {}),
      ...(anchors.anchored.length > 0 ? { anchoredDocuments: anchors.anchored.map(({ documentId, documentTitle }) => ({ documentId, documentTitle })) } : {}),
      ...(ambiguous.length > 0 ? { ambiguousProcesses: ambiguous } : {}),
      ...(planned ? { coverage: planned.trace } : {}),
      ...(marks ? { checkpointCatalog: publicCatalogOf(marks) } : {}),
      ...governanceTrace,
      ...(askerTrace ? { askerQuestion: askerTrace } : {}),
    },
  }
}

/**
 * Dúvida de PROCESSO: mais de um documento empata como assunto da pergunta — os títulos casam com exatamente as mesmas
 * palavras da pergunta ("troca" em "Troca de Titularidade" e "Troca de CHIP").
 * Nunca decide por palpite: a resposta pergunta ao colaborador.
 */
export function ambiguousProcessesOf(anchors: ReturnType<typeof documentAnchors>): { documentId: string; documentTitle: string }[] {
  const pool = anchors.anchored.length > 0 ? anchors.anchored : anchors.candidates
  const best = pool[0]
  if (!best) return []
  // Empate de VERDADE: os títulos casam com as MESMAS palavras da pergunta ("troca" nos dois). Títulos que casam com
  // palavras diferentes ("chamada" num, "móvel" noutro) não são o mesmo assunto — não há dúvida a perguntar.
  const key = (anchor: { matchedTitleTerms: string[] }) => [...anchor.matchedTitleTerms].sort().join("|")
  const tied = pool.filter((anchor) => key(anchor) === key(best))
  return tied.length >= 2 ? tied.slice(0, 4).map(({ documentId, documentTitle }) => ({ documentId, documentTitle })) : []
}

/** Siglas ativas do Glossário geral da organização (termo curto em maiúsculas). Falha = sem expansão, nunca sem resposta. */
async function loadGlossaryAcronyms(db: Database, organizationId: string): Promise<GlossaryAcronym[]> {
  try {
    const result = await db.query<{ term: string; definition: string }>(`select term, definition from glossary_terms where organization_id = $1 and active`, [organizationId])
    return result.rows.flatMap((row) => (/^[A-Z][A-Z0-9]{1,5}$/.test(row.term.trim()) ? [{ acronym: row.term.trim(), definition: row.definition.trim() }] : []))
  } catch (error) {
    console.error(JSON.stringify({ event: "glossary_acronyms_load_failed", message: (error as Error).message }))
    return []
  }
}

/** O plano de cobertura da fase de fechamento (puro; exportado para teste). */
export function planClosingCoverage(chunks: readonly KnowledgeChunk[], ranked: readonly RankedChunk[], request: KnowledgeCoverageRequest, coverageBudget: { maxChunks: number; maxChars: number } = DEFAULT_COVERAGE_BUDGET): { chunks: RankedChunk[]; trace: KnowledgeCoverageTrace } {
  // V1.7.1m — o PROCESSO é o documento primário pelo assunto da interação (nunca o maior score); ambíguo = todos os ancorados.
  const primaryProcess = selectPrimaryProcessDocument(chunks.map((chunk) => ({ documentId: chunk.documentId, documentTitle: chunk.documentTitle })), request.subject)
  const processIds = new Set(primaryProcess.primaryDocumentId ? [primaryProcess.primaryDocumentId] : primaryProcess.basis === "AMBIGUOUS_SUBJECT_ANCHOR" ? primaryProcess.candidates.map((candidate) => candidate.documentId) : [])
  const processId = primaryProcess.primaryDocumentId
  const taken = new Set(ranked.map((chunk) => `${chunk.documentId}#${chunk.index}`))
  const withRole = chunks.flatMap((chunk) => { const role = closingSectionRoleOf(chunk.heading, chunk.documentTitle); return role ? [{ chunk, role }] : [] })
  // Ordem: seções de fechamento do(s) processo(s) primeiro; depois as checklists transversais (reforço, nunca substituto).
  const candidates = [
    ...withRole.filter(({ chunk }) => processIds.has(chunk.documentId)).map((entry) => ({ ...entry, reason: "PROCESS_CLOSING_SECTION" as const })),
    ...withRole.filter(({ chunk, role }) => !processIds.has(chunk.documentId) && role === "CHECKLIST").map((entry) => ({ ...entry, reason: "TRANSVERSAL_CHECKLIST" as const })),
  ].filter(({ chunk }) => !taken.has(`${chunk.documentId}#${chunk.index}`))
  const added: KnowledgeCoverageTrace["added"] = []
  const picked: RankedChunk[] = []
  let chars = 0
  let skipped = 0
  for (const { chunk, role, reason } of candidates) {
    if (picked.length >= coverageBudget.maxChunks || chars + chunk.text.length > coverageBudget.maxChars) { skipped += 1; continue }
    picked.push({ ...chunk, score: 0 })
    chars += chunk.text.length
    added.push({ documentId: chunk.documentId, documentTitle: chunk.documentTitle, heading: chunk.heading, chunkIndex: chunk.index, role, reason })
  }
  const process = processId ? chunks.find((chunk) => chunk.documentId === processId) ?? null : null
  return { chunks: picked, trace: { version: KNOWLEDGE_COVERAGE_VERSION, primaryProcess, phases: [...request.phases], processDocument: process ? { documentId: process.documentId, documentTitle: process.documentTitle } : null, added, skippedForBudget: skipped } }
}

/**
 * V1.7.1n — rastro para PERSISTIR/telemetria: o catálogo completo (texto de cada etapa) sai — a verificação o recalcula dos trechos
 * apresentados — e fica só o resumo (quantas etapas, obrigatórias, opcionais, só apoio).
 */
export function withoutCheckpointCatalog(trace: KnowledgeTrace): KnowledgeTrace {
  if (!trace.checkpointCatalog) return trace
  const { checkpointCatalog, ...rest } = trace
  const refsOf = (predicate: (entry: (typeof checkpointCatalog.entries)[number]) => boolean) => checkpointCatalog.entries.filter(predicate).map((entry) => entry.ref)
  const required = refsOf((entry) => entry.processRequirement === "REQUIRED")
  const mustAssess = refsOf((entry) => entry.assessmentRequirement === "MUST_ASSESS")
  const mayAssess = refsOf((entry) => entry.assessmentRequirement === "MAY_ASSESS").length
  return { ...rest, checkpointSummary: { version: checkpointCatalog.version, presented: checkpointCatalog.entries.length, required: required.length, optional: mayAssess, supportOnly: refsOf((entry) => entry.assessmentRequirement === "SUPPORT_ONLY").length, requiredRefs: required, mustAssess: mustAssess.length, mayAssess, mustAssessRefs: mustAssess, coveragePlan: checkpointCatalog.coveragePlan } }
}

function toExcerpt(chunk: RankedChunk): RetrievedKnowledgeExcerpt {
  return { documentId: chunk.documentId, documentTitle: chunk.documentTitle, heading: chunk.heading, excerpt: chunk.text, score: Number(chunk.score.toFixed(3)), chunkIndex: chunk.index }
}

/**
 * V1.7.1m — ASSUNTO da interação para identificar o processo primário: o nome canônico do assunto (quando o bruto resolve
 * para um) ou o assunto registrado — o submotivo, quando a fonte o informou, senão o motivo (`SUBJECT_RESOLUTION_V2`). Dado
 * estruturado do atendimento — nunca texto do modelo. Interação de outra organização = null.
 */
export async function loadInteractionSubject(db: Database, organizationId: string, interactionId: string | null | undefined): Promise<string | null> {
  if (!interactionId) return null
  const row = await db.query<{ subject: string | null }>(
    `select coalesce(d.name, ${rawSubjectSql("i")}) subject
     from interactions i
     left join interaction_subject_definitions d on d.organization_id = i.organization_id and d.code = ${canonicalSubjectSql("i")} and d.active
     where i.id = $1 and i.organization_id = $2`,
    [interactionId, organizationId],
  )
  return row.rows[0]?.subject?.trim() || null
}
