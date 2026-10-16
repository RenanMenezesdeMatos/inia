import type { ReactNode } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowDown, CircleCheck, CircleX, Lightbulb } from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { WikiTableOfContents, type WikiTocEntry } from "./wiki-toc"

export function WikiSection({
  id,
  title,
  eyebrow,
  children,
}: {
  id: string
  title: string
  eyebrow?: string
  children: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-5 border-t border-border pt-10 first:border-t-0 first:pt-0">
      <div className="space-y-1.5">
        {eyebrow ? <p className="font-mono text-xs font-medium tracking-wide text-primary uppercase">{eyebrow}</p> : null}
        <h2 className="text-balance font-heading text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
      </div>
      <div className="space-y-5 text-sm leading-relaxed text-foreground/90 sm:text-base">{children}</div>
    </section>
  )
}

export function CapabilityBadge({ label, tone = "supported" }: { label: string; tone?: "supported" | "partial" | "missing" }) {
  const toneClass =
    tone === "supported"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : tone === "partial"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "border-muted-foreground/20 bg-muted text-muted-foreground"
  return (
    <Badge variant="outline" className={cn("rounded-full font-mono text-[11px] font-normal", toneClass)}>
      {label}
    </Badge>
  )
}

export function ExampleCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="bg-muted/30">
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{children}</CardContent>
    </Card>
  )
}

export function WarningCallout({ title, children, kind = "warning" }: { title: string; children: ReactNode; kind?: "warning" | "tip" }) {
  const Icon = kind === "warning" ? AlertTriangle : Lightbulb
  return (
    <div
      className={cn(
        "flex gap-3 rounded-lg border p-4",
        kind === "warning"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200"
          : "border-sky-500/30 bg-sky-500/10 text-sky-900 dark:text-sky-200",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-1 text-sm">
        <p className="font-semibold">{title}</p>
        <div className="text-[0.9em] leading-relaxed opacity-90">{children}</div>
      </div>
    </div>
  )
}

export function NodeReference({
  icon: Icon,
  iconClass,
  iconBgClass,
  name,
  summary,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  iconClass: string
  iconBgClass: string
  name: string
  summary: string
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3 space-y-0">
        <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", iconBgClass)}>
          <Icon className={cn("size-4.5", iconClass)} />
        </div>
        <div className="space-y-1">
          <CardTitle>{name}</CardTitle>
          <p className="text-sm text-muted-foreground">{summary}</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">{children}</CardContent>
    </Card>
  )
}

export function FieldRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,88px)_1fr] gap-3 text-sm">
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="text-foreground/90">{value}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Primitivas da Wiki geral (shell único, cabeçalho, artigo com índice, fluxo, tabela, passos)
// ---------------------------------------------------------------------------------------------

/** Cabeçalho padrão de toda página da Wiki: eyebrow (área), título, lead e badges de capacidade. */
export function WikiPageHeader({
  id = "visao-geral",
  eyebrow,
  title,
  lead,
  children,
}: {
  id?: string
  eyebrow?: string
  title: string
  lead: ReactNode
  children?: ReactNode
}) {
  return (
    <header id={id} className="scroll-mt-24 space-y-4">
      {eyebrow ? <p className="font-mono text-xs font-medium tracking-wide text-primary uppercase">{eyebrow}</p> : null}
      <h1 className="text-balance font-heading text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
      <div className="max-w-2xl text-pretty text-base text-muted-foreground sm:text-lg">{lead}</div>
      {children}
    </header>
  )
}

/** Artigo com índice ("Nesta página") — em xl o índice vira coluna própria à direita; abaixo disso
 * é uma barra fixa no topo da coluna de conteúdo (dentro do <main>, pra o sticky ter um pai da
 * altura da página inteira). */
export function WikiArticle({ toc, children }: { toc: WikiTocEntry[]; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_200px] xl:gap-10">
      <main className="min-w-0 space-y-14">
        <WikiTableOfContents entries={toc} variant="bar" />
        {children}
      </main>
      <aside className="hidden xl:block">
        <WikiTableOfContents entries={toc} variant="list" />
      </aside>
    </div>
  )
}

export type FlowStep = { label: string; detail?: string; tone?: "input" | "core" | "ai" | "output" | "people" | "neutral" }

