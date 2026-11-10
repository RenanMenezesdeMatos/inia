"use client"

import { BookOpen, Sparkles, X } from "lucide-react"
import { useId, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useInterventionCommand, useTrainingCompetenciesQuery } from "@/queries/interventions/use-intervention-queries"
import type { InterventionDetail, InterventionPlan } from "@/schemas/interventions/intervention.schema"
import { applyAiDraft, applyTrainingCompetency, requestAiDraft, updateInterventionPlan } from "@/services/interventions/intervention-service"
import { DatePicker } from "@/components/ui/date-picker"

/**
 * Conteúdo da intervenção conforme as CAPACIDADES do tipo (o código não conhece tipos de negócio): treinamento, plano de ação,
 * orientação, observação, revisão, reconhecimento, solicitação de continuidade. Editável só quando o backend diz que pode
 * (proposta ou em execução — nunca durante a aprovação).
 */
const has = (detail: InterventionDetail, key: string) => detail.type.capabilities.some((capability) => capability.key === key)

function Field({ label, value, editing, onChange, multiline = true, placeholder }: { label: string; value: string; editing: boolean; onChange: (value: string) => void; multiline?: boolean; placeholder?: string }) {
  const fieldId = useId()
  if (!editing) return value ? <div className="space-y-0.5"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="whitespace-pre-wrap text-sm">{value}</p></div> : null
  return (
    <div className="space-y-1">
      <Label htmlFor={fieldId} className="text-xs">{label}</Label>
      {multiline ? <Textarea id={fieldId} value={value} onChange={(event) => onChange(event.target.value)} rows={2} placeholder={placeholder} /> : <Input id={fieldId} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />}
    </div>
  )
}

