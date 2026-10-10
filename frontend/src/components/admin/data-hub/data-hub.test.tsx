/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import type { DataContract, Preview } from "@/schemas/admin/data-hub.schema"

import { formatBytes, formatDuration, formatFuture, formatRelative } from "./data-hub-format"
import { MappingEditor } from "./mapping-editor"
import { PreviewTable } from "./preview-table"
import { ConnectionHealthBadge, FeedStatusBadge, FreshnessBadge, RunStatusBadge, SourceStatusBadge } from "./status-badges"
import { connectionDraftValid, emptyConnectionDraft, toSourcePayload } from "./connection-form"
import { connectorDraftFrom, emptyConnectorDraft, toConnectorConfig } from "./feed-connector-form"

afterEach(cleanup)

const CONTRACT: DataContract = {
  key: "EMPLOYEES",
  version: 1,
  label: "Colaboradores",
  description: "Cadastro de pessoas.",
  category: "MASTER",
  targetEntity: "people",
  fields: [
    { key: "externalEmployeeId", label: "Matrícula / ID externo", type: "STRING", required: true, identity: true, description: "Identidade.", example: "OP-1" },
    { key: "name", label: "Nome", type: "STRING", required: true, description: "Nome.", example: "Ana" },
    { key: "role", label: "Papel", type: "ENUM", required: true, enumValues: ["OPERATOR", "SUPERVISOR"], description: "Papel.", example: "OPERATOR" },
    { key: "hiredAt", label: "Admissão", type: "DATE", required: false, description: "Data.", example: "2024-01-01" },
    { key: "currentStatus", label: "Situação funcional (bruta)", type: "STRING", required: false, description: "Situação.", example: "FERIAS" },
  ],
  naturalKey: ["externalEmployeeId"],
  dependencies: ["GROUPS"],
  writeSemantics: "UPSERT",
  writePolicy: "PARTIAL_ALLOWED",
  businessTimeField: null,
  examples: [],
}

describe("formatação da Central", () => {
  const now = new Date("2026-09-16T15:00:00Z")
  it("tempo relativo, futuro, duração e bytes em pt-BR", () => {
    expect(formatRelative(null, now)).toBe("nunca")
    expect(formatRelative("2026-09-16T14:48:00Z", now)).toBe("há 12 min")
    expect(formatRelative("2026-09-16T11:00:00Z", now)).toBe("há 4 h")
    expect(formatRelative("2026-09-13T15:00:00Z", now)).toBe("há 3 dias")
    expect(formatFuture("2026-09-16T15:15:00Z", now)).toBe("em 15 min")
    expect(formatFuture("2026-09-16T14:00:00Z", now)).toBe("agora")
    expect(formatDuration(443)).toBe("443 ms")
    expect(formatDuration(6495)).toBe("6.5 s")
    expect(formatDuration(125_000)).toBe("2 min 5 s")
    expect(formatBytes(2560)).toBe("2.5 KB")
  })
})

describe("badges de status — ícone + texto, nunca só cor", () => {
  it("status da fonte, saúde da conexão e atualidade são conceitos distintos com rótulos próprios", () => {
    render(
      <TooltipProvider>
        <SourceStatusBadge status="ERROR" />
        <ConnectionHealthBadge health="HEALTHY" />
        <FreshnessBadge freshness="STALE" lastSuccessAt="2026-09-16T11:00:00Z" />
        <FeedStatusBadge status="DEGRADED" />
        <RunStatusBadge status="PARTIAL" />
        <RunStatusBadge status="APPLYING" />
      </TooltipProvider>,
    )
    expect(screen.getByText("Erro")).toBeInTheDocument()
    expect(screen.getByText("Conexão OK")).toBeInTheDocument()
    expect(screen.getByText("Atrasado")).toBeInTheDocument()
    expect(screen.getByText("Degradado")).toBeInTheDocument()
    expect(screen.getByText("Parcial")).toBeInTheDocument()
    expect(screen.getByText("Aplicando")).toBeInTheDocument()
    // Cada badge carrega um ícone SVG além do texto.
    expect(document.querySelectorAll("svg").length).toBeGreaterThanOrEqual(6)
  })

  it("sem feed ativo, a atualidade diz 'Sem feed' em vez de fingir dado", () => {
    render(
      <TooltipProvider>
        <FreshnessBadge freshness={null} />
      </TooltipProvider>,
    )
    expect(screen.getByText("Sem feed")).toBeInTheDocument()
  })
})

describe("editor de mapeamento", () => {
  it("mostra obrigatórios mapeados, aplica a sugestão por nome e permite desmapear", () => {
    const changes: unknown[] = []
    const { rerender } = render(<MappingEditor contract={CONTRACT} columns={["matricula", "nome", "perfil"]} value={{ fields: [] }} onChange={(next) => changes.push(next)} suggestion={{ fields: [{ target: "externalEmployeeId", source: "matricula", transforms: [] }, { target: "name", source: "nome", transforms: [] }] }} />)
    expect(screen.getByText("0/3 obrigatórios mapeados · 0 campo(s) no total")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Sugerir por nome/ }))
    expect(changes).toHaveLength(1)
    const suggested = changes[0] as { fields: { target: string; source: string | null }[] }
    expect(suggested.fields.map((field) => field.target)).toEqual(["externalEmployeeId", "name"])
    rerender(<MappingEditor contract={CONTRACT} columns={["matricula", "nome", "perfil"]} value={suggested as never} onChange={(next) => changes.push(next)} />)
    expect(screen.getByText("2/3 obrigatórios mapeados · 2 campo(s) no total")).toBeInTheDocument()
    expect(screen.getAllByText("obrigatório")).toHaveLength(3)
    expect(screen.getByText("identidade")).toBeInTheDocument()
  })
})

