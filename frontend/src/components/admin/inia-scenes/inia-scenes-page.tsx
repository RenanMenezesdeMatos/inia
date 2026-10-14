"use client"

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react"
import { CalendarClock, Clock, Copy, ImageIcon, ImagePlus, Lock, Moon, Pencil, Plus, RefreshCw, Star, Trash2 } from "lucide-react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { IniaSceneBackdrop } from "@/components/inia-scenes/inia-scene-backdrop"
import { AdminApiError } from "@/lib/admin/admin-api"
import {
  checkSlot,
  compareImagesBySlot,
  crossesMidnight,
  findSlotOverlap,
  formatClock,
  localMinuteIn,
  MINUTES_PER_DAY,
  nextImageChange,
  resolveImageAt,
  uncoveredRanges,
  type TimeSlot,
} from "@/lib/inia-scenes/scene-time-slots"
import { cn } from "@/lib/utils"
import {
  useCreateIniaSceneMutation,
  useDeleteIniaSceneMutation,
  useIniaScenesOverviewQuery,
  useSetDefaultIniaSceneMutation,
  useUpdateIniaSceneMutation,
} from "@/queries/inia-scenes/use-inia-scenes"
import { INIA_SCENE_BLUR, INIA_SCENE_DIM, INIA_SCENE_IMAGE_RULES, INIA_SCENE_IMAGES, type IniaScene, type IniaSceneImage, type IniaScenesOverview } from "@/schemas/inia-scenes/inia-scene.schema"
import { sceneImageSrc } from "@/services/inia-scenes/inia-scene-service"
import { publicAsset } from "@/lib/assets/public-asset"

/**
 * CENÁRIO DA INIA — o fundo atrás dela no palco da aplicação de feedback e no painel do Acompanhamento (call center, Natal,
 * Outubro Rosa…). Só o Administrador geral altera (o backend recusa os demais); os colaboradores só veem o que vale AGORA:
 * um cenário AGENDADO no período, senão o PADRÃO, senão o palco roxo de sempre — e, dentro do cenário, a imagem da faixa de
 * horário (dia, noite…) no fuso da organização. Quando o período acaba, volta sozinho ao padrão.
 */

const NONE = "__none__"
const formatDay = (value: string) => value.split("-").reverse().join("/")
// Sempre duas casas: o número não "pula" de largura enquanto o slider anda.
const formatBlur = (value: number) => `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} px`
const formatDim = (value: number) => (value === 0 ? "0% (sem máscara)" : `${value}%`)
/** Valor guardado: centésimos de px (a grade do backend). */
const roundBlur = (value: number) => Math.round(value * 100) / 100
const clampBlur = (value: number) => Math.min(INIA_SCENE_BLUR.max, Math.max(INIA_SCENE_BLUR.min, value))
/**
 * O ARRASTO é contínuo (passo de 0,001: o marcador acompanha o cursor pixel a pixel); o valor exibido, a prévia e o que é salvo
 * ficam em centésimos. O teclado anda pela grade do valor salvo — 0,01 px nas setas, 0,1 px com Shift ou PageUp/PageDown —,
 * porque o passo fino do arrasto exigiria milhares de toques.
 */
const BLUR_POINTER_STEP = 0.001
function blurFromKey(event: KeyboardEvent, value: number): number | null {
  const large = event.shiftKey || event.key === "PageUp" || event.key === "PageDown"
  const delta = large ? 0.1 : INIA_SCENE_BLUR.step
  switch (event.key) {
    case "ArrowRight": case "ArrowUp": case "PageUp": return clampBlur(roundBlur(roundBlur(value) + delta))
    case "ArrowLeft": case "ArrowDown": case "PageDown": return clampBlur(roundBlur(roundBlur(value) - delta))
    default: return null
  }
}
const periodLabel = (scene: Pick<IniaScene, "scheduleStart" | "scheduleEnd">) => (scene.scheduleStart && scene.scheduleEnd ? `${formatDay(scene.scheduleStart)} a ${formatDay(scene.scheduleEnd)}` : null)
const slotLabel = (image: Pick<IniaSceneImage, "start" | "end">) => (image.start && image.end ? `${image.start}–${image.end}` : null)
/** "Dia 06:00–18:00 · Noite 18:00–06:00" ou "o dia inteiro". */
function imagesSummary(scene: IniaScene) {
  if (scene.images.length === 1 && !scene.images[0]!.start) return "1 imagem, o dia inteiro"
  return scene.images.map((image) => `${image.label} ${slotLabel(image) ?? "(fora das faixas)"}`).join(" · ")
}

