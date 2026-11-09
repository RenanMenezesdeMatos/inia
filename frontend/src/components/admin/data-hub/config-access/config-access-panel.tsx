"use client"

import { Lock, LockOpen } from "lucide-react"

import type { ConfigAccess } from "@/schemas/admin/data-hub.schema"

import { formatTime } from "../data-hub-format"
import { ConfigUnlockForm, type CredentialTarget } from "./config-unlock-form"

export const isConfigLocked = (access: ConfigAccess | null | undefined): boolean => Boolean(access?.required && !access.unlocked)

/** Bloqueio em linha: os detalhes continuam na tela; quem quer alterar informa a senha aqui. */
export function ConfigAccessPanel({ sourceId, kind, access }: { sourceId: string; kind: string; access: ConfigAccess }) {
  if (!access.required) return null
  if (access.unlocked) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="config-unlocked">
        <LockOpen className="size-3.5" aria-hidden /> Configuração liberada para você{access.expiresAt ? ` até ${formatTime(access.expiresAt)}` : ""}.
      </p>
    )
  }
  const target: CredentialTarget = { sourceId, kind, fields: access.fields }
  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4" data-testid="config-locked">
      <div className="space-y-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Lock className="size-4" aria-hidden /> Informe a senha para configurar
        </p>
        <p className="text-sm text-muted-foreground">Quem não informar a senha da fonte vê os detalhes, testa a conexão e pode excluir, mas não altera a configuração nem lê as tabelas do cliente. A liberação vale 30 minutos, só para você e só nesta sessão.</p>
      </div>
      <ConfigUnlockForm target={target} />
    </div>
  )
}
