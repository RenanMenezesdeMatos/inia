import { describe, expect, it } from "vitest"

import { mean, measureAudioOnlyMouth, measureBehavior, measureDynamics, summarizeContrast, withCompleteTranscript, type DynamicsMetrics } from "./__fixtures__/dynamics-metrics"
import { buildReplaySchedule, listFixtureIds, loadFixture } from "./__fixtures__/load-fixture"

/**
 * Dinâmica da boca nas capturas REAIS do Gemini Live, reproduzidas com a chegada dos pacotes
 * intercalada com a amostragem no instante ouvido (o que o avatar mostra ao vivo). Regressão das
 * metas da avaliação de 2026-10-07 (`scripts/dev/lipsync-dynamics.ts` imprime tudo):
 *
 * - nitidez: a boca chega perto do alvo de cada classe de fone (antes: consoantes mostravam o dobro
 *   da abertura-alvo, a média dos vizinhos achatava tudo);
 * - sem vazamento de bico/arredondamento nas vogais não arredondadas;
 * - sincronia preservada (lag boca × som) e nenhum "tranco" (> 0,2 de mandíbula em 20 ms);
 * - acentos de frase (≈ 1/s), não um pulso por palavra.
 *
 * E o TIPO do acento (direção do F0, avaliação de 2026-10-07 — segunda rodada): a fala mostrada tocada
 * no `BehaviorController` (várias sementes) acena para baixo na queda e no nuclear, levanta a cabeça
 * e a sobrancelha na subida, e a piscada procura o fim de frase sem mudar a taxa.
 *
 * Todas as capturas, inclusive as da voz de produção (`kore-*`) e as com a transcrição INCOMPLETA
 * (2026-10-08): a fala sem texto é mostrada pelos fones só-áudio, calibrados contra o texto
 * (`audio-only-phones.ts`) — e a régua deles é a última seção (as capturas completas lidas sem texto).
 */

const FIXTURES = listFixtureIds()
const schedules = new Map(FIXTURES.map((id) => [id, buildReplaySchedule(loadFixture(id), { clockOffset: 12.5 })]))
const results: DynamicsMetrics[] = FIXTURES.map((id) => measureDynamics(schedules.get(id)!))
/** Transcrição incompleta → a mesma gravação com o texto completo (a referência do que deveria aparecer). */
const completeText = new Map(
  FIXTURES.flatMap((id) => {
    const complete = withCompleteTranscript(schedules.get(id)!)
    return complete ? [[id, measureDynamics(complete)] as const] : []
  }),
)
const byId = new Map(results.map((m) => [m.id, m]))
const contrast = summarizeContrast(results)
const ratioOf = (group: string) => contrast.find((row) => row.group === group)!.ratio
const behavior = measureBehavior(results, { seeds: 12 })
const randomBlinks = measureBehavior(results, { seeds: 12, prosodicBlinks: false })
/** Acentos de uma captura, em segundos desde o início do áudio. */
const accentsOf = (id: string) => byId.get(id)!.accents.map((accent) => ({ ...accent, at: accent.t - byId.get(id)!.track.start }))

describe("régua da dinâmica", () => {
  it("roteiro sem áudio é erro explícito (antes o envelope lia o índice −1 e a correlação virava NaN sem aviso)", () => {
    const schedule = schedules.get(FIXTURES[0]!)!
    expect(() => measureDynamics({ ...schedule, steps: schedule.steps.filter((step) => step.kind !== "audio") })).toThrow("o roteiro não tem áudio")
  })
})

