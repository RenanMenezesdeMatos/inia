"use client"

import { useRef, useState } from "react"
import { CheckCircle2, Download, FileSpreadsheet, Upload, UserCheck, XCircle } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { InlineError } from "@/components/ui/states"
import { StatusChip, SURFACE_CARD, type Tone } from "@/components/ui/surface"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { downloadBlob, fileToBase64 } from "@/lib/access/download"
import { NETWORK_ENABLE_OUTCOME_LABELS, networkEnableReportCsv, networkEnableRowNote } from "@/lib/access/network-access-labels"
import { cn } from "@/lib/utils"
import { useApplyNetworkEnableMutation, usePreviewNetworkEnableMutation } from "@/queries/access/use-access"
import type { NetworkEnableOutcome, NetworkEnableReport } from "@/schemas/access/access.schema"
import { downloadNetworkEnableTemplate } from "@/services/access/access-service"

/** Espelho do limite do servidor (que decide): só evita enviar um arquivo que seria recusado. */
const MAX_BYTES = 700_000
/** Linhas mostradas por vez; o relatório baixado traz todas. */
const VISIBLE_ROWS = 100
const OUTCOME_TONES: Record<NetworkEnableOutcome, Tone> = { CREATE: "success", REENABLE: "success", ALREADY_ENABLED: "neutral", REFUSED: "danger" }
const OUTCOME_ORDER: NetworkEnableOutcome[] = ["REFUSED", "CREATE", "REENABLE", "ALREADY_ENABLED"]

/**
 * Habilitar em massa pela rede: baixar o modelo, escolher o CSV, conferir linha a linha (nada é gravado) e confirmar. A regra é do
 * servidor; o arquivo só leva matrículas (e e-mail opcional) — nenhuma senha, nenhum papel.
 */
