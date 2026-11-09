"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { SourceKind } from "@/schemas/admin/data-hub.schema"

/** Configuração do conector de um feed (o "como buscar/receber" deste conjunto de dados). */
export type ConnectorDraft = {
  // arquivo (upload/SFTP)
  format: "CSV" | "XLSX"
  encoding: "utf-8" | "windows-1252" | "latin1"
  delimiter: "auto" | "," | ";" | "\t" | "|"
  sheet: string
  hasHeader: boolean
  // SFTP
  filePattern: string
  // API Pull
  endpoint: string
  method: "GET" | "POST"
  extractPath: string
  queryParamsText: string
  paginationKind: "NONE" | "PAGE_NUMBER" | "OFFSET" | "CURSOR"
  pageParam: string
  sizeParam: string
  pageSize: number
  offsetParam: string
  limitParam: string
  cursorParam: string
  nextCursorPath: string
  checkpointKind: "NONE" | "WATERMARK"
  watermarkField: string
  watermarkParam: string
  // API Push
  pushExtractPath: string
}

export function emptyConnectorDraft(): ConnectorDraft {
  return {
    format: "CSV",
    encoding: "utf-8",
    delimiter: "auto",
    sheet: "",
    hasHeader: true,
    filePattern: "",
    endpoint: "",
    method: "GET",
    extractPath: "",
    queryParamsText: "",
    paginationKind: "NONE",
    pageParam: "page",
    sizeParam: "pageSize",
    pageSize: 500,
    offsetParam: "offset",
    limitParam: "limit",
    cursorParam: "cursor",
    nextCursorPath: "meta.nextCursor",
    checkpointKind: "NONE",
    watermarkField: "",
    watermarkParam: "since",
    pushExtractPath: "records",
  }
}

export function connectorDraftFrom(config: Record<string, unknown>): ConnectorDraft {
  const draft = emptyConnectorDraft()
  const connector = config.connector as SourceKind | undefined
  const file = (connector === "FILE_UPLOAD" ? config.file : connector === "SFTP" ? config.sftp : null) as Record<string, unknown> | null
  if (file) {
    draft.format = (file.format as "CSV" | "XLSX") ?? "CSV"
    const csv = (file.csv ?? {}) as Record<string, unknown>
    draft.encoding = (csv.encoding as ConnectorDraft["encoding"]) ?? "utf-8"
    draft.delimiter = (csv.delimiter as ConnectorDraft["delimiter"]) ?? "auto"
    draft.hasHeader = (csv.hasHeader as boolean) ?? true
    draft.sheet = String(((file.excel ?? {}) as Record<string, unknown>).sheet ?? "")
    draft.filePattern = String(file.filePattern ?? "")
  }
  if (connector === "API_PULL") {
    const api = (config.api ?? {}) as Record<string, unknown>
    draft.endpoint = String(api.endpoint ?? "")
    draft.method = (api.method as "GET" | "POST") ?? "GET"
    draft.extractPath = String(api.extractPath ?? "")
    draft.queryParamsText = Object.entries((api.queryParams ?? {}) as Record<string, string>)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")
    const pagination = (api.pagination ?? { kind: "NONE" }) as Record<string, unknown>
    draft.paginationKind = (pagination.kind as ConnectorDraft["paginationKind"]) ?? "NONE"
    draft.pageParam = String(pagination.pageParam ?? "page")
    draft.sizeParam = String(pagination.sizeParam ?? "pageSize")
    draft.pageSize = Number(pagination.pageSize ?? pagination.limit ?? 500)
    draft.offsetParam = String(pagination.offsetParam ?? "offset")
    draft.limitParam = String(pagination.limitParam ?? "limit")
    draft.cursorParam = String(pagination.cursorParam ?? "cursor")
    draft.nextCursorPath = String(pagination.nextCursorPath ?? "meta.nextCursor")
    const checkpoint = (api.checkpoint ?? { kind: "NONE" }) as Record<string, unknown>
    draft.checkpointKind = (checkpoint.kind as ConnectorDraft["checkpointKind"]) ?? "NONE"
    draft.watermarkField = String(checkpoint.sourceField ?? "")
    draft.watermarkParam = String(checkpoint.requestParam ?? "since")
  }
  if (connector === "API_PUSH") draft.pushExtractPath = String(((config.push ?? {}) as Record<string, unknown>).extractPath ?? "records")
  return draft
}

