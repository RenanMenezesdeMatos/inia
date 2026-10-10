"use client"

import { useState } from "react"
import { RotateCcw } from "lucide-react"

import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { AdminApiError } from "@/lib/admin/admin-api"
import { useDatabaseColumnsQuery, useResetFeedCheckpointMutation } from "@/queries/admin/use-data-hub-queries"
import { DATABASE_BATCH_SIZE_DEFAULT, DATABASE_MAX_ROWS_PER_RUN_DEFAULT, type DatabaseCheckpoint, type DatabaseFeedConfig } from "@/schemas/admin/data-hub.schema"
import { formatDateTime } from "../data-hub-format"
import { DatabaseSyncSettings, toDatabaseSync, type DatabaseSyncDraft } from "./database-sync-settings"

/** Rascunho editável da leitura de um conjunto de banco externo (a tabela/visão em si não muda depois de criado). */
export function syncDraftFromConfig(config: DatabaseFeedConfig): DatabaseSyncDraft {
  const sync = config.sync
  return {
    mode: sync.mode,
    cursorColumn: sync.mode === "INCREMENTAL" ? sync.cursorColumn : "",
    keyColumns: sync.keyColumns ?? [],
    lookbackMinutes: sync.mode === "INCREMENTAL" ? sync.lookbackMinutes ?? 0 : 0,
    batchSize: config.batchSize ?? DATABASE_BATCH_SIZE_DEFAULT,
    maxRowsPerRun: config.maxRowsPerRun ?? DATABASE_MAX_ROWS_PER_RUN_DEFAULT,
  }
}

export function configFromSyncDraft(config: DatabaseFeedConfig, draft: DatabaseSyncDraft): DatabaseFeedConfig {
  return { object: config.object, sync: toDatabaseSync(draft), batchSize: draft.batchSize, maxRowsPerRun: draft.maxRowsPerRun }
}

export function DatabaseFeedConnector({ sourceId, config, draft, onChange }: { sourceId: string; config: DatabaseFeedConfig; draft: DatabaseSyncDraft; onChange: (next: DatabaseSyncDraft) => void }) {
  const columns = useDatabaseColumnsQuery(sourceId, config.object)
  return (
    <div className="space-y-4">
      <p className="text-sm">
        Lendo {config.object.kind === "VIEW" ? "a visão" : "a tabela"} <span className="font-mono">{config.object.schema}.{config.object.name}</span>
      </p>
      {columns.isLoading ? (
        <Skeleton className="h-40" aria-hidden />
      ) : columns.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {columns.error instanceof AdminApiError ? columns.error.message : "Não foi possível consultar o banco."} As configurações de leitura só podem ser alteradas com o banco acessível.
        </p>
      ) : columns.data ? (
        <DatabaseSyncSettings description={columns.data} value={draft} onChange={onChange} />
      ) : null}
    </div>
  )
}

/** "Até onde a INIA já leu" — o checkpoint em linguagem de gente, com o botão para recomeçar do início. */
export function DatabaseCheckpointSummary({ feedId, checkpoint }: { feedId: string; checkpoint: Record<string, unknown> | null }) {
  const reset = useResetFeedCheckpointMutation()
  const [open, setOpen] = useState(false)
  const current = checkpoint && checkpoint.kind === "DATABASE" ? (checkpoint as unknown as DatabaseCheckpoint) : null
  return (
    <div className="space-y-1">
      {current?.position ? (
        <>
          <p className="text-xs">
            {current.mode === "INCREMENTAL" ? "Lido até" : "Varredura parou em"}{" "}
            <span className="font-mono">{current.orderColumns.map((column, index) => `${column} = ${current.position![index]}`).join(", ")}</span>
          </p>
          <p className="text-xs text-muted-foreground">{current.reachedEnd ? "Em dia com a origem" : "Continua na próxima carga"} · {formatDateTime(current.updatedAt)}</p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Ainda não leu nada — a próxima carga começa do início.</p>
      )}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" disabled={!current}>
            <RotateCcw className="size-3" /> Reiniciar leitura
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reiniciar a leitura deste conjunto?</AlertDialogTitle>
            <AlertDialogDescription>
              A próxima carga relê tudo desde o início. Nada é apagado e nada é duplicado (cada linha é reconhecida pela chave do conjunto de dados) — útil depois de corrigir o mapeamento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button disabled={reset.isPending} onClick={() => reset.mutate(feedId, { onSuccess: () => setOpen(false) })}>
              Reiniciar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
