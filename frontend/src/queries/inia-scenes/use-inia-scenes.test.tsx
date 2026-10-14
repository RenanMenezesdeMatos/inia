/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"

import { gradientAlphaOver } from "@/components/inia-scenes/inia-scene-backdrop"
import type { CurrentIniaSceneState } from "@/schemas/inia-scenes/inia-scene.schema"
import { MAX_SCENE_CHANGE_JITTER_MS, msUntilSceneChange, sceneRefetchInterval, sceneStaleTime, useCurrentIniaScene } from "./use-inia-scenes"

const service = vi.hoisted(() => ({ fetch: vi.fn<() => Promise<unknown>>() }))
vi.mock("@/services/inia-scenes/inia-scene-service", () => ({ fetchCurrentIniaScene: service.fetch, sceneImageSrc: (url: string) => url }))

const scene = (imageId: string) => ({ id: "rosa", name: "Outubro Rosa", imageId, imageLabel: imageId, imageUrl: `/api/v1/inia-scenes/images/${imageId}?v=1`, width: 1920, height: 1080, blur: 0.5, dim: 0, reason: "SCHEDULED" as const, imageReason: "SLOT" as const })
const state = (now: string, nextChangeAt: string | null, imageId = "dia"): CurrentIniaSceneState => ({ scene: scene(imageId), now, nextChangeAt, upcoming: nextChangeAt ? { imageUrl: "/api/v1/inia-scenes/images/noite?v=1" } : null })

afterEach(() => {
  cleanup()
  service.fetch.mockReset()
  focusManager.setFocused(undefined)
})

describe("cenário atual — quando pedir de novo", () => {
  it("conta pelo relógio do SERVIDOR: relógio local adiantado ou atrasado não muda o instante da troca", () => {
    const data = state("2026-10-07T20:59:00.000Z", "2026-10-07T21:00:00.000Z")
    // Resposta chegou com o relógio local em qualquer hora: falta 1 min para a troca; 20 s depois, faltam 40 s.
    const fetchedAt = Date.parse("2030-01-01T00:00:00Z")
    expect(msUntilSceneChange(data, fetchedAt, fetchedAt)).toBe(60_000)
    expect(msUntilSceneChange(data, fetchedAt, fetchedAt + 20_000)).toBe(40_000)
    // Fica velho logo depois da troca (com folga), nunca antes; sem troca prevista, 5 min.
    expect(sceneStaleTime(data, fetchedAt)).toBe(61_500)
    expect(sceneStaleTime(state("2026-10-07T12:00:00.000Z", "2026-10-07T21:00:00.000Z"), fetchedAt)).toBe(5 * 60_000)
    expect(sceneStaleTime(state("2026-10-07T12:00:00.000Z", null), fetchedAt)).toBe(5 * 60_000)
    // Com a página aberta: pergunta de novo logo depois da troca; troca distante = confere a cada hora; nenhuma = não agenda.
    expect(sceneRefetchInterval(data, fetchedAt, fetchedAt)).toBe(61_500)
    expect(sceneRefetchInterval(state("2026-10-07T12:00:00.000Z", "2026-12-01T03:00:00.000Z"), fetchedAt, fetchedAt)).toBe(60 * 60_000)
    expect(sceneRefetchInterval(state("2026-10-07T12:00:00.000Z", null), fetchedAt, fetchedAt)).toBe(false)
    // Troca que já passou (o servidor ainda resolvia o instante anterior): nunca vira laço apertado.
    expect(sceneRefetchInterval(data, fetchedAt, fetchedAt + 120_000)).toBe(1_000)
  })

  it("espalha a releitura da troca (0–60 s por página): centenas de telas não pedem o cenário novo no mesmo segundo", () => {
    const data = state("2026-10-07T20:59:00.000Z", "2026-10-07T21:00:00.000Z")
    const fetchedAt = Date.parse("2030-01-01T00:00:00Z")
    expect(sceneRefetchInterval(data, fetchedAt, fetchedAt, 0)).toBe(61_500)
    expect(sceneRefetchInterval(data, fetchedAt, fetchedAt, 45_000)).toBe(106_500)
    expect(sceneStaleTime(data, fetchedAt, 45_000)).toBe(106_500)
    // Nunca passa do teto de 5 min de "velho" nem do de 1 h do timer; troca já passada continua sem laço apertado.
    expect(sceneStaleTime(state("2026-10-07T12:00:00.000Z", "2026-10-07T21:00:00.000Z"), fetchedAt, MAX_SCENE_CHANGE_JITTER_MS)).toBe(5 * 60_000)
    expect(sceneRefetchInterval(data, fetchedAt, fetchedAt + 120_000, 30_000)).toBe(1_000)
    expect(MAX_SCENE_CHANGE_JITTER_MS).toBe(60_000)
  })

  it("troca a imagem SOZINHA com a tela aberta, no instante informado pelo servidor", async () => {
    // 1ª resposta: a troca é agora (folga de 1,5 s); a 2ª já vem com a noite.
    service.fetch.mockResolvedValueOnce(state("2026-10-07T21:00:00.000Z", "2026-10-07T21:00:00.000Z", "dia")).mockResolvedValue(state("2026-10-07T21:00:01.500Z", "2026-10-08T09:00:00.000Z", "noite"))
    function Probe() {
      const current = useCurrentIniaScene(true, 0)
      return <p data-testid="image">{current?.imageId ?? "nenhum"}</p>
    }
    render(<QueryClientProvider client={new QueryClient()}><Probe /></QueryClientProvider>)
    expect(await screen.findByText("dia")).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId("image")).toHaveTextContent("noite"), { timeout: 4_000 })
    expect(service.fetch).toHaveBeenCalledTimes(2)
  })

  it("ao voltar para a aba depois do instante da troca, relê; antes dele, não", async () => {
    service.fetch.mockResolvedValue(state("2026-10-07T20:00:00.000Z", "2026-10-07T21:00:00.000Z"))
    function Probe() {
      const current = useCurrentIniaScene(true, 0)
      return <p>{current?.imageId ?? "nenhum"}</p>
    }
    const client = new QueryClient()
    render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>)
    expect(await screen.findByText("dia")).toBeInTheDocument()
    focusManager.setFocused(false)
    focusManager.setFocused(true)
    // Ainda falta 1 h: voltar para a aba não pede de novo.
    expect(service.fetch).toHaveBeenCalledTimes(1)
    // A resposta "envelhece" (a troca passou): voltar para a aba relê.
    const query = client.getQueryCache().find({ queryKey: ["inia-scene", "current"] })!
    query.setState({ dataUpdatedAt: Date.now() - 2 * 60 * 60_000 })
    focusManager.setFocused(false)
    focusManager.setFocused(true)
    await waitFor(() => expect(service.fetch).toHaveBeenCalledTimes(2))
  })
})

describe("cenário — gradientes de leitura sobre a máscara", () => {
  it("cada ponto fica com o MAIS ESCURO dos dois (não soma); 0 % = gradientes de antes; 100 % = só a máscara", () => {
    const combined = (mask: number, alpha: number) => 1 - (1 - mask) * (1 - gradientAlphaOver(mask, alpha))
    expect(gradientAlphaOver(0, 0.5)).toBe(0.5)
    expect(combined(0.3, 0.5)).toBeCloseTo(0.5)
    expect(combined(0.3, 0.2)).toBeCloseTo(0.3)
    expect(combined(0.6, 0.5)).toBeCloseTo(0.6)
    expect(gradientAlphaOver(1, 0.6)).toBe(0)
  })
})