const STATUS_BADGE: Record<IniaScene["status"], { label: string; className: string } | null> = {
  LIVE: { label: "No ar", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  UPCOMING: { label: "Agendado", className: "bg-primary/10 text-primary dark:bg-chart-4/15 dark:text-chart-4" },
  ENDED: { label: "Período encerrado", className: "bg-muted text-muted-foreground" },
  STANDBY: null,
}

const IMAGE_PROMPT = "Fundo fotográfico realista de uma central de atendimento (call center) moderna, sem pessoas em primeiro plano, profundidade de campo rasa (fundo desfocado), luz suave e acolhedora, tons neutros com detalhes em roxo. Lado esquerdo com espaço livre e profundidade; lado direito calmo, sem textos nem logotipos. Formato 16:9, 1920×1080."

/** Hora local da organização, atualizada a cada 15 s (o editor mostra o que está no ar e a próxima troca ao vivo). */
function useOrganizationMinute(timeZone: string): number {
  const [minute, setMinute] = useState(() => localMinuteIn(timeZone))
  useEffect(() => {
    const timer = window.setInterval(() => setMinute(localMinuteIn(timeZone)), 15_000)
    return () => window.clearInterval(timer)
  }, [timeZone])
  return minute
}

/**
 * Prévia do palco: o mesmo fundo que o colaborador verá, com a INIA à esquerda e o card do feedback à direita. É uma MINIATURA
 * do palco de 1440 px: o desfoque encolhe na mesma proporção; o escurecimento é o mesmo.
 */
function StagePreview({ imageUrl, blur, dim, className }: { imageUrl: string | null; blur: number; dim: number; className?: string }) {
  return (
    <div className={cn("relative aspect-video overflow-hidden rounded-xl bg-[#0b0613]", className)} data-testid="inia-scene-preview">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_24%_48%,rgba(150,70,210,0.42),transparent_52%)]" />
      {imageUrl ? <IniaSceneBackdrop imageUrl={imageUrl} blur={blur} dim={dim} variant="stage" miniature /> : null}
      {/* A INIA no lugar dela (meio corpo, à esquerda) e os cards à direita, em escala — sempre ACIMA da máscara. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- ilustração local estática da prévia */}
      <img src={publicAsset("/INIA.png")} alt="" aria-hidden className="absolute bottom-0 left-[6%] w-[30%] object-contain object-bottom" />
      <div aria-hidden className="absolute top-[9%] right-[4%] bottom-[6%] flex w-[52%] flex-col gap-[3%]">
        <div className="flex-[1.1] rounded-md bg-background/95 p-[3%] shadow-lg">
          <div className="h-[9%] w-1/3 rounded-full bg-primary/40" />
          <div className="mt-[5%] h-[7%] w-11/12 rounded-full bg-muted-foreground/25" />
          <div className="mt-[3%] h-[7%] w-10/12 rounded-full bg-muted-foreground/25" />
          <div className="mt-[3%] h-[7%] w-9/12 rounded-full bg-muted-foreground/25" />
        </div>
        <div className="flex-1 rounded-md bg-background/95 shadow-lg" />
      </div>
    </div>
  )
}

type ImageCheck = { ok: true; width: number; height: number } | { ok: false; message: string }
/** Antecipa as regras do backend (que valida de novo pelo conteúdo): formato, tamanho, paisagem e dimensões mínimas. */
function checkImage(file: File, url: string): Promise<ImageCheck> {
  if (!INIA_SCENE_IMAGE_RULES.accept.split(",").includes(file.type)) return Promise.resolve({ ok: false, message: "Formato não suportado. Envie JPG, PNG ou WebP." })
  if (file.size > INIA_SCENE_IMAGE_RULES.maxBytes) return Promise.resolve({ ok: false, message: "A imagem é grande demais (máximo de 8 MB)." })
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      const { naturalWidth: width, naturalHeight: height } = image
      if (width <= height) resolve({ ok: false, message: "Use uma imagem horizontal (paisagem), como 1920×1080." })
      else if (width < INIA_SCENE_IMAGE_RULES.minWidth || height < INIA_SCENE_IMAGE_RULES.minHeight) resolve({ ok: false, message: `A imagem tem ${width}×${height}: use pelo menos 1280×640 (recomendado 1920×1080).` })
      else resolve({ ok: true, width, height })
    }
    image.onerror = () => resolve({ ok: false, message: "Não foi possível ler a imagem escolhida." })
    image.src = url
  })
}

/** Uma imagem no editor: existente (`id`) ou nova; `file` = arquivo novo (substitui a existente ou cria). */
type ImageRow = { key: string; id?: string; label: string; start: string; end: string; primary: boolean; file?: File; url: string; local: boolean }
type FormState = { name: string; scheduled: boolean; start: string; end: string; blur: number; dim: number }
type FieldErrors = Partial<Record<"name" | "period" | "images", string>>
const FIELD_OF_CODE: Record<string, keyof FieldErrors> = {
  INIA_SCENE_NAME_TAKEN: "name",
  INIA_SCENE_NAME_INVALID: "name",
  INIA_SCENE_PERIOD_OVERLAP: "period",
  SCENE_PERIOD_INCOMPLETE: "period",
  SCENE_PERIOD_INVALID: "period",
  SCENE_PERIOD_INVERTED: "period",
}

const slotOfRow = (row: ImageRow): TimeSlot | null => {
  const check = checkSlot(row.start, row.end)
  return check.ok ? check.slot : null
}
/** Em ordem de horário (faixas pelo início; sem faixa por último), como o colaborador vê o dia. */
const sortRows = (rows: ImageRow[]) => [...rows].sort((a, b) => compareImagesBySlot({ id: a.key, isPrimary: a.primary, slot: slotOfRow(a) }, { id: b.key, isPrimary: b.primary, slot: slotOfRow(b) }))
const normalizeLabel = (value: string) => value.replace(/\s+/g, " ").trim()

/** Problemas do conjunto de imagens que dá para ver antes de salvar (as mesmas regras do backend). */
function imagesProblem(rows: ImageRow[]): { message: string; keys: string[] } | null {
  for (const row of rows) {
    const label = normalizeLabel(row.label)
    if (!label || label.length > INIA_SCENE_IMAGES.labelMax) return { message: `Identifique cada imagem com até ${INIA_SCENE_IMAGES.labelMax} caracteres (ex.: Dia, Noite).`, keys: [row.key] }
    const check = checkSlot(row.start, row.end)
    if (!check.ok) return { message: `Imagem "${label}": ${check.message.charAt(0).toLowerCase()}${check.message.slice(1)}`, keys: [row.key] }
  }
  const seen = new Map<string, string>()
  for (const row of rows) {
    const folded = normalizeLabel(row.label).toLocaleLowerCase("pt-BR")
    if (seen.has(folded)) return { message: `Duas imagens estão identificadas como "${normalizeLabel(row.label)}". Use nomes diferentes.`, keys: [seen.get(folded)!, row.key] }
    seen.set(folded, row.key)
  }
  const overlap = findSlotOverlap(rows.map((row) => ({ key: row, slot: slotOfRow(row) })))
  if (overlap) return { message: `Os horários de "${normalizeLabel(overlap.a.label)}" e "${normalizeLabel(overlap.b.label)}" se sobrepõem das ${formatClock(overlap.overlap.start)} às ${formatClock(overlap.overlap.end)}. Ajuste as faixas para não coincidirem.`, keys: [overlap.a.key, overlap.b.key] }
  return null
}

