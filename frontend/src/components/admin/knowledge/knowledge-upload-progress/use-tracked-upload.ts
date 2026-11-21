"use client"

import { useCallback, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"

import type { UploadTransfer } from "@/lib/admin/admin-api"
import { knowledgeUploadRunKey, useKnowledgeUploadRunQuery } from "@/queries/admin/use-knowledge-queries"
import { fetchKnowledgeUploadRun } from "@/services/admin/knowledge-service"

/**
 * Id do envio no formato uuid v4. `crypto.randomUUID` só existe em contexto seguro (https ou localhost); a instalação por http num servidor da
 * rede não teria, e `getRandomValues` existe nos dois.
 */
export function newUploadId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export type TrackedUpload = {
  uploadId: string
  filename: string
  sizeBytes: number
  transfer: UploadTransfer | null
  /** A requisição do envio ainda não respondeu. */
  waiting: boolean
  requestError: string | null
  /** Até quando o registro do servidor ainda pode aparecer (a requisição não respondeu, ou respondeu há poucos segundos). */
  waitUntil: number
}

/** Folga depois da resposta: o registro final é gravado antes dela, mas uma consulta em curso pode ter saído antes da gravação. */
const SETTLE_GRACE_MS = 6_000

/**
 * Acompanha um envio feito nesta tela: gera o id, recebe o andamento dos bytes do navegador e consulta as etapas que o servidor grava. O estado
 * mostrado vem sempre do navegador (bytes) ou do servidor (etapas).
 */
export function useTrackedUpload() {
  const [upload, setUpload] = useState<TrackedUpload | null>(null)
  const runQuery = useKnowledgeUploadRunQuery(upload?.uploadId ?? null, upload ? (upload.waiting ? Number.POSITIVE_INFINITY : upload.waitUntil) : null)
  const queryClient = useQueryClient()
  // Quem chama `settle` guardou as funções do clique, quando o id ainda não existia: o id atual vem daqui, não do fechamento.
  const currentId = useRef<string | null>(null)

  const begin = useCallback((file: File) => {
    const uploadId = newUploadId()
    currentId.current = uploadId
    setUpload({ uploadId, filename: file.name, sizeBytes: file.size, transfer: { loaded: 0, total: file.size }, waiting: true, requestError: null, waitUntil: Number.POSITIVE_INFINITY })
    const onProgress = (transfer: UploadTransfer) => setUpload((current) => (current?.uploadId === uploadId ? { ...current, transfer } : current))
    return { uploadId, onProgress }
  }, [])

  /** A requisição respondeu: sucesso, ou o erro que ela devolveu. Uma última consulta traz o estado final gravado. */
  const settle = useCallback(
    (requestError: string | null = null) => {
      setUpload((current) => (current ? { ...current, waiting: false, requestError, waitUntil: Date.now() + SETTLE_GRACE_MS } : current))
      // Leitura final direta, pelo id deste envio: o estado gravado antes da resposta (concluído ou a etapa que falhou).
      const uploadId = currentId.current
      if (uploadId) {
        void fetchKnowledgeUploadRun(uploadId)
          .then((run) => {
            if (run) queryClient.setQueryData(knowledgeUploadRunKey(uploadId), run)
          })
          .catch(() => undefined)
      }
    },
    [queryClient],
  )

  const reset = useCallback(() => {
    currentId.current = null
    setUpload(null)
  }, [])

  return { upload, run: runQuery.data, begin, settle, reset }
}
