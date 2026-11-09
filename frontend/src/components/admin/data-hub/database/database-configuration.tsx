"use client"

import { useState } from "react"
import { KeyRound, Loader2, Plug } from "lucide-react"

import { Button } from "@/components/ui/button"
import { AdminApiError } from "@/lib/admin/admin-api"
import { useUpdateSourceMutation } from "@/queries/admin/use-data-hub-queries"
import { testDatabaseConnection } from "@/services/admin/data-hub-service"
import { DATABASE_ENGINE_LABELS, type ConnectionTest, type SourceDetail } from "@/schemas/admin/data-hub.schema"
import { ConfigAccessPanel, isConfigLocked } from "../config-access/config-access-panel"
import { ignoreHandled, useConfigUnlockPrompt } from "../config-access/use-config-unlock-prompt"
import { useFormInUse } from "../config-access/use-held-form-key"
import { formatDateTime } from "../data-hub-format"
import { DatabaseConnectionFields, DatabaseTestResult, databaseDraftFromSource, databaseDraftProblems, draftSignature, toDatabaseConfig, type DatabaseDraft } from "./database-connection-fields"

/**
 * Configuração de uma conexão com banco EXTERNO já existente: alterar servidor/usuário/criptografia, trocar a senha
 * (em branco = mantém a guardada) e testar antes de salvar — o teste usa a senha digitada ou, sem ela, a guardada.
 * Sem liberação os dados aparecem, e testar continua possível; alterar exige informar a senha.
 */
export function DatabaseConfigurationTab({ source, onHold }: { source: SourceDetail; onHold: (inUse: boolean) => void }) {
  const update = useUpdateSourceMutation()
  const [draft, setDraft] = useState<DatabaseDraft>(() => databaseDraftFromSource(source))
  const [test, setTest] = useState<{ result: ConnectionTest; signature: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const problems = databaseDraftProblems(draft, false)
  const secret = source.secrets.find((entry) => entry.purpose === "DATABASE_PASSWORD")
  const locked = isConfigLocked(source.configAccess)
  const prompt = useConfigUnlockPrompt()
  const markSaved = useFormInUse(onHold, draft, prompt.active)

  async function runTest() {
    setTesting(true)
    setError(null)
    const signature = draftSignature(draft)
    try {
      setTest({ result: await testDatabaseConnection({ config: toDatabaseConfig(draft), password: draft.password || undefined, sourceId: source.id }), signature })
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Não foi possível testar a conexão.")
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-5">
      {prompt.dialog}
      <ConfigAccessPanel sourceId={source.id} kind={source.kind} access={source.configAccess} />
      <p className="text-sm text-muted-foreground">
        Banco: <span className="font-medium text-foreground">{DATABASE_ENGINE_LABELS[draft.engine]}</span>
        {secret ? ` · senha guardada em ${formatDateTime(secret.rotatedAt ?? secret.createdAt)} (nunca exibida)` : " · sem senha guardada"}
      </p>
      <fieldset disabled={locked} className="m-0 min-w-0 border-0 p-0" data-testid="source-config-fields">
        <DatabaseConnectionFields draft={draft} onChange={setDraft} passwordMode="rotate" />
      </fieldset>
      {test && test.signature === draftSignature(draft) ? <DatabaseTestResult result={test.result} /> : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={runTest} disabled={testing || problems.length > 0}>
          {testing ? <Loader2 className="animate-spin" /> : <Plug />} Testar
        </Button>
        <Button
          disabled={locked || problems.length > 0 || update.isPending}
          onClick={() =>
            ignoreHandled(
              prompt
                .guarded(() => update.mutateAsync({ id: source.id, input: { name: draft.name.trim(), config: { kind: "DATABASE", database: toDatabaseConfig(draft) }, secrets: draft.password ? { password: draft.password } : undefined } }))
                .then(() => {
                  setDraft((current) => ({ ...current, password: "" }))
                  markSaved()
                }),
            )
          }
        >
          {draft.password ? <KeyRound /> : null} Salvar {draft.password ? "conexão e nova senha" : "conexão"}
        </Button>
      </div>
      {problems.length > 0 ? <p className="text-xs text-muted-foreground">{problems[0]}</p> : null}
    </div>
  )
}