/** O dia de 24 h em uma barra: cada faixa com a sua identificação, os trechos sem faixa (principal) e o marcador de agora. */
function DayTimeline({ rows, minuteNow }: { rows: ImageRow[]; minuteNow: number }) {
  const slotted = rows.flatMap((row) => { const slot = slotOfRow(row); return slot ? [{ row, slot }] : [] })
  const pieces = slotted.flatMap(({ row, slot }) => (crossesMidnight(slot) ? [{ row, from: slot.start, to: MINUTES_PER_DAY }, { row, from: 0, to: slot.end }] : [{ row, from: slot.start, to: slot.end }]).filter((piece) => piece.to > piece.from))
  const percent = (minute: number) => `${(minute / MINUTES_PER_DAY) * 100}%`
  return (
    <div className="space-y-1" aria-hidden data-testid="inia-scene-timeline">
      <div className="relative h-7 overflow-hidden rounded-md bg-muted">
        {pieces.map((piece, index) => (
          <div key={`${piece.row.key}-${index}`} className={cn("absolute inset-y-0 flex items-center overflow-hidden border-x border-background/60 px-1.5 text-[11px] font-medium text-white", piece.row.primary ? "bg-primary" : "bg-primary/70")} style={{ left: percent(piece.from), width: percent(piece.to - piece.from) }}>
            <span className="truncate">{normalizeLabel(piece.row.label)}</span>
          </div>
        ))}
        <div className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: percent(minuteNow) }} />
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
    </div>
  )
}

