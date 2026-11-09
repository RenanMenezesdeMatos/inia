"use client"

import { useId, useState, type FormEvent } from "react"
import { KeyRound, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { AdminApiError } from "@/lib/admin/admin-api"
import { useRotateSecretsMutation, useUnlockConfigurationMutation } from "@/queries/admin/use-data-hub-queries"

import { formatTime } from "../data-hub-format"

/**
 * Pede a credencial da fonte, com o campo certo para cada tipo. "Liberar" confere com a guardada e não conecta em nada. "Trocar"
 * é para quando a senha mudou no servidor: não pede a antiga, mas só grava a nova depois de um teste real de conexão.
 * O valor nunca é exibido e o campo é limpo depois de cada envio.
 */
export type CredentialTarget = { sourceId: string; kind: string; fields: string[] }

export function credentialLabel(field: string, kind: string): string {
  switch (field) {
    case "password":
      return kind === "DATABASE" ? "Senha do banco de dados" : kind === "SFTP" ? "Senha do SFTP" : "Senha da API"
    case "token":
      return "Token de acesso"
    case "apiKey":
      return "Chave da API"
    case "clientSecret":
      return "Client secret"
    case "privateKey":
      return "Chave privada (PEM)"
    case "passphrase":
      return "Frase da chave (se houver)"
    default:
      return field
  }
}

function errorText(error: unknown): string {
  if (error instanceof AdminApiError && error.code === "DATA_SOURCE_UNLOCK_TOO_MANY_ATTEMPTS") {
    const retryAt = (error.details as { retryAt?: string } | undefined)?.retryAt
    return retryAt ? `${error.message} Nova tentativa às ${formatTime(retryAt)}.` : error.message
  }
  return error instanceof Error ? error.message : "Não foi possível conferir a senha."
}

export function ConfigUnlockForm({ target, onDone, onCancel }: { target: CredentialTarget; onDone?: () => void; onCancel?: () => void }) {
  const unlock = useUnlockConfigurationMutation()
  const rotate = useRotateSecretsMutation({ errorsInline: true })
  const baseId = useId()
  const [mode, setMode] = useState<"unlock" | "rotate">("unlock")
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const fields = mode === "rotate" && target.fields.includes("privateKey") ? [...target.fields, "passphrase"] : target.fields
  const required = target.fields
  const pending = unlock.isPending || rotate.isPending
  const canSubmit = required.every((field) => values[field]) && !pending

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const secrets = Object.fromEntries(Object.entries(values).filter(([, value]) => value))
    try {
      if (mode === "unlock") {
        const access = await unlock.mutateAsync({ id: target.sourceId, secrets })
        toast.success(access.expiresAt ? `Configuração liberada até ${formatTime(access.expiresAt)}.` : "Configuração liberada.")
      } else {
        await rotate.mutateAsync({ id: target.sourceId, secrets })
      }
      onDone?.()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setValues({})
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-3" autoComplete="off">
      {mode === "rotate" ? <p className="text-sm text-muted-foreground">Use quando a senha mudou no servidor. A senha antiga não é pedida: a INIA conecta com a nova e só grava se funcionar. Quem estava liberado precisará da senha nova.</p> : null}
      {fields.map((field) => {
        const id = `${baseId}-${field}`
        const label = mode === "rotate" && field !== "passphrase" ? `Nova: ${credentialLabel(field, target.kind).toLowerCase()}` : credentialLabel(field, target.kind)
        return (
          <div key={field} className="space-y-1.5">
            <Label htmlFor={id}>{label}</Label>
            {field === "privateKey" ? (
              // Textarea porque a chave tem várias linhas; a máscara mantém o valor fora da tela.
              <Textarea id={id} rows={4} spellCheck={false} autoComplete="off" className="font-mono text-xs [-webkit-text-security:disc]" value={values[field] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))} />
            ) : (
              <Input id={id} type="password" autoComplete="new-password" value={values[field] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))} />
            )}
          </div>
        )
      })}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={!canSubmit}>
          {pending ? <Loader2 className="animate-spin" /> : <KeyRound />} {mode === "unlock" ? "Liberar configuração" : "Testar e trocar"}
        </Button>
        {onCancel ? (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="link"
          className="px-0 text-xs"
          onClick={() => {
            setMode((current) => (current === "unlock" ? "rotate" : "unlock"))
            setValues({})
            setError(null)
          }}
        >
          {mode === "unlock" ? "A senha mudou no servidor? Trocar a senha" : "Tenho a senha atual"}
        </Button>
      </div>
    </form>
  )
}
