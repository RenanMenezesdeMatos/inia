"use client"

import { useState } from "react"
import { Download, Eye, MoreHorizontal, RotateCcw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatShortDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { useKnowledgeVersionQuery } from "@/queries/admin/use-knowledge-queries"
import { KNOWLEDGE_SITUATION_LABELS, KNOWLEDGE_SUPERSEDED_REASON_LABELS, type KnowledgeVersionFullRow, type KnowledgeVersionRow } from "@/schemas/admin/knowledge.schema"

import { useDownloadKnowledgeFile } from "../knowledge-file-preview"
import { NOT_RECORDED, versionLabel } from "../knowledge-visuals"
import { canRevertVersion } from "./version-rules"

function versionDate(version: KnowledgeVersionFullRow): { label: string; at: string } {
  if (version.publishedAt) return { label: "Publicada em", at: version.publishedAt }
  if (version.publishRequestedAt) return { label: "Publicação pedida em", at: version.publishRequestedAt }
  if (version.updatedAt) return { label: "Salva em", at: version.updatedAt }
  return { label: "Criada em", at: version.createdAt }
}

function SituationCell({ version }: { version: KnowledgeVersionFullRow }) {
  return (
    <div className="space-y-1">
      <Badge variant={version.situation === "IN_USE" ? "default" : version.situation === "FAILED" ? "destructive" : "outline"}>{KNOWLEDGE_SITUATION_LABELS[version.situation]}</Badge>
      {version.situation === "SUPERSEDED" && version.supersededReason ? <p className="text-xs text-muted-foreground">{KNOWLEDGE_SUPERSEDED_REASON_LABELS[version.supersededReason]}</p> : null}
      {version.situation === "FAILED" && version.errorMessage ? <p className="text-xs text-destructive">{version.errorMessage}</p> : null}
    </div>
  )
}

/**
 * Ações da versão. A lista não diz se a versão tem arquivo: isso é conferido ao abrir o menu, para nunca oferecer um download que não existe.
 */
function VersionActions({ documentId, documentTitle, version, onView, onRevert }: { documentId: string; documentTitle: string; version: KnowledgeVersionFullRow; onView: () => void; onRevert: () => void }) {
  const [open, setOpen] = useState(false)
  const detailQuery = useKnowledgeVersionQuery(documentId, open ? version.id : null)
  const { download, pending } = useDownloadKnowledgeFile({ documentId, versionId: version.id, inUse: false }, detailQuery.data?.config?.file?.filename ?? documentTitle)
  const hasFile = Boolean(detailQuery.data?.fileId)
  const label = versionLabel(version.number)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={`Ações da ${label}`} className="text-muted-foreground">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={onView}>
          <Eye /> Ver a versão
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!hasFile || pending} onSelect={() => void download()}>
          <Download /> {detailQuery.isLoading ? "Conferindo o arquivo..." : hasFile ? "Baixar arquivo" : "Esta versão não tem arquivo"}
        </DropdownMenuItem>
        {canRevertVersion(version) ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onRevert}>
              <RotateCcw /> Reverter para esta versão
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function FullRow({
  documentId,
  documentTitle,
  version,
  checked,
  selectable,
  onToggle,
  onView,
  onRevert,
}: {
  documentId: string
  documentTitle: string
  version: KnowledgeVersionFullRow
  checked: boolean
  selectable: boolean
  onToggle: (checked: boolean) => void
  onView: () => void
  onRevert: () => void
}) {
  const inUse = version.situation === "IN_USE"
  const date = versionDate(version)
  const label = versionLabel(version.number)
  return (
    <TableRow className={cn("align-top", inUse && "bg-primary/5")} data-testid={`knowledge-version-${version.number}`}>
      <TableCell>
        <Checkbox aria-label={`Comparar a ${label}`} checked={checked} disabled={!checked && !selectable} onCheckedChange={(next) => onToggle(next === true)} />
      </TableCell>
      <TableCell>
        <p className={cn("font-medium", inUse && "text-primary")}>{label}</p>
        {version.revertedFromNumber !== null ? <p className="text-xs text-muted-foreground">{`origem: reversão da ${versionLabel(version.revertedFromNumber)}`}</p> : null}
        {version.reactivationConfirmedByName ? <p className="text-xs text-muted-foreground">{`reativação da base confirmada por ${version.reactivationConfirmedByName}`}</p> : null}
      </TableCell>
      <TableCell className="min-w-40 max-w-64 whitespace-normal">
        <SituationCell version={version} />
      </TableCell>
      <TableCell className="text-sm">
        <p>{version.authorName ?? NOT_RECORDED}</p>
        {version.publishedByName && version.publishedByName !== version.authorName ? <p className="text-xs text-muted-foreground">Publicada por {version.publishedByName}</p> : null}
      </TableCell>
      <TableCell className="text-sm">
        <p className="text-xs text-muted-foreground">{date.label}</p>
        <time dateTime={date.at}>{formatShortDateTime(date.at, { withYear: true })}</time>
      </TableCell>
      <TableCell className="max-w-64 whitespace-normal text-sm">{version.changeSummary ?? <span className="text-muted-foreground">{NOT_RECORDED}</span>}</TableCell>
      <TableCell className="text-sm">
        <p>{version.usageCount}</p>
        {version.lastUsedAt ? <p className="text-xs text-muted-foreground">última em {formatShortDateTime(version.lastUsedAt, { withYear: true })}</p> : null}
      </TableCell>
      <TableCell className="text-right">
        <VersionActions documentId={documentId} documentTitle={documentTitle} version={version} onView={onView} onRevert={onRevert} />
      </TableCell>
    </TableRow>
  )
}

/** Versão fora do alcance de quem lê: só número e situação, sem ações e sem dizer o que ela continha. */
function RestrictedRow({ version }: { version: Extract<KnowledgeVersionRow, { restricted: true }> }) {
  return (
    <TableRow className="align-top" data-testid={`knowledge-version-${version.number}`}>
      <TableCell />
      <TableCell className="font-medium">{versionLabel(version.number)}</TableCell>
      <TableCell>
        <Badge variant="outline">{KNOWLEDGE_SITUATION_LABELS[version.situation]}</Badge>
      </TableCell>
      <TableCell colSpan={5} className="text-sm italic text-muted-foreground">
        Sem acesso a esta versão
      </TableCell>
    </TableRow>
  )
}

export function VersionTable({
  documentId,
  documentTitle,
  versions,
  selected,
  maxSelected,
  onToggle,
  onView,
  onRevert,
}: {
  documentId: string
  documentTitle: string
  versions: readonly KnowledgeVersionRow[]
  selected: readonly string[]
  maxSelected: number
  onToggle: (id: string, checked: boolean) => void
  onView: (version: KnowledgeVersionFullRow) => void
  onRevert: (version: KnowledgeVersionFullRow) => void
}) {
  return (
    <div className={TABLE_FRAME}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <span className="sr-only">Comparar</span>
            </TableHead>
            <TableHead>Versão</TableHead>
            <TableHead>Situação</TableHead>
            <TableHead>Autor</TableHead>
            <TableHead>Data</TableHead>
            <TableHead>Resumo da alteração</TableHead>
            <TableHead>Consultas</TableHead>
            <TableHead className="w-10">
              <span className="sr-only">Ações</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {versions.map((version) =>
            version.restricted ? (
              <RestrictedRow key={version.id} version={version} />
            ) : (
              <FullRow
                key={version.id}
                documentId={documentId}
                documentTitle={documentTitle}
                version={version}
                checked={selected.includes(version.id)}
                selectable={selected.length < maxSelected}
                onToggle={(checked) => onToggle(version.id, checked)}
                onView={() => onView(version)}
                onRevert={() => onRevert(version)}
              />
            ),
          )}
        </TableBody>
      </Table>
    </div>
  )
}