describe("preview ✓/✕ por registro", () => {
  it("resume válidos × com erro, lista problemas de mapeamento e marca o campo com erro", () => {
    const preview: Preview = {
      rows: [
        { recordNumber: 1, sourceRecordKey: "OP-1", valid: true, record: { externalEmployeeId: "OP-1", name: "Ana", role: "OPERATOR", hiredAt: null, currentStatus: "FER" }, errors: [], normalized: { currentStatus: "FÉRIAS" } },
        { recordNumber: 2, sourceRecordKey: null, valid: false, record: { externalEmployeeId: null, name: "Bia", role: "OPERATOR", hiredAt: null, currentStatus: "XYZ" }, errors: [{ code: "DATA_REQUIRED_FIELD_MISSING", field: "externalEmployeeId", message: "Matrícula é obrigatória." }], normalized: { currentStatus: null } },
      ],
      sampled: 2,
      valid: 1,
      rejected: 1,
      mappingProblems: [],
      schemaWarnings: [],
      fingerprint: { columns: ["matricula", "nome"], hash: "abc" },
      errorSummary: [{ code: "DATA_REQUIRED_FIELD_MISSING", count: 1 }],
    }
    render(
      <TooltipProvider>
        <PreviewTable preview={preview} contract={CONTRACT} />
      </TooltipProvider>,
    )
    expect(screen.getByText("1 válido(s)")).toBeInTheDocument()
    expect(screen.getByText("1 com erro")).toBeInTheDocument()
    expect(screen.getByText("1 × DATA_REQUIRED_FIELD_MISSING")).toBeInTheDocument()
    // Valor de origem × normalizado: "FER → FÉRIAS"; desconhecido fica explícito.
    const normalized = screen.getAllByTestId("preview-normalized")
    expect(normalized[0]).toHaveTextContent("→ FÉRIAS")
    expect(normalized[1]).toHaveTextContent("→ não reconhecido")
    expect(screen.getByLabelText("Válido")).toBeInTheDocument()
    expect(screen.getByLabelText("Com erro")).toBeInTheDocument()
    expect(screen.getByTitle("DATA_REQUIRED_FIELD_MISSING: Matrícula é obrigatória.")).toBeInTheDocument()
  })
})

describe("rascunhos de conexão e conector → payload da API (sem segredo em claro fora do envio)", () => {
  it("API Pull com Bearer exige token na criação e não o inclui quando vazio na edição", () => {
    const draft = { ...emptyConnectionDraft(), name: "API RH", baseUrl: "https://api.cliente.com.br", authKind: "BEARER" as const }
    expect(connectionDraftValid("API_PULL", draft, true)).toBe(false)
    expect(connectionDraftValid("API_PULL", draft, false)).toBe(true)
    const payload = toSourcePayload("API_PULL", { ...draft, token: "abc" })
    expect(payload.config).toEqual({ kind: "API_PULL", api: { baseUrl: "https://api.cliente.com.br", auth: { kind: "BEARER" }, headers: {}, timeoutMs: 30000 } })
    expect(payload.secrets).toEqual({ token: "abc" })
    expect(toSourcePayload("API_PULL", draft).secrets).toBeUndefined()
  })

  it("SFTP com chave privada e fingerprint; conector com paginação e watermark vai e volta sem perder nada", () => {
    const sftp = { ...emptyConnectionDraft(), name: "SFTP", host: "sftp.x", username: "inia", sftpAuthKind: "PRIVATE_KEY" as const, privateKey: "-----BEGIN", hostKeyFingerprint: "SHA256:abc" }
    const payload = toSourcePayload("SFTP", sftp)
    expect(payload.config).toMatchObject({ kind: "SFTP", sftp: { host: "sftp.x", port: 22, authKind: "PRIVATE_KEY", hostKeyFingerprint: "SHA256:abc" } })
    expect(payload.secrets).toEqual({ privateKey: "-----BEGIN" })

    const connector = { ...emptyConnectorDraft(), endpoint: "/v1/medicoes", extractPath: "data", paginationKind: "PAGE_NUMBER" as const, pageSize: 4, checkpointKind: "WATERMARK" as const, watermarkField: "atualizadoEm", watermarkParam: "since" }
    const config = toConnectorConfig("API_PULL", connector)
    expect(config).toMatchObject({ connector: "API_PULL", api: { endpoint: "/v1/medicoes", extractPath: "data", pagination: { kind: "PAGE_NUMBER", pageSize: 4 }, checkpoint: { kind: "WATERMARK", sourceField: "atualizadoEm", requestParam: "since" } } })
    const back = connectorDraftFrom(config)
    expect(back.endpoint).toBe("/v1/medicoes")
    expect(back.paginationKind).toBe("PAGE_NUMBER")
    expect(back.pageSize).toBe(4)
    expect(back.watermarkField).toBe("atualizadoEm")
  })
})
