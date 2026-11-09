"use client"

import { ArrowRight } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useKnowledgeVersionComparisonQuery } from "@/queries/admin/use-knowledge-queries"
import { KNOWLEDGE_SITUATION_LABELS, type KnowledgeConfigChange, type KnowledgeConfigurationComparison, type KnowledgeFileComparison, type KnowledgeReconversion, type KnowledgeVersionRow } from "@/schemas/admin/knowledge.schema"

import { formatFileSize, NOT_RECORDED, versionLabel } from "../knowledge-visuals"
import { TextDiff } from "./compare-text-diff"
import { versionsPhrase } from "./version-rules"

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

const CONFIG_KIND_LABELS: Record<KnowledgeConfigChange["kind"], string> = { ADDED: "Entrou", REMOVED: "Saiu", CHANGED: "Mudou" }

/** Valor único: "de → para". Conjuntos (alcance, assuntos, produtos): o que entrou e o que saiu. */
function ConfigChangeRow({ change }: { change: KnowledgeConfigChange }) {
  const entered = change.to.filter((value) => !change.from.includes(value))
  const left = change.from.filter((value) => !change.to.includes(value))
  const single = change.kind === "CHANGED" && change.from.length === 1 && change.to.length === 1
  return (
    <li className="rounded-md border p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{change.label}</span>
        <Badge variant="outline">{CONFIG_KIND_LABELS[change.kind]}</Badge>
      </div>
      {single ? (
        <p className="mt-1 break-words">
          {change.from[0]} <span aria-hidden>→</span>
          <span className="sr-only">para</span> {change.to[0]}
        </p>
      ) : (
        <div className="mt-1 space-y-0.5 break-words">
          {entered.length > 0 ? <p>Entrou: {entered.join(", ")}</p> : null}
          {left.length > 0 ? <p>Saiu: {left.join(", ")}</p> : null}
        </div>
      )}
    </li>
  )
}

function ConfigurationSection({ configuration }: { configuration: KnowledgeConfigurationComparison }) {
  if (!configuration.comparable) {
    const phrase = versionsPhrase(configuration.versions)
    return <p className="text-sm text-muted-foreground">{`A configuração ${phrase.article} ${phrase.noun} ${phrase.list} não foi registrada`}</p>
  }
  if (configuration.changes.length === 0) return <p className="text-sm text-muted-foreground">Sem mudança na configuração</p>
  return (
    <ul className="space-y-2">
      {configuration.changes.map((change) => (
        <ConfigChangeRow key={change.field} change={change} />
      ))}
    </ul>
  )
}

function fileSummary(file: KnowledgeFileComparison): string {
  const name = (side: KnowledgeFileComparison["from"]) => side?.filename ?? NOT_RECORDED
  switch (file.change) {
    case "REPLACED":
      return `Arquivo trocado: ${name(file.from)} → ${name(file.to)}`
    case "ADDED":
      return `Arquivo adicionado: ${name(file.to)}`
    case "REMOVED":
      return `Arquivo removido: ${name(file.from)}`
    case "UNCHANGED":
      return `Sem mudança no arquivo: ${name(file.to)}`
    case "NONE":
      return "Sem arquivo nas duas versões"
  }
}

function FileSection({ file }: { file: KnowledgeFileComparison }) {
  const fromSize = formatFileSize(file.from?.sizeBytes)
  const toSize = formatFileSize(file.to?.sizeBytes)
  return (
    <div className="text-sm">
      <p className="break-words">{fileSummary(file)}</p>
      {file.change === "REPLACED" && fromSize && toSize && fromSize !== toSize ? <p className="text-xs text-muted-foreground">{`Tamanho: ${fromSize} → ${toSize}`}</p> : null}
    </div>
  )
}

/** Mesmo arquivo, conversão diferente: as linhas abaixo mudam quase todas de forma. O que importa saber é se algum texto entrou ou saiu. */
function ReconversionNote({ reconversion, fromNumber, toNumber }: { reconversion: KnowledgeReconversion; fromNumber: number; toNumber: number }) {
  const same = reconversion.onlyInFrom === 0 && reconversion.onlyInTo === 0
  return (
    <div className="space-y-1 rounded-lg border bg-muted/40 p-2 text-xs" data-testid="knowledge-reconversion">
      <p className="font-medium">Mesmo arquivo, convertido de outra forma: a diferença entre as linhas é sobretudo de formato.</p>
      {same ? (
        <p className="text-muted-foreground">Nenhuma palavra entrou nem saiu.</p>
      ) : (
        <>
          <p className="text-muted-foreground">{`Só na ${versionLabel(fromNumber)}: ${reconversion.onlyInFrom} ${reconversion.onlyInFrom === 1 ? "palavra" : "palavras"}${reconversion.examplesFrom.length > 0 ? ` (${reconversion.examplesFrom.join(", ")})` : ""}.`}</p>
          <p className="text-muted-foreground">{`Só na ${versionLabel(toNumber)}: ${reconversion.onlyInTo} ${reconversion.onlyInTo === 1 ? "palavra" : "palavras"}${reconversion.examplesTo.length > 0 ? ` (${reconversion.examplesTo.join(", ")})` : ""}.`}</p>
          <p className="text-muted-foreground">Cabeçalho e rodapé repetidos saem de propósito; confira as outras.</p>
        </>
      )}
    </div>
  )
}

function VersionTag({ version }: { version: KnowledgeVersionRow }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="font-medium text-foreground">{versionLabel(version.number)}</span>
      <Badge variant={version.situation === "IN_USE" ? "default" : "outline"}>{version.situation === "IN_USE" ? "Vigente · em uso pela IA" : KNOWLEDGE_SITUATION_LABELS[version.situation]}</Badge>
    </span>
  )
}

/** Comparação de duas versões, sempre da mais antiga para a mais nova: configuração, arquivo e texto lado a lado. */
export function VersionCompareDialog({ documentId, from, to, onClose }: { documentId: string; from: KnowledgeVersionRow; to: KnowledgeVersionRow; onClose: () => void }) {
  const comparisonQuery = useKnowledgeVersionComparisonQuery(documentId, from.id, to.id)
  const comparison = comparisonQuery.data
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="flex max-h-[90vh] min-w-0 flex-col overflow-hidden sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{`Comparar ${versionLabel(from.number)} com ${versionLabel(to.number)}`}</DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-2">
              <VersionTag version={from} />
              <ArrowRight aria-hidden className="size-3.5" />
              <VersionTag version={to} />
            </div>
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto pr-1">
          {comparisonQuery.isLoading ? <Skeleton className="h-48 w-full" /> : null}
          {comparisonQuery.isError ? <p className="text-sm text-destructive">{comparisonQuery.error.message || "Não foi possível comparar estas versões."}</p> : null}
          {comparison ? (
            <>
              <Section title="Configuração">
                <ConfigurationSection configuration={comparison.configuration} />
              </Section>
              <Section title="Arquivo">
                <FileSection file={comparison.file} />
              </Section>
              <Section title="Texto">
                {comparison.reconversion ? <ReconversionNote reconversion={comparison.reconversion} fromNumber={from.number} toNumber={to.number} /> : null}
                <TextDiff content={comparison.content} fromNumber={from.number} toNumber={to.number} />
              </Section>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
