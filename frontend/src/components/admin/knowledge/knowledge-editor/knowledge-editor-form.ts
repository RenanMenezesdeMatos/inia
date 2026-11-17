import { scopeValueKey, type ScopeLinksValue } from "@/lib/scope-links/scope-links"
import { isFileSource, subjectSelectionOf, subjectSelectionIssue, type KnowledgeDocumentDetail, type KnowledgeDocumentType, type KnowledgeSourceType, type KnowledgeSubjectSelection } from "@/schemas/admin/knowledge.schema"

export const KNOWLEDGE_LIST_HREF = "/admin/knowledge"
export const knowledgeDetailHref = (id: string) => `${KNOWLEDGE_LIST_HREF}/${id}`
export const knowledgeEditHref = (id: string, options: { publish?: boolean } = {}) => `${KNOWLEDGE_LIST_HREF}/${id}/edit${options.publish ? "?publicar=1" : ""}`

export const MIN_TITLE_LENGTH = 2
export const MIN_CONTENT_LENGTH = 10
export const ACCEPTED_FILES = ".pdf,.docx,.txt,.json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,application/json"

/**
 * O que o editor da base edita. Produtos ("Vale para") ficam no `useSourceProductScope` (gravados à parte, também no rascunho) e o arquivo
 * escolhido numa base nova fica fora do formulário (não é texto para comparar).
 */
export type KnowledgeEditorForm = {
  title: string
  documentType: KnowledgeDocumentType
  /** Só numa base nova: o conteúdo vem do texto escrito ou de um arquivo. Numa base salva, o arquivo é trocado na hora (fica no rascunho). */
  sourceMode: "text" | "file"
  content: string
  scope: ScopeLinksValue
  subjects: KnowledgeSubjectSelection
  changeSummary: string
}

export const emptyKnowledgeForm = (): KnowledgeEditorForm => ({
  title: "",
  documentType: "PROCEDURE",
  sourceMode: "text",
  content: "",
  scope: { global: true, groups: [] },
  subjects: { mode: "ALL", subjectIds: [] },
  changeSummary: "",
})

/** Valores que o editor abre: os de `editable` (rascunho, atualização com falha, versão em uso ou a mais recente), nunca os "da base". */
export function knowledgeFormOf(document: KnowledgeDocumentDetail, scope: ScopeLinksValue): KnowledgeEditorForm {
  const config = document.editable?.config ?? null
  return {
    title: config?.title ?? document.title,
    documentType: config?.documentType ?? document.documentType,
    sourceMode: "text",
    content: document.editable?.content ?? "",
    scope,
    subjects: subjectSelectionOf(config ? config.subjectScopes : document.subjectScopes),
    changeSummary: document.draft?.changeSummary ?? "",
  }
}

/** O arquivo que está no rascunho (ou na versão que o editor abre). */
export function draftFileOf(document: KnowledgeDocumentDetail): { sourceType: KnowledgeSourceType; filename: string | null; sizeBytes: number | null; textAvailable: boolean } {
  const config = document.editable?.config ?? null
  return {
    sourceType: config?.sourceType ?? document.sourceType,
    filename: config ? (config.file?.filename ?? null) : document.originalFilename,
    sizeBytes: config ? (config.file?.sizeBytes ?? null) : document.fileSizeBytes,
    textAvailable: document.editable?.textAvailable ?? true,
  }
}

export const isFileDraft = (file: { sourceType: KnowledgeSourceType }) => isFileSource(file.sourceType)

/** Comparação "mudou?" estável: a ordem dos assuntos e dos Grupos escolhidos não conta. */
export function knowledgeFormFingerprint(form: KnowledgeEditorForm): string {
  return JSON.stringify({
    title: form.title.trim(),
    documentType: form.documentType,
    sourceMode: form.sourceMode,
    content: form.content,
    scope: scopeValueKey(form.scope),
    subjects: { mode: form.subjects.mode, subjectIds: [...form.subjects.subjectIds].sort() },
    changeSummary: form.changeSummary.trim(),
  })
}

/**
 * O que falta para salvar (a primeira pendência, na ordem da tela). `hasFile`: numa base nova com arquivo escolhido. `textRequired`: numa
 * base salva, falso quando o arquivo do rascunho não teve texto extraído (o rascunho fica sem texto e publicar falha no processamento).
 */
export function knowledgeFormIssue(form: KnowledgeEditorForm, options: { creating: boolean; hasFile: boolean; textRequired: boolean; scopeIssue: string | null; universeMissing: boolean }): string | null {
  if (form.title.trim().length < MIN_TITLE_LENGTH) return "Dê um título à base (pelo menos 2 caracteres)."
  if (options.creating && form.sourceMode === "file") {
    if (!options.hasFile) return "Escolha o arquivo (PDF, DOCX, TXT ou JSON)."
  } else if (form.content.trim().length > 0 ? form.content.trim().length < MIN_CONTENT_LENGTH : options.textRequired) {
    return `Escreva o conteúdo (pelo menos ${MIN_CONTENT_LENGTH} caracteres).`
  }
  if (options.universeMissing) return "Escolha o universo de atuação da base."
  if (options.scopeIssue) return options.scopeIssue
  return subjectSelectionIssue(form.subjects)
}

/** Situação para o selo do editor: o que a IA usa e o que está em edição, sem misturar (PEN-008). */
export type KnowledgeEditorState = "NEW" | "DRAFT" | "IN_USE" | "PROCESSING" | "FAILED" | "ARCHIVED"

export function knowledgeEditorStateOf(document: KnowledgeDocumentDetail | null): KnowledgeEditorState {
  if (!document) return "NEW"
  if (document.updates.some((update) => update.status === "PROCESSING")) return "PROCESSING"
  if (document.updates.some((update) => update.status === "FAILED")) return "FAILED"
  if (document.archived) return "ARCHIVED"
  if (document.inUse && !document.draft) return "IN_USE"
  return "DRAFT"
}