export function InterventionPlanSection({ detail }: { detail: InterventionDetail }) {
  const canEdit = detail.availableActions.includes("EDIT")
  const [editing, setEditing] = useState(false)
  const [plan, setPlan] = useState<InterventionPlan>(detail.plan)
  const save = useInterventionCommand((next: InterventionPlan) => updateInterventionPlan(detail.id, { expectedRevision: detail.revision, plan: next }), "Plano salvo.")
  const set = (patch: Partial<InterventionPlan>) => setPlan((current) => ({ ...current, ...patch }))
  const current = editing ? plan : detail.plan
  const training = has(detail, "TRAINING")
  const actionPlan = has(detail, "ACTION_PLAN")
  const dueDateId = useId()

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{training ? "Treinamento" : actionPlan ? "Plano de ação" : "Registro da intervenção"}</p>
        {canEdit && !editing ? (
          <Button size="sm" variant="outline" onClick={() => { setPlan(detail.plan); setEditing(true) }}>
            Editar
          </Button>
        ) : null}
      </div>
      {training ? (
        <>
          <Field label="Objetivo" value={current.objective ?? ""} editing={editing} onChange={(objective) => set({ objective })} />
          <TrainingCompetency detail={detail} editing={editing} contents={current.contents ?? []} onRemoveContent={(documentId) => set({ contents: (current.contents ?? []).filter((content) => content.documentId !== documentId) })} />
          <Field label="Como a aprendizagem será avaliada" value={current.learningAssessment?.method ?? ""} editing={editing} onChange={(method) => set({ learningAssessment: { method, passCriterion: current.learningAssessment?.passCriterion ?? "" } })} />
          <Field label="Critério de aprovação na avaliação" value={current.learningAssessment?.passCriterion ?? ""} editing={editing} onChange={(passCriterion) => set({ learningAssessment: { method: current.learningAssessment?.method ?? "", passCriterion } })} multiline={false} />
        </>
      ) : null}
      {actionPlan ? (
        <>
          <Field label="Situação inicial" value={current.initialSituation ?? ""} editing={editing} onChange={(initialSituation) => set({ initialSituation })} />
          <div className="grid gap-2 sm:grid-cols-[1fr_160px]">
            <Field label="Objetivo mensurável" value={current.measurableObjective?.target ?? ""} editing={editing} multiline={false} onChange={(target) => set({ measurableObjective: { indicatorCode: current.measurableObjective?.indicatorCode ?? detail.indicatorCode, target, by: current.measurableObjective?.by ?? detail.dueAt } })} />
            {editing ? (
              <div className="space-y-1">
                <Label htmlFor={dueDateId} className="text-xs">Até</Label>
                <DatePicker id={dueDateId} value={current.measurableObjective?.by ?? detail.dueAt} onChange={(by) => set({ measurableObjective: { indicatorCode: current.measurableObjective?.indicatorCode ?? detail.indicatorCode, target: current.measurableObjective?.target ?? "", by } })} />
              </div>
            ) : current.measurableObjective ? <p className="self-end text-xs text-muted-foreground">até {current.measurableObjective.by}</p> : null}
          </div>
          <Field label="Apoio necessário" value={current.support ?? ""} editing={editing} onChange={(support) => set({ support })} />
          <Field label="Critério de encerramento" value={current.closureCriterion ?? ""} editing={editing} onChange={(closureCriterion) => set({ closureCriterion })} />
        </>
      ) : null}
      {has(detail, "GUIDANCE") ? <Field label="O que foi orientado" value={current.guidance?.summary ?? ""} editing={editing} onChange={(summary) => set({ guidance: { summary, documentIds: current.guidance?.documentIds ?? [] } })} /> : null}
      {has(detail, "OBSERVATION") ? <Field label="Foco da observação" value={current.observation?.focus ?? ""} editing={editing} onChange={(focus) => set({ observation: { focus, until: current.observation?.until ?? detail.dueAt } })} /> : null}
      {has(detail, "LEADERSHIP_REVIEW") || has(detail, "DATA_REVIEW") ? <Field label="Parecer" value={current.review?.finding ?? ""} editing={editing} onChange={(finding) => set({ review: { finding } })} /> : null}
      {has(detail, "RECOGNITION") ? <Field label="Reconhecimento feito" value={current.recognition?.message ?? ""} editing={editing} onChange={(message) => set({ recognition: { message } })} /> : null}
      {detail.sensitive ? <Field label="Justificativa da solicitação" value={current.continuityRequest?.justification ?? ""} editing={editing} onChange={(justification) => set({ continuityRequest: { justification } })} placeholder="Pelo menos 30 caracteres" /> : null}
      {editing ? (
        <div className="flex gap-2">
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate(cleanPlan(plan), { onSuccess: () => setEditing(false) })}>
            Salvar plano
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancelar edição
          </Button>
        </div>
      ) : null}
      {detail.aiDraftEnabled ? <AiDraft detail={detail} /> : null}
    </div>
  )
}

/**
 * Treinamento: indicador → diagnóstico → COMPETÊNCIA → conteúdo aprovado → atividade. A competência pode vir do diagnóstico
 * (abertura pela política) ou ser escolhida pelo líder aqui; aplicar traz só documentos PUBLICADOS e as atividades sugeridas
 * viram itens com prazo. Tudo estruturado, sem IA.
 */
