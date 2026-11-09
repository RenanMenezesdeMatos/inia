"use client"

import { useState } from "react"
import { GitCompare } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useKnowledgeVersionsQuery } from "@/queries/admin/use-knowledge-queries"
import type { KnowledgeDocumentDetail, KnowledgeVersionFullRow, KnowledgeVersionRow } from "@/schemas/admin/knowledge.schema"

import { RevertVersionDialog } from "./knowledge-version-history/revert-dialog"
import { VersionCompareDialog } from "./knowledge-version-history/version-compare-dialog"
import { VersionTable } from "./knowledge-version-history/version-table"
import { VersionViewDialog } from "./knowledge-version-history/version-view-dialog"

const MAX_COMPARED = 2

/** Histórico da base (PEN-008, RN-066): as versões, da mais nova para a mais antiga, com ver, baixar, reverter e comparar duas delas. */
export function KnowledgeVersionHistory({ document }: { document: KnowledgeDocumentDetail }) {
  const versionsQuery = useKnowledgeVersionsQuery(document.id)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [viewing, setViewing] = useState<KnowledgeVersionFullRow | null>(null)
  const [reverting, setReverting] = useState<KnowledgeVersionFullRow | null>(null)
  const [comparing, setComparing] = useState<[KnowledgeVersionRow, KnowledgeVersionRow] | null>(null)

  if (versionsQuery.isLoading) return <Skeleton className="h-40 w-full" />
  if (versionsQuery.isError) return <p className="text-sm text-destructive">Não foi possível carregar o histórico de versões.</p>
  const versions = versionsQuery.data ?? []
  if (versions.length === 0) return <p className="text-sm text-muted-foreground">Esta base ainda não tem nenhuma versão.</p>

  // Uma versão selecionada pode ter sumido (rascunho descartado): a seleção vale só para o que ainda existe, da mais antiga para a mais nova.
  const selected = versions.filter((version) => selectedIds.includes(version.id)).sort((a, b) => a.number - b.number)

  function toggle(id: string, checked: boolean) {
    setSelectedIds((current) => (checked ? [...current, id].slice(-MAX_COMPARED) : current.filter((value) => value !== id)))
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Versões publicadas não mudam. Marque duas versões para comparar, sempre da mais antiga para a mais nova.</p>
        <Button size="sm" variant="outline" disabled={selected.length !== MAX_COMPARED} onClick={() => setComparing([selected[0]!, selected[1]!])}>
          <GitCompare /> Comparar
        </Button>
      </div>
      <VersionTable documentId={document.id} documentTitle={document.title} versions={versions} selected={selected.map((version) => version.id)} maxSelected={MAX_COMPARED} onToggle={toggle} onView={setViewing} onRevert={setReverting} />
      <p className="text-xs text-muted-foreground">Consultas: quantas consultas da IA usaram cada versão, contadas desde que esse registro existe. Versões anteriores a ele podem ter sido usadas sem aparecer aqui.</p>
      {viewing ? <VersionViewDialog documentId={document.id} documentTitle={document.title} version={viewing} onClose={() => setViewing(null)} /> : null}
      {reverting ? <RevertVersionDialog document={document} version={reverting} onClose={() => setReverting(null)} /> : null}
      {comparing ? <VersionCompareDialog documentId={document.id} from={comparing[0]} to={comparing[1]} onClose={() => setComparing(null)} /> : null}
    </div>
  )
}