describe("dinâmica da boca nas capturas reais", () => {
  it.each(["a (aberto)", "é/ó", "s/z/x/j", "f/v", "t/d/n/l"])("%s: mandíbula no centro do fone a ±25%% do alvo", (group) => {
    expect(Math.abs(ratioOf(group) - 1)).toBeLessThanOrEqual(0.25)
  })

  it("contraste: vogal aberta abre ≥ 3× mais que as sibilantes (antes: 2,5×)", () => {
    const jaw = (group: string) => contrast.find((row) => row.group === group)!.jaw
    expect(jaw("a (aberto)") / jaw("s/z/x/j")).toBeGreaterThanOrEqual(3)
  })

  it("vogais não arredondadas sem bico vazado dos vizinhos (média ≤ 0,08)", () => {
    expect(mean(results.flatMap((m) => m.unroundedRounding))).toBeLessThanOrEqual(0.08)
  })

  it.each(FIXTURES)("%s: sincronia ±20 ms, sem tranco, todo bilabial selado", (id) => {
    const m = byId.get(id)!
    expect(Math.abs(m.lag.bestMs)).toBeLessThanOrEqual(20)
    expect(m.velocity.pops).toBe(0)
    expect(m.velocity.maxStep20ms).toBeLessThanOrEqual(0.2)
    expect(m.bilabials.sealed).toBe(m.bilabials.total)
    expect(m.bilabials.sealMsP10).toBeGreaterThanOrEqual(25)
  })

  it.each(FIXTURES)("%s: cada sílaba abre e fecha (profundidade ≥ 80%% do teto das metas; por pico ≥ 0,18 ou o teto)", (id) => {
    // Teto = profundidade se toda meta fosse atingida exatamente (texto com muito i/u e hiato tem
    // teto baixo — a mandíbula quase não precisa mexer ali). Antes: 25–40% do teto.
    const m = byId.get(id)!
    expect(m.jaw.depthP50).toBeGreaterThanOrEqual(0.8 * m.jaw.idealDepthP50)
    // O piso por pico (0,18) veio de capturas com teto 0,18–0,28. Com o teto abaixo dele, nem a boca que
    // acerta toda meta chega lá: "kore-numeros" ("dois mil e vinte e seis, zero nove dois cinco…") tem
    // teto 0,171, a boca chega a 95% dele e o pico mediano a 0,177 (2026-10-08). Aí o piso é o teto.
    expect(m.jaw.peakDepthP50).toBeGreaterThanOrEqual(Math.min(0.18, m.jaw.idealDepthP50))
  })

  it.each(FIXTURES)("%s: ênfase só nos acentos de frase (0,5–1,3 pulsos/s, bem abaixo das palavras/s)", (id) => {
    const m = byId.get(id)!
    const reference = completeText.get(id)
    // Transcrição incompleta: o piso é o que a mesma gravação dá com o texto completo, menos um acento.
    // Na frase-02 a referência fica em 0,49/s (2 acentos em 4,1 s: a Kore diz "primeiro" a 3,3 st, logo
    // abaixo do limiar de acento) — o piso de 0,5/s não vale nem com o texto, então não mede o só-áudio.
    if (reference) expect(m.accents.length).toBeGreaterThanOrEqual(reference.accents.length - 1)
    else expect(m.emphasis.pulsesPerSecond).toBeGreaterThanOrEqual(0.5)
    expect(m.emphasis.pulsesPerSecond).toBeLessThanOrEqual(1.3)
    // Palavras FALADAS (`spokenWordCount`: números por extenso; o Whisper quando a transcrição veio incompleta).
    expect(m.emphasis.pulsesPerSecond).toBeLessThan(0.6 * m.emphasis.wordsPerSecond)
  })

  it("ênfase média 0,6–1,0 acento/s nas capturas", () => {
    const average = mean(results.map((m) => m.emphasis.pulsesPerSecond))
    expect(average).toBeGreaterThanOrEqual(0.6)
    expect(average).toBeLessThanOrEqual(1)
  })
})