export function toConnectorConfig(kind: SourceKind, draft: ConnectorDraft): Record<string, unknown> {
  const file = { format: draft.format, csv: { encoding: draft.encoding, delimiter: draft.delimiter, hasHeader: draft.hasHeader, skipRows: 0 }, excel: { sheet: draft.sheet || undefined, hasHeader: draft.hasHeader, skipRows: 0 } }
  switch (kind) {
    case "FILE_UPLOAD":
      return { connector: "FILE_UPLOAD", file }
    case "SFTP":
      return { connector: "SFTP", sftp: { ...file, filePattern: draft.filePattern.trim() } }
    case "API_PUSH":
      return { connector: "API_PUSH", push: { extractPath: draft.pushExtractPath.trim() || "records" } }
    case "API_PULL": {
      const queryParams: Record<string, string> = {}
      for (const line of draft.queryParamsText.split("\n")) {
        const index = line.indexOf("=")
        if (index > 0) queryParams[line.slice(0, index).trim()] = line.slice(index + 1).trim()
      }
      const pagination =
        draft.paginationKind === "PAGE_NUMBER"
          ? { kind: "PAGE_NUMBER", pageParam: draft.pageParam, sizeParam: draft.sizeParam || undefined, pageSize: draft.pageSize, startPage: 1 }
          : draft.paginationKind === "OFFSET"
            ? { kind: "OFFSET", offsetParam: draft.offsetParam, limitParam: draft.limitParam, limit: draft.pageSize }
            : draft.paginationKind === "CURSOR"
              ? { kind: "CURSOR", cursorParam: draft.cursorParam, nextCursorPath: draft.nextCursorPath }
              : { kind: "NONE" }
      const checkpoint = draft.checkpointKind === "WATERMARK" ? { kind: "WATERMARK", sourceField: draft.watermarkField.trim(), requestParam: draft.watermarkParam.trim() || "since" } : { kind: "NONE" }
      return { connector: "API_PULL", api: { endpoint: draft.endpoint.trim(), method: draft.method, queryParams, headers: {}, extractPath: draft.extractPath.trim(), pagination, checkpoint, maxPages: 500 } }
    }
    case "DATABASE":
      // Banco externo tem editor próprio (database/database-feed-settings.tsx) — este formulário nunca o monta.
      throw new Error("Conjunto de banco de dados é configurado pelo editor de banco.")
  }
}

