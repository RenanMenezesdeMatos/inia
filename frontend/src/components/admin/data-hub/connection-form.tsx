"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { API_AUTH_KINDS, API_AUTH_LABELS, AVAILABILITY_RELEVANT_CONTRACTS, availabilityPolicyLabel, type ApiAuthKind, type AvailabilityPolicy, type SourceKind } from "@/schemas/admin/data-hub.schema"

/**
 * Formulários de conexão por tipo de fonte. O estado é "flat" (ConnectionDraft) e vira
 * `config` + `secrets` da API em `toSourcePayload`. Segredos só existem no rascunho local
 * enquanto o usuário digita — nunca voltam preenchidos da API.
 */
export type ConnectionDraft = {
  name: string
  description: string
  // API Pull
  baseUrl: string
  authKind: ApiAuthKind
  apiKeyHeader: string
  basicUsername: string
  tokenUrl: string
  clientId: string
  scope: string
  headersText: string
  timeoutMs: number
  // SFTP
  host: string
  port: number
  username: string
  remoteDirectory: string
  sftpAuthKind: "PASSWORD" | "PRIVATE_KEY"
  hostKeyFingerprint: string
  // Segredos (só na criação/rotação)
  token: string
  apiKey: string
  password: string
  clientSecret: string
  privateKey: string
  passphrase: string
}

export function emptyConnectionDraft(): ConnectionDraft {
  return {
    name: "",
    description: "",
    baseUrl: "",
    authKind: "BEARER",
    apiKeyHeader: "X-API-Key",
    basicUsername: "",
    tokenUrl: "",
    clientId: "",
    scope: "",
    headersText: "",
    timeoutMs: 30000,
    host: "",
    port: 22,
    username: "",
    remoteDirectory: "/",
    sftpAuthKind: "PASSWORD",
    hostKeyFingerprint: "",
    token: "",
    apiKey: "",
    password: "",
    clientSecret: "",
    privateKey: "",
    passphrase: "",
  }
}

export function draftFromSource(source: { name: string; description: string | null; config: Record<string, unknown> }): ConnectionDraft {
  const draft = emptyConnectionDraft()
  draft.name = source.name
  draft.description = source.description ?? ""
  const config = source.config as { kind: SourceKind; api?: Record<string, unknown>; sftp?: Record<string, unknown> }
  if (config.kind === "API_PULL" && config.api) {
    const api = config.api as { baseUrl: string; auth: Record<string, string>; headers: Record<string, string>; timeoutMs: number }
    draft.baseUrl = api.baseUrl
    draft.authKind = (api.auth?.kind as ApiAuthKind) ?? "NONE"
    draft.apiKeyHeader = api.auth?.headerName ?? "X-API-Key"
    draft.basicUsername = api.auth?.username ?? ""
    draft.tokenUrl = api.auth?.tokenUrl ?? ""
    draft.clientId = api.auth?.clientId ?? ""
    draft.scope = api.auth?.scope ?? ""
    draft.headersText = Object.entries(api.headers ?? {})
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n")
    draft.timeoutMs = api.timeoutMs ?? 30000
  }
  if (config.kind === "SFTP" && config.sftp) {
    const sftp = config.sftp as { host: string; port: number; username: string; remoteDirectory: string; authKind: "PASSWORD" | "PRIVATE_KEY"; hostKeyFingerprint?: string; timeoutMs?: number }
    draft.host = sftp.host
    draft.port = sftp.port
    draft.username = sftp.username
    draft.remoteDirectory = sftp.remoteDirectory
    draft.sftpAuthKind = sftp.authKind
    draft.hostKeyFingerprint = sftp.hostKeyFingerprint ?? ""
    draft.timeoutMs = sftp.timeoutMs ?? 30000
  }
  return draft
}

function parseHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const index = line.indexOf(":")
    if (index <= 0) continue
    headers[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return headers
}