const FLOW_TONE: Record<NonNullable<FlowStep["tone"]>, string> = {
  input: "border-sky-400/50 bg-sky-500/10 text-sky-900 dark:text-sky-200",
  core: "border-primary/40 bg-primary/10 text-foreground",
  ai: "border-indigo-400/50 bg-indigo-500/10 text-indigo-900 dark:text-indigo-200",
  output: "border-emerald-400/50 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200",
  people: "border-amber-400/50 bg-amber-500/10 text-amber-900 dark:text-amber-200",
  neutral: "border-border bg-muted/40 text-foreground/90",
}

/** Fluxo vertical simples (caixa → seta → caixa) — sem biblioteca de diagramação. */
export function WikiFlow({ steps, compact = false }: { steps: FlowStep[]; compact?: boolean }) {
  return (
    <ol className={cn("flex flex-col items-stretch rounded-lg border border-border bg-muted/20", compact ? "gap-0 p-3" : "gap-0 p-4")}>
      {steps.map((step, index) => (
        <li key={`${step.label}-${index}`} className="flex flex-col items-center">
          <div className={cn("w-full max-w-xl rounded-md border px-3 py-2 text-center text-sm font-medium shadow-xs", FLOW_TONE[step.tone ?? "neutral"])}>
            {step.label}
            {step.detail ? <span className="mt-0.5 block text-xs font-normal opacity-80">{step.detail}</span> : null}
          </div>
          {index < steps.length - 1 ? <ArrowDown className="my-1.5 size-4 text-muted-foreground" aria-hidden /> : null}
        </li>
      ))}
    </ol>
  )
}

/**
 * Tabela com scroll horizontal próprio — nunca estoura a página (regra 118 da Wiki). As células da Wiki são texto corrido: quebram
 * linha (o `TableCell` do kit é `whitespace-nowrap`, que deixava regras de uma frase com milhares de pixels de largura) e têm uma
 * largura mínima por coluna só em tela estreita — no celular, tabela de muitas colunas rola em vez de virar uma palavra por linha.
 */
export function WikiTable({ children, caption }: { children: ReactNode; caption?: string }) {
  return (
    <figure className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-border max-md:[&_td]:min-w-32 [&_td]:align-top [&_td]:whitespace-normal [&_th]:whitespace-normal">{children}</div>
      {caption ? <figcaption className="text-xs text-muted-foreground">{caption}</figcaption> : null}
    </figure>
  )
}

/** Lista numerada de passos de um tutorial — os rótulos entre aspas são os da UI real. */
export function StepList({ steps }: { steps: { title: string; detail: ReactNode }[] }) {
  return (
    <ol className="space-y-3">
      {steps.map((step, index) => (
        <li key={step.title} className="flex gap-3.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-xs font-semibold text-primary">{index + 1}</span>
          <div className="min-w-0 space-y-1 pt-0.5">
            <p className="font-medium text-foreground">{step.title}</p>
            <div className="text-sm text-muted-foreground">{step.detail}</div>
          </div>
        </li>
      ))}
    </ol>
  )
}

/** "Quando usar / quando não usar" lado a lado. */
export function UseCases({ use, avoid }: { use: string[]; avoid: string[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
        <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
          <CircleCheck className="size-4" /> Quando usar
        </p>
        <ul className="list-inside list-disc space-y-1 text-sm text-foreground/90">
          {use.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4">
        <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-rose-800 dark:text-rose-300">
          <CircleX className="size-4" /> Quando NÃO usar
        </p>
        <ul className="list-inside list-disc space-y-1 text-sm text-foreground/90">
          {avoid.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** Links cruzados no fim (ou meio) de uma seção — sempre pra páginas da própria Wiki. */
export function SeeAlso({ links }: { links: { href: string; label: string; hint?: string }[] }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-4">
      <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Veja também</p>
      <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        {links.map((link) => (
          <li key={link.href + link.label}>
            <Link href={link.href} className="font-medium text-primary underline-offset-2 hover:underline">
              {link.label}
            </Link>
            {link.hint ? <span className="text-muted-foreground"> — {link.hint}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Link interno inline com o estilo padrão da Wiki. */
export function WikiLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-medium text-primary underline underline-offset-2">
      {children}
    </Link>
  )
}

/** Termo com definição curta (glossário, "conceitos desta página"). */
export function TermRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-border py-3 last:border-b-0 sm:grid-cols-[200px_1fr] sm:gap-4">
      <dt className="font-medium text-foreground">{term}</dt>
      <dd className="text-sm text-foreground/90">{children}</dd>
    </div>
  )
}
