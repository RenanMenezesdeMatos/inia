"use client"

import { Plus, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { UniverseBadge } from "@/components/operating-universe/universe-badge"
import { fitsUniverse } from "@/lib/operating-universe/hierarchy"
import type { KnowledgeDocument } from "@/schemas/admin/knowledge.schema"
import type { OperatingUniverse } from "@/schemas/operating-universe/operating-universe.schema"

const NO_VERSION_LABEL = "Sem versão disponível"
const NO_VERSION_HINT = "o agente não consulta esta base até haver uma versão pronta."

// `operatingUniverse` opcional: com ele, cada linha mostra o selo do universo da base.
type MoverDocument = Pick<KnowledgeDocument, "id" | "title" | "inUseVersion"> & { operatingUniverse?: OperatingUniverse | null }

/** Selo da base sem versão pronta (CA-WF008.5): pode ser selecionada, mas o agente não a consulta enquanto isso. */
/** Selo do universo por linha; a base de outro universo que o agente já tinha fica marcada (o agente não salva com ela). */
function DocumentRow({ document, icon, onClick, universe }: { document: MoverDocument; icon: React.ReactNode; onClick: () => void; universe: OperatingUniverse | null | undefined }) {
  const outOfUniverse = document.operatingUniverse !== undefined && !fitsUniverse(document.operatingUniverse, universe)
  return (
    <button type="button" className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={onClick}>
      <span className="min-w-0">{document.title}</span>
      <span className="flex shrink-0 items-center gap-1.5">
        {document.operatingUniverse !== undefined ? <UniverseBadge universe={document.operatingUniverse} /> : null}
        {outOfUniverse ? (
          <Badge variant="outline" className="border-destructive/50 text-destructive" title="Base de outro universo de atuação: remova para salvar o agente">
            De outro universo
          </Badge>
        ) : null}
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

export function KnowledgeBaseMover({
  documents,
  selectedIds,
  onChange,
  universe,
}: {
  documents: MoverDocument[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  /** Universo do agente: marca a base de outro universo já vinculada. */
  universe?: OperatingUniverse | null
}) {
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
                available.map((document) => <DocumentRow key={document.id} document={document} universe={universe} icon={<Plus className="h-3.5 w-3.5 text-muted-foreground" />} onClick={() => onChange([...selectedIds, document.id])} />)
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
                selected.map((document) => <DocumentRow key={document.id} document={document} universe={universe} icon={<X className="h-3.5 w-3.5 text-muted-foreground" />} onClick={() => onChange(selectedIds.filter((id) => id !== document.id))} />)
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
