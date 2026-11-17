"use client"

import { useId, useState, type ReactNode } from "react"
import Link from "next/link"
import { ArrowRight, CheckCircle2, CircleAlert, CircleSlash, HeartHandshake, Info, ShieldPlus, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { IconBadge, SectionLabel, StatusChip, SURFACE_CARD, toneSurface } from "@/components/ui/surface"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useSaveSupportScopeMutation } from "@/queries/human-support/use-human-support-admin"
import { SCOPE_STATES, type ScopeNode, type ScopeState } from "@/schemas/human-support/admin.schema"

import { GRANT_ROLE_HREF } from "./anjos-tab"
import { effectiveFor, headline, optionEffect, optionLabel, originText, project, resultSummary } from "./scope-rules"

/** Ícone ⓘ com um detalhe complementar (o essencial já está escrito na tela). */
export function InfoHint({ label, children }: { label: string; children: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label} className="inline-flex size-4 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
          <Info className="size-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-xs leading-snug">{children}</TooltipContent>
    </Tooltip>
  )
}

const anjoCountText = (count: number) => (count === 0 ? "Nenhum Anjo" : count === 1 ? "1 Anjo" : `${count} Anjos`)
const typeWord = (node: Pick<ScopeNode, "type">) => (node.type === "GROUP" ? "Grupo" : "Subgrupo")

type Props = {
  node: ScopeNode
  parent: ScopeNode | null
  masterOn: boolean
  canGrantRoles: boolean
  onOpenSettings: () => void
  onShowAnjos: () => void
}

/**
 * Detalhe de um Grupo ou Subgrupo, em três blocos e nesta ordem: QUAL escopo estou editando, QUAL estado está em vigor (com a opção
 * salva e o resultado aplicado separados, a origem escrita e o que falta para o Anjo funcionar) e O QUE posso alterar (cada opção com o
 * efeito em uma frase, prévia antes de salvar, confirmação do estado aplicado depois).
 */
