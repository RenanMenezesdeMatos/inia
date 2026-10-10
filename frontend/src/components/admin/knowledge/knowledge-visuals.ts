import { Braces, FileText, FileType2, Notebook, ScrollText, type LucideIcon } from "lucide-react"

import { formatShortDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import type { KnowledgeSourceType, KnowledgeStatus } from "@/schemas/admin/knowledge.schema"

export const SOURCE_TYPE_ICONS: Record<KnowledgeSourceType, LucideIcon> = {
  TEXT: Notebook,
  PDF: FileText,
  DOCX: FileType2,
  TXT: ScrollText,
  JSON: Braces,
}

// Cor de destaque por formato — só um toque no ícone do card/cabeçalho, para o olho achar
// rápido "isso é um PDF" sem transformar a lista num arco-íris.
export const SOURCE_TYPE_TONE: Record<KnowledgeSourceType, string> = {
  TEXT: "bg-primary/10 text-primary",
  PDF: "bg-red-500/10 text-red-600 dark:text-red-400",
  DOCX: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  TXT: "bg-muted text-muted-foreground",
  JSON: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
}

export const STATUS_BADGE_VARIANT: Record<KnowledgeStatus, "default" | "secondary" | "outline" | "destructive"> = {
  DRAFT: "outline",
  APPROVED: "secondary",
  PUBLISHED: "secondary",
  ARCHIVED: "outline",
}

export function formatFileSize(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function orgScopeLabel(scope: { scopeType: string; teamName: string | null; subteamName: string | null } | undefined) {
  if (!scope || scope.scopeType === "ALL_TEAMS") return "Todos os grupos"
  return scope.subteamName ?? scope.teamName ?? "Grupo não informado"
}

export function subjectScopeLabel(scope: { scopeType: string; subjectName: string | null } | undefined) {
  if (!scope || scope.scopeType === "ALL_SUBJECTS") return "Todos os assuntos"
  return scope.subjectName ?? "Assunto não informado"
}

// "Atualizado em" só faz sentido se houver uma data, ela for posterior à publicação e ainda por
// cima aparecer diferente na tela (granularidade de minuto) — o backfill da migração garante que
// registros antigos sem alteração ficam sem data.
export function hasMeaningfulUpdate(createdAt: string, updatedAt: string | null) {
  if (!updatedAt) return false
  const created = new Date(createdAt).getTime()
  const updated = new Date(updatedAt).getTime()
  if (Number.isNaN(created) || Number.isNaN(updated) || updated <= created) return false
  return formatShortDateTime(createdAt, { withYear: true }) !== formatShortDateTime(updatedAt, { withYear: true })
}

// Tipografia para o HTML (já sanitizado) gerado de um DOCX — compartilhada entre a página admin e o
// leitor de materiais (`components/knowledge-material`) — mesmas proporções do artigo, mas
// aplicadas via seletores porque aqui não controlamos os elementos um a um.
export const DOCUMENT_HTML_CLASS = cn(
  "text-[15px] leading-7 text-foreground/90 sm:text-base",
  "[&_h1]:mt-10 [&_h1]:mb-4 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight",
  "[&_h2]:mt-10 [&_h2]:mb-4 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight",
  "[&_h3]:mt-8 [&_h3]:mb-3 [&_h3]:text-xl [&_h3]:font-semibold",
  "[&_h4]:mt-6 [&_h4]:mb-2 [&_h4]:text-lg [&_h4]:font-semibold",
  "[&_h5]:mt-6 [&_h5]:mb-2 [&_h5]:font-semibold [&_h6]:mt-4 [&_h6]:mb-2 [&_h6]:font-semibold",
  "[&>*:first-child]:mt-0",
  "[&_p]:my-4 [&_p:empty]:my-0 [&_strong]:font-semibold [&_strong]:text-foreground",
  "[&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_li>p]:my-0",
  "[&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground",
  "[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:bg-muted/60 [&_pre]:p-4 [&_pre]:text-[13px]",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.88em]",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4",
  "[&_img]:my-4 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg",
  "[&_hr]:my-8 [&_hr]:border-border",
  "[&_table]:my-5 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm",
  "[&_th]:border [&_th]:border-border [&_th]:bg-muted/60 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_th>p]:my-0",
  "[&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_td>p]:my-0",
)
