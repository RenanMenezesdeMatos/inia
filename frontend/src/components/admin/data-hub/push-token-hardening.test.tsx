/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { PushToken, SourceDetail } from "@/schemas/admin/data-hub.schema"

import { SourceDetailPage } from "./source-detail-page"

const service = vi.hoisted(() => ({ fetchSource: vi.fn(), createPushToken: vi.fn(), revokePushToken: vi.fn(), rotatePushToken: vi.fn(), downloadPushOpenApi: vi.fn() }))
vi.mock("@/services/admin/data-hub-service", () => service)
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/admin/data-hub", useSearchParams: () => new URLSearchParams() }))

const NOW = "2026-10-20T12:00:00.000Z"
const token = (overrides: Partial<PushToken>): PushToken => ({ id: "tok-1", label: "Integração RH", tokenPrefix: "inia_push_abcd…", feedId: null, createdAt: NOW, lastUsedAt: null, revokedAt: null, expiresAt: null, allowedNetworks: null, ...overrides })

function source(overrides: Partial<SourceDetail>): SourceDetail {
  return {
    id: "src-push",
    publicId: "pushrh01",
    name: "API RH (push)",
    description: null,
    kind: "API_PUSH",
    status: "ACTIVE",
    config: { kind: "API_PUSH" },
    connectionHealth: "UNKNOWN",
    connectionCheckedAt: null,
    connectionError: null,
    createdAt: NOW,
    updatedAt: NOW,
    feedCount: 0,
    activeFeedCount: 0,
    freshness: "NEVER",
    lastRunAt: null,
    lastSuccessAt: null,
    lastDataAt: null,
    nextSyncAt: null,
    lastRecordsReceived: null,
    lastRecordsRejected: null,
    feeds: [],
    secrets: [],
    tokens: [],
    transportWarning: null,
    configAccess: { required: false, unlocked: true, expiresAt: null, fields: [] },
    createdByName: null,
    updatedByName: null,
    lastChangedAt: null,
    ...overrides,
  } as SourceDetail
}

beforeAll(() => installJsdomStubs())
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Tokens de push — validade e IPs autorizados (R-28)", () => {
  it("mostra validade, IPs e o token vencido como 'Vencido'", async () => {
    service.fetchSource.mockResolvedValue(
      source({
        tokens: [
          token({ id: "tok-1", label: "Integração RH", expiresAt: "2027-10-20T12:00:00.000Z", allowedNetworks: ["10.0.0.0/24"] }),
          token({ id: "tok-2", label: "Integração antiga", expiresAt: "2026-01-01T12:00:00.000Z" }),
          token({ id: "tok-3", label: "Sem prazo" }),
        ],
      }),
    )
    renderWithQuery(<SourceDetailPage sourceId="src-push" />)
    expect(await screen.findByText("Só de 10.0.0.0/24")).toBeInTheDocument()
    expect(screen.getByText(/^Vencido em/)).toBeInTheDocument()
    expect(screen.getByText("Sem validade")).toBeInTheDocument()
  })

  it("cria o token com 1 ano de validade por padrão e a lista de IPs digitada", async () => {
    service.fetchSource.mockResolvedValue(source({}))
    service.createPushToken.mockResolvedValue({ ...token({}), token: "inia_push_segredo" })
    renderWithQuery(<SourceDetailPage sourceId="src-push" />)
    fireEvent.change(await screen.findByLabelText("Rótulo do token"), { target: { value: "Integração RH" } })
    fireEvent.change(screen.getByLabelText("IPs ou redes autorizadas"), { target: { value: "10.0.0.5, 10.1.0.0/24" } })
    fireEvent.click(screen.getByRole("button", { name: /Novo token/ }))
    await waitFor(() => expect(service.createPushToken).toHaveBeenCalledWith("src-push", { label: "Integração RH", feedId: null, expiresInDays: 365, allowedNetworks: ["10.0.0.5", "10.1.0.0/24"] }))
    expect(await screen.findByDisplayValue("inia_push_segredo")).toBeInTheDocument()
  })
})

describe("OpenAPI da API Push (B21)", () => {
  it("o botão baixa a especificação gerada pelo backend para esta fonte", async () => {
    service.fetchSource.mockResolvedValue(source({}))
    service.downloadPushOpenApi.mockResolvedValue({ blob: new Blob(["{}"], { type: "application/json" }), filename: "inia-api-push-pushrh01.openapi.json" })
    const createObjectURL = vi.fn(() => "blob:openapi")
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    renderWithQuery(<SourceDetailPage sourceId="src-push" />)
    fireEvent.click(await screen.findByRole("button", { name: /Baixar OpenAPI/ }))
    await waitFor(() => expect(service.downloadPushOpenApi).toHaveBeenCalledWith("src-push"))
    await waitFor(() => expect(click).toHaveBeenCalled())
    click.mockRestore()
  })
})

describe("Fonte com credencial por http:// (R-29)", () => {
  it("avisa na visão geral enquanto a fonte estiver assim", async () => {
    service.fetchSource.mockResolvedValue(source({ kind: "API_PULL", config: { kind: "API_PULL", api: { baseUrl: "http://api.interna", auth: { kind: "BEARER" }, headers: {}, timeoutMs: 30000 } }, transportWarning: "Esta fonte envia credencial por http://." }))
    renderWithQuery(<SourceDetailPage sourceId="src-push" />)
    expect(await screen.findByTestId("source-transport-warning")).toHaveTextContent("Esta fonte envia credencial por http://.")
  })
})