function SceneFormDialog({ open, scene, timeZone, onOpenChange }: { open: boolean; scene: IniaScene | null; timeZone: string; onOpenChange(open: boolean): void }) {
  const editing = scene !== null
  const [form, setForm] = useState<FormState>(() => ({ name: scene?.name ?? "", scheduled: Boolean(scene?.scheduleStart), start: scene?.scheduleStart ?? "", end: scene?.scheduleEnd ?? "", blur: scene?.blur ?? INIA_SCENE_BLUR.default, dim: scene?.dim ?? INIA_SCENE_DIM.default }))
  const [rows, setRows] = useState<ImageRow[]>(() => (scene ? scene.images.map((image) => ({ key: image.id, id: image.id, label: image.label, start: image.start ?? "", end: image.end ?? "", primary: image.isPrimary, url: image.imageUrl, local: false })) : []))
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  // `form.blur` é a posição do marcador (contínua); `blur` é o valor de verdade (centésimos): prévia, rótulo e o que é salvo.
  const blur = roundBlur(form.blur)
  const blurLabel = blur === 0 ? "Nítido" : formatBlur(blur)
  const dimLabel = formatDim(form.dim)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [errorKeys, setErrorKeys] = useState<string[]>([])
  const [imageError, setImageError] = useState<string | null>(null)
  const blobsRef = useRef(new Set<string>())
  const addInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const replacingKeyRef = useRef<string | null>(null)
  const keySeq = useRef(0)
  const create = useCreateIniaSceneMutation()
  const update = useUpdateIniaSceneMutation()
  const pending = create.isPending || update.isPending
  const minuteNow = useOrganizationMinute(timeZone)

  // As prévias locais (blob:) são liberadas ao fechar.
  useEffect(() => {
    const blobs = blobsRef.current
    return () => {
      for (const url of blobs) URL.revokeObjectURL(url)
    }
  }, [])

  const slotted = rows.map((row) => ({ id: row.key, isPrimary: row.primary, slot: slotOfRow(row) }))
  const onAir = resolveImageAt(slotted, minuteNow)
  const upcoming = nextImageChange(slotted, minuteNow)
  const rowOf = (key: string | undefined) => rows.find((row) => row.key === key)
  const previewRow = rowOf(previewKey ?? undefined) ?? rowOf(onAir?.image.id)
  const gaps = uncoveredRanges(slotted.flatMap((image) => (image.slot ? [image.slot] : [])))
  const primaryRow = rows.find((row) => row.primary)
  const liveProblem = useMemo(() => imagesProblem(rows), [rows])
  const highlighted = new Set([...(liveProblem?.keys ?? []), ...errorKeys])

  async function readFile(event: ChangeEvent<HTMLInputElement>): Promise<{ file: File; url: string } | null> {
    const chosen = event.target.files?.[0]
    event.target.value = ""
    if (!chosen) return null
    const url = URL.createObjectURL(chosen)
    const check = await checkImage(chosen, url)
    if (!check.ok) {
      URL.revokeObjectURL(url)
      setImageError(check.message)
      return null
    }
    blobsRef.current.add(url)
    setImageError(null)
    return { file: chosen, url }
  }

  async function addImage(event: ChangeEvent<HTMLInputElement>) {
    const read = await readFile(event)
    if (!read) return
    keySeq.current += 1
    const key = `new-${keySeq.current}`
    setRows((current) => [...current, { key, label: `Imagem ${current.length + 1}`, start: "", end: "", primary: current.length === 0, file: read.file, url: read.url, local: true }])
    setPreviewKey(key)
    clearImageErrors()
  }

  async function replaceImage(event: ChangeEvent<HTMLInputElement>) {
    const key = replacingKeyRef.current
    const read = await readFile(event)
    if (!read || !key) return
    setRows((current) => current.map((row) => (row.key === key ? { ...row, file: read.file, url: read.url, local: true } : row)))
    setPreviewKey(key)
    clearImageErrors()
  }

  function removeImage(key: string) {
    setRows((current) => {
      const next = current.filter((row) => row.key !== key)
      // Sem a principal, a primeira que sobrar assume (sempre existe exatamente uma).
      if (next.length > 0 && !next.some((row) => row.primary)) next[0] = { ...next[0]!, primary: true }
      return next
    })
    if (previewKey === key) setPreviewKey(null)
    clearImageErrors()
  }

  /** Mexer nas imagens limpa o erro do último envio (o problema de agora, se houver, aparece ao vivo). */
  const clearImageErrors = () => {
    setErrors((current) => (current.images ? { ...current, images: undefined } : current))
    setErrorKeys([])
  }
  const updateRow = (key: string, patch: Partial<ImageRow>) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
    clearImageErrors()
  }
  const choosePrimary = (key: string) => {
    setRows((current) => current.map((row) => ({ ...row, primary: row.key === key })))
    clearImageErrors()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const next: FieldErrors = {}
    if (!form.name.trim()) next.name = "Dê um nome ao cenário (ex.: Natal 2026)."
    if (form.scheduled && (!form.start || !form.end)) next.period = "Informe o início e o fim do período."
    else if (form.scheduled && form.end < form.start) next.period = "O fim do período precisa ser no mesmo dia ou depois do início."
    if (rows.length === 0) next.images = "Adicione pelo menos uma imagem."
    else if (liveProblem) next.images = liveProblem.message
    setErrors(next)
    if (Object.keys(next).length > 0) return
    const period = form.scheduled ? { start: form.start, end: form.end } : null
    const images = sortRows(rows).map((row) => ({ id: row.id, label: normalizeLabel(row.label), start: row.start || null, end: row.end || null, primary: row.primary, file: row.file }))
    try {
      if (scene) await update.mutateAsync({ id: scene.id, name: form.name.trim(), period, blur, dim: form.dim, images })
      else await create.mutateAsync({ name: form.name.trim(), period, blur, dim: form.dim, images })
      onOpenChange(false)
    } catch (error) {
      if (!(error instanceof AdminApiError) || !error.code) return
      // Nome e período no campo deles; o resto (imagens, faixas, principal) na seção de imagens.
      const field = FIELD_OF_CODE[error.code] ?? "images"
      setErrors({ [field]: error.message })
      // O backend aponta a imagem pela posição no conjunto enviado (a mesma ordem de `images` acima).
      const details = (error.details ?? {}) as { imageIndex?: number; imageIndexes?: number[] }
      const sent = sortRows(rows)
      const indexes = details.imageIndexes ?? (details.imageIndex !== undefined ? [details.imageIndex] : [])
      setErrorKeys(indexes.flatMap((index) => (sent[index] ? [sent[index].key] : [])))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <form onSubmit={submit} className="space-y-5" noValidate>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar cenário" : "Novo cenário"}</DialogTitle>
            <DialogDescription>O fundo atrás da INIA no palco da aplicação de feedback e no painel do Acompanhamento.</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <StagePreview imageUrl={previewRow?.url ?? null} blur={blur} dim={form.dim} />
            <p className="text-xs text-muted-foreground" data-testid="inia-scene-preview-caption">
              {previewRow ? (previewKey && previewRow.key !== onAir?.image.id ? <>Prévia: <strong className="font-medium text-foreground">{normalizeLabel(previewRow.label)}</strong>. <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => setPreviewKey(null)}>Ver a imagem de agora</button></> : <>Prévia da imagem no ar agora ({formatClock(minuteNow)}): <strong className="font-medium text-foreground">{normalizeLabel(previewRow.label)}</strong></>) : "Adicione uma imagem para ver a prévia."}
            </p>
          </div>

          {/* Imagens e horários: várias imagens, cada uma na sua faixa diária (fuso da organização). */}
          <section className="space-y-3 rounded-lg border p-3" aria-labelledby="inia-scene-images-title">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p id="inia-scene-images-title" className="text-sm font-medium">Imagens e horários</p>
                <p className="text-xs text-muted-foreground">Cada imagem aparece todos os dias do período na sua faixa, no horário de {timeZone.split("/").pop()?.replace(/_/g, " ")} ({timeZone}). O início conta e o fim não: às 18:00 já entra a faixa que começa às 18:00. Uma faixa como 18:00–06:00 atravessa a meia-noite.</p>
              </div>
              <input ref={addInputRef} type="file" accept={INIA_SCENE_IMAGE_RULES.accept} className="sr-only" onChange={addImage} aria-label="Adicionar imagem ao cenário" data-testid="inia-scene-file" />
              <input ref={replaceInputRef} type="file" accept={INIA_SCENE_IMAGE_RULES.accept} className="sr-only" onChange={replaceImage} aria-label="Substituir imagem" data-testid="inia-scene-replace-file" />
              <Button type="button" variant="outline" size="sm" onClick={() => addInputRef.current?.click()} disabled={rows.length >= INIA_SCENE_IMAGES.max}>
                <ImagePlus aria-hidden />Adicionar imagem
              </Button>
            </div>

            {rows.length > 0 ? (
              <>
                <DayTimeline rows={rows} minuteNow={minuteNow} />
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-testid="inia-scene-slot-status">
                  <span className="inline-flex items-center gap-1.5"><Clock className="size-4 text-muted-foreground" aria-hidden />Agora ({formatClock(minuteNow)}): <strong className="font-medium">{onAir ? normalizeLabel(rowOf(onAir.image.id)!.label) : "—"}</strong></span>
                  <span className="text-muted-foreground">{upcoming ? `Próxima troca: ${upcoming.nextDay ? "amanhã " : ""}às ${formatClock(upcoming.minute)} → ${normalizeLabel(rowOf(upcoming.image.id)!.label)}` : "Uma imagem o dia inteiro (sem trocas)."}</span>
                </p>
                {gaps.length > 0 && primaryRow ? <p className="text-xs text-muted-foreground" data-testid="inia-scene-gaps">Sem faixa {gaps.map((gap) => `das ${formatClock(gap.start)} às ${formatClock(gap.end)}`).join(", ")}: vale a imagem principal ({normalizeLabel(primaryRow.label)}).</p> : null}
              </>
            ) : null}

            {rows.length === 0 ? (
              <div className="flex flex-col items-center rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                <ImageIcon className="size-6" aria-hidden />
                <p className="mt-2">Adicione a imagem do cenário. Depois, se quiser, outras para horários diferentes (ex.: dia e noite).</p>
              </div>
            ) : (
              // Em ordem de horário; enquanto a pessoa edita dentro da lista nada muda de lugar (o foco não pula) — a lista se
              // reordena quando o foco sai dela.
              <ul className="space-y-2" aria-label="Imagens do cenário" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setRows((current) => sortRows(current)) }}>
                {rows.map((row) => {
                  const slot = slotOfRow(row)
                  const live = onAir?.image.id === row.key
                  return (
                    <li key={row.key} className={cn("grid gap-3 rounded-lg border p-2.5 sm:grid-cols-[8.5rem_minmax(0,1fr)]", highlighted.has(row.key) && "border-destructive", previewRow?.key === row.key && "ring-2 ring-primary/40")} data-testid="inia-scene-image-row">
                      <button type="button" className="relative aspect-video overflow-hidden rounded-md bg-muted bg-cover bg-center text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" style={{ backgroundImage: `url("${sceneImageSrc(row.url)}")` }} onClick={() => setPreviewKey(row.key)} aria-label={`Ver ${normalizeLabel(row.label) || "imagem"} na prévia`}>
                        <span className="absolute top-1 left-1 flex flex-wrap gap-1">
                          {live ? <Badge className="bg-emerald-100 px-1.5 text-[10px] text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">No ar agora</Badge> : null}
                        </span>
                      </button>
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem]">
                        <div className="space-y-1">
                          <Label htmlFor={`inia-scene-image-label-${row.key}`} className="text-xs">Identificação</Label>
                          <Input id={`inia-scene-image-label-${row.key}`} value={row.label} maxLength={INIA_SCENE_IMAGES.labelMax} placeholder="Ex.: Dia, Noite" onChange={(event) => updateRow(row.key, { label: event.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`inia-scene-image-start-${row.key}`} className="text-xs">Início</Label>
                          <Input id={`inia-scene-image-start-${row.key}`} type="time" step={60} value={row.start} onChange={(event) => updateRow(row.key, { start: event.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`inia-scene-image-end-${row.key}`} className="text-xs">Fim</Label>
                          <Input id={`inia-scene-image-end-${row.key}`} type="time" step={60} value={row.end} onChange={(event) => updateRow(row.key, { end: event.target.value })} />
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
                          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs">
                            <input type="radio" name="inia-scene-primary" className="accent-primary" checked={row.primary} onChange={() => choosePrimary(row.key)} />
                            Principal
                          </label>
                          <span className="text-xs text-muted-foreground">
                            {slot ? (crossesMidnight(slot) ? `Das ${row.start} às ${row.end} do dia seguinte` : `Das ${row.start} às ${row.end}`) : row.primary ? "Sem faixa: vale nos horários sem faixa" : "Sem faixa: só aparece se virar a principal"}
                          </span>
                          <span className="ml-auto flex gap-1">
                            <Button type="button" size="xs" variant="ghost" onClick={() => { replacingKeyRef.current = row.key; replaceInputRef.current?.click() }}><RefreshCw aria-hidden />Substituir</Button>
                            <Button type="button" size="xs" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => removeImage(row.key)} disabled={rows.length === 1} aria-label={`Remover ${normalizeLabel(row.label) || "imagem"}`}><Trash2 aria-hidden />Remover</Button>
                          </span>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            {imageError ? <p className="text-sm text-destructive" role="alert">{imageError}</p> : null}
            {errors.images ? <p className="text-sm text-destructive" role="alert" data-testid="inia-scene-images-error">{errors.images}</p> : liveProblem && rows.length > 0 ? <p className="text-sm text-destructive" role="alert" data-testid="inia-scene-images-error">{liveProblem.message}</p> : null}
            <p className="text-xs text-muted-foreground">JPG, PNG ou WebP, horizontal, até 8 MB cada — recomendado 1920×1080. Até {INIA_SCENE_IMAGES.max} imagens.</p>
          </section>

          {/* Desfoque ao vivo: a prévia acima muda enquanto arrasta (nada é salvo até "Salvar"). */}
          <div className="space-y-2.5 rounded-lg border p-3">
            <div className="flex items-baseline justify-between gap-3">
              <Label id="inia-scene-blur-label">Desfoque do fundo</Label>
              <span className="text-sm font-medium tabular-nums" data-testid="inia-scene-blur-value">{blurLabel}</span>
            </div>
            <Slider
              aria-labelledby="inia-scene-blur-label"
              getAriaValueText={() => blurLabel}
              min={INIA_SCENE_BLUR.min}
              max={INIA_SCENE_BLUR.max}
              step={BLUR_POINTER_STEP}
              value={[form.blur]}
              onValueChange={([value]) => setForm((current) => ({ ...current, blur: value ?? current.blur }))}
              onKeyDown={(event) => {
                const next = blurFromKey(event, form.blur)
                if (next === null) return
                // Impede o passo de 0,001 do próprio slider (Home/End continuam com ele).
                event.preventDefault()
                setForm((current) => ({ ...current, blur: next }))
              }}
            />
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>Nítido</span>
              <button type="button" className="rounded underline-offset-2 hover:text-foreground hover:underline disabled:no-underline disabled:opacity-60" disabled={blur === INIA_SCENE_BLUR.default} onClick={() => setForm((current) => ({ ...current, blur: INIA_SCENE_BLUR.default }))}>
                Recomendado: {formatBlur(INIA_SCENE_BLUR.default)}
              </button>
              <span>Mais desfocado</span>
            </div>
            <p className="text-xs text-muted-foreground">Como o foco de uma câmera: a INIA fica nítida e o cenário, levemente fora de foco. Fotos que já vêm desfocadas pedem pouco ou nenhum.</p>
          </div>

          {/* Escurecimento ao vivo: máscara preta só sobre a imagem de fundo (a INIA, os textos e os cards ficam por cima). */}
          <div className="space-y-2.5 rounded-lg border p-3">
            <div className="flex items-baseline justify-between gap-3">
              <Label id="inia-scene-dim-label">Escurecimento do fundo</Label>
              <span className="text-sm font-medium tabular-nums" data-testid="inia-scene-dim-value">{dimLabel}</span>
            </div>
            <Slider
              aria-labelledby="inia-scene-dim-label"
              getAriaValueText={() => dimLabel}
              min={INIA_SCENE_DIM.min}
              max={INIA_SCENE_DIM.max}
              step={INIA_SCENE_DIM.step}
              value={[form.dim]}
              onValueChange={([value]) => setForm((current) => ({ ...current, dim: Math.round(value ?? current.dim) }))}
            />
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>0% · sem máscara</span>
              <button type="button" className="rounded underline-offset-2 hover:text-foreground hover:underline disabled:no-underline disabled:opacity-60" disabled={form.dim === INIA_SCENE_DIM.default} onClick={() => setForm((current) => ({ ...current, dim: INIA_SCENE_DIM.default }))}>
                Sem escurecimento (0%)
              </button>
              <span>100% · preto</span>
            </div>
            <p className="text-xs text-muted-foreground">Escurece só a imagem de fundo, sem mexer no desfoque. Útil quando a foto é clara demais para o texto branco do palco; o escurecimento leve que o palco já faz atrás dos cards não soma com este.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="inia-scene-name">Nome</Label>
            <Input id="inia-scene-name" value={form.name} maxLength={80} placeholder="Ex.: Call center, Natal 2026, Outubro Rosa" onChange={(event) => setForm({ ...form, name: event.target.value })} aria-invalid={Boolean(errors.name)} />
            {errors.name ? <p className="text-sm text-destructive" role="alert">{errors.name}</p> : null}
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Label htmlFor="inia-scene-scheduled">Agendar período</Label>
                <p className="text-xs text-muted-foreground">No período (datas inclusivas), este cenário substitui o padrão. Quando acaba, o padrão volta sozinho à meia-noite — uma faixa noturna não estende o último dia.</p>
              </div>
              <Switch id="inia-scene-scheduled" checked={form.scheduled} onCheckedChange={(checked) => setForm({ ...form, scheduled: checked })} />
            </div>
            {form.scheduled ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="inia-scene-start">Início</Label>
                  <Input id="inia-scene-start" type="date" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inia-scene-end">Fim</Label>
                  <Input id="inia-scene-end" type="date" value={form.end} min={form.start || undefined} onChange={(event) => setForm({ ...form, end: event.target.value })} />
                </div>
              </div>
            ) : null}
            {errors.period ? <p className="text-sm text-destructive" role="alert">{errors.period}</p> : null}
          </div>

          {/* Fixo embaixo: com a prévia grande, salvar fica sempre à vista. */}
          <DialogFooter className="sticky -bottom-4 z-10 bg-popover">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button>
            <Button type="submit" disabled={pending}>{pending ? "Salvando…" : editing ? "Salvar alterações" : "Criar cenário"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ImageGuide() {
  return (
    <Collapsible className="rounded-xl border bg-card">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-muted/40">
        <ImageIcon className="size-4 text-primary" aria-hidden />Como preparar a imagem
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 border-t px-4 py-3 text-sm text-muted-foreground">
        <ul className="list-disc space-y-1 pl-5">
          <li>Horizontal, de preferência <strong className="font-medium text-foreground">1920×1080</strong> (mínimo 1280×640), JPG, PNG ou WebP até 8 MB.</li>
          <li>A INIA fica no <strong className="font-medium text-foreground">lado esquerdo</strong>: deixe ali profundidade, sem rosto nem objeto que dispute com ela.</li>
          <li>O <strong className="font-medium text-foreground">lado direito</strong> fica atrás do feedback e da conversa: quanto mais calmo, melhor.</li>
          <li>Sem textos, marcas de terceiros ou pessoas reconhecíveis. Use o desfoque e o escurecimento do cenário para manter a leitura.</li>
          <li>Para o dia e a noite, use a <strong className="font-medium text-foreground">mesma cena com a luz trocada</strong> (céu claro × janelas escuras): a troca de horário fica natural.</li>
          <li>Para datas especiais (Natal, Outubro Rosa, Páscoa, Carnaval), use a mesma central com a decoração do tema — o operador reconhece o ambiente.</li>
        </ul>
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="text-xs font-medium text-foreground">Sugestão de texto para um gerador de imagens</p>
          <p className="mt-1 text-xs leading-5">{IMAGE_PROMPT}</p>
          <Button type="button" variant="ghost" size="xs" className="mt-2" onClick={() => void navigator.clipboard?.writeText(IMAGE_PROMPT).then(() => toast.success("Texto copiado."))}>
            <Copy aria-hidden />Copiar texto
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** "hoje às 18:00", "amanhã à 00:00", "em 01/12 à 00:00" — sempre no horário da organização. */
function whenLabel(date: string, time: string, today: string) {
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
  const at = time === "00:00" ? "à 00:00" : `às ${time}`
  if (date === today) return `hoje ${at}`
  if (date === tomorrow) return `amanhã ${at}`
  return `em ${formatDay(date)} ${at}`
}

function CurrentSceneCard({ overview }: { overview: IniaScenesOverview }) {
  const sceneById = (id: string | null | undefined) => (id ? overview.scenes.find((scene) => scene.id === id) ?? null : null)
  const current = sceneById(overview.current?.sceneId)
  const currentImage = current?.images.find((image) => image.id === overview.current?.imageId) ?? null
  const upcoming = overview.scenes.find((scene) => scene.status === "UPCOMING")
  const nextChange = overview.nextChange
  const nextScene = sceneById(nextChange?.sceneId)
  const nextImage = nextScene?.images.find((image) => image.id === nextChange?.imageId)
  return (
    <section aria-labelledby="inia-scene-current" className="grid gap-4 rounded-xl border bg-card p-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <StagePreview imageUrl={currentImage?.imageUrl ?? null} blur={current?.blur ?? INIA_SCENE_BLUR.default} dim={current?.dim ?? 0} />
      <div className="flex flex-col justify-center gap-2">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase" id="inia-scene-current">No ar agora · {overview.localTime} ({overview.timeZone})</p>
        <p className="text-lg font-semibold" data-testid="inia-scene-current-name">{current ? current.name : "Palco padrão da INIA"}</p>
        {current && currentImage && current.images.length > 1 ? <p className="text-sm" data-testid="inia-scene-current-image">Imagem: <strong className="font-medium">{currentImage.label}</strong>{slotLabel(currentImage) ? ` · ${slotLabel(currentImage)}` : " · fora das faixas (principal)"}</p> : null}
        <p className="text-sm text-muted-foreground">
          {current
            ? overview.current!.reason === "SCHEDULED"
              ? `Agendado até ${formatDay(current.scheduleEnd!)}. Depois volta ao cenário padrão.`
              : "Cenário padrão — vale fora dos períodos agendados."
            : "Sem cenário: os colaboradores veem o fundo roxo de sempre."}
        </p>
        {nextChange ? (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="inia-scene-next-change">
            <Moon className="size-4 shrink-0" aria-hidden />Próxima troca: {whenLabel(nextChange.date, nextChange.time, overview.today)} → {nextScene ? (nextScene.id === current?.id ? nextImage?.label : `${nextScene.name}${nextImage && nextScene.images.length > 1 ? ` · ${nextImage.label}` : ""}`) : "palco padrão"}
          </p>
        ) : null}
        {upcoming ? <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><CalendarClock className="size-4 shrink-0" aria-hidden />Próximo: {upcoming.name}, a partir de {formatDay(upcoming.scheduleStart!)}</p> : null}
      </div>
    </section>
  )
}

/** Miniatura do cenário com a imagem que vale no horário de agora. */
function SceneThumb({ scene, className }: { scene: IniaScene; className?: string }) {
  const active = scene.images.find((image) => image.id === scene.activeImageId) ?? scene.images[0]
  return <div className={cn("relative aspect-video bg-muted bg-cover bg-center", className)} style={{ backgroundImage: `url("${sceneImageSrc(active?.imageUrl ?? scene.imageUrl)}")` }} role="img" aria-label={`Imagem do cenário ${scene.name}${active && scene.images.length > 1 ? ` (${active.label})` : ""}`} />
}

function SceneDetails({ scene }: { scene: IniaScene }) {
  const next = scene.nextImageChange ? scene.images.find((image) => image.id === scene.nextImageChange!.imageId) : null
  return (
    <>
      <p className="text-xs text-muted-foreground" data-testid="inia-scene-images-summary">{imagesSummary(scene)}</p>
      {next && scene.status === "LIVE" ? <p className="text-xs text-muted-foreground">Troca {scene.nextImageChange!.nextDay ? "amanhã " : ""}às {scene.nextImageChange!.time} → {next.label}</p> : null}
      <p className="text-xs text-muted-foreground">Desfoque: {scene.blur === 0 ? "nítido" : formatBlur(scene.blur)} · Escurecimento: {scene.dim}%</p>
    </>
  )
}

export function IniaScenesPage() {
  const query = useIniaScenesOverviewQuery()
  const setDefault = useSetDefaultIniaSceneMutation()
  const remove = useDeleteIniaSceneMutation()
  const [editor, setEditor] = useState<{ scene: IniaScene | null; key: number } | null>(null)
  const [deleting, setDeleting] = useState<IniaScene | null>(null)
  const forbidden = query.error instanceof AdminApiError && query.error.code === "FORBIDDEN"

  const header = (
    <div className="flex flex-wrap items-start gap-3">
      <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><ImageIcon className="size-5" /></span>
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-semibold tracking-tight">Cenário da INIA</h1>
        <p className="text-sm text-muted-foreground">O fundo atrás da INIA para os colaboradores — um padrão e, se quiser, cenários de datas especiais com período. Cada cenário pode ter imagens por horário (ex.: dia e noite). Só o Administrador geral altera.</p>
      </div>
      {query.data ? <Button onClick={() => setEditor({ scene: null, key: Date.now() })}><Plus aria-hidden />Novo cenário</Button> : null}
    </div>
  )

  if (forbidden) {
    return <div className="space-y-5">{header}<div className="flex flex-col items-center rounded-xl border p-8 text-center" role="alert"><Lock className="size-8 text-muted-foreground/60" aria-hidden /><p className="mt-3 font-medium">Só o Administrador geral altera o cenário da INIA</p></div></div>
  }
  if (query.isPending) return <div className="space-y-5">{header}<Skeleton className="h-64 w-full rounded-xl" /><Skeleton className="h-40 w-full rounded-xl" /></div>
  if (query.isError) return <div className="space-y-5">{header}<p className="text-sm text-destructive" role="alert">Não foi possível carregar os cenários.</p></div>

  const overview = query.data
  const defaultScene = overview.scenes.find((scene) => scene.isDefault) ?? null
  // Ordem do backend (cronológica pela data de início; sem período depois) — a tela não reordena. O padrão sem período tem
  // destaque próprio e não se repete na lista.
  const scheduled = overview.scenes.filter((scene) => scene.scheduleStart)
  const unscheduled = overview.scenes.filter((scene) => !scene.scheduleStart && !scene.isDefault)

  const card = (scene: IniaScene) => {
    const badge = STATUS_BADGE[scene.status]
    const period = periodLabel(scene)
    return (
      <li key={scene.id} className="overflow-hidden rounded-xl border bg-card" data-testid="inia-scene-card">
        <div className="relative">
          <SceneThumb scene={scene} />
          <div className="absolute top-2 left-2 flex flex-wrap gap-1.5">
            {badge ? <Badge className={badge.className}>{badge.label}</Badge> : null}
            {scene.isDefault ? <Badge className="bg-background/90 text-foreground"><Star className="fill-current" aria-hidden />Padrão</Badge> : null}
          </div>
        </div>
        <div className="space-y-3 p-3">
          <div>
            <p className="truncate font-medium">{scene.name}</p>
            <p className="text-xs text-muted-foreground">{period ? `Período: ${period}` : scene.isDefault ? "Fora dos períodos agendados" : "Sem período — use como padrão ou agende"}</p>
            <SceneDetails scene={scene} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" onClick={() => setEditor({ scene, key: Date.now() })}><Pencil aria-hidden />Editar</Button>
            {scene.isDefault ? null : <Button size="sm" variant="ghost" onClick={() => setDefault.mutate(scene.id)} disabled={setDefault.isPending}><Star aria-hidden />Definir como padrão</Button>}
            <Button size="sm" variant="ghost" className="ml-auto text-destructive hover:text-destructive" aria-label={`Excluir ${scene.name}`} onClick={() => setDeleting(scene)}><Trash2 aria-hidden /></Button>
          </div>
        </div>
      </li>
    )
  }

  return (
    <div className="space-y-5">
      {header}
      <CurrentSceneCard overview={overview} />

      {/* Cenário padrão: destaque próprio, separado da agenda. */}
      <section className="grid gap-4 rounded-xl border bg-card p-4 md:grid-cols-[14rem_minmax(0,1fr)]" aria-label="Cenário padrão" data-testid="inia-scene-default-section">
        {defaultScene ? <SceneThumb scene={defaultScene} className="overflow-hidden rounded-lg" /> : <div className="flex aspect-video items-center justify-center rounded-lg bg-[#0b0613] text-xs text-white/70">Palco roxo</div>}
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <Label htmlFor="inia-scene-default">Cenário padrão</Label>
              <p className="text-xs text-muted-foreground">Vale todos os dias fora dos períodos agendados — também com imagens por horário.</p>
            </div>
            <Select value={overview.defaultSceneId ?? NONE} onValueChange={(value) => setDefault.mutate(value === NONE ? null : value)} disabled={setDefault.isPending}>
              <SelectTrigger id="inia-scene-default" className="w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Nenhum (palco padrão roxo)</SelectItem>
                {overview.scenes.map((scene) => <SelectItem key={scene.id} value={scene.id}>{scene.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {defaultScene ? (
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{defaultScene.name}</p>
                <SceneDetails scene={defaultScene} />
              </div>
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" onClick={() => setEditor({ scene: defaultScene, key: Date.now() })}><Pencil aria-hidden />Editar padrão</Button>
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" aria-label={`Excluir ${defaultScene.name}`} onClick={() => setDeleting(defaultScene)}><Trash2 aria-hidden /></Button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {overview.scenes.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed p-8 text-center">
          <ImageIcon className="size-8 text-muted-foreground/60" aria-hidden />
          <p className="mt-3 font-medium">Nenhum cenário ainda</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">Comece pelo ambiente do dia a dia (ex.: a central de atendimento) e defina como padrão. Depois, crie os de datas especiais com período.</p>
          <Button className="mt-4" onClick={() => setEditor({ scene: null, key: Date.now() })}><Plus aria-hidden />Novo cenário</Button>
        </div>
      ) : (
        <>
          {scheduled.length > 0 ? (
            <section className="space-y-3" aria-labelledby="inia-scenes-scheduled">
              <h2 id="inia-scenes-scheduled" className="text-sm font-semibold">Agenda <span className="font-normal text-muted-foreground">· em ordem de data · {scheduled.length} {scheduled.length === 1 ? "cenário" : "cenários"}</span></h2>
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Cenários agendados">{scheduled.map(card)}</ul>
            </section>
          ) : null}
          {unscheduled.length > 0 ? (
            <section className="space-y-3" aria-labelledby="inia-scenes-unscheduled">
              <h2 id="inia-scenes-unscheduled" className="text-sm font-semibold">Sem período</h2>
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Cenários sem período">{unscheduled.map(card)}</ul>
            </section>
          ) : null}
        </>
      )}

      <ImageGuide />

      {editor ? <SceneFormDialog key={editor.key} open scene={editor.scene} timeZone={overview.timeZone} onOpenChange={(open) => { if (!open) setEditor(null) }} /> : null}
      <AlertDialog open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir o cenário “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>{deleting?.isDefault ? "Ele é o cenário padrão: sem ele, os colaboradores voltam a ver o palco roxo de sempre (fora dos períodos agendados)." : "As imagens e o período deste cenário são apagados."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (deleting) remove.mutate(deleting.id); setDeleting(null) }}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