export function toSourcePayload(kind: SourceKind, draft: ConnectionDraft): { name: string; description?: string; config: Record<string, unknown>; secrets?: Record<string, string | undefined> } {
  const base = { name: draft.name.trim(), description: draft.description.trim() || undefined }
  if (kind === "API_PULL") {
    const auth =
      draft.authKind === "NONE"
        ? { kind: "NONE" }
        : draft.authKind === "API_KEY"
          ? { kind: "API_KEY", headerName: draft.apiKeyHeader || "X-API-Key" }
          : draft.authKind === "BASIC"
            ? { kind: "BASIC", username: draft.basicUsername }
            : draft.authKind === "OAUTH2_CLIENT_CREDENTIALS"
              ? { kind: "OAUTH2_CLIENT_CREDENTIALS", tokenUrl: draft.tokenUrl, clientId: draft.clientId, scope: draft.scope || undefined }
              : { kind: "BEARER" }
    const secrets: Record<string, string | undefined> = {}
    if (draft.token) secrets.token = draft.token
    if (draft.apiKey) secrets.apiKey = draft.apiKey
    if (draft.password) secrets.password = draft.password
    if (draft.clientSecret) secrets.clientSecret = draft.clientSecret
    return { ...base, config: { kind, api: { baseUrl: draft.baseUrl.trim(), auth, headers: parseHeaders(draft.headersText), timeoutMs: draft.timeoutMs } }, secrets: Object.keys(secrets).length ? secrets : undefined }
  }
  if (kind === "SFTP") {
    const secrets: Record<string, string | undefined> = {}
    if (draft.password) secrets.password = draft.password
    if (draft.privateKey) secrets.privateKey = draft.privateKey
    if (draft.passphrase) secrets.passphrase = draft.passphrase
    return {
      ...base,
      config: { kind, sftp: { host: draft.host.trim(), port: Number(draft.port) || 22, username: draft.username.trim(), remoteDirectory: draft.remoteDirectory.trim() || "/", authKind: draft.sftpAuthKind, hostKeyFingerprint: draft.hostKeyFingerprint.trim() || undefined, timeoutMs: draft.timeoutMs } },
      secrets: Object.keys(secrets).length ? secrets : undefined,
    }
  }
  return { ...base, config: { kind } }
}

