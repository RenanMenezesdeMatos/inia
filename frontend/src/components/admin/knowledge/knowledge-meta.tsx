"use client"

import { CalendarClock, Tag, UserRound, Users } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { formatShortDateTime } from "@/lib/format/date"
import {
  DOCUMENT_TYPE_LABELS,
  KNOWLEDGE_STATUS_LABELS,
  SOURCE_TYPE_LABELS,
  type KnowledgeDocument,
  type KnowledgeStatus,
} from "@/schemas/admin/knowledge.schema"

import { SOURCE_TYPE_ICONS, SOURCE_TYPE_TONE, STATUS_BADGE_VARIANT, hasMeaningfulUpdate, orgScopeLabel, subjectScopeLabel } from "./knowledge-visuals"

export function SourceTypeIcon({ sourceType, className }: { sourceType: KnowledgeDocument["sourceType"]; className?: string }) {
  const Icon = SOURCE_TYPE_ICONS[sourceType]
  return (
    <span
      aria-hidden
      className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-lg", SOURCE_TYPE_TONE[sourceType], className)}
    >
      <Icon className="size-4.5" />
    </span>
  )
}

export function SourceTypeBadge({ sourceType }: { sourceType: KnowledgeDocument["sourceType"] }) {
  const Icon = SOURCE_TYPE_ICONS[sourceType]
  return (
    <Badge variant="outline" className="gap-1">
      <Icon data-icon="inline-start" /> {SOURCE_TYPE_LABELS[sourceType]}
    </Badge>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const known = status in KNOWLEDGE_STATUS_LABELS ? (status as KnowledgeStatus) : null
  return <Badge variant={known ? STATUS_BADGE_VARIANT[known] : "outline"}>{known ? KNOWLEDGE_STATUS_LABELS[known] : status}</Badge>
}

// Etiquetas discretas de alcance: grupo/subgrupo e assunto, sempre nessa ordem.
export function ScopeTags({ document, className }: { document: Pick<KnowledgeDocument, "orgScopes" | "subjectScopes">; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
        <Users className="size-3 shrink-0" />
        <span className="truncate">{orgScopeLabel(document.orgScopes[0])}</span>
      </span>
      <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
        <Tag className="size-3 shrink-0" />
        <span className="truncate">{subjectScopeLabel(document.subjectScopes[0])}</span>
      </span>
    </div>
  )
}

export function DocumentTypeLabel({ documentType }: { documentType: KnowledgeDocument["documentType"] }) {
  return <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{DOCUMENT_TYPE_LABELS[documentType]}</span>
}

// Autor e data de publicação. Registro antigo sem autor mostra "Autor não informado" em vez de
// inventar alguém.
export function AuthorLine({ document, withTime = false, className }: { document: Pick<KnowledgeDocument, "authorName" | "createdAt">; withTime?: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground", className)}>
      <span className="inline-flex items-center gap-1">
        <UserRound className="size-3.5" />
        {document.authorName ? <span className="text-foreground/80">{document.authorName}</span> : <span className="italic">Autor não informado</span>}
      </span>
      <span className="inline-flex items-center gap-1">
        <CalendarClock className="size-3.5" />
        <time dateTime={document.createdAt}>{withTime ? formatShortDateTime(document.createdAt, { withYear: true }) : formatDateOnly(document.createdAt)}</time>
      </span>
    </div>
  )
}

export function UpdatedAtLine({ document }: { document: Pick<KnowledgeDocument, "createdAt" | "updatedAt"> }) {
  if (!hasMeaningfulUpdate(document.createdAt, document.updatedAt)) return null
  return (
    <span className="text-xs text-muted-foreground">
      Atualizado em <time dateTime={document.updatedAt!}>{formatShortDateTime(document.updatedAt!, { withYear: true })}</time>
    </span>
  )
}

export function formatDateOnly(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(date).replace(/\./g, "")
}