function TrainingCompetency({ detail, editing, contents, onRemoveContent }: { detail: InterventionDetail; editing: boolean; contents: NonNullable<InterventionPlan["contents"]>; onRemoveContent: (documentId: string) => void }) {
  const canEdit = detail.availableActions.includes("EDIT")
  const competenciesQuery = useTrainingCompetenciesQuery(canEdit || (detail.plan.competencyKeys ?? []).length > 0)
  const [picked, setPicked] = useState<string>("")
  const apply = useInterventionCommand((competencyKey: string) => applyTrainingCompetency(detail.id, { expectedRevision: detail.revision, competencyKey }), "Competência aplicada: conteúdos e atividades incluídos.")
  const all = competenciesQuery.data ?? []
  const nameOf = (key: string) => all.find((item) => item.key === key)?.name ?? key
  const linked = detail.plan.competencyKeys ?? []
  const choice = all.find((item) => item.key === picked)
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Competência</p>
        {linked.length > 0 ? <p className="text-sm">{linked.map(nameOf).join(", ")}</p> : <p className="text-sm text-muted-foreground">Nenhuma competência ligada ainda.</p>}
        {canEdit && !editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={picked || undefined} onValueChange={setPicked}>
              <SelectTrigger className="w-72" aria-label="Escolher competência">
                <SelectValue placeholder={competenciesQuery.isPending ? "Carregando…" : "Escolher competência"} />
              </SelectTrigger>
              <SelectContent>
                {all.map((item) => (
                  <SelectItem key={item.key} value={item.key} disabled={item.contents.length === 0}>
                    {item.name}
                    {item.contents.length === 0 ? " (sem conteúdo publicado)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" disabled={!choice || apply.isPending} onClick={() => choice && apply.mutate(choice.key, { onSuccess: () => setPicked("") })}>
              Aplicar competência
            </Button>
          </div>
        ) : null}
        {choice ? <p className="text-xs text-muted-foreground">Traz {choice.contents.length} conteúdo(s) publicado(s) e {choice.activities.length} atividade(s) sugerida(s).</p> : null}
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Conteúdos aprovados da base</p>
        {contents.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum conteúdo ainda — escolha a competência para trazer os documentos publicados dela.</p> : null}
        <ul className="space-y-0.5 text-sm">
          {contents.map((content) => (
            <li key={content.documentId} className="flex items-center gap-2">
              <BookOpen className="size-3.5 shrink-0 text-muted-foreground" />
              {content.title}
              {editing ? (
                <Button type="button" size="icon-xs" variant="ghost" aria-label={`Remover ${content.title}`} onClick={() => onRemoveContent(content.documentId)}>
                  <X />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** Remove blocos vazios (o backend recusa texto obrigatório vazio dentro de um bloco preenchido pela metade). */
function cleanPlan(plan: InterventionPlan): InterventionPlan {
  const next: InterventionPlan = { ...plan }
  if (next.learningAssessment && (!next.learningAssessment.method.trim() || !next.learningAssessment.passCriterion.trim())) delete next.learningAssessment
  if (next.measurableObjective && !next.measurableObjective.target.trim()) delete next.measurableObjective
  if (next.guidance && !next.guidance.summary.trim()) delete next.guidance
  if (next.observation && !next.observation.focus.trim()) delete next.observation
  if (next.review && !next.review.finding.trim()) delete next.review
  if (next.recognition && !next.recognition.message.trim()) delete next.recognition
  if (next.continuityRequest && next.continuityRequest.justification.trim().length < 30) delete next.continuityRequest
  for (const key of ["objective", "initialSituation", "support", "closureCriterion"] as const) if (typeof next[key] === "string" && !next[key]!.trim()) delete next[key]
  return next
}

/** Rascunho da INIA: FATOS (copiados pelo sistema), FONTES (o que foi oferecido) e CONTEÚDO PROPOSTO (escrito pela IA) — separados. */
function AiDraft({ detail }: { detail: InterventionDetail }) {
  const request = useInterventionCommand(() => requestAiDraft(detail.id))
  const apply = useInterventionCommand(() => applyAiDraft(detail.id, detail.revision), "Rascunho aplicado ao plano — revise antes de enviar para aprovação.")
  const draft = detail.aiDraft
  const canDraft = detail.availableActions.includes("DRAFT_WITH_AI")
  return (
    <div className="space-y-2 rounded-md border border-dashed p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 text-primary" /> Rascunho pela INIA
        </p>
        {canDraft ? (
          <Button size="sm" variant="outline" disabled={request.isPending} onClick={() => request.mutate(undefined)}>
            {request.isPending ? "Gerando…" : draft ? "Gerar de novo" : "Pedir rascunho"}
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">A INIA propõe a partir dos fatos, do diagnóstico sustentado e dos conteúdos aprovados — cada item cita a fonte. Nada entra no plano sem você aplicar, e depois valem as aprovações do tipo.</p>
      {draft?.status === "INVESTIGATION_NEEDED" ? <p className="text-sm text-amber-700 dark:text-amber-400">{draft.message}</p> : null}
      {draft?.status === "FAILED" ? <p className="text-sm text-destructive">{draft.error}</p> : null}
      {draft && (draft.status === "PROPOSED" || draft.status === "APPLIED") ? (
        <div className="space-y-2 text-xs">
          <div>
            <p className="font-medium">Fatos (do sistema)</p>
            <ul className="text-muted-foreground">{(draft.facts ?? []).map((fact) => <li key={fact}>• {fact}</li>)}</ul>
          </div>
          <div>
            <p className="font-medium">Fontes oferecidas</p>
            <ul className="text-muted-foreground">{(draft.sources ?? []).map((source) => <li key={source.handle}><Badge variant="outline" className="mr-1 font-mono">{source.handle}</Badge>{source.label}</li>)}</ul>
          </div>
          <div>
            <p className="font-medium">Conteúdo proposto (redigido pela INIA)</p>
            <DraftProposal kind={draft.kind} proposal={draft.proposal} sources={draft.sources ?? []} />
          </div>
          {draft.status === "PROPOSED" && detail.availableActions.includes("EDIT") ? (
            <Button size="sm" disabled={apply.isPending} onClick={() => apply.mutate(undefined)}>
              Aplicar ao plano
            </Button>
          ) : draft.status === "APPLIED" ? <p className="text-muted-foreground">Aplicado ao plano.</p> : null}
        </div>
      ) : null}
    </div>
  )
}

type Source = { handle: string; label: string }
type TrainingProposal = { objective: { text: string; refs: string[] }; contents: { content: string; why: string }[]; activities: { title: string; description: string; refs: string[] }[]; learningAssessment: { method: string; passCriterion: string } }
type PlanProposal = { initialSituation: { text: string; refs: string[] }; measurableObjective: { target: string; dueInDays: number }; tasks: { title: string; description: string; owner: "COLLABORATOR" | "RESPONSIBLE"; dueInDays: number; refs: string[] }[]; support: string; checkpoints: { title: string; dueInDays: number }[]; closureCriterion: string }

const Refs = ({ refs }: { refs: string[] }) => <span className="ml-1 font-mono text-[10px] text-muted-foreground">{refs.join(" ")}</span>

function DraftProposal({ kind, proposal, sources }: { kind: "TRAINING" | "ACTION_PLAN"; proposal: unknown; sources: Source[] }) {
  const label = (handle: string) => sources.find((source) => source.handle === handle)?.label ?? handle
  if (!proposal || typeof proposal !== "object") return null
  if (kind === "TRAINING") {
    const value = proposal as TrainingProposal
    return (
      <div className="space-y-1.5 rounded bg-muted/60 p-2">
        <p><span className="font-medium">Objetivo:</span> {value.objective.text}<Refs refs={value.objective.refs} /></p>
        <p className="font-medium">Conteúdos</p>
        <ul>{value.contents.map((item) => <li key={item.content}>• {label(item.content)} — {item.why}</li>)}</ul>
        <p className="font-medium">Atividades</p>
        <ul>{value.activities.map((item) => <li key={item.title}>• {item.title}{item.description ? ` — ${item.description}` : ""}<Refs refs={item.refs} /></li>)}</ul>
        <p><span className="font-medium">Avaliação de aprendizagem:</span> {value.learningAssessment.method} · aprovação: {value.learningAssessment.passCriterion}</p>
      </div>
    )
  }
  const value = proposal as PlanProposal
  return (
    <div className="space-y-1.5 rounded bg-muted/60 p-2">
      <p><span className="font-medium">Situação inicial:</span> {value.initialSituation.text}<Refs refs={value.initialSituation.refs} /></p>
      <p><span className="font-medium">Objetivo mensurável:</span> {value.measurableObjective.target} (em {value.measurableObjective.dueInDays} dias)</p>
      <p className="font-medium">Tarefas</p>
      <ul>{value.tasks.map((task) => <li key={task.title}>• {task.title} — {task.owner === "COLLABORATOR" ? "colaborador" : "responsável"}, em {task.dueInDays} dias<Refs refs={task.refs} /></li>)}</ul>
      <p><span className="font-medium">Apoio necessário:</span> {value.support}</p>
      <p className="font-medium">Checkpoints</p>
      <ul>{value.checkpoints.map((checkpoint) => <li key={checkpoint.title}>• {checkpoint.title} — em {checkpoint.dueInDays} dias</li>)}</ul>
      <p><span className="font-medium">Critério de encerramento:</span> {value.closureCriterion}</p>
    </div>
  )
}
