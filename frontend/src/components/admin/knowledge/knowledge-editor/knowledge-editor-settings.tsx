"use client"

import Link from "next/link"
import { Archive, Boxes, CircleCheck, CircleSlash, FileClock, Globe2, History, Loader2, NotebookPen, Send, Tags, TriangleAlert, Users } from "lucide-react"

import { ProductScopeField } from "@/components/admin/product-catalog/product-scope-field"
import { MultiOrgScopeField } from "@/components/admin/shared/multi-org-scope-field"
import { UniverseSelect } from "@/components/operating-universe/universe-select"
import { Label } from "@/components/ui/label"
import { SettingsSection } from "@/components/ui/surface"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import type { ScopeLinksValue, ScopeTeamOption } from "@/lib/scope-links/scope-links"
import { isOcrReading, KNOWLEDGE_UPDATE_STATUS_LABELS, type KnowledgeDocumentDetail, type KnowledgeSubjectSelection } from "@/schemas/admin/knowledge.schema"
import type { OperatingUniverse } from "@/schemas/operating-universe/operating-universe.schema"
import type { ProductNode } from "@/schemas/admin/product-catalog.schema"

import { CHANGE_SUMMARY_MAX_LENGTH } from "../knowledge-lifecycle-dialogs"
import { byLine, versionLabel } from "../knowledge-visuals"
import { knowledgeDetailHref } from "./knowledge-editor-form"
import { KnowledgeSubjectsField } from "./knowledge-subjects-field"

function StatusLine({ icon: Icon, tone = "muted", children }: { icon: typeof Send; tone?: "muted" | "primary" | "warning" | "danger"; children: React.ReactNode }) {
  const color = { muted: "text-muted-foreground", primary: "text-primary", warning: "text-amber-700 dark:text-amber-300", danger: "text-destructive" }[tone]
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon className={`mt-0.5 size-4 shrink-0 ${color}`} aria-hidden />
      <div className="min-w-0 space-y-0.5">{children}</div>
    </div>
  )
}

/**
 * Situação e publicação (PEN-008): o que a IA usa agora, o rascunho em edição e as atualizações, sem misturar. Salvar grava o rascunho
 * e nunca muda o que a IA usa; publicar pede a disponibilização, que só vale quando a versão fica pronta.
 */
export function KnowledgePublicationSection({ document, changeSummary, onChangeSummary }: { document: KnowledgeDocumentDetail | null; changeSummary: string; onChangeSummary: (value: string) => void }) {
  if (!document) {
    return (
      <SettingsSection title="Publicação" icon={Send}>
        <StatusLine icon={NotebookPen}><p>Ainda não salva.</p><p className="text-xs text-muted-foreground">Salvar rascunho cria a {versionLabel(1)}, fora do alcance da IA. Publicar a disponibiliza para agentes, Workflows e orquestradores quando ela ficar pronta.</p></StatusLine>
      </SettingsSection>
    )
  }
  const draft = document.draft && !document.draft.restricted ? document.draft : null
  return (
    <SettingsSection title="Publicação" icon={Send}>
      <div className="space-y-2.5" data-testid="knowledge-editor-status">
        {document.inUse ? (
          <StatusLine icon={CircleCheck} tone="primary"><p className="font-medium">Em uso pela IA: {versionLabel(document.inUse.version)}</p><p className="text-xs text-muted-foreground">{byLine("Publicada", document.inUse.publishedByName, document.inUse.publishedAt)}</p></StatusLine>
        ) : document.archived ? (
          <StatusLine icon={Archive}><p className="font-medium">Arquivada: fora de uso pela IA</p><p className="text-xs text-muted-foreground">Publicar o rascunho também reativa a base (pede confirmação).</p></StatusLine>
        ) : (
          <StatusLine icon={CircleSlash} tone="warning"><p className="font-medium">Nenhuma versão em uso pela IA</p><p className="text-xs text-muted-foreground">A base só é consultada depois de publicada e pronta.</p></StatusLine>
        )}
        {draft ? (
          <StatusLine icon={FileClock}>
            <p className="font-medium">Rascunho: {versionLabel(draft.version)}</p>
            <p className="text-xs text-muted-foreground">{byLine("Salvo", draft.updatedByName, draft.updatedAt)}</p>
            {isOcrReading(draft.ocr) ? <p className="text-xs text-amber-800 dark:text-amber-200">Lendo as páginas digitalizadas (OCR): espere terminar para editar o texto ou publicar.</p> : null}
            {!draft.textAvailable && !isOcrReading(draft.ocr) ? <p className="text-xs text-amber-800 dark:text-amber-200">Sem texto: publicar assim falha no processamento.</p> : null}
          </StatusLine>
        ) : (
          <StatusLine icon={NotebookPen}><p className="text-xs text-muted-foreground">Sem rascunho. Salvar uma alteração cria a {versionLabel((document.latestVersion?.version ?? 0) + 1)}; a versão em uso não muda até a publicação.</p></StatusLine>
        )}
        {document.updates.map((update) => (
          <StatusLine key={update.id} icon={update.status === "PROCESSING" ? Loader2 : TriangleAlert} tone={update.status === "FAILED" ? "danger" : "muted"}>
            <p className="font-medium">{`Atualização ${versionLabel(update.version)}: ${KNOWLEDGE_UPDATE_STATUS_LABELS[update.status]}`}</p>
            {update.status === "FAILED" ? <p className="text-xs text-destructive">{update.errorMessage ?? "Motivo não registrado."} Tente de novo na página da base.</p> : <p className="text-xs text-muted-foreground">A IA passa a usá-la quando ficar pronta.</p>}
          </StatusLine>
        ))}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="knowledge-change-summary">Resumo da alteração (opcional)</Label>
        <Textarea id="knowledge-change-summary" value={changeSummary} rows={2} maxLength={CHANGE_SUMMARY_MAX_LENGTH} placeholder="O que mudou e por quê" onChange={(event) => onChangeSummary(event.target.value)} />
        <p className="text-xs text-muted-foreground">Fica no rascunho e aparece no histórico de versões.</p>
      </div>
      <Link href={`${knowledgeDetailHref(document.id)}?aba=versoes`} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"><History className="size-3.5" aria-hidden />Histórico de versões</Link>
    </SettingsSection>
  )
}

