/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AdminApiError } from "@/lib/admin/admin-api"
import type { IniaScenesOverview } from "@/schemas/inia-scenes/inia-scene.schema"
import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { IniaScenesPage } from "./inia-scenes-page"

const api = vi.hoisted(() => ({
  overview: null as unknown,
  fetch: vi.fn(),
  create: vi.fn<(input: unknown) => Promise<undefined>>(async () => undefined),
  update: vi.fn<(input: unknown) => Promise<undefined>>(async () => undefined),
  remove: vi.fn(async () => undefined),
  setDefault: vi.fn<(sceneId: string | null) => Promise<undefined>>(async () => undefined),
}))
vi.mock("@/services/inia-scenes/inia-scene-service", () => ({
  fetchIniaScenesOverview: api.fetch,
  fetchCurrentIniaScene: vi.fn(async () => ({ scene: null, now: null, nextChangeAt: null, upcoming: null })),
  createIniaScene: api.create,
  updateIniaScene: api.update,
  deleteIniaScene: api.remove,
  setDefaultIniaScene: api.setDefault,
  sceneImageSrc: (url: string) => url,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

type Scene = IniaScenesOverview["scenes"][number]
const image = (id: string, label: string, isPrimary: boolean, start: string | null, end: string | null) => ({ id, label, imageUrl: `/api/v1/inia-scenes/images/${id}?v=1`, width: 1920, height: 1080, byteSize: 1000, isPrimary, start, end })
const dayNight = (prefix: string) => [image(`${prefix}-dia`, "Dia", true, "06:00", "18:00"), image(`${prefix}-noite`, "Noite", false, "18:00", "06:00")]
const scene = (overrides: Partial<Scene>): Scene => {
  const images = overrides.images ?? [image(`${overrides.id ?? "s"}-img`, "Principal", true, null, null)]
  return {
    id: "s", name: "Cenário", imageUrl: images[0]!.imageUrl, width: 1920, height: 1080, byteSize: 1000, blur: 0.5, dim: 0,
    scheduleStart: null, scheduleEnd: null, isDefault: false, status: "STANDBY", images, activeImageId: images[0]!.id, nextImageChange: null,
    createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
    ...overrides,
  }
}
// Backend em ordem cronológica (2025 → 2026 → 2027), padrão sem período por último.
const OVERVIEW: IniaScenesOverview = {
  today: "2026-10-07",
  timeZone: "America/Fortaleza",
  now: "2026-10-07T20:30:00.000Z",
  localTime: "17:30",
  defaultSceneId: "call",
  current: { sceneId: "rosa", imageId: "rosa-dia", reason: "SCHEDULED", imageReason: "SLOT" },
  nextChange: { at: "2026-10-07T21:00:00.000Z", date: "2026-10-07", time: "18:00", sceneId: "rosa", imageId: "rosa-noite" },
  scenes: [
    scene({ id: "ano26", name: "Ano-Novo 2026", scheduleStart: "2025-12-29", scheduleEnd: "2026-01-04", status: "ENDED", images: dayNight("ano26"), activeImageId: "ano26-dia" }),
    scene({ id: "rosa", name: "Outubro Rosa", scheduleStart: "2026-10-05", scheduleEnd: "2026-10-11", status: "LIVE", images: dayNight("rosa"), activeImageId: "rosa-dia", nextImageChange: { time: "18:00", imageId: "rosa-noite", nextDay: false } }),
    scene({ id: "natal", name: "Natal", scheduleStart: "2026-12-01", scheduleEnd: "2026-12-26", status: "UPCOMING" }),
    scene({ id: "carnaval27", name: "Carnaval 2027", scheduleStart: "2027-02-08", scheduleEnd: "2027-02-14", status: "UPCOMING" }),
    scene({ id: "call", name: "Call center", isDefault: true, images: dayNight("call"), activeImageId: "call-dia" }),
  ],
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><IniaScenesPage /></QueryClientProvider>)
}

/** O jsdom não carrega imagens: simula uma imagem 1920×1080 que termina de carregar no próximo ciclo. */
class LoadedImage { naturalWidth = 1920; naturalHeight = 1080; decoding = "auto"; onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(_value: string) { setTimeout(() => this.onload?.(), 0) } }

beforeEach(() => {
  installJsdomStubs()
  vi.stubGlobal("Image", LoadedImage)
  // Só o relógio é falso: 17:30 em Fortaleza (UTC−3). O resto (React Query, waitFor) segue com timers reais.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-07T20:30:00Z"))
  api.fetch.mockReset()
  api.fetch.mockImplementation(async () => {
    if (api.overview instanceof Error) throw api.overview
    return api.overview
  })
  api.overview = OVERVIEW
  for (const fn of [api.create, api.update, api.remove, api.setDefault]) fn.mockClear()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("Cenário da INIA — administração", () => {
  it("mostra o que está no ar (cenário, imagem do horário, próxima troca) e a agenda na ordem do backend", async () => {
    renderPage()
    expect(await screen.findByTestId("inia-scene-current-name")).toHaveTextContent("Outubro Rosa")
    expect(screen.getByTestId("inia-scene-current-image")).toHaveTextContent("Imagem: Dia · 06:00–18:00")
    expect(screen.getByTestId("inia-scene-next-change")).toHaveTextContent("Próxima troca: hoje às 18:00 → Noite")
    expect(screen.getByText("Agendado até 11/10/2026. Depois volta ao cenário padrão.")).toBeInTheDocument()
    expect(screen.getByText("Próximo: Natal, a partir de 01/12/2026")).toBeInTheDocument()
    // Agenda cronológica (2025 → 2027), exatamente na ordem recebida; o padrão sem período fica no destaque próprio.
    const scheduled = within(screen.getByRole("list", { name: "Cenários agendados" })).getAllByTestId("inia-scene-card")
    expect(scheduled.map((card) => within(card).getByText(/^(Ano-Novo 2026|Outubro Rosa|Natal|Carnaval 2027)$/).textContent)).toEqual(["Ano-Novo 2026", "Outubro Rosa", "Natal", "Carnaval 2027"])
    expect(within(scheduled[1]!).getByText("No ar")).toBeInTheDocument()
    expect(within(scheduled[1]!).getByTestId("inia-scene-images-summary")).toHaveTextContent("Dia 06:00–18:00 · Noite 18:00–06:00")
    expect(within(scheduled[1]!).getByText("Troca às 18:00 → Noite")).toBeInTheDocument()
    expect(within(scheduled[2]!).getByTestId("inia-scene-images-summary")).toHaveTextContent("1 imagem, o dia inteiro")
    expect(screen.queryByRole("list", { name: "Cenários sem período" })).not.toBeInTheDocument()
    const defaults = screen.getByTestId("inia-scene-default-section")
    expect(within(defaults).getByText("Call center", { selector: "p" })).toBeInTheDocument()
    expect(within(defaults).getByRole("button", { name: "Editar padrão" })).toBeInTheDocument()
    // Definir como padrão a partir do card.
    fireEvent.click(within(scheduled[2]!).getByRole("button", { name: "Definir como padrão" }))
    await waitFor(() => expect(api.setDefault.mock.calls[0]?.[0]).toBe("natal"))
  })

  it("editor: faixas em ordem de horário, imagem no ar e próxima troca no fuso da organização; sobreposição recusada com mensagem clara", async () => {
    renderPage()
    const cards = await screen.findAllByTestId("inia-scene-card")
    fireEvent.click(within(cards[1]!).getByRole("button", { name: "Editar" }))
    const dialog = await screen.findByRole("dialog")
    const rows = within(dialog).getAllByTestId("inia-scene-image-row")
    expect(rows.map((row) => (within(row).getByLabelText("Identificação") as HTMLInputElement).value)).toEqual(["Dia", "Noite"])
    expect(within(dialog).getByTestId("inia-scene-slot-status")).toHaveTextContent("Agora (17:30): Dia")
    expect(within(dialog).getByTestId("inia-scene-slot-status")).toHaveTextContent("Próxima troca: às 18:00 → Noite")
    expect(within(rows[0]!).getByText("No ar agora")).toBeInTheDocument()
    expect(within(rows[1]!).getByText("Das 18:00 às 06:00 do dia seguinte")).toBeInTheDocument()
    expect(within(dialog).getByTestId("inia-scene-preview-caption")).toHaveTextContent("Prévia da imagem no ar agora (17:30): Dia")

    // A noite começando às 17:00 encosta no dia: o erro aparece na hora, nomeando as duas imagens e o trecho em comum.
    fireEvent.change(within(rows[1]!).getByLabelText("Início"), { target: { value: "17:00" } })
    expect(within(dialog).getByTestId("inia-scene-images-error")).toHaveTextContent('Os horários de "Dia" e "Noite" se sobrepõem das 17:00 às 18:00. Ajuste as faixas para não coincidirem.')
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar alterações" }))
    expect(api.update).not.toHaveBeenCalled()

    // Corrigido para 18:00: salva o conjunto inteiro (ids existentes, faixas, principal), sem arquivos novos.
    fireEvent.change(within(rows[1]!).getByLabelText("Início"), { target: { value: "18:00" } })
    expect(within(dialog).queryByTestId("inia-scene-images-error")).not.toBeInTheDocument()
    // Clicar na miniatura da noite mostra a noite na prévia.
    fireEvent.click(within(rows[1]!).getByRole("button", { name: "Ver Noite na prévia" }))
    expect(within(dialog).getByTestId("inia-scene-preview-caption")).toHaveTextContent("Prévia: Noite")
    // A troca na prévia espera a imagem carregar e entra em fade (sem piscar o fundo vazio).
    await waitFor(() => expect(within(dialog).getByTestId("inia-scene-preview").innerHTML).toContain("rosa-noite"))
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar alterações" }))
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1))
    expect(api.update.mock.calls[0]![0]).toEqual({
      id: "rosa", name: "Outubro Rosa", period: { start: "2026-10-05", end: "2026-10-11" }, blur: 0.5, dim: 0,
      images: [
        { id: "rosa-dia", label: "Dia", start: "06:00", end: "18:00", primary: true, file: undefined },
        { id: "rosa-noite", label: "Noite", start: "18:00", end: "06:00", primary: false, file: undefined },
      ],
    })
  })

  it("horários sem faixa usam a principal; trocar a principal e remover imagem; adicionar imagem nova", async () => {
    const createObjectURL = vi.fn(() => "blob:nova-imagem")
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    renderPage()
    const defaults = await screen.findByTestId("inia-scene-default-section")
    fireEvent.click(within(defaults).getByRole("button", { name: "Editar padrão" }))
    const dialog = await screen.findByRole("dialog")
    let rows = within(dialog).getAllByTestId("inia-scene-image-row")
    // Noite das 20:00 às 06:00: das 18:00 às 20:00 fica sem faixa → vale a principal (Dia).
    fireEvent.change(within(rows[1]!).getByLabelText("Início"), { target: { value: "20:00" } })
    expect(within(dialog).getByTestId("inia-scene-gaps")).toHaveTextContent("Sem faixa das 18:00 às 20:00: vale a imagem principal (Dia).")
    // A noite vira a principal.
    fireEvent.click(within(rows[1]!).getByRole("radio", { name: "Principal" }))
    expect(within(dialog).getByTestId("inia-scene-gaps")).toHaveTextContent("vale a imagem principal (Noite)")
    // Adiciona uma terceira imagem (fim de tarde), com faixa 18:00–20:00.
    const file = new File(["png"], "fim-de-tarde.png", { type: "image/png" })
    await act(async () => { fireEvent.change(within(dialog).getByTestId("inia-scene-file"), { target: { files: [file] } }) })
    await waitFor(() => expect(within(dialog).getAllByTestId("inia-scene-image-row")).toHaveLength(3))
    rows = within(dialog).getAllByTestId("inia-scene-image-row")
    fireEvent.change(within(rows[2]!).getByLabelText("Identificação"), { target: { value: "Fim de tarde" } })
    fireEvent.change(within(rows[2]!).getByLabelText("Início"), { target: { value: "18:00" } })
    fireEvent.change(within(rows[2]!).getByLabelText("Fim"), { target: { value: "20:00" } })
    expect(within(dialog).queryByTestId("inia-scene-gaps")).not.toBeInTheDocument()
    // Remove o dia: a cobertura passa a ter buraco (06:00–18:00), coberto pela principal (Noite).
    fireEvent.click(within(rows[0]!).getByRole("button", { name: "Remover Dia" }))
    expect(within(dialog).getByTestId("inia-scene-gaps")).toHaveTextContent("Sem faixa das 06:00 às 18:00: vale a imagem principal (Noite).")
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar alterações" }))
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1))
    const saved = api.update.mock.calls[0]![0] as { period: unknown; images: Array<{ id?: string; label: string; start: string | null; end: string | null; primary: boolean; file?: File }> }
    expect(saved.period).toBeNull()
    // Enviado em ordem de horário: fim de tarde (nova, com arquivo) e noite (principal).
    expect(saved.images.map((entry) => [entry.id ?? "nova", entry.label, entry.start, entry.end, entry.primary, entry.file?.name ?? null])).toEqual([
      ["nova", "Fim de tarde", "18:00", "20:00", false, "fim-de-tarde.png"],
      ["call-noite", "Noite", "20:00", "06:00", true, null],
    ])
  })

  it("escurecimento do fundo: 0–100 %, prévia ao vivo (só sobre a imagem), teclado e valor salvo; independente do desfoque", async () => {
    renderPage()
    const cards = await screen.findAllByTestId("inia-scene-card")
    fireEvent.click(within(cards[2]!).getByRole("button", { name: "Editar" }))
    const dialog = await screen.findByRole("dialog")
    const value = () => within(dialog).getByTestId("inia-scene-dim-value")
    const mask = () => within(dialog).getByTestId("inia-scene-preview").querySelector('[data-testid="inia-scene-dim"]') as HTMLElement | null
    expect(value()).toHaveTextContent("0% (sem máscara)")
    expect(mask()).toBeNull()
    const [blurThumb, dimThumb] = within(dialog).getAllByRole("slider")
    expect(dimThumb).toHaveAttribute("aria-valuetext", "0% (sem máscara)")
    dimThumb!.focus()
    fireEvent.keyDown(dimThumb!, { key: "ArrowRight" })
    expect(value()).toHaveTextContent("1%")
    fireEvent.keyDown(dimThumb!, { key: "PageUp" })
    fireEvent.keyDown(dimThumb!, { key: "PageUp" })
    fireEvent.keyDown(dimThumb!, { key: "PageUp" })
    expect(value()).toHaveTextContent("31%")
    // A máscara fica entre a imagem e os gradientes de leitura (que descontam a máscara: não somam escuro).
    expect(mask()?.style.opacity).toBe("0.31")
    const layers = Array.from(within(dialog).getByTestId("inia-scene-preview").querySelector("[data-inia-scene]")!.children)
    expect(layers.map((layer) => layer.getAttribute("data-scene-image") ? "imagem" : layer.getAttribute("data-testid") === "inia-scene-dim" ? "máscara" : layer.getAttribute("data-readability"))).toEqual(["imagem", "máscara", "right", "top"])
    fireEvent.keyDown(dimThumb!, { key: "End" })
    expect(value()).toHaveTextContent("100%")
    fireEvent.keyDown(dimThumb!, { key: "Home" })
    fireEvent.keyDown(dimThumb!, { key: "PageUp" })
    fireEvent.keyDown(dimThumb!, { key: "PageUp" })
    fireEvent.keyDown(dimThumb!, { key: "ArrowLeft" })
    expect(value()).toHaveTextContent("19%")
    // O desfoque continua independente.
    expect(within(dialog).getByTestId("inia-scene-blur-value")).toHaveTextContent("0,50 px")
    blurThumb!.focus()
    fireEvent.keyDown(blurThumb!, { key: "ArrowRight" })
    expect(within(dialog).getByTestId("inia-scene-blur-value")).toHaveTextContent("0,51 px")
    expect(value()).toHaveTextContent("19%")
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar alterações" }))
    await waitFor(() => expect(api.update.mock.calls[0]?.[0]).toMatchObject({ id: "natal", blur: 0.51, dim: 19 }))
  })

  it("conflito do backend aparece no campo certo (período; imagem apontada pela posição)", async () => {
    api.update.mockRejectedValueOnce(new AdminApiError('O período coincide com o do cenário "Outubro Rosa". Ajuste as datas para não se sobreporem.', "INIA_SCENE_PERIOD_OVERLAP"))
    renderPage()
    const cards = await screen.findAllByTestId("inia-scene-card")
    fireEvent.click(within(cards[2]!).getByRole("button", { name: "Editar" }))
    const edit = await screen.findByRole("dialog")
    expect(within(edit).getByLabelText("Nome")).toHaveValue("Natal")
    fireEvent.change(within(edit).getByLabelText("Início", { selector: "#inia-scene-start" }), { target: { value: "2026-10-10" } })
    fireEvent.click(within(edit).getByRole("button", { name: "Salvar alterações" }))
    expect(await within(edit).findByText(/coincide com o do cenário "Outubro Rosa"/)).toBeInTheDocument()

    api.update.mockRejectedValueOnce(new AdminApiError('Imagem "Principal": A imagem é pequena demais: use pelo menos 1280×640 (recomendado 1920×1080).', "SCENE_IMAGE_TOO_SMALL", { imageIndex: 0 }))
    fireEvent.click(within(edit).getByRole("button", { name: "Salvar alterações" }))
    expect(await within(edit).findByTestId("inia-scene-images-error")).toHaveTextContent('Imagem "Principal": A imagem é pequena demais')
    expect(within(edit).getByTestId("inia-scene-image-row").className).toContain("border-destructive")
  })

  it("novo cenário: exige nome e ao menos uma imagem antes de enviar", async () => {
    renderPage()
    fireEvent.click((await screen.findAllByRole("button", { name: "Novo cenário" }))[0]!)
    const dialog = await screen.findByRole("dialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar cenário" }))
    expect(within(dialog).getByText("Dê um nome ao cenário (ex.: Natal 2026).")).toBeInTheDocument()
    expect(within(dialog).getByText("Adicione pelo menos uma imagem.")).toBeInTheDocument()
    expect(api.create).not.toHaveBeenCalled()
  })

  it("sem permissão (Administrador comum ou operador): explica que só o Administrador geral altera", async () => {
    api.overview = new AdminApiError("Você não tem permissão para este recurso.", "FORBIDDEN")
    renderPage()
    expect(await screen.findByText("Só o Administrador geral altera o cenário da INIA")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Novo cenário" })).not.toBeInTheDocument()
  })
})