describe("tipo do acento de frase nas capturas reais (direção do F0)", () => {
  it("as três formas aparecem; queda é a mais comum e a maioria dos nucleares cai", () => {
    const count = (key: "fall" | "rise" | "peak") => results.reduce((acc, m) => acc + m.emphasis.byShape[key] * m.speechSeconds, 0)
    expect(count("fall")).toBeGreaterThan(count("rise"))
    expect(count("rise")).toBeGreaterThanOrEqual(8)
    expect(count("peak")).toBeGreaterThanOrEqual(4)
    const nuclear = results.reduce((acc, m) => acc + m.emphasis.nuclear, 0)
    const nuclearFalls = results.reduce((acc, m) => acc + m.emphasis.nuclearFalls, 0)
    expect(nuclear).toBeGreaterThanOrEqual(15)
    expect(nuclearFalls / nuclear).toBeGreaterThanOrEqual(0.55)
  })

  it("frase-01: os declarativos terminam em queda nuclear; 'juntos?' (sim/não) termina em subida", () => {
    const accents = accentsOf("frase-01-apresentacao")
    const last = accents[accents.length - 1]!
    expect(last.nuclear).toBe(true)
    expect(last.shape).toBe("rise")
    const declaratives = accents.filter((accent) => accent.nuclear && accent !== last)
    expect(declaratives.length).toBeGreaterThanOrEqual(2)
    for (const accent of declaratives) expect(accent.shape, `${accent.at.toFixed(2)} s`).toBe("fall")
  })

  it("continuações sobem: 'vendas,' (frase-03) e 'Amanhã,' (frase-04)", () => {
    const near = (id: string, at: number) => accentsOf(id).find((accent) => Math.abs(accent.at - at) < 0.25)
    expect(near("frase-03-escolha", 1.48)?.shape).toBe("rise")
    expect(near("frase-04-amanha", 0.47)?.shape).toBe("rise")
  })

  it("cabeça: queda e nuclear acenam para BAIXO (≥ 1°); subida LEVANTA (≤ −0,3°), nunca o mesmo aceno", () => {
    const { fall, nuclear, peak, rise } = behavior.response
    expect(fall.headDeg).toBeGreaterThanOrEqual(1)
    expect(nuclear.headDeg).toBeGreaterThanOrEqual(1)
    expect(rise.headDeg).toBeLessThanOrEqual(-0.3)
    // Pico: batida intermediária (para baixo, menor que a queda).
    expect(peak.headDeg).toBeGreaterThan(0.3)
    expect(peak.headDeg).toBeLessThan(fall.headDeg)
  })

  it("sobrancelha: sobe na subida (≥ 2× a da queda), um pouco no pico", () => {
    const { fall, peak, rise } = behavior.response
    expect(rise.brow).toBeGreaterThanOrEqual(2 * fall.brow)
    expect(rise.brow).toBeGreaterThan(peak.brow)
    expect(peak.brow).toBeGreaterThan(fall.brow)
  })

  it("piscada: procura o fim de frase (≥ 1,8× o acaso, antes perto do acaso) sem mudar a taxa (±20%)", () => {
    expect(Math.abs(behavior.blinks.perMinute / randomBlinks.blinks.perMinute - 1)).toBeLessThanOrEqual(0.2)
    expect(behavior.blinks.perMinute).toBeGreaterThan(12)
    expect(behavior.blinks.perMinute).toBeLessThan(26)
    expect(behavior.blinks.nearBoundary).toBeGreaterThanOrEqual(1.8 * behavior.blinks.chance)
    expect(behavior.blinks.nearBoundary).toBeGreaterThanOrEqual(randomBlinks.blinks.nearBoundary + 0.15)
    expect(randomBlinks.blinks.nearBoundary).toBeLessThan(1.6 * randomBlinks.blinks.chance)
    // E não fecha o olho no meio de um acento forte.
    expect(behavior.blinks.duringAccent).toBeLessThanOrEqual(randomBlinks.blinks.duringAccent + 0.02)
  })
})

describe("fala sem texto: a boca só-áudio acompanha a do texto", () => {
  // Régua: as capturas com transcrição completa lidas de novo SEM texto nenhum. Em 2026-10-08, antes da
  // calibração dos fones só-áudio: boca 1,73× mais aberta que a do texto, correlação 0,39, erro médio
  // 0,20 e 40 trancos; depois: 0,84–1,10× por captura, correlação 0,66–0,86 (média 0,77), erro 0,075, 0 tranco.
  const complete = FIXTURES.filter((id) => !completeText.has(id))
  const comparisons = complete.map((id) => measureAudioOnlyMouth(schedules.get(id)!))

  it.each(comparisons.map((c) => [c.id, c] as const))("%s: abre como a boca do texto (±20%%), no mesmo ritmo (r ≥ 0,6), sem tranco", (_id, c) => {
    expect(Math.abs(c.audioOnlyJaw / c.textJaw - 1)).toBeLessThanOrEqual(0.2)
    expect(c.r).toBeGreaterThanOrEqual(0.6)
    expect(c.pops).toBe(0)
  })

  it("no conjunto: abertura a ±10%, correlação média ≥ 0,7 e erro médio ≤ 0,1", () => {
    const total = (key: "textJaw" | "audioOnlyJaw") => comparisons.reduce((acc, c) => acc + c[key], 0)
    expect(Math.abs(total("audioOnlyJaw") / total("textJaw") - 1)).toBeLessThanOrEqual(0.1)
    expect(mean(comparisons.map((c) => c.r))).toBeGreaterThanOrEqual(0.7)
    expect(mean(comparisons.map((c) => c.meanAbsError))).toBeLessThanOrEqual(0.1)
  })

  it.each([...completeText.keys()])("%s: com a transcrição incompleta, abre como a mesma fala com o texto completo (±20%%)", (id) => {
    expect(Math.abs(byId.get(id)!.jaw.meanSpeaking / completeText.get(id)!.jaw.meanSpeaking - 1)).toBeLessThanOrEqual(0.2)
  })
})
