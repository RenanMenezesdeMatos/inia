"use client"

import { AlertTriangle, CheckCircle2, ChevronDown, Info, Lock, LockOpen, ShieldCheck, XCircle } from "lucide-react"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  DATABASE_ENGINE_LABELS,
  DATABASE_TLS_LABELS,
  DEFAULT_DATABASE_PORTS,
  DEFAULT_TLS_MODE,
  supportedTlsModes,
  type ConnectionTest,
  type DatabaseConfig,
  type DatabaseEngine,
  type DatabaseTlsMode,
} from "@/schemas/admin/data-hub.schema"

/**
 * Campos de uma conexão com BANCO EXTERNO (o banco do cliente — nunca o banco interno da INIA). O comum fica à vista
 * (servidor, porta, banco, usuário, senha); criptografia, certificado e tempos-limite ficam recolhidos com os
 * padrões de cada banco. A senha só existe neste rascunho enquanto é digitada: depois de salva nunca volta da API.
 */
export type DatabaseDraft = {
  name: string
  engine: DatabaseEngine
  host: string
  port: string
  database: string
  username: string
  password: string
  instanceName: string
  tlsMode: DatabaseTlsMode
  caCertificate: string
  connectTimeoutSeconds: string
  queryTimeoutSeconds: string
}

export function emptyDatabaseDraft(engine: DatabaseEngine): DatabaseDraft {
  return { name: "", engine, host: "", port: "", database: "", username: "", password: "", instanceName: "", tlsMode: DEFAULT_TLS_MODE[engine], caCertificate: "", connectTimeoutSeconds: "15", queryTimeoutSeconds: "120" }
}

export function databaseDraftFromSource(source: { name: string; config: Record<string, unknown> }): DatabaseDraft {
  const config = (source.config.database ?? {}) as Partial<DatabaseConfig>
  const engine = (config.engine ?? "POSTGRESQL") as DatabaseEngine
  return {
    name: source.name,
    engine,
    host: config.host ?? "",
    port: config.port ? String(config.port) : "",
    database: config.database ?? "",
    username: config.username ?? "",
    password: "",
    instanceName: config.instanceName ?? "",
    tlsMode: config.tls?.mode ?? DEFAULT_TLS_MODE[engine],
    caCertificate: config.tls?.caCertificate ?? "",
    connectTimeoutSeconds: String(Math.round((config.connectTimeoutMs ?? 15_000) / 1000)),
    queryTimeoutSeconds: String(Math.round((config.queryTimeoutMs ?? 120_000) / 1000)),
  }
}

/** Mudar de banco reaplica os padrões dele (porta, criptografia) sem apagar o que já foi digitado. */
export function switchEngine(draft: DatabaseDraft, engine: DatabaseEngine): DatabaseDraft {
  return { ...draft, engine, tlsMode: DEFAULT_TLS_MODE[engine], instanceName: engine === "SQLSERVER" ? draft.instanceName : "" }
}

export function toDatabaseConfig(draft: DatabaseDraft): DatabaseConfig {
  const port = Number(draft.port)
  const usesInstance = draft.engine === "SQLSERVER" && draft.instanceName.trim().length > 0
  const tls: DatabaseConfig["tls"] = { mode: draft.tlsMode }
  if (draft.tlsMode === "VERIFY_FULL" && draft.caCertificate.trim()) tls.caCertificate = draft.caCertificate.trim()
  return {
    engine: draft.engine,
    host: draft.host.trim(),
    ...(Number.isInteger(port) && port > 0 && !usesInstance ? { port } : {}),
    database: draft.database.trim(),
    username: draft.username.trim(),
    ...(usesInstance ? { instanceName: draft.instanceName.trim() } : {}),
    tls,
    connectTimeoutMs: Math.min(60, Math.max(1, Number(draft.connectTimeoutSeconds) || 15)) * 1000,
    queryTimeoutMs: Math.min(600, Math.max(1, Number(draft.queryTimeoutSeconds) || 120)) * 1000,
  }
}

const HOST_PATTERN = /^[^\s/@]+$/

