"use client"

import { scopeValueIssue } from "@/lib/scope-links/scope-links"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Archive, ArchiveRestore, CalendarClock, EllipsisVertical, Loader2, PenLine, Save, Send, SlidersHorizontal, Trash2, Undo2 } from "lucide-react"
import { toast } from "sonner"

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { BackLink } from "@/components/ui/back-link"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusChip, SURFACE_CARD, toneSurface } from "@/components/ui/surface"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ListErrorState } from "@/components/admin/shared/list/list-states"
import { cn } from "@/lib/utils"
import { formatClockTime, formatDateTime } from "@/lib/format/date"
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard"
import { useCurrentUserQuery } from "@/queries/auth/use-current-user"
import {
  useArchiveCommunicationMutation,
  useAudienceOptionsQuery,
  useAudiencePreviewQuery,
  useCreateCommunicationMutation,
  useMyCommunicationQuery,
  useRetireCommunicationMutation,
  useUpdateCommunicationMutation,
} from "@/queries/communications/use-communications"
import { COMMUNICATION_STATE_LABELS, editorialFormSchema, publishBlockers, type EditorialCommunication, type EditorialForm } from "@/schemas/communications/communication.schema"

import { PublicationPreviewDialog } from "./editor/publication-preview-dialog"
import { PublicationRichTextEditor, type EditorValue } from "./editor/publication-rich-text-editor"
import { PublicationAudienceSettings, PublicationOrganizationSettings, PublicationScheduleSettings, PublicationSummarySettings } from "./editor/publication-settings"
import { audienceDescription, emptyForm, formFingerprint, formOf, payloadOf, publicationPath, PUBLICATIONS_PATH, scheduleDescription, segmentPayloadOf, STATE_TONES, wentOut } from "./publication-form"

const failureMessage = (failure: unknown, fallback: string) => (failure instanceof Error && failure.message ? failure.message : fallback)

/**
 * ÁREA EDITORIAL — criar ou editar uma publicação (comunicado). Referência de fluxo: o editor de posts do WordPress: título e texto
 * em destaque; à direita (abaixo, no celular, em "Configurações") publicação e exibição, público, organização e resumo. Ações:
 * salvar rascunho, pré-visualizar, publicar agora ou agendar, atualizar, voltar a rascunho (agendado), arquivar/desarquivar e
 * retirar. Alterações pendentes avisam ao sair. O servidor é a autoridade: público, permissão, datas e conteúdo são refeitos lá.
 */
export function PublicationEditorPage({ id }: { id: string | null }) {
  const existing = useMyCommunicationQuery(id)
  if (id && existing.isLoading) return <EditorSkeleton />
  if (id && (existing.isError || !existing.data)) {
    return (
      <div className="space-y-4">
        <BackLink href={PUBLICATIONS_PATH} label="Publicações" />
        <ListErrorState message="Não foi possível abrir a publicação. Ela pode ter sido retirada ou não ser sua." onRetry={() => existing.refetch()} error={existing.error ?? undefined} />
      </div>
    )
  }
  // A publicação salva entra UMA vez no formulário (o `key` remonta o editor se o id mudar); recarregar a consulta depois não apaga
  // o que está sendo escrito.
  return <PublicationEditor key={id ?? "nova"} initial={existing.data ?? null} reload={async () => (await existing.refetch()).data ?? null} />
}