export function connectionDraftValid(kind: SourceKind, draft: ConnectionDraft, requireSecrets: boolean): boolean {
  if (draft.name.trim().length < 2) return false
  if (kind === "API_PULL") {
    if (!/^https?:\/\//.test(draft.baseUrl.trim())) return false
    if (draft.authKind === "BASIC" && !draft.basicUsername) return false
    if (draft.authKind === "OAUTH2_CLIENT_CREDENTIALS" && (!draft.tokenUrl || !draft.clientId)) return false
    if (requireSecrets) {
      if (draft.authKind === "BEARER" && !draft.token) return false
      if (draft.authKind === "API_KEY" && !draft.apiKey) return false
      if (draft.authKind === "BASIC" && !draft.password) return false
      if (draft.authKind === "OAUTH2_CLIENT_CREDENTIALS" && !draft.clientSecret) return false
    }
  }
  if (kind === "SFTP") {
    if (!draft.host.trim() || !draft.username.trim()) return false
    if (requireSecrets) {
      if (draft.sftpAuthKind === "PASSWORD" && !draft.password) return false
      if (draft.sftpAuthKind === "PRIVATE_KEY" && !draft.privateKey) return false
    }
  }
  return true
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function ConnectionForm({ kind, draft, onChange, secretsMode }: { kind: SourceKind; draft: ConnectionDraft; onChange: (next: ConnectionDraft) => void; secretsMode: "create" | "rotate" | "hidden" }) {
  const set = <K extends keyof ConnectionDraft>(key: K, value: ConnectionDraft[K]) => onChange({ ...draft, [key]: value })
  const secretHint = secretsMode === "rotate" ? "Deixe em branco para manter a credencial atual. O valor nunca é exibido depois de salvo." : "Guardado cifrado; nunca exibido de novo."
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="source-name" label="Nome da fonte">
          <Input id="source-name" value={draft.name} onChange={(event) => set("name", event.target.value)} placeholder={kind === "API_PULL" ? "Ex.: API RH do cliente" : kind === "SFTP" ? "Ex.: SFTP Corporativo" : kind === "API_PUSH" ? "Ex.: Data lake de atendimento" : "Ex.: Importação manual"} />
        </Field>
        <Field id="source-description" label="Descrição (opcional)">
          <Input id="source-description" value={draft.description} onChange={(event) => set("description", event.target.value)} placeholder="Para que serve esta fonte" />
        </Field>
      </div>

      {kind === "API_PULL" ? (
        <div className="space-y-4">
          <Field id="api-base" label="Base URL" hint="Endereço raiz da API; cada feed informa o próprio endpoint.">
            <Input id="api-base" value={draft.baseUrl} onChange={(event) => set("baseUrl", event.target.value)} placeholder="https://api.cliente.com.br" inputMode="url" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="api-auth" label="Autenticação">
              <Select value={draft.authKind} onValueChange={(value) => set("authKind", value as ApiAuthKind)}>
                <SelectTrigger id="api-auth" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {API_AUTH_KINDS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {API_AUTH_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="api-timeout" label="Timeout (ms)">
              <Input id="api-timeout" type="number" min={1000} max={120000} value={draft.timeoutMs} onChange={(event) => set("timeoutMs", Number(event.target.value) || 30000)} />
            </Field>
          </div>
          {draft.authKind === "BEARER" && secretsMode !== "hidden" ? (
            <Field id="api-token" label="Token" hint={secretHint}>
              <Input id="api-token" type="password" autoComplete="off" value={draft.token} onChange={(event) => set("token", event.target.value)} />
            </Field>
          ) : null}
          {draft.authKind === "API_KEY" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="api-key-header" label="Nome do header">
                <Input id="api-key-header" value={draft.apiKeyHeader} onChange={(event) => set("apiKeyHeader", event.target.value)} />
              </Field>
              {secretsMode !== "hidden" ? (
                <Field id="api-key" label="API Key" hint={secretHint}>
                  <Input id="api-key" type="password" autoComplete="off" value={draft.apiKey} onChange={(event) => set("apiKey", event.target.value)} />
                </Field>
              ) : null}
            </div>
          ) : null}
          {draft.authKind === "BASIC" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="basic-user" label="Usuário">
                <Input id="basic-user" value={draft.basicUsername} onChange={(event) => set("basicUsername", event.target.value)} autoComplete="off" />
              </Field>
              {secretsMode !== "hidden" ? (
                <Field id="basic-pass" label="Senha" hint={secretHint}>
                  <Input id="basic-pass" type="password" autoComplete="new-password" value={draft.password} onChange={(event) => set("password", event.target.value)} />
                </Field>
              ) : null}
            </div>
          ) : null}
          {draft.authKind === "OAUTH2_CLIENT_CREDENTIALS" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="oauth-token-url" label="Token URL">
                <Input id="oauth-token-url" value={draft.tokenUrl} onChange={(event) => set("tokenUrl", event.target.value)} placeholder="https://auth.cliente.com.br/oauth/token" />
              </Field>
              <Field id="oauth-client" label="Client ID">
                <Input id="oauth-client" value={draft.clientId} onChange={(event) => set("clientId", event.target.value)} autoComplete="off" />
              </Field>
              <Field id="oauth-scope" label="Scope (opcional)">
                <Input id="oauth-scope" value={draft.scope} onChange={(event) => set("scope", event.target.value)} />
              </Field>
              {secretsMode !== "hidden" ? (
                <Field id="oauth-secret" label="Client Secret" hint={secretHint}>
                  <Input id="oauth-secret" type="password" autoComplete="off" value={draft.clientSecret} onChange={(event) => set("clientSecret", event.target.value)} />
                </Field>
              ) : null}
            </div>
          ) : null}
          <Field id="api-headers" label="Headers adicionais (opcional)" hint="Um por linha, no formato Nome: valor. Nunca coloque credenciais aqui — use a autenticação acima. Sem liberar a configuração, os valores aparecem ocultos; deixar oculto mantém o valor atual.">
            <Textarea id="api-headers" rows={2} value={draft.headersText} onChange={(event) => set("headersText", event.target.value)} placeholder="Accept: application/json" />
          </Field>
        </div>
      ) : null}

      {kind === "SFTP" ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <Field id="sftp-host" label="Host">
              <Input id="sftp-host" value={draft.host} onChange={(event) => set("host", event.target.value)} placeholder="sftp.cliente.com.br" />
            </Field>
            <Field id="sftp-port" label="Porta">
              <Input id="sftp-port" type="number" min={1} max={65535} value={draft.port} onChange={(event) => set("port", Number(event.target.value) || 22)} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="sftp-user" label="Usuário">
              <Input id="sftp-user" value={draft.username} onChange={(event) => set("username", event.target.value)} autoComplete="off" />
            </Field>
            <Field id="sftp-dir" label="Diretório remoto">
              <Input id="sftp-dir" value={draft.remoteDirectory} onChange={(event) => set("remoteDirectory", event.target.value)} placeholder="/exportacoes/inia" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="sftp-auth" label="Autenticação">
              <Select value={draft.sftpAuthKind} onValueChange={(value) => set("sftpAuthKind", value as "PASSWORD" | "PRIVATE_KEY")}>
                <SelectTrigger id="sftp-auth" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PASSWORD">Senha</SelectItem>
                  <SelectItem value="PRIVATE_KEY">Chave privada</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field id="sftp-fingerprint" label="Fingerprint da host key (SHA-256, opcional)" hint="Se informada, a conexão só é aceita quando a host key do servidor bater. Sem ela, a verificação não é desligada silenciosamente: fixe-a assim que confirmar o servidor.">
              <Input id="sftp-fingerprint" value={draft.hostKeyFingerprint} onChange={(event) => set("hostKeyFingerprint", event.target.value)} placeholder="SHA256:…" />
            </Field>
          </div>
          {secretsMode !== "hidden" ? (
            draft.sftpAuthKind === "PASSWORD" ? (
              <Field id="sftp-pass" label="Senha" hint={secretHint}>
                <Input id="sftp-pass" type="password" autoComplete="new-password" value={draft.password} onChange={(event) => set("password", event.target.value)} />
              </Field>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="sftp-key" label="Chave privada (PEM)" hint={secretHint}>
                  <Textarea id="sftp-key" rows={4} spellCheck={false} autoComplete="off" value={draft.privateKey} onChange={(event) => set("privateKey", event.target.value)} className="font-mono text-xs [-webkit-text-security:disc]" />
                </Field>
                <Field id="sftp-passphrase" label="Passphrase (opcional)">
                  <Input id="sftp-passphrase" type="password" autoComplete="off" value={draft.passphrase} onChange={(event) => set("passphrase", event.target.value)} />
                </Field>
              </div>
            )
          ) : null}
        </div>
      ) : null}

      {kind === "API_PUSH" ? <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">Ao ativar, a INIA gera o endpoint e um token de push para cada feed. O cliente envia os dados em JSON com <code className="font-mono">Authorization: Bearer</code> e <code className="font-mono">Idempotency-Key</code>.</p> : null}
      {kind === "FILE_UPLOAD" ? <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">Fonte manual: cada feed define o contrato e o mapeamento; os arquivos (.csv/.xlsx) são enviados pela tela Importar arquivo.</p> : null}
    </div>
  )
}

/**
 * DISPONIBILIDADE ESPERADA do feed (SLA D-1/D-2 + horário local) — conceito distinto da cadência:
 * "quando o dado referente ao dia D já deveria estar carregado". Sem SLA a INIA não assume D-1 e não
 * conclui ausência de ninguém (dias ficam "disponibilidade não configurada"). Fonte atrasada em relação
 * ao SLA gera alerta administrativo — nunca pendência por colaborador.
 */
export function AvailabilityPolicyField({ value, onChange, disabled, contractKey }: { value: AvailabilityPolicy | null; onChange: (next: AvailabilityPolicy | null) => void; disabled?: boolean; contractKey: string }) {
  const relevant = (AVAILABILITY_RELEVANT_CONTRACTS as readonly string[]).includes(contractKey)
  if (!relevant) return null
  const employment = contractKey === "EMPLOYEES" || contractKey === "EMPLOYEE_ABSENCES"
  return (
    <div className="space-y-3 rounded-lg border border-border/60 p-3" data-testid="availability-policy">
      <label className="flex items-start gap-3 text-sm">
        <Switch checked={value !== null} onCheckedChange={(checked) => onChange(checked ? { lagDays: employment ? 2 : 1, availableByLocalTime: employment ? "08:00" : "11:00" } : null)} disabled={disabled} aria-label="Disponibilidade esperada configurada" data-testid="availability-policy-switch" />
        <span>
          <span className="font-medium">Disponibilidade esperada dos dados (SLA)</span>
          <span className="block text-xs text-muted-foreground">
            {employment ? "Quando a situação funcional (férias, afastamentos, licenças) referente a um dia já deveria estar refletida nesta fonte. Antes disso a INIA aguarda o RH antes de classificar qualquer ausência." : "Quando o dado referente a um dia já deveria estar carregado. Freshness ≠ disponibilidade: a fonte pode ter sincronizado hoje às 08:00 e o dado de ontem só ser esperado às 11:00."}
            {value === null ? " Sem SLA, nenhuma ausência é concluída automaticamente." : ""}
          </span>
        </span>
      </label>
      {value ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="availability-lag">Dado de D chega em</Label>
            <Select value={String(value.lagDays)} onValueChange={(next) => onChange({ ...value, lagDays: Number(next) })} disabled={disabled}>
              <SelectTrigger id="availability-lag" className="w-full" data-testid="availability-lag"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">No mesmo dia (D)</SelectItem>
                <SelectItem value="1">D-1 (dia seguinte)</SelectItem>
                <SelectItem value="2">D-2 (dois dias depois)</SelectItem>
                <SelectItem value="3">D-3</SelectItem>
                <SelectItem value="5">D-5</SelectItem>
                <SelectItem value="7">D-7</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="availability-time">até (horário da operação)</Label>
            <Input id="availability-time" type="time" value={value.availableByLocalTime} onChange={(event) => onChange({ ...value, availableByLocalTime: event.target.value || "11:00" })} disabled={disabled} data-testid="availability-time" />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">Resultado: {availabilityPolicyLabel(value)} — só depois disso a INIA considera que a fonte &quot;já deveria conter&quot; o dia; se a carga não vier, é a FONTE que fica atrasada.</p>
        </div>
      ) : null}
    </div>
  )
}
