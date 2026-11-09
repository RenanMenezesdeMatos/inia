"use client"

import { Plus, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { KnowledgeDocument } from "@/schemas/admin/knowledge.schema"

const NO_VERSION_LABEL = "Sem versão disponível"
const NO_VERSION_HINT = "o agente não consulta esta base até haver uma versão pronta."

type MoverDocument = Pick<KnowledgeDocument, "id" | "title" | "inUseVersion">

/** Selo da base sem versão pronta (CA-WF008.5): pode ser selecionada, mas o agente não a consulta enquanto isso. */
function DocumentRow({ document, icon, onClick }: { document: MoverDocument; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={onClick}>
      <span className="min-w-0">{document.title}</span>
      <span className="flex shrink-0 items-center gap-1.5">
        {document.inUseVersion === null ? (
          <Badge variant="outline" className="border-dashed text-muted-foreground" title={`${NO_VERSION_LABEL}: ${NO_VERSION_HINT}`}>
            {NO_VERSION_LABEL}
          </Badge>
        ) : null}
        {icon}
      </span>
    </button>
  )
}

export function KnowledgeBaseMover({ documents, selectedIds, onChange }: { documents: MoverDocument[]; selectedIds: string[]; onChange: (ids: string[]) => void }) {
  const available = documents.filter((document) => !selectedIds.includes(document.id))
  const selected = documents.filter((document) => selectedIds.includes(document.id))
  const anyWithoutVersion = documents.some((document) => document.inUseVersion === null)

  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Disponíveis</p>
          <ScrollArea className="h-48 rounded-lg border">
            <div className="space-y-1 p-2">
              {available.length ? (
                available.map((document) => <DocumentRow key={document.id} document={document} icon={<Plus className="h-3.5 w-3.5 text-muted-foreground" />} onClick={() => onChange([...selectedIds, document.id])} />)
              ) : (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">Nenhuma base disponível.</p>
              )}
            </div>
          </ScrollArea>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Selecionadas</p>
          <ScrollArea className="h-48 rounded-lg border">
            <div className="space-y-1 p-2">
              {selected.length ? (
                selected.map((document) => <DocumentRow key={document.id} document={document} icon={<X className="h-3.5 w-3.5 text-muted-foreground" />} onClick={() => onChange(selectedIds.filter((id) => id !== document.id))} />)
              ) : (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">Nenhuma base selecionada.</p>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
      {anyWithoutVersion ? (
        <p className="text-xs text-muted-foreground">
          “{NO_VERSION_LABEL}”: {NO_VERSION_HINT}
        </p>
      ) : null}
    </div>
  )
}
