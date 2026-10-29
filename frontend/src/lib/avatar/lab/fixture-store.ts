import { buildCaptureSteps, shiftToFastStart, wavDataBytes, type CaptureFixtureJson, type CaptureStep } from "./capture-steps"
import { labFixtureUrl, type LabFixtureId } from "./fixture-catalog"
import type { ReplayScript } from "./fixture-replay-socket"

/**
 * Capturas baixadas da rota de desenvolvimento e já convertidas em mensagens do Live — uma vez por
 * captura (a resposta longa tem 2,6 MB de áudio). O servidor falso pede o script de forma SÍNCRONA
 * (`nextScript`), então o laboratório pré-carrega a captura escolhida e lê daqui.
 */

export type LabTiming = "original" | "fast"

type LoadedFixture = { json: CaptureFixtureJson; original: CaptureStep[]; fast: CaptureStep[] }

export class FixtureStore {
  private readonly loading = new Map<LabFixtureId, Promise<LoadedFixture>>()
  private readonly loaded = new Map<LabFixtureId, LoadedFixture>()

  constructor(private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init)) {}

  /** Baixa (uma vez) e converte; falhas não ficam em cache — a próxima chamada tenta de novo. */
  load(id: LabFixtureId): Promise<LoadedFixture> {
    const pending = this.loading.get(id)
    if (pending) return pending
    const attempt = this.download(id).then(
      (fixture) => {
        this.loaded.set(id, fixture)
        return fixture
      },
      (error: unknown) => {
        this.loading.delete(id)
        throw error
      },
    )
    this.loading.set(id, attempt)
    return attempt
  }

  async script(id: LabFixtureId, timing: LabTiming): Promise<ReplayScript> {
    const fixture = await this.load(id)
    return toScript(id, fixture, timing)
  }

  /** Só o que já está carregado (o servidor falso não pode esperar rede). */
  scriptIfLoaded(id: LabFixtureId, timing: LabTiming): ReplayScript | null {
    const fixture = this.loaded.get(id)
    return fixture ? toScript(id, fixture, timing) : null
  }

  /** Texto do pedido original da captura (vai pelo `sendText`, como um turno de texto real). */
  prompt(id: LabFixtureId): string | null {
    return this.loaded.get(id)?.json.prompt ?? null
  }

  /** Duração do áudio da captura (s), para o log. */
  audioSeconds(id: LabFixtureId): number | null {
    const fixture = this.loaded.get(id)
    if (!fixture) return null
    const samples = fixture.original.reduce((sum, step) => sum + (step.samples ?? 0), 0)
    return samples / (fixture.json.sampleRate || 24000)
  }

  private async download(id: LabFixtureId): Promise<LoadedFixture> {
    const [jsonResponse, wavResponse] = await Promise.all([this.fetchImpl(labFixtureUrl(id, "json")), this.fetchImpl(labFixtureUrl(id, "wav"))])
    if (!jsonResponse.ok || !wavResponse.ok) throw new Error(`Captura ${id} indisponível (HTTP ${jsonResponse.status}/${wavResponse.status}).`)
    const json = (await jsonResponse.json()) as CaptureFixtureJson
    const pcm = wavDataBytes(new Uint8Array(await wavResponse.arrayBuffer()))
    const original = buildCaptureSteps(json, pcm)
    return { json, original, fast: shiftToFastStart(original) }
  }
}

function toScript(id: LabFixtureId, fixture: LoadedFixture, timing: LabTiming): ReplayScript {
  return { id, steps: timing === "fast" ? fixture.fast : fixture.original }
}