export function NetworkBulkEnableDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  // Enquanto grava, o diálogo não fecha (Esc e X inclusive): o resultado e o relatório só existem aqui.
  const [applying, setApplying] = useState(false)
  return (
    <Dialog open={open} onOpenChange={(next) => { if (next || !applying) onOpenChange(next) }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl" onInteractOutside={(event) => event.preventDefault()}>
        {open ? <BulkEnable onClose={() => onOpenChange(false)} onApplyingChange={setApplying} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function BulkEnable({ onClose, onApplyingChange }: { onClose: () => void; onApplyingChange: (applying: boolean) => void }) {
  const [file, setFile] = useState<{ name: string; contentBase64: string } | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const preview = usePreviewNetworkEnableMutation()
  const apply = useApplyNetworkEnableMutation()
  const ready = preview.data ? preview.data.counts.CREATE + preview.data.counts.REENABLE : 0
  const applied = apply.data ?? null

  async function choose(selected: File | undefined) {
    preview.reset()
    apply.reset()
    setFileError(null)
    setFile(null)
    if (!selected) return
    if (selected.size > MAX_BYTES) return setFileError("O arquivo é grande demais. Divida em arquivos de até 5.000 linhas.")
    try {
      const chosen = { name: selected.name, contentBase64: await fileToBase64(selected) }
      if (!chosen.contentBase64) return setFileError("O arquivo está vazio.")
      setFile(chosen)
      preview.mutate(chosen.contentBase64)
    } catch {
      setFileError("Não foi possível ler o arquivo. Se ele estiver aberto na planilha, feche e tente de novo.")
    }
  }

  function submit() {
    if (!file) return
    onApplyingChange(true)
    apply.mutate(file.contentBase64, { onSettled: () => onApplyingChange(false) })
  }

  async function downloadTemplate() {
    try {
      const { blob, filename } = await downloadNetworkEnableTemplate()
      downloadBlob(blob, filename ?? "modelo-habilitar-acesso-pela-rede.csv")
    } catch {
      toast.error("Não foi possível baixar o modelo agora.")
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      <DialogHeader>
        <DialogTitle>Habilitar em massa pela rede</DialogTitle>
        <DialogDescription>As pessoas passam a entrar com a matrícula e a senha de rede. Nenhuma senha é gerada, nenhum cadastro é criado e nenhum papel é concedido.</DialogDescription>
      </DialogHeader>

      <ol className="grid gap-3 sm:grid-cols-2">
        <li className={cn(SURFACE_CARD, "space-y-2 p-3")}>
          <p className="text-sm font-medium">1. Baixe o modelo</p>
          <p className="text-xs text-muted-foreground">Uma matrícula por linha. A coluna <code className="rounded bg-muted px-1">email</code> é opcional. Apague a linha de exemplo ou deixe: ela é ignorada.</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void downloadTemplate()}><Download aria-hidden />Baixar modelo CSV</Button>
        </li>
        <li className={cn(SURFACE_CARD, "space-y-2 p-3")}>
          <p className="text-sm font-medium">2. Envie o arquivo preenchido</p>
          <p className="text-xs text-muted-foreground">CSV de até 5.000 linhas. Você confere o resultado antes de confirmar.</p>
          <input ref={inputRef} type="file" accept=".csv,text/csv,text/plain" className="sr-only" aria-label="Arquivo CSV de matrículas" tabIndex={-1} onChange={(event) => { const selected = event.target.files?.[0]; event.target.value = ""; void choose(selected) }} />
          <Button type="button" size="sm" variant="outline" disabled={preview.isPending || apply.isPending} onClick={() => inputRef.current?.click()}><Upload aria-hidden />{file ? "Trocar arquivo" : "Escolher arquivo"}</Button>
          {file ? <p className="flex items-center gap-1.5 text-xs break-all"><FileSpreadsheet className="size-3.5 shrink-0" aria-hidden />{file.name}</p> : null}
        </li>
      </ol>

      <div aria-live="polite" className="space-y-3">
        {fileError ? <InlineError message={fileError} /> : null}
        {preview.isPending ? <p className="text-sm text-muted-foreground">Conferindo as matrículas…</p> : null}
        {preview.isError ? <InlineError message={preview.error.message} /> : null}
        {apply.isError ? <InlineError message={apply.error.message} /> : null}
        {applied ? <ReportView report={applied} phase="applied" /> : preview.data ? <ReportView report={preview.data} phase="preview" /> : null}
      </div>

      <DialogFooter>
        {applied ? (
          <Button type="button" onClick={onClose}>Concluir</Button>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={onClose} disabled={apply.isPending}>Cancelar</Button>
            <Button type="button" disabled={!file || ready === 0 || preview.isPending || apply.isPending} onClick={() => submit()}>
              <UserCheck aria-hidden />
              {apply.isPending ? "Habilitando…" : ready === 1 ? "Habilitar 1 pessoa" : ready > 0 ? `Habilitar ${ready.toLocaleString("pt-BR")} pessoas` : "Habilitar"}
            </Button>
          </>
        )}
      </DialogFooter>
    </div>
  )
}

function ReportView({ report, phase }: { report: NetworkEnableReport; phase: "preview" | "applied" }) {
  const present = OUTCOME_ORDER.filter((outcome) => report.counts[outcome] > 0)
  const [filter, setFilter] = useState<NetworkEnableOutcome | null>(null)
  const active = filter && present.includes(filter) ? filter : null
  // Quem precisa de atenção primeiro; a ordem do arquivo dentro de cada resultado.
  const rows = [...report.rows].filter((row) => active === null || row.outcome === active).sort((a, b) => OUTCOME_ORDER.indexOf(a.outcome) - OUTCOME_ORDER.indexOf(b.outcome) || a.line - b.line)
  const done = report.counts.CREATE + report.counts.REENABLE
  return (
    <section className="space-y-3" aria-label={phase === "applied" ? "Resultado da habilitação" : "Conferência do arquivo"}>
      {phase === "applied" ? (
        <p className="flex items-center gap-2 text-sm font-medium">
          {done > 0 ? <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden /> : <XCircle className="size-4 text-destructive" aria-hidden />}
          {done === 0 ? "Ninguém foi habilitado." : done === 1 ? "1 pessoa habilitada: já pode entrar com a matrícula e a senha de rede." : `${done.toLocaleString("pt-BR")} pessoas habilitadas: já podem entrar com a matrícula e a senha de rede.`}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar linhas por resultado">
          {present.map((outcome) => (
            <button key={outcome} type="button" aria-pressed={active === outcome} onClick={() => setFilter(active === outcome ? null : outcome)} className={cn("rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60", active !== null && active !== outcome ? "opacity-60" : null)}>
              <StatusChip tone={OUTCOME_TONES[outcome]}>{NETWORK_ENABLE_OUTCOME_LABELS[outcome][phase]}: {report.counts[outcome].toLocaleString("pt-BR")}</StatusChip>
            </button>
          ))}
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={() => downloadBlob(new Blob([networkEnableReportCsv(report.rows, phase)], { type: "text/csv;charset=utf-8" }), phase === "applied" ? "resultado-habilitar-pela-rede.csv" : "conferencia-habilitar-pela-rede.csv")}>
          <Download aria-hidden />Baixar relatório
        </Button>
      </div>
      {report.ignoredColumns.length > 0 ? <p className="text-xs text-muted-foreground">Colunas ignoradas do arquivo: {report.ignoredColumns.join(", ")}.</p> : null}
      <div className={cn(TABLE_FRAME, "max-h-72 overflow-auto")}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Linha</TableHead>
              <TableHead>Matrícula</TableHead>
              <TableHead>Pessoa</TableHead>
              <TableHead>Login na INIA</TableHead>
              <TableHead>Resultado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, VISIBLE_ROWS).map((row) => (
              <TableRow key={row.line}>
                <TableCell className="tabular-nums">{row.line}</TableCell>
                <TableCell className="font-mono text-xs break-all">{row.matricula || "—"}</TableCell>
                <TableCell>{row.name ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{row.login ?? "—"}</TableCell>
                <TableCell className="whitespace-normal">
                  <span className="block text-sm">{NETWORK_ENABLE_OUTCOME_LABELS[row.outcome][phase]}</span>
                  {networkEnableRowNote(row) ? <span className="block text-xs text-muted-foreground">{networkEnableRowNote(row)}</span> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {rows.length > VISIBLE_ROWS ? <p className="text-xs text-muted-foreground">Mostrando {VISIBLE_ROWS} de {rows.length.toLocaleString("pt-BR")} linhas. O relatório baixado traz todas.</p> : null}
    </section>
  )
}