export function KnowledgeUniverseSection({ value, onChange, allowPending, error }: { value: OperatingUniverse | null; onChange: (value: OperatingUniverse | null) => void; allowPending: boolean; error: string | null }) {
  return (
    <SettingsSection title="Universo de atuação" icon={Globe2}>
      <Label htmlFor="knowledge-universe" className="sr-only">Universo de atuação</Label>
      <UniverseSelect id="knowledge-universe" value={value} onChange={onChange} allowPending={allowPending} aria-describedby="knowledge-universe-help" />
      <p id="knowledge-universe-help" className="text-xs text-muted-foreground">A base só é consultada por quem atua neste universo e só vale para produtos dele. Numa base salva, mudar o universo vale ao salvar, fora do rascunho.</p>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </SettingsSection>
  )
}

export function KnowledgeScopeSection({ teams, value, onChange, universe, editing }: { teams: readonly ScopeTeamOption[] | null; value: ScopeLinksValue; onChange: (value: ScopeLinksValue) => void; universe: OperatingUniverse | null; editing: boolean }) {
  return (
    <SettingsSection title="Alcance" icon={Users}>
      {teams ? (
        <MultiOrgScopeField
          teams={teams}
          value={value}
          onChange={onChange}
          universe={universe}
          allowGlobal
          globalLabel="Todos os grupos"
          label="Grupos"
          hint={editing ? "Incluir ou tirar um Grupo vale quando o rascunho for publicado; quem perde o vínculo deixa de receber a base, também no chat." : "A mesma base pode valer para vários Grupos — inteiros ou só alguns Subgrupos de cada um."}
        />
      ) : (
        <Skeleton className="h-20 w-full" />
      )}
    </SettingsSection>
  )
}

export function KnowledgeSubjectsSection({ value, onChange, allowNone }: { value: KnowledgeSubjectSelection; onChange: (value: KnowledgeSubjectSelection) => void; allowNone: boolean }) {
  return (
    <SettingsSection title="Assuntos" icon={Tags}>
      <KnowledgeSubjectsField value={value} onChange={onChange} allowNone={allowNone} />
    </SettingsSection>
  )
}

export function KnowledgeProductsSection({ nodes, value, onChange, universe, editing }: { nodes: readonly ProductNode[]; value: readonly string[]; onChange: (ids: string[]) => void; universe: OperatingUniverse | null; editing: boolean }) {
  return (
    <SettingsSection title="Produtos" icon={Boxes}>
      <ProductScopeField nodes={nodes} value={value} onChange={onChange} idPrefix="knowledge-products" universe={universe} />
      {editing ? <p className="text-xs text-muted-foreground">Entra no rascunho com o resto: só passa a valer quando a versão entrar em uso, e chamadas já analisadas continuam com o que valia na época.</p> : null}
    </SettingsSection>
  )
}
