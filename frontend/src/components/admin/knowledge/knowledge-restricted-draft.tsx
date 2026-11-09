import { Lock } from "lucide-react"

import { cn } from "@/lib/utils"
import type { KnowledgeDocumentDetail } from "@/schemas/admin/knowledge.schema"

import { byLine, versionLabel } from "./knowledge-visuals"

export const RESTRICTED_DRAFT_NOTE = "Há um rascunho preparado para Grupos fora do seu escopo. Só quem administra todos eles pode vê-lo, editá-lo, publicá-lo ou descartá-lo."

/** A versão que abriria na edição vale para Grupos fora do escopo de quem lê, sem ser rascunho (ex.: atualização com falha). */
const restrictedVersionNote = (version: number | undefined) =>
  `${version === undefined ? "A versão em edição" : `A ${versionLabel(version)}`} vale para Grupos fora do seu escopo. Só quem administra todos eles pode vê-la ou editá-la.`

/**
 * Versão em edição cujo alcance quem lê não alcança: a API manda só número e situação, sem texto nem configuração, e recusa editar, trocar
 * arquivo, reprocessar, publicar e descartar com 403. Este aviso fica no lugar do texto e do editor, que apareceriam vazios.
 */
export function RestrictedEditableNotice({ document, className }: { document: Pick<KnowledgeDocumentDetail, "draft" | "editable">; className?: string }) {
  const draft = document.draft?.restricted ? document.draft : null
  return (
    <div className={cn("flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/60 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100", className)}>
      <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <div className="space-y-0.5">
        <p>{draft ? RESTRICTED_DRAFT_NOTE : restrictedVersionNote(document.editable?.version)}</p>
        {draft ? <p>{byLine("Salvo", draft.updatedByName, draft.updatedAt)}</p> : null}
      </div>
    </div>
  )
}