function PublicationEditor({ initial, reload }: { initial: EditorialCommunication | null; reload: () => Promise<EditorialCommunication | null> }) {
  const router = useRouter()
  const me = useCurrentUserQuery()
  const options = useAudienceOptionsQuery()
  const create = useCreateCommunicationMutation()
  const update = useUpdateCommunicationMutation()
  const archive = useArchiveCommunicationMutation()
  const retire = useRetireCommunicationMutation()

  const [form, setForm] = useState<EditorialForm>(() => (initial ? formOf(initial) : emptyForm()))
  const [baseline, setBaseline] = useState(() => formFingerprint(initial ? formOf(initial) : emptyForm()))
  const [saved, setSaved] = useState<EditorialCommunication | null>(initial)
  const initialHtml = initial?.contentHtml ?? ""
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [confirmPublish, setConfirmPublish] = useState(false)
  const [confirmRetire, setConfirmRetire] = useState(false)
  const [mobilePanel, setMobilePanel] = useState<"write" | "settings">("write")

  const dirty = formFingerprint(form) !== baseline
  const guard = useUnsavedChangesGuard(dirty)
  const locked = wentOut(saved)
  const archived = saved?.status === "ARCHIVED"
  const state = saved?.state ?? "DRAFT"
  const pending = create.isPending || update.isPending || archive.isPending || retire.isPending
  const blockers = useMemo(() => publishBlockers(form), [form])
  const segmentReady = form.audience !== "SEGMENT" || Boolean(form.segment.universe || (form.segment.scope.groups.length > 0 && !scopeValueIssue(form.segment.scope)))
  const preview = useAudiencePreviewQuery({ audience: form.audience, segment: form.audience === "SEGMENT" ? segmentPayloadOf(form.segment) : null }, !locked && segmentReady && Boolean(options.data))
  const recipientCount = locked ? (saved?.recipientCount ?? null) : (preview.data ?? null)

  const patch = useCallback((next: Partial<EditorialForm>) => setForm((current) => ({ ...current, ...next })), [])
  const onContent = useCallback((value: EditorValue) => setForm((current) => (current.contentHtml === value.html && current.plainText === value.text ? current : { ...current, contentHtml: value.html, plainText: value.text })), [])

  function afterSave(result: EditorialCommunication | null, savedForm: EditorialForm, message: string) {
    setBaseline(formFingerprint(savedForm))
    setLastSavedAt(new Date().toISOString())
    setError("")
    if (result) setSaved(result)
    toast.success(message)
  }

  async function save(mode: "DRAFT" | "PUBLISH", successMessage: string) {
    const parsed = editorialFormSchema.safeParse(form)
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Revise a publicação.")
    if (mode === "PUBLISH" && blockers.length > 0) return setError(blockers[0]!)
    const snapshot = form
    try {
      if (!saved) {
        const created = await create.mutateAsync(payloadOf(snapshot, mode, false))
        guard.release() // a navegação abaixo não pode disparar o aviso de "não salvo"
        toast.success(successMessage)
        router.replace(publicationPath(created.id))
        return
      }
      const result = await update.mutateAsync({ id: saved.id, input: payloadOf(snapshot, mode, locked) })
      afterSave(result, snapshot, successMessage)
    } catch (failure) {
      setError(failureMessage(failure, "Não foi possível salvar. Tente novamente."))
    }
  }

  const scheduling = Boolean(form.publishAt) && !locked
  const primaryLabel = locked ? "Atualizar" : scheduling ? (state === "SCHEDULED" ? "Salvar agendamento" : "Agendar") : "Publicar"
  const PrimaryIcon = locked ? Save : scheduling ? CalendarClock : Send

  function primary() {
    if (locked) return void save("PUBLISH", "Publicação atualizada.")
    if (blockers.length > 0) return setError(blockers[0]!)
    setConfirmPublish(true)
  }

  // Ctrl/Cmd+S salva (rascunho enquanto for rascunho; senão, atualiza).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault()
        if (!pending && !archived) void save(state === "DRAFT" ? "DRAFT" : "PUBLISH", state === "DRAFT" ? "Rascunho salvo." : "Alterações salvas.")
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const author = { personId: me.data?.personId ?? "", name: me.data?.displayName ?? me.data?.name ?? "Você", jobTitle: me.data?.jobTitle ?? null }
  const saveStatus = pending ? "Salvando…" : dirty ? "Alterações não salvas" : lastSavedAt ? `Salvo às ${formatClockTime(lastSavedAt)}` : saved?.updatedAt ? `Salvo em ${formatDateTime(saved.updatedAt)}` : saved ? "Sem alterações" : "Ainda não salvo"

  const settings = (
    <div className="space-y-0">
      <PublicationScheduleSettings form={form} patch={patch} locked={locked} publishedAtLabel={saved?.publishedAt ? `Publicado em ${formatDateTime(saved.publishedAt)}` : null} />
      <PublicationAudienceSettings form={form} patch={patch} locked={locked} options={options.data} optionsLoading={options.isLoading} />
      <PublicationOrganizationSettings form={form} patch={patch} options={options.data} />
      <PublicationSummarySettings form={form} patch={patch} />
    </div>
  )

  return (
    <div className="space-y-4">
      <BackLink label="Publicações" onClick={() => guard.request(() => router.push(PUBLICATIONS_PATH))} />

      {/* Barra do editor: estado, situação do salvamento e ações. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <StatusChip tone={STATE_TONES[state]}>{COMMUNICATION_STATE_LABELS[state]}</StatusChip>
          <span className={cn("text-sm text-muted-foreground", dirty && "text-amber-700 dark:text-amber-400")} aria-live="polite">{saveStatus}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PublicationPreviewDialog form={form} saved={saved} options={options.data} author={author} recipientCount={recipientCount} />
          {!archived && (state === "DRAFT" || !saved) ? (
            <Button type="button" variant="outline" disabled={pending} onClick={() => void save("DRAFT", "Rascunho salvo.")}>
              {create.isPending || update.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Save data-icon="inline-start" />}Salvar rascunho
            </Button>
          ) : null}
          {!archived ? (
            <Button type="button" disabled={pending || (locked && !dirty)} onClick={primary}>
              <PrimaryIcon data-icon="inline-start" />{primaryLabel}
            </Button>
          ) : (
            <Button type="button" disabled={pending} onClick={() => archive.mutate({ id: saved!.id, archived: false }, { onSuccess: () => { toast.success("Publicação desarquivada."); void reload().then((fresh) => { if (fresh) setSaved(fresh) }) }, onError: (failure) => setError(failureMessage(failure, "Não foi possível desarquivar.")) })}>
              <ArchiveRestore data-icon="inline-start" />Desarquivar
            </Button>
          )}
          {saved ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" aria-label="Mais ações"><EllipsisVertical /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {state === "SCHEDULED" ? <DropdownMenuItem onSelect={() => void save("DRAFT", "Agendamento cancelado; voltou a rascunho.")}><Undo2 />Voltar a rascunho</DropdownMenuItem> : null}
                {saved.status === "PUBLISHED" ? <DropdownMenuItem onSelect={() => archive.mutate({ id: saved.id, archived: true }, { onSuccess: () => { toast.success("Publicação arquivada: saiu do Acompanhamento e do chat."); void reload().then((fresh) => { if (fresh) setSaved(fresh) }) }, onError: (failure) => setError(failureMessage(failure, "Não foi possível arquivar.")) })}><Archive />Arquivar</DropdownMenuItem> : null}
                {saved.status === "PUBLISHED" || state === "SCHEDULED" ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirmRetire(true)}><Trash2 />{state === "DRAFT" ? "Descartar rascunho" : "Retirar"}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      {archived ? <p className={cn(toneSurface("warning"), "px-4 py-3 text-sm")}>Publicação arquivada em {formatDateTime(saved!.archivedAt!)}: não aparece no Acompanhamento nem é usada pela INIA no chat. Desarquive para editar.</p> : null}
      {locked && !archived ? <p className="text-sm text-muted-foreground">Já publicada: título, conteúdo, categoria, resumo, destaque e fim da exibição podem mudar (a versão anterior fica guardada e quem recebeu vê “editado”). Público e data de publicação ficam fixos.</p> : null}
      {error ? <p role="alert" className={cn(toneSurface("danger"), "px-4 py-3 text-sm")}>{error}</p> : null}

      {/* Celular: escrever e configurar em abas; desktop: as duas colunas. */}
      <Tabs value={mobilePanel} onValueChange={(value) => setMobilePanel(value as "write" | "settings")} className="lg:hidden">
        <TabsList className="w-full">
          <TabsTrigger value="write" className="flex-1"><PenLine />Escrever</TabsTrigger>
          <TabsTrigger value="settings" className="flex-1"><SlidersHorizontal />Configurações</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <fieldset disabled={archived} className={cn(SURFACE_CARD, "min-w-0 px-4 pt-4 sm:px-8 sm:pt-6", mobilePanel !== "write" && "hidden lg:block")}>
          <legend className="sr-only">Conteúdo</legend>
          <textarea
            aria-label="Título da publicação"
            value={form.title}
            maxLength={120}
            rows={1}
            placeholder="Título da publicação"
            onChange={(event) => patch({ title: event.target.value.replace(/\n/g, " ") })}
            className="field-sizing-content w-full resize-none bg-transparent font-heading text-2xl leading-tight font-semibold tracking-tight outline-none placeholder:text-muted-foreground/60 sm:text-3xl"
          />
          <PublicationRichTextEditor value={{ html: form.contentHtml, text: form.plainText }} onChange={onContent} initialHtml={initialHtml} readOnly={archived} />
        </fieldset>
        <aside aria-label="Configurações da publicação" className={cn(SURFACE_CARD, "h-fit p-4 lg:sticky lg:top-4", mobilePanel !== "settings" && "hidden lg:block")}>
          <fieldset disabled={archived}>{settings}</fieldset>
        </aside>
      </div>

      <AlertDialog open={confirmPublish} onOpenChange={setConfirmPublish}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{scheduling ? "Agendar a publicação?" : "Publicar agora?"}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p><strong className="text-foreground">{form.title.trim()}</strong></p>
                <p>{audienceDescription(form, options.data)}{recipientCount !== null ? ` · ${recipientCount.toLocaleString("pt-BR")} ${recipientCount === 1 ? "pessoa" : "pessoas"} hoje` : ""}.</p>
                <p>{scheduleDescription(form, saved)}.</p>
                <p>Quem recebe vê no Acompanhamento, e a INIA pode usar a publicação no chat para quem a recebeu.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Revisar</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={(event) => { event.preventDefault(); void save("PUBLISH", scheduling ? "Publicação agendada." : "Publicação no ar.").then(() => setConfirmPublish(false)) }}>
              {scheduling ? "Agendar" : "Publicar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmRetire} onOpenChange={setConfirmRetire}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{state === "DRAFT" ? "Descartar o rascunho?" : "Retirar a publicação?"}</AlertDialogTitle>
            <AlertDialogDescription>{state === "DRAFT" ? "O rascunho sai da sua lista." : "Sai do Acompanhamento de todos que a receberam e deixa de ser usada pela INIA."} O registro fica guardado e pode voltar por Consultar dados › Itens excluídos.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Manter</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                retire.mutate(saved!.id, {
                  onSuccess: () => { toast.success(state === "DRAFT" ? "Rascunho descartado." : "Publicação retirada."); guard.release(); router.push(PUBLICATIONS_PATH) },
                  onError: (failure) => { setConfirmRetire(false); setError(failureMessage(failure, "Não foi possível retirar.")) },
                })
              }}
            >
              {state === "DRAFT" ? "Descartar" : "Retirar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={guard.open} onOpenChange={(open) => { if (!open) guard.cancel() }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sair sem salvar?</AlertDialogTitle>
            <AlertDialogDescription>Há alterações nesta publicação que ainda não foram salvas. Se sair agora, elas se perdem.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={guard.confirm}>Sair sem salvar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function EditorSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Carregando a publicação">
      <Skeleton className="h-8 w-32" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className={cn(SURFACE_CARD, "space-y-4 p-6")}><Skeleton className="h-9 w-2/3" /><Skeleton className="h-64 w-full" /></div>
        <div className={cn(SURFACE_CARD, "space-y-3 p-4")}><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
      </div>
    </div>
  )
}

