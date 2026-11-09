"use client"

import { Boxes, CalendarClock, Tag, UserRound, Users } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { formatShortDateTime } from "@/lib/format/date"
import {
  DOCUMENT_TYPE_LABELS,
  KNOWLEDGE_STATUS_LABELS,
  KNOWLEDGE_UPDATE_STATUS_LABELS,
  SOURCE_TYPE_LABELS,
  type KnowledgeDocument,
} from "@/schemas/admin/knowledge.schema"

import { SOURCE_TYPE_ICONS, SOURCE_TYPE_TONE, hasMeaningfulUpdate, orgScopeLabel, subjectScopeLabel, versionLabel } from "./knowledge-visuals"

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

type VersionStatusDocument = Pick<KnowledgeDocument, "status" | "inUseVersion" | "draftVersion" | "updateVersion" | "updateStatus">

/** O que a lista diz sobre a IA: a versão em uso. Rascunho e atualização nunca contam aqui; base sem versão pronta não parece disponível. */
function InUseBadge({ document }: { document: VersionStatusDocument }) {
  if (document.inUseVersion !== null) {
    return <Badge variant="secondary">{`${versionLabel(document.inUseVersion)} · ${KNOWLEDGE_STATUS_LABELS.PUBLISHED}`}</Badge>
  }
  if (document.status === "ARCHIVED") return <Badge variant="outline">{KNOWLEDGE_STATUS_LABELS.ARCHIVED}</Badge>
  return (
    <Badge variant="outline" className="border-dashed text-muted-foreground" title="A IA não consulta esta base até haver uma versão pronta.">
      Sem versão pronta
    </Badge>
  )
}

/** Status da base na lista: a versão em uso e, à parte, os selos discretos de rascunho e de atualização. */
export function KnowledgeVersionBadges({ document }: { document: VersionStatusDocument }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <InUseBadge document={document} />
      {document.draftVersion !== null ? <span className="text-[11px] font-medium text-muted-foreground">{`Rascunho ${versionLabel(document.draftVersion)}`}</span> : null}
      {document.updateVersion !== null && document.updateStatus ? (
        <span className={cn("text-[11px] font-medium", document.updateStatus === "FAILED" ? "text-destructive" : "text-muted-foreground")}>
          {`Atualização ${versionLabel(document.updateVersion)} · ${KNOWLEDGE_UPDATE_STATUS_LABELS[document.updateStatus]}`}
        </span>
      ) : null}
    </div>
  )
}

// Etiquetas discretas de alcance: grupo/subgrupo e assunto, sempre nessa ordem.
export function ScopeTags({ document, products, className }: { document: Pick<KnowledgeDocument, "orgScopes" | "subjectScopes">; products?: readonly string[]; className?: string }) {
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
      {/* Só quando a base vale para alguns produtos (sem marca = todos os produtos). */}
      {products && products.length > 0 ? (
        <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground" title="Vale só para estes produtos">
          <Boxes className="size-3 shrink-0" />
          <span className="truncate">{products.join(", ")}</span>
        </span>
      ) : null}
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
