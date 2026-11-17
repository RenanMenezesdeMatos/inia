"use client"

import { ResponsiblePicker } from "./responsible-picker"
import { useMemo, useState } from "react"
import { ArrowLeft, History } from "lucide-react"

import { UniverseSelect } from "@/components/operating-universe/universe-select"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DateRangePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ErrorState, LoadingState } from "@/components/ui/states"
import { SectionLabel, StatusChip, type Tone } from "@/components/ui/surface"
import { Textarea } from "@/components/ui/textarea"
import { AdminApiError } from "@/lib/admin/admin-api"
import { formatCivilDate, formatDateTime } from "@/lib/format/date"
import { useProductNodesQuery } from "@/queries/admin/use-product-catalog-queries"
import {
  useAffectedAssessmentsQuery,
  useAlignmentReasonsQuery,
  useRequestReasonsQuery,
  useAlignmentQuery,
  useAlignmentScopeOptionsQuery,
  useCreateAlignmentMutation,
  useDeleteAlignmentMutation,
  useDiscardAlignmentDraftMutation,
  useEndAlignmentMutation,
  usePublicationPreviewQuery,
  usePublishAlignmentMutation,
  useSaveAlignmentDraftMutation,
} from "@/queries/operational-alignments/use-operational-alignment-queries"
import {
  ALIGNMENT_STATE_LABELS,
  ALIGNMENT_VERSION_STATUS_LABELS,
  alignmentFormSchema,
  type AlignmentDetail,
  type AlignmentFormValues,
  type AlignmentRelation,
  type AlignmentState,
  type AlignmentVersion, type ResponsibleOption } from "@/schemas/operational-alignments/operational-alignment.schema"

import { ProcessPicker, type PickedProcess } from "./process-picker"
import { keepCompatibleScope, subteamsOf, teamsForUniverse } from "./scope-hierarchy"

const NONE = "__none__"
export const STATE_TONE: Record<AlignmentState, Tone> = { DRAFT: "neutral", SCHEDULED: "info", IN_FORCE: "success", ENDED: "neutral", CANCELLED: "warning" }

export const audienceOf = (version: Pick<AlignmentVersion, "scopeType" | "team" | "subteam" | "product">) => {
  const scope = version.scopeType === "UNIVERSE" ? "Todo o universo" : version.scopeType === "TEAM" ? `Grupo ${version.team?.name ?? ""}` : `${version.team?.name ?? ""} › ${version.subteam?.name ?? ""}`
  return version.product ? `${scope} · ${version.product.name}` : scope
}
export const periodOf = (version: Pick<AlignmentVersion, "startsOn" | "endsOn">) => `${formatCivilDate(version.startsOn)} a ${formatCivilDate(version.endsOn)}`

const EMPTY: AlignmentFormValues = { title: "", guidance: "", affectedDocumentIds: [], reasonId: "", requestSubjectIds: [], affectedTopic: "", justification: "", operatingUniverse: null, scopeType: "TEAM", teamId: null, subteamId: null, productId: null, startsOn: "", endsOn: "", changeReason: null, responsiblePersonId: null }

const valuesOf = (version: AlignmentVersion): AlignmentFormValues => ({ title: version.title, guidance: version.guidance, affectedDocumentIds: version.processes.map((process) => process.id), reasonId: version.reason?.id ?? "", requestSubjectIds: version.requestReasons.map((reason) => reason.id), affectedTopic: version.affectedTopic ?? "", justification: version.justification, operatingUniverse: version.operatingUniverse, scopeType: version.scopeType, teamId: version.team?.id ?? null, subteamId: version.subteam?.id ?? null, productId: version.product?.id ?? null, startsOn: version.startsOn, endsOn: version.endsOn, changeReason: null, responsiblePersonId: version.responsible?.id ?? null })

function FieldError({ message }: { message: string | undefined }) {
  return message ? <p className="text-xs text-destructive">{message}</p> : null
}

/**
 * Formulário do alinhamento, NA PÁGINA (como os demais cadastros da Administração). Editar um publicado abre a próxima versão em
 * rascunho (motivo obrigatório); a publicada continua valendo até a nova ser publicada. O backend confere escopo, universo e processos.
 */
