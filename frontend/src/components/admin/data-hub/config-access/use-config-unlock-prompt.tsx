"use client"

import { useCallback, useRef, useState } from "react"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AdminApiError } from "@/lib/admin/admin-api"

import { ConfigUnlockForm, type CredentialTarget } from "./config-unlock-form"

export function isConfigLockedError(error: unknown): error is AdminApiError {
  return error instanceof AdminApiError && error.code === "DATA_SOURCE_CONFIG_LOCKED"
}

/** O alvo vem do próprio erro: qualquer rota protegida diz qual fonte precisa de senha e qual campo pedir. */
export function lockedTarget(error: AdminApiError): CredentialTarget | null {
  const details = error.details as Partial<CredentialTarget> | undefined
  return details?.sourceId && details.kind && details.fields ? { sourceId: details.sourceId, kind: details.kind, fields: details.fields } : null
}

/** Pessoa fechou o pedido de senha sem informar: nada foi enviado, e o que estava preenchido continua na tela. */
export class ConfigUnlockCancelled extends Error {
  constructor() {
    super("A configuração continua bloqueada. Informe a senha da fonte para continuar; o que você preencheu foi mantido.")
    this.name = "ConfigUnlockCancelled"
  }
}

/**
 * A liberação pode vencer no meio do caminho. `guarded` tenta a ação e, se ela voltar bloqueada, pede a senha num diálogo e tenta de
 * novo uma vez. O estado de quem chama não muda enquanto isso, então nada do que foi preenchido se perde.
 */
export function useConfigUnlockPrompt() {
  const [target, setTarget] = useState<CredentialTarget | null>(null)
  // Da caixa aberta até a ação repetida terminar: o formulário não pode ser relido no meio disso.
  const [active, setActive] = useState(false)
  const waiting = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null)

  const guarded = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work()
    } catch (error) {
      const next = isConfigLockedError(error) ? lockedTarget(error) : null
      if (!next) throw error
      setActive(true)
      try {
        await new Promise<void>((resolve, reject) => {
          waiting.current = { resolve, reject }
          setTarget(next)
        })
        return await work()
      } finally {
        setActive(false)
      }
    }
  }, [])

  const finish = (settle: (entry: NonNullable<typeof waiting.current>) => void) => {
    const entry = waiting.current
    waiting.current = null
    setTarget(null)
    if (entry) settle(entry)
  }
  const cancel = () => finish((entry) => entry.reject(new ConfigUnlockCancelled()))

  const dialog = (
    <Dialog open={target !== null} onOpenChange={(open) => (open ? undefined : cancel())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Informe a senha para continuar</DialogTitle>
          <DialogDescription>A liberação desta fonte venceu ou ainda não foi feita. O que você preencheu continua aqui; depois de informar a senha, a ação é repetida.</DialogDescription>
        </DialogHeader>
        {target ? <ConfigUnlockForm target={target} onDone={() => finish((entry) => entry.resolve())} onCancel={cancel} /> : null}
      </DialogContent>
    </Dialog>
  )

  return { guarded, dialog, active }
}

/** Ação de botão: o aviso de erro já saiu pela mutação (ou o pedido de senha foi cancelado), não há o que tratar aqui. */
export function ignoreHandled(promise: Promise<unknown>): void {
  void promise.catch(() => undefined)
}