export function ScopeDetail({ node, parent, masterOn, canGrantRoles, onOpenSettings, onShowAnjos }: Props) {
  const save = useSaveSupportScopeMutation()
  const [draft, setDraft] = useState<ScopeState | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [applied, setApplied] = useState<string | null>(null)
  const titleId = useId()

  const chosen = draft ?? node.state
  const dirty = draft !== null && draft !== node.state
  const projection = project(node, parent, chosen, masterOn)
  const origin = originText(node, parent)
  const withoutAnjo = node.effective && node.anjoCount === 0
  const turningOff = dirty && (node.effective && !projection.after.effective || projection.children.some((child) => child.before && !child.after))
  // Sem olhar a chave geral: a opção deste escopo (própria ou herdada) habilita?
  const optionEnables = effectiveFor({ type: node.type, state: node.state, masterOn: true, groupState: parent?.state ?? null }).effective
  const tone = node.effective ? (withoutAnjo ? "warning" : "success") : "neutral"

  function submit() {
    if (!dirty || draft === null) return
    save.mutate(
      { scopeType: node.type === "GROUP" ? "group" : "subgroup", id: node.id, state: draft },
      {
        onSuccess: (saved) => {
          const text = `Salvo. Em vigor agora: ${resultSummary(saved, parent?.name ?? null)}.`
          setDraft(null)
          setApplied(text)
          toast.success(`${saved.name}: ${resultSummary(saved, parent?.name ?? null)}.`)
        },
        onError: (error) => toast.error(error.message),
      },
    )
  }

  return (
    <section aria-labelledby={titleId} className="space-y-4">
      {/* 1 · Qual escopo estou editando */}
      <div className={cn(SURFACE_CARD, "px-4 py-4 sm:px-5")}>
        <SectionLabel as="p">Escopo em edição</SectionLabel>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 id={titleId} className="text-lg font-semibold">{node.name}</h3>
          <span className="text-sm text-muted-foreground">{typeWord(node)}</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground" aria-label="Caminho do escopo">
          Organização › {parent ? `${parent.name} › ${node.name}` : node.name}
        </p>
      </div>

      {/* 2 · Qual estado está em vigor */}
      <div className={cn(toneSurface(tone), "space-y-4 px-4 py-4 sm:px-5")} data-testid="scope-effective">
        <SectionLabel as="p">Em vigor agora</SectionLabel>
        <div className="flex items-start gap-3">
          <IconBadge icon={node.effective ? (withoutAnjo ? TriangleAlert : CheckCircle2) : CircleSlash} tone={tone} size="lg" />
          <div className="min-w-0 space-y-1">
            <p className="text-lg font-semibold" role="status">{headline(node)}</p>
            <p className="text-sm">{origin.sentence}</p>
          </div>
        </div>
        <dl className="grid gap-3 rounded-xl bg-card/70 p-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Opção salva neste escopo</dt>
            <dd className="font-medium">{optionLabel(node.type, node.state)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Resultado aplicado</dt>
            <dd className="font-medium">{node.effective ? "Habilitado" : "Desabilitado"}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1 text-xs text-muted-foreground">
              Origem
              <InfoHint label="Como a origem é decidida">A ordem é Organização → Grupo → Subgrupo. A chave geral da organização libera ou bloqueia tudo, mas não habilita ninguém sozinha. A opção própria de um Subgrupo vence a do Grupo; sem opção própria, o Subgrupo segue o Grupo.</InfoHint>
            </dt>
            <dd className="font-medium">{origin.short}</dd>
          </div>
        </dl>

        <div className="space-y-2">
          <p className="text-sm font-medium">Para o Anjo funcionar em {node.name}</p>
          <ul className="space-y-2 text-sm">
            <Requirement ok={masterOn} label="Chave geral da organização ligada" missing="Está desligada: nenhum escopo tem o Anjo.">
              {masterOn ? null : (
                <Button type="button" size="sm" variant="outline" onClick={onOpenSettings}>
                  Ligar na aba Configuração
                  <ArrowRight data-icon="inline-end" aria-hidden />
                </Button>
              )}
            </Requirement>
            <Requirement
              ok={optionEnables}
              label={node.type === "SUBGROUP" ? `Habilitado neste Subgrupo ou herdado de ${parent?.name ?? "o Grupo"}` : "Habilitado neste Grupo"}
              missing={node.type === "SUBGROUP" ? `Escolha “Habilitar neste escopo” abaixo, ou habilite ${parent?.name ?? "o Grupo"} e mantenha “Herdar do escopo superior”.` : "Escolha “Habilitar neste escopo” abaixo."}
            />
            <Requirement ok={node.anjoCount > 0} label={`Alguém com o papel Anjo atende aqui · ${anjoCountText(node.anjoCount)}`} missing={node.effective ? "Os operadores veem o apoio, mas ninguém atende os pedidos." : "Sem Anjo, os pedidos ficariam sem atendimento."} hint="Conta quem tem o papel Anjo com escopo na organização inteira, neste Grupo ou neste Subgrupo — esteja ou não disponível agora.">
              <Button type="button" size="sm" variant="outline" onClick={onShowAnjos}>
                <HeartHandshake data-icon="inline-start" aria-hidden />
                Ver Anjos
              </Button>
              {node.anjoCount === 0 ? (
                canGrantRoles ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={GRANT_ROLE_HREF}>
                      <ShieldPlus data-icon="inline-start" aria-hidden />
                      Conceder o papel Anjo em Usuários e acessos
                    </Link>
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">Peça a quem administra os acessos para conceder o papel Anjo.</span>
                )
              ) : null}
            </Requirement>
          </ul>
        </div>
      </div>

      {/* 3 · O que posso alterar */}
      <div className={cn(SURFACE_CARD, "overflow-hidden")}>
        <div className="space-y-3 px-4 py-4 sm:px-5">
          <SectionLabel as="p">O que você pode alterar</SectionLabel>
          <RadioGroup
            value={chosen}
            onValueChange={(value) => {
              setApplied(null)
              setDraft(value === node.state ? null : (value as ScopeState))
            }}
            aria-label={`Opção do Anjo em ${node.name}`}
            disabled={save.isPending}
            className="gap-2"
          >
            {SCOPE_STATES.map((state) => {
              const id = `${titleId}-${state}`
              return (
                <label
                  key={state}
                  htmlFor={id}
                  className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/40", chosen === state && "border-primary bg-primary/5 hover:bg-primary/5")}
                >
                  <RadioGroupItem value={state} id={id} className="mt-0.5" aria-labelledby={`${id}-label`} aria-describedby={`${id}-effect`} />
                  <span className="min-w-0 space-y-0.5">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span id={`${id}-label`}>{optionLabel(node.type, state)}</span>
                      {state === node.state ? <StatusChip tone="neutral" className="py-0.5">Salva agora</StatusChip> : null}
                    </span>
                    <span id={`${id}-effect`} className="block text-sm text-muted-foreground">{optionEffect(node, parent, state)}</span>
                  </span>
                </label>
              )
            })}
          </RadioGroup>
        </div>

        {dirty ? (
          <div className={cn(toneSurface(projection.after.effective ? "info" : "neutral"), "mx-4 mb-4 space-y-2 px-3 py-3 text-sm sm:mx-5")} data-testid="scope-preview" aria-live="polite">
            <SectionLabel as="p">Resultado esperado ao salvar</SectionLabel>
            <p className="font-medium">{resultSummary({ type: node.type, name: node.name, effective: projection.after.effective, effectiveSource: projection.after.source }, parent?.name ?? null)}.</p>
            <p className="text-muted-foreground">
              Hoje: {node.effective ? "habilitado" : "desabilitado"} · Depois de salvar: {projection.after.effective ? "habilitado" : "desabilitado"}
            </p>
            {projection.children.length > 0 ? (
              <ul className="list-disc space-y-0.5 pl-5">
                {projection.children.map((child) => (
                  <li key={child.id}>
                    {child.name} (herda deste Grupo): {child.before === child.after ? `continua ${child.after ? "habilitado" : "desabilitado"}` : `passa a ${child.after ? "habilitado" : "desabilitado"}`}
                  </li>
                ))}
              </ul>
            ) : null}
            {!masterOn ? <p className="flex items-start gap-1.5"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />A chave geral está desligada: a opção fica salva e só passa a valer quando ela for ligada.</p> : null}
            {masterOn && projection.after.effective && node.anjoCount === 0 ? <p className="flex items-start gap-1.5"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />Nenhum Anjo atende este escopo: os operadores verão o apoio, mas ninguém vai atender.</p> : null}
            {turningOff ? <p className="flex items-start gap-1.5"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />Os pedidos na fila de quem perde o Anjo são cancelados; os atendimentos em andamento continuam.</p> : null}
          </div>
        ) : null}

        {applied && !dirty ? (
          <p role="status" className={cn(toneSurface("success"), "mx-4 mb-4 flex items-start gap-1.5 px-3 py-2 text-sm sm:mx-5")}>
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
            {applied}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/40 px-4 py-3 sm:px-5">
          {dirty ? <p className="mr-auto text-xs text-muted-foreground">Alteração não salva.</p> : null}
          {dirty ? (
            <Button type="button" variant="outline" className="rounded-full px-4" onClick={() => setDraft(null)} disabled={save.isPending}>
              Descartar
            </Button>
          ) : null}
          <Button type="button" className="rounded-full px-5" onClick={() => (turningOff ? setConfirming(true) : submit())} disabled={!dirty || save.isPending}>
            {save.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desabilitar o Anjo em {node.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Os pedidos que estão na fila {projection.children.some((child) => child.before && !child.after) ? `deste Grupo e dos Subgrupos que herdam dele (${projection.children.filter((child) => child.before && !child.after).map((child) => child.name).join(", ")})` : "deste escopo"} são cancelados, e os operadores veem “O apoio com Anjo foi desativado para sua equipe”. Os atendimentos em andamento continuam até alguém encerrar. Pedidos novos são recusados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirming(false)
                submit()
              }}
            >
              Desabilitar e salvar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function Requirement({ ok, label, missing, hint, children }: { ok: boolean; label: string; missing: string; hint?: string; children?: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Atendido" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-label="Pendente" />}
      <div className="min-w-0 space-y-1.5">
        <p className="flex flex-wrap items-center gap-1">
          {label}
          {hint ? <InfoHint label={`Detalhe: ${label}`}>{hint}</InfoHint> : null}
        </p>
        {ok ? null : <p className="text-muted-foreground">{missing}</p>}
        {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
      </div>
    </li>
  )
}