export function AlignmentForm({ editing, onSaved, onCancel }: { editing: AlignmentDetail | null; onSaved: (detail: AlignmentDetail) => void; onCancel: () => void }) {
  const source = editing ? (editing.draft ?? editing.current ?? editing.shown) : null
  const [values, setValues] = useState<AlignmentFormValues>(source ? valuesOf(source) : EMPTY)
  const [processes, setProcesses] = useState<PickedProcess[]>(source ? source.processes : [])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [responsible, setResponsible] = useState<ResponsibleOption | null>(source?.responsible ?? null)
  const scopeOptions = useAlignmentScopeOptionsQuery()
  const products = useProductNodesQuery()
  const reasons = useAlignmentReasonsQuery()
  const requestReasons = useRequestReasonsQuery()
  // Motivo desativado continua visível no registro que já o tinha (nunca some do formulário), mas não é oferecido ao novo.
  const reasonOptions = (reasons.data ?? []).filter((reason) => reason.active || reason.id === values.reasonId)
  const toggleRequest = (id: string) => setValues((previous) => ({ ...previous, requestSubjectIds: previous.requestSubjectIds.includes(id) ? previous.requestSubjectIds.filter((entry) => entry !== id) : [...previous.requestSubjectIds, id] }))
  const create = useCreateAlignmentMutation()
  const save = useSaveAlignmentDraftMutation()
  const needsChangeReason = editing?.current?.status === "PUBLISHED"

  const set = <K extends keyof AlignmentFormValues>(key: K, value: AlignmentFormValues[K]) => setValues((previous) => ({ ...previous, [key]: value }))
  // Encadeamento universo → Grupo → Subgrupo (e produtos/processos pelo universo): só aparece o que cabe no nível de cima.
  const scopeTeams = useMemo(() => scopeOptions.data?.teams ?? [], [scopeOptions.data])
  // Só Grupo/Subgrupo classificado em algum universo (o backend recusa alinhamento para quem ainda não tem universo).
  const allowedTeams = useMemo(() => teamsForUniverse(scopeTeams, values.operatingUniverse).map((team) => ({ ...team, subteams: team.subteams.filter((subteam) => subteam.operatingUniverse !== null) })).filter((team) => team.operatingUniverse !== null || team.subteams.length > 0), [scopeTeams, values.operatingUniverse])
  const allowedSubteams = subteamsOf(allowedTeams, values.teamId)
  const changeUniverse = (universe: AlignmentFormValues["operatingUniverse"]) => {
    setValues((previous) => ({ ...previous, operatingUniverse: universe, ...keepCompatibleScope(scopeTeams, universe, previous.teamId, previous.subteamId), productId: null }))
    // Processo de outro universo deixa de caber (os ainda sem universo continuam).
    setProcesses((previous) => previous.filter((process) => !universe || !process.operatingUniverse || process.operatingUniverse === universe))
  }
  const changeTeam = (teamId: string) => {
    const team = scopeTeams.find((entry) => entry.id === teamId)
    // Grupo escolhido antes do universo: o universo vem dele (o nível de cima acompanha o de baixo, nunca o contrário fica incoerente).
    if (!values.operatingUniverse && team?.operatingUniverse) changeUniverse(team.operatingUniverse)
    setValues((previous) => ({ ...previous, teamId, subteamId: null }))
  }
  const allowedProducts = (products.data ?? []).filter((node) => node.kind === "PRODUCT" && node.active && (!values.operatingUniverse || node.operatingUniverse === null || node.operatingUniverse === values.operatingUniverse))

  const submit = async () => {
    setServerError(null)
    const candidate = { ...values, affectedDocumentIds: processes.map((process) => process.id) }
    const parsed = alignmentFormSchema.safeParse(candidate)
    const issues: Record<string, string> = {}
    if (!parsed.success) for (const issue of parsed.error.issues) issues[String(issue.path[0])] ??= issue.message
    if (needsChangeReason && !values.changeReason?.trim()) issues.changeReason = "Informe o motivo da alteração (a nova versão fica no histórico)."
    setErrors(issues)
    if (!parsed.success || Object.keys(issues).length > 0) return
    try {
      const detail = editing ? await save.mutateAsync({ id: editing.id, values: candidate }) : await create.mutateAsync(candidate)
      onSaved(detail)
    } catch (error) {
      setServerError(error instanceof AdminApiError ? error.message : "Não foi possível salvar o alinhamento.")
    }
  }

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{editing ? (needsChangeReason ? `Nova versão de "${editing.shown.title}"` : "Editar rascunho") : "Novo alinhamento operacional"}</h2>
          <p className="text-sm text-muted-foreground">Orientação temporária de um ou mais processos, para o público e o período escolhidos: pode ser informação nova ou mudar um trecho da base. Se conflitar com a base, vale só no trecho conflitante; a base oficial não muda.</p>
        </div>
      </div>

      {/* Duas colunas em tela larga: o texto da orientação à esquerda; classificação, público e vigência à direita (campos na largura
          de um campo, nunca esticados); processos na largura toda. Em tela estreita, uma coluna na mesma ordem. */}
      <div className="grid gap-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="grid content-start gap-4">
          <SectionLabel>Orientação</SectionLabel>
          <div className="grid gap-1.5">
            <Label htmlFor="alignment-title">Título</Label>
            <Input id="alignment-title" value={values.title} onChange={(event) => set("title", event.target.value)} placeholder="Ex.: Fatura pelo App Meu Vivo ou site" />
            <FieldError message={errors.title} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="alignment-guidance">Orientação que passa a valer</Label>
            <Textarea id="alignment-guidance" rows={6} value={values.guidance} onChange={(event) => set("guidance", event.target.value)} placeholder="Ex.: Oriente o cliente a acessar a fatura pelo App Meu Vivo ou pelo site." />
            <FieldError message={errors.guidance} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="alignment-topic">Trecho ou assunto que muda (opcional)</Label>
            <Input id="alignment-topic" value={values.affectedTopic} onChange={(event) => set("affectedTopic", event.target.value)} placeholder="Ex.: Envio da fatura quando o cliente solicita — vazio se for orientação nova" />
            <FieldError message={errors.affectedTopic} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="alignment-justification">Justificativa (obrigatória)</Label>
            <Textarea id="alignment-justification" rows={4} value={values.justification} onChange={(event) => set("justification", event.target.value)} placeholder="Por que a operação mudou antes da base oficial?" />
            <FieldError message={errors.justification} />
          </div>
        </section>

        <div className="grid content-start gap-8">
          <section className="grid content-start gap-4">
            <SectionLabel>Autoria</SectionLabel>
            <div className="grid gap-1.5">
              <Label htmlFor="alignment-responsible">Responsável pela decisão</Label>
              <ResponsiblePicker id="alignment-responsible" value={values.responsiblePersonId} current={responsible} onChange={(option) => { setResponsible(option); set("responsiblePersonId", option?.id ?? null) }} />
              <p className="text-xs text-muted-foreground">Quem definiu a orientação (a INIA atribui a decisão a essa pessoa, com o cargo do cadastro). Se for você, deixe como está; quem publica fica registrado à parte.</p>
              <FieldError message={errors.responsiblePersonId} />
            </div>
          </section>
          <section className="grid content-start gap-4">
            <SectionLabel>Classificação</SectionLabel>
            <div className="grid gap-1.5">
              <Label htmlFor="alignment-reason">Motivo do alinhamento</Label>
              <Select value={values.reasonId} onValueChange={(reasonId) => set("reasonId", reasonId)}>
                <SelectTrigger id="alignment-reason" className="w-full"><SelectValue placeholder="Por que a operação mudou?" /></SelectTrigger>
                <SelectContent>{reasonOptions.map((reason) => <SelectItem key={reason.id} value={reason.id}>{reason.name}{reason.active ? "" : " (desativado)"}</SelectItem>)}</SelectContent>
              </Select>
              <FieldError message={errors.reasonId} />
            </div>
            <div className="grid gap-1.5">
              <Label id="alignment-request-label">Pedidos do cliente relacionados (opcional)</Label>
              <p className="text-xs text-muted-foreground">Os assuntos dos atendimentos em que este alinhamento se aplica.</p>
              <div role="group" aria-labelledby="alignment-request-label" className="flex flex-wrap gap-1.5">
                {(requestReasons.data ?? []).map((reason) => {
                  const on = values.requestSubjectIds.includes(reason.id)
                  return (
                    <Button key={reason.id} type="button" size="sm" variant={on ? "default" : "outline"} aria-pressed={on} className="h-7 rounded-full px-3 text-xs" onClick={() => toggleRequest(reason.id)}>
                      {reason.name}
                    </Button>
                  )
                })}
              </div>
            </div>
          </section>

          <section className="grid content-start gap-4">
            <SectionLabel>Público e vigência</SectionLabel>
            {/* Na coluna direita (xl) os campos ficam um por linha; duas colunas só quando há largura (sm na tela estreita, 2xl na larga). */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <div className="grid content-start gap-1.5">
                <Label htmlFor="alignment-universe">Universo de atuação</Label>
                <UniverseSelect id="alignment-universe" value={values.operatingUniverse} onChange={changeUniverse} />
                <FieldError message={errors.operatingUniverse} />
              </div>
              <div className="grid content-start gap-1.5">
                <Label htmlFor="alignment-scope">Público</Label>
                <Select value={values.scopeType} onValueChange={(scopeType) => setValues((previous) => ({ ...previous, scopeType: scopeType as AlignmentFormValues["scopeType"], subteamId: scopeType === "SUBTEAM" ? previous.subteamId : null }))}>
                  <SelectTrigger id="alignment-scope" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {scopeOptions.data?.universe ? <SelectItem value="UNIVERSE">Todo o universo</SelectItem> : null}
                    <SelectItem value="TEAM">Um Grupo</SelectItem>
                    <SelectItem value="SUBTEAM">Um Subgrupo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {values.scopeType !== "UNIVERSE" ? (
                <div className="grid content-start gap-1.5">
                  <Label htmlFor="alignment-team">Grupo</Label>
                  <Select value={values.teamId ?? ""} onValueChange={changeTeam}>
                    <SelectTrigger id="alignment-team" className="w-full"><SelectValue placeholder="Escolha o Grupo" /></SelectTrigger>
                    <SelectContent>{allowedTeams.map((team) => <SelectItem key={team.id} value={team.id} disabled={!team.manageable && values.scopeType === "TEAM"}>{team.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <FieldError message={errors.teamId} />
                </div>
              ) : null}
              {values.scopeType === "SUBTEAM" ? (
                <div className="grid content-start gap-1.5">
                  <Label htmlFor="alignment-subteam">Subgrupo</Label>
                  <Select value={values.subteamId ?? ""} onValueChange={(subteamId) => set("subteamId", subteamId)}>
                    <SelectTrigger id="alignment-subteam" className="w-full"><SelectValue placeholder="Escolha o Subgrupo" /></SelectTrigger>
                    <SelectContent>{allowedSubteams.map((subteam) => <SelectItem key={subteam.id} value={subteam.id}>{subteam.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <FieldError message={errors.subteamId} />
                </div>
              ) : null}
              <div className="grid content-start gap-1.5">
                <Label htmlFor="alignment-period">Vigência</Label>
                <DateRangePicker id="alignment-period" className="w-full" value={{ from: values.startsOn || undefined, to: values.endsOn || undefined }} onChange={(range) => setValues((previous) => ({ ...previous, startsOn: range.from ?? "", endsOn: range.to ?? "" }))} presets={false} placeholder="Início e término" />
                <FieldError message={errors.startsOn ?? errors.endsOn} />
              </div>
              <div className="grid content-start gap-1.5">
                <Label htmlFor="alignment-product">Produto (opcional)</Label>
                <Select value={values.productId ?? NONE} onValueChange={(id) => set("productId", id === NONE ? null : id)}>
                  <SelectTrigger id="alignment-product" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Qualquer produto</SelectItem>
                    {allowedProducts.map((product) => <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Início e término inclusivos, no fuso da organização: começa às 00:00 do início e vai até o fim do dia do término. Assuntos proibidos e limites de atuação continuam valendo acima de qualquer alinhamento.</p>
          </section>
        </div>
      </div>

      <section className="grid gap-3">
        <SectionLabel>Processos</SectionLabel>
        <ProcessPicker value={processes} onChange={setProcesses} universe={values.operatingUniverse} error={errors.affectedDocumentIds} />
      </section>

      {needsChangeReason ? (
        <div className="grid gap-1.5">
          <Label htmlFor="alignment-change">Motivo da alteração</Label>
          <Input id="alignment-change" value={values.changeReason ?? ""} onChange={(event) => set("changeReason", event.target.value)} />
          <FieldError message={errors.changeReason} />
        </div>
      ) : null}
      {serverError ? <p role="alert" className="text-sm text-destructive">{serverError}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button onClick={submit} disabled={create.isPending || save.isPending}>Salvar rascunho</Button>
      </div>
    </div>
  )
}

function VersionBlock({ version }: { version: AlignmentVersion }) {
  return (
    <div className="grid gap-3 text-sm">
      <div className="grid gap-1 sm:grid-cols-3">
        <div><span className="text-muted-foreground">Público: </span>{version.operatingUniverse} · {audienceOf(version)}</div>
        <div><span className="text-muted-foreground">Vigência: </span>{periodOf(version)} ({version.timeZone})</div>
        <div><span className="text-muted-foreground">Motivo: </span>{version.reason?.name ?? "não informado"}</div>
        <div><span className="text-muted-foreground">Pedidos do cliente relacionados: </span>{version.requestReasons.map((reason) => reason.name).join(", ") || "não informado"}</div>
        <div><span className="text-muted-foreground">Trecho que muda: </span>{version.affectedTopic ?? "nenhum indicado (orientação nova ou complementar)"}</div>
      </div>
      {version.endedAt ? <div className="text-muted-foreground">Encerrado em {formatDateTime(version.endedAt)}{version.endReason ? ` — ${version.endReason}` : ""}</div> : null}
      <div className="whitespace-pre-wrap rounded-lg border bg-muted/40 p-3">{version.guidance}</div>
      <div><span className="text-muted-foreground">Justificativa: </span>{version.justification}</div>
      <div className="grid gap-1">
        <span className="text-muted-foreground">Processos ({version.processes.length}):</span>
        <div className="flex flex-wrap gap-1">{version.processes.map((process) => <Badge key={process.id} variant="outline">{process.title}</Badge>)}</div>
      </div>
    </div>
  )
}

/** Detalhe NA PÁGINA: versão vigente (e rascunho, se houver), monitorias a reprocessar, histórico e as ações do ciclo de vida. */
export function AlignmentDetailPanel({ id, onBack, onDiscarded, startEditing = false }: { id: string; onBack: () => void; onDiscarded: () => void; startEditing?: boolean }) {
  const detail = useAlignmentQuery(id)
  const affected = useAffectedAssessmentsQuery(detail.data?.current ? id : null)
  const discard = useDiscardAlignmentDraftMutation()
  const [editing, setEditing] = useState(startEditing)
  const [publishing, setPublishing] = useState(false)
  const [ending, setEnding] = useState(false)
  const [deleting, setDeleting] = useState(false)
  if (detail.isLoading) return <LoadingState />
  if (detail.isError || !detail.data) return <ErrorState message="Não foi possível carregar o alinhamento." onRetry={() => detail.refetch()} />
  const data = detail.data
  if (editing) return <AlignmentForm editing={data} onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} />
  const main = data.current ?? data.draft ?? data.shown

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <Button variant="ghost" size="sm" className="w-fit" onClick={onBack}><ArrowLeft className="size-4" />Voltar à lista</Button>
          <h2 className="text-lg font-semibold">{main.title}</h2>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">{main.reference}<StatusChip tone={STATE_TONE[data.state]}>{ALIGNMENT_STATE_LABELS[data.state]}</StatusChip></div>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.draft ? <Button variant="outline" onClick={() => discard.mutate(id, { onSuccess: () => (data.current ? detail.refetch() : onDiscarded()) })}>Descartar rascunho</Button> : null}
          {/* Editar sempre gera rascunho rastreável: depois de encerrado, uma nova versão volta a valer só quando publicada. */}
          <Button variant="outline" onClick={() => setEditing(true)}>{data.draft ? "Editar rascunho" : "Editar (nova versão)"}</Button>
          {data.current?.status === "PUBLISHED" && (data.state === "IN_FORCE" || data.state === "SCHEDULED") ? <Button variant="outline" onClick={() => setEnding(true)}>Encerrar</Button> : null}
          <Button variant="outline" className="text-destructive" onClick={() => setDeleting(true)}>Excluir</Button>
          {data.draft ? <Button onClick={() => setPublishing(true)}>Publicar</Button> : null}
        </div>
      </div>
      <VersionBlock version={main} />
      {data.draft && data.current ? (
        <section className="grid gap-2 rounded-xl border border-dashed p-3">
          <SectionLabel as="h3">Rascunho da versão {data.draft.version}{data.draft.changeReason ? ` — ${data.draft.changeReason}` : ""}</SectionLabel>
          <VersionBlock version={data.draft} />
        </section>
      ) : null}
      {data.current && affected.data ? (
        <p className="text-sm text-muted-foreground">
          {affected.data.items.length === 0
            ? "Nenhuma monitoria concluída da vigência ficou sem este alinhamento."
            : `${affected.data.items.length}${affected.data.truncated ? "+" : ""} monitoria(s) concluída(s) da vigência foram avaliadas sem este alinhamento (${affected.data.items.filter((item) => item.withDeviation).length} com desvio nos processos dele). O reprocessamento rastreável é feito pela equipe técnica (scripts/operational-alignments/reprocess.ts).`}
        </p>
      ) : null}
      <section className="grid gap-2">
        <SectionLabel as="h3"><History className="mr-1 inline size-4" />Histórico</SectionLabel>
        <ul className="grid gap-1.5 text-sm">
          {data.versions.map((version) => (
            <li key={version.id} className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">v{version.version}</Badge>
              <span>{ALIGNMENT_VERSION_STATUS_LABELS[version.status]}</span>
              <span className="text-muted-foreground">
                {version.responsible ? <>definida por {version.responsible.name}{version.responsible.jobTitle ? ` (${version.responsible.jobTitle})` : ""} · </> : null}
                criada por {version.createdBy ?? "—"} em {formatDateTime(version.createdAt)}
                {version.publishedAt ? ` · publicada por ${version.publishedBy ?? "—"} em ${formatDateTime(version.publishedAt)}` : ""}
                {version.changeReason ? ` · motivo: ${version.changeReason}` : ""}
                {version.endedAt ? ` · encerrada por ${version.endedBy ?? "—"}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>
      {publishing ? <PublishConfirm detail={data} onClose={() => setPublishing(false)} /> : null}
      {ending ? <EndConfirm id={id} onClose={() => setEnding(false)} /> : null}
      {deleting ? <DeleteConfirm id={id} onClose={() => setDeleting(false)} onDeleted={onDiscarded} /> : null}
    </div>
  )
}

/**
 * Confirmação de publicação. Cada alinhamento que alcança o mesmo público, algum processo em comum e o mesmo período precisa de uma
 * decisão — mesmo ponto (vale o recorte mais específico; mesmo recorte é conflito e não publica) ou pontos diferentes (os dois valem).
 */
function PublishConfirm({ detail, onClose }: { detail: AlignmentDetail; onClose: () => void }) {
  const preview = usePublicationPreviewQuery(detail.id)
  const publish = usePublishAlignmentMutation()
  const [relations, setRelations] = useState<Record<string, AlignmentRelation>>({})
  const [error, setError] = useState<string | null>(null)
  const overlaps = preview.data?.overlaps ?? []
  const ready = overlaps.every((overlap) => relations[overlap.alignmentId])
  const submit = async () => {
    setError(null)
    try {
      await publish.mutateAsync({ id: detail.id, relations: Object.entries(relations).map(([alignmentId, relation]) => ({ alignmentId, relation })) })
      onClose()
    } catch (failure) {
      setError(failure instanceof AdminApiError ? failure.message : "Não foi possível publicar.")
    }
  }
  return (
    <AlertDialog open onOpenChange={(open) => (open ? null : onClose())}>
      <AlertDialogContent className="sm:max-w-xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Publicar alinhamento</AlertDialogTitle>
          <AlertDialogDescription>Publicado, passa a valer para o público, os processos e o período escolhidos, no chat e na monitoria, e não muda mais (alterar cria nova versão). A orientação é conferida contra os assuntos proibidos antes de publicar.</AlertDialogDescription>
        </AlertDialogHeader>
        {preview.isLoading ? <LoadingState rows={1} /> : overlaps.length > 0 ? (
          <div className="grid max-h-80 gap-3 overflow-y-auto text-sm">
            <p>Estes alinhamentos alcançam o mesmo público, algum processo em comum e o mesmo período. Diga, para cada um:</p>
            {overlaps.map((overlap) => (
              <div key={overlap.alignmentId} className="grid gap-2 rounded-lg border p-3">
                <div className="font-medium">{overlap.version.title} <span className="text-muted-foreground">({overlap.version.reference} · {audienceOf(overlap.version)} · {periodOf(overlap.version)})</span></div>
                {overlap.sharedProcesses.length > 0 ? <div className="text-xs text-muted-foreground">Em comum: {overlap.sharedProcesses.map((process) => process.title).join(", ")}</div> : null}
                <RadioGroup value={relations[overlap.alignmentId] ?? ""} onValueChange={(value) => setRelations((previous) => ({ ...previous, [overlap.alignmentId]: value as AlignmentRelation }))}>
                  <div className="flex items-center gap-2"><RadioGroupItem id={`same-${overlap.alignmentId}`} value="SAME_TOPIC" /><Label htmlFor={`same-${overlap.alignmentId}`}>Mesmo ponto {overlap.sameScopeLevel ? "(mesmo recorte: conflito, não publica)" : overlap.moreSpecific === "THIS" ? "(este, mais específico, prevalece)" : "(o outro, mais específico, prevalece)"}</Label></div>
                  <div className="flex items-center gap-2"><RadioGroupItem id={`independent-${overlap.alignmentId}`} value="INDEPENDENT" /><Label htmlFor={`independent-${overlap.alignmentId}`}>Pontos diferentes (os dois valem)</Label></div>
                </RadioGroup>
              </div>
            ))}
          </div>
        ) : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button onClick={submit} disabled={!ready || publish.isPending || preview.isLoading}>Publicar</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function EndConfirm({ id, onClose }: { id: string; onClose: () => void }) {
  const end = useEndAlignmentMutation()
  const [reason, setReason] = useState("")
  return (
    <AlertDialog open onOpenChange={(open) => (open ? null : onClose())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Encerrar alinhamento</AlertDialogTitle>
          <AlertDialogDescription>A partir de agora vale o procedimento oficial. Atendimentos que já aconteceram na vigência continuam avaliados pelo alinhamento.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="alignment-end-reason">Motivo</Label>
          <Textarea id="alignment-end-reason" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex.: base oficial atualizada" />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button variant="destructive" disabled={reason.trim().length < 3 || end.isPending} onClick={() => end.mutate({ id, reason }, { onSuccess: onClose })}>Encerrar</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Exclusão lógica com motivo: deixa de valer a partir de agora; o rastro guarda quem, quando e por quê (sem tela). */
export function DeleteConfirm({ id, onClose, onDeleted }: { id: string; onClose: () => void; onDeleted: () => void }) {
  const remove = useDeleteAlignmentMutation()
  const [reason, setReason] = useState("")
  return (
    <AlertDialog open onOpenChange={(open) => (open ? null : onClose())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir alinhamento</AlertDialogTitle>
          <AlertDialogDescription>Deixa de valer a partir de agora, no chat e na monitoria, e sai da lista. Atendimentos que já aconteceram na vigência continuam avaliados por ele. Volta (encerrado) por Consultar dados › Itens excluídos.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="alignment-delete-reason">Motivo</Label>
          <Textarea id="alignment-delete-reason" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex.: cadastrado no Grupo errado" />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button variant="destructive" disabled={reason.trim().length < 3 || remove.isPending} onClick={() => remove.mutate({ id, reason }, { onSuccess: () => { onClose(); onDeleted() } })}>Excluir</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