export function databaseDraftProblems(draft: DatabaseDraft, requirePassword: boolean): string[] {
  const problems: string[] = []
  if (draft.name.trim().length < 2) problems.push("Dê um nome à conexão.")
  if (!draft.host.trim()) problems.push("Informe o servidor.")
  else if (!HOST_PATTERN.test(draft.host.trim()) || /:\/\//.test(draft.host)) problems.push("No servidor, informe só o nome ou IP (sem protocolo, usuário ou caminho).")
  else if (/:\d+$/.test(draft.host.trim()) && draft.host.split(":").length === 2) problems.push("Informe a porta no campo Porta.")
  if (draft.port && !(Number.isInteger(Number(draft.port)) && Number(draft.port) > 0 && Number(draft.port) < 65536)) problems.push("Porta inválida.")
  if (!draft.database.trim()) problems.push("Informe o banco de dados.")
  if (!draft.username.trim()) problems.push("Informe o usuário.")
  if (requirePassword && !draft.password) problems.push("Informe a senha.")
  return problems
}

/** Assinatura do que foi testado — mudar qualquer campo invalida o teste anterior. */
export function draftSignature(draft: DatabaseDraft): string {
  return JSON.stringify({ ...toDatabaseConfig(draft), password: draft.password ? `len:${draft.password.length}:${draft.password.slice(-1)}` : "" })
}

function Field({ id, label, hint, children, className }: { id: string; label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function DatabaseConnectionFields({ draft, onChange, passwordMode }: { draft: DatabaseDraft; onChange: (next: DatabaseDraft) => void; passwordMode: "create" | "rotate" }) {
  const set = <K extends keyof DatabaseDraft>(key: K, value: DatabaseDraft[K]) => onChange({ ...draft, [key]: value })
  const usesInstance = draft.engine === "SQLSERVER" && draft.instanceName.trim().length > 0
  return (
    <div className="space-y-4">
      <Field id="db-name" label="Nome da conexão" hint="Como esta conexão aparece na Central (ex.: RH corporativo).">
        <Input id="db-name" value={draft.name} onChange={(event) => set("name", event.target.value)} placeholder={`Ex.: ${DATABASE_ENGINE_LABELS[draft.engine]} do RH`} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <Field id="db-host" label="Servidor" hint="Nome ou IP, como o servidor da INIA o enxerga na rede.">
          <Input id="db-host" value={draft.host} onChange={(event) => set("host", event.target.value)} placeholder="db.empresa.com.br" autoComplete="off" spellCheck={false} />
        </Field>
        <Field id="db-port" label="Porta">
          <Input id="db-port" inputMode="numeric" value={usesInstance ? "" : draft.port} disabled={usesInstance} onChange={(event) => set("port", event.target.value.replace(/\D/g, ""))} placeholder={usesInstance ? "automática" : String(DEFAULT_DATABASE_PORTS[draft.engine])} />
        </Field>
      </div>
      {draft.engine === "SQLSERVER" ? (
        <Field id="db-instance" label="Instância (opcional)" hint="Só para instância nomeada (ex.: SQLEXPRESS). Com instância, a porta é descoberta pelo SQL Browser (UDP 1434).">
          <Input id="db-instance" value={draft.instanceName} onChange={(event) => set("instanceName", event.target.value)} placeholder="SQLEXPRESS" autoComplete="off" />
        </Field>
      ) : null}
      <Field id="db-database" label="Banco de dados">
        <Input id="db-database" value={draft.database} onChange={(event) => set("database", event.target.value)} placeholder="rh" autoComplete="off" spellCheck={false} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="db-user" label="Usuário" hint="Use um usuário só com permissão de leitura.">
          <Input id="db-user" value={draft.username} onChange={(event) => set("username", event.target.value)} autoComplete="off" spellCheck={false} />
        </Field>
        <Field id="db-password" label="Senha" hint={passwordMode === "rotate" ? "Em branco = manter a senha guardada. Nunca é exibida depois de salva." : "Guardada cifrada; nunca exibida de novo."}>
          <Input id="db-password" type="password" autoComplete="new-password" value={draft.password} onChange={(event) => set("password", event.target.value)} />
        </Field>
      </div>

      <Collapsible className="rounded-lg border border-border">
        <CollapsibleTrigger className="group flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium">
          <span>Opções avançadas</span>
          <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
            Criptografia: {DATABASE_TLS_LABELS[draft.tlsMode]}
            <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 border-t border-border px-3 py-3">
          <Field id="db-tls" label="Criptografia da conexão (TLS)" hint={draft.engine === "SQLSERVER" ? "Padrão do SQL Server: cifrar sem validar o certificado (o SQL Server usa certificado próprio). Para validar, escolha a última opção." : "Padrão: usar TLS quando o servidor oferecer, como os clientes nativos do banco."}>
            <Select value={draft.tlsMode} onValueChange={(value) => set("tlsMode", value as DatabaseTlsMode)}>
              <SelectTrigger id="db-tls" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {supportedTlsModes(draft.engine).map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {DATABASE_TLS_LABELS[mode]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {draft.tlsMode === "VERIFY_FULL" ? (
            <Field id="db-ca" label="Certificado da autoridade (CA), opcional" hint="Formato PEM. Necessário quando o certificado do servidor é emitido por uma CA interna.">
              <Textarea id="db-ca" rows={4} value={draft.caCertificate} onChange={(event) => set("caCertificate", event.target.value)} className="font-mono text-xs" placeholder="-----BEGIN CERTIFICATE-----" />
            </Field>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="db-connect-timeout" label="Tempo-limite para conectar (s)">
              <Input id="db-connect-timeout" inputMode="numeric" value={draft.connectTimeoutSeconds} onChange={(event) => set("connectTimeoutSeconds", event.target.value.replace(/\D/g, ""))} />
            </Field>
            <Field id="db-query-timeout" label="Tempo-limite por consulta (s)">
              <Input id="db-query-timeout" inputMode="numeric" value={draft.queryTimeoutSeconds} onChange={(event) => set("queryTimeoutSeconds", event.target.value.replace(/\D/g, ""))} />
            </Field>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <p className="flex gap-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          A conexão sai do <strong className="font-medium text-foreground">servidor da INIA</strong>, não do seu navegador. Se o banco fica numa rede privada, ela precisa estar acessível a partir desse servidor (VPN, liberação de firewall ou túnel). A INIA só lê — nunca cria nem altera nada no banco do cliente.
        </span>
      </p>
    </div>
  )
}

/** Resultado do "Testar conexão" em linguagem de quem configura. */
export function DatabaseTestResult({ result }: { result: ConnectionTest }) {
  if (result.health === "ERROR") {
    return (
      <div role="status" className="space-y-1 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200" data-testid="database-test-result">
        <p className="flex items-center gap-2 font-medium">
          <XCircle className="size-4" aria-hidden /> Não foi possível conectar
        </p>
        <p>{result.detail}</p>
        {result.errorCode ? <p className="font-mono text-xs opacity-80">{result.errorCode}</p> : null}
      </div>
    )
  }
  const report = result.database
  return (
    <div role="status" className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100" data-testid="database-test-result">
      <p className="flex items-center gap-2 font-medium">
        <CheckCircle2 className="size-4" aria-hidden /> Conexão OK
      </p>
      {report ? (
        <ul className="space-y-1 text-xs">
          <li>{report.serverVersion}</li>
          <li className="flex items-center gap-1.5">
            {report.tlsActive ? <Lock className="size-3.5" aria-hidden /> : <LockOpen className="size-3.5" aria-hidden />}
            {report.tlsActive ? "Tráfego cifrado (TLS)" : "Tráfego SEM criptografia — use só em rede privada confiável"}
          </li>
          <li className="flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" aria-hidden />
            {report.readOnlyEnforced ? "Sessão somente leitura garantida pelo próprio banco" : "Somente leitura garantida pela INIA (só consultas de leitura); recomendamos um usuário apenas com permissão de leitura"}
          </li>
          <li>
            {report.objectsVisible} tabela(s)/visão(ões) que este usuário pode ler
          </li>
        </ul>
      ) : (
        <p className="text-xs">{result.detail}</p>
      )}
      {report?.engineMismatch ? <p className="flex gap-1.5 text-xs text-amber-800 dark:text-amber-200"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />{report.engineMismatch}</p> : null}
      {report?.privilegeWarning ? <p className="flex gap-1.5 text-xs text-amber-800 dark:text-amber-200"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />{report.privilegeWarning}</p> : null}
    </div>
  )
}