export function connectorDraftValid(kind: SourceKind, draft: ConnectorDraft): boolean {
  if (kind === "API_PULL") {
    if (!draft.endpoint.trim()) return false
    if (draft.checkpointKind === "WATERMARK" && !draft.watermarkField.trim()) return false
  }
  if (kind === "SFTP" && !draft.filePattern.trim()) return false
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

export function FileOptionsFields({ draft, onChange, sheets }: { draft: ConnectorDraft; onChange: (next: ConnectorDraft) => void; sheets?: string[] }) {
  const set = <K extends keyof ConnectorDraft>(key: K, value: ConnectorDraft[K]) => onChange({ ...draft, [key]: value })
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field id="file-format" label="Formato">
        <Select value={draft.format} onValueChange={(value) => set("format", value as "CSV" | "XLSX")}>
          <SelectTrigger id="file-format" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="CSV">CSV (.csv)</SelectItem>
            <SelectItem value="XLSX">Excel (.xlsx)</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {draft.format === "CSV" ? (
        <>
          <Field id="file-encoding" label="Codificação">
            <Select value={draft.encoding} onValueChange={(value) => set("encoding", value as ConnectorDraft["encoding"])}>
              <SelectTrigger id="file-encoding" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="utf-8">UTF-8</SelectItem>
                <SelectItem value="windows-1252">Windows-1252 (Excel BR)</SelectItem>
                <SelectItem value="latin1">Latin-1 (ISO-8859-1)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field id="file-delimiter" label="Separador">
            <Select value={draft.delimiter} onValueChange={(value) => set("delimiter", value as ConnectorDraft["delimiter"])}>
              <SelectTrigger id="file-delimiter" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Detectar automaticamente</SelectItem>
                <SelectItem value=";">Ponto e vírgula (;)</SelectItem>
                <SelectItem value=",">Vírgula (,)</SelectItem>
                <SelectItem value={"\t"}>Tab</SelectItem>
                <SelectItem value="|">Barra vertical (|)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </>
      ) : (
        <Field id="file-sheet" label="Aba (sheet)" hint="Vazio = primeira aba. Macros nunca são executadas.">
          {sheets && sheets.length > 0 ? (
            <Select value={draft.sheet || sheets[0]} onValueChange={(value) => set("sheet", value)}>
              <SelectTrigger id="file-sheet" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sheets.map((sheet) => (
                  <SelectItem key={sheet} value={sheet}>
                    {sheet}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input id="file-sheet" value={draft.sheet} onChange={(event) => set("sheet", event.target.value)} placeholder="Ex.: Medições" />
          )}
        </Field>
      )}
    </div>
  )
}

export function FeedConnectorForm({ kind, draft, onChange, sheets }: { kind: SourceKind; draft: ConnectorDraft; onChange: (next: ConnectorDraft) => void; sheets?: string[] }) {
  const set = <K extends keyof ConnectorDraft>(key: K, value: ConnectorDraft[K]) => onChange({ ...draft, [key]: value })
  if (kind === "FILE_UPLOAD") return <FileOptionsFields draft={draft} onChange={onChange} sheets={sheets} />
  if (kind === "SFTP") {
    return (
      <div className="space-y-4">
        <Field id="sftp-pattern" label="Padrão de arquivo" hint="Glob simples: employees_*.csv, medicoes_????.xlsx. Cada padrão é um feed; o arquivo mais antigo ainda não processado entra primeiro.">
          <Input id="sftp-pattern" value={draft.filePattern} onChange={(event) => set("filePattern", event.target.value)} placeholder="employees_*.csv" />
        </Field>
        <FileOptionsFields draft={draft} onChange={onChange} sheets={sheets} />
      </div>
    )
  }
  if (kind === "API_PUSH") {
    return (
      <Field id="push-path" label="Caminho dos registros no corpo" hint='Dot path até a lista de registros no JSON enviado (padrão "records").'>
        <Input id="push-path" value={draft.pushExtractPath} onChange={(event) => set("pushExtractPath", event.target.value)} />
      </Field>
    )
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
        <Field id="api-method" label="Método">
          <Select value={draft.method} onValueChange={(value) => set("method", value as "GET" | "POST")}>
            <SelectTrigger id="api-method" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="GET">GET</SelectItem>
              <SelectItem value="POST">POST</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field id="api-endpoint" label="Endpoint" hint="Relativo à Base URL da fonte (ex.: /v1/medicoes).">
          <Input id="api-endpoint" value={draft.endpoint} onChange={(event) => set("endpoint", event.target.value)} placeholder="/v1/medicoes" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="api-extract" label="Caminho dos registros (extract path)" hint='Dot path até a lista na resposta (ex.: "data.items"). Vazio = a resposta é a lista.'>
          <Input id="api-extract" value={draft.extractPath} onChange={(event) => set("extractPath", event.target.value)} placeholder="data" />
        </Field>
        <Field id="api-query" label="Query params fixos (opcional)" hint="Um por linha, chave=valor. Sem liberar a configuração, os valores aparecem ocultos; deixar oculto mantém o valor atual.">
          <Input id="api-query" value={draft.queryParamsText} onChange={(event) => set("queryParamsText", event.target.value)} placeholder="tipo=diario" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="api-pagination" label="Paginação">
          <Select value={draft.paginationKind} onValueChange={(value) => set("paginationKind", value as ConnectorDraft["paginationKind"])}>
            <SelectTrigger id="api-pagination" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">Sem paginação</SelectItem>
              <SelectItem value="PAGE_NUMBER">Por número de página</SelectItem>
              <SelectItem value="OFFSET">Por offset/limit</SelectItem>
              <SelectItem value="CURSOR">Por cursor</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {draft.paginationKind === "PAGE_NUMBER" ? (
          <div className="grid grid-cols-3 gap-2">
            <Field id="api-page-param" label="Param página">
              <Input id="api-page-param" value={draft.pageParam} onChange={(event) => set("pageParam", event.target.value)} />
            </Field>
            <Field id="api-size-param" label="Param tamanho">
              <Input id="api-size-param" value={draft.sizeParam} onChange={(event) => set("sizeParam", event.target.value)} />
            </Field>
            <Field id="api-page-size" label="Tamanho">
              <Input id="api-page-size" type="number" min={1} value={draft.pageSize} onChange={(event) => set("pageSize", Number(event.target.value) || 500)} />
            </Field>
          </div>
        ) : null}
        {draft.paginationKind === "OFFSET" ? (
          <div className="grid grid-cols-3 gap-2">
            <Field id="api-offset-param" label="Param offset">
              <Input id="api-offset-param" value={draft.offsetParam} onChange={(event) => set("offsetParam", event.target.value)} />
            </Field>
            <Field id="api-limit-param" label="Param limit">
              <Input id="api-limit-param" value={draft.limitParam} onChange={(event) => set("limitParam", event.target.value)} />
            </Field>
            <Field id="api-limit" label="Limit">
              <Input id="api-limit" type="number" min={1} value={draft.pageSize} onChange={(event) => set("pageSize", Number(event.target.value) || 500)} />
            </Field>
          </div>
        ) : null}
        {draft.paginationKind === "CURSOR" ? (
          <div className="grid grid-cols-2 gap-2">
            <Field id="api-cursor-param" label="Param cursor">
              <Input id="api-cursor-param" value={draft.cursorParam} onChange={(event) => set("cursorParam", event.target.value)} />
            </Field>
            <Field id="api-next-cursor" label="Caminho do próximo cursor">
              <Input id="api-next-cursor" value={draft.nextCursorPath} onChange={(event) => set("nextCursorPath", event.target.value)} />
            </Field>
          </div>
        ) : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="api-checkpoint" label="Checkpoint incremental" hint="Com watermark, a INIA guarda o maior valor visto e envia no parâmetro na próxima carga — só avança depois de aplicar com sucesso.">
          <Select value={draft.checkpointKind} onValueChange={(value) => set("checkpointKind", value as ConnectorDraft["checkpointKind"])}>
            <SelectTrigger id="api-checkpoint" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">Sempre carga completa</SelectItem>
              <SelectItem value="WATERMARK">Watermark (campo de data/sequência)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {draft.checkpointKind === "WATERMARK" ? (
          <div className="grid grid-cols-2 gap-2">
            <Field id="api-wm-field" label="Campo na resposta">
              <Input id="api-wm-field" value={draft.watermarkField} onChange={(event) => set("watermarkField", event.target.value)} placeholder="atualizadoEm" />
            </Field>
            <Field id="api-wm-param" label="Parâmetro enviado">
              <Input id="api-wm-param" value={draft.watermarkParam} onChange={(event) => set("watermarkParam", event.target.value)} placeholder="since" />
            </Field>
          </div>
        ) : null}
      </div>
    </div>
  )
}
