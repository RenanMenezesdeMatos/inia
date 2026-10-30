/**
 * Laboratório da DINÂMICA da boca (só dev): reproduz cada captura real do Gemini Live intercalando a
 * chegada dos pacotes com a amostragem no instante ouvido e mede sincronia, nitidez articulatória,
 * saltos, selo bilabial, contraste por classe de fone e pulsos de ênfase (por TIPO de acento:
 * subida/queda/pico, nucleares). Depois toca a fala mostrada no `BehaviorController` (várias
 * sementes) e mede a resposta da cabeça/sobrancelha por tipo de acento e a piscada × fim de frase,
 * com e sem a atração da piscada pelo fim de frase. Por fim, a fala SEM texto: as capturas completas
 * lidas de novo sem a transcrição (boca só-áudio × boca do texto) e as de transcrição incompleta × a
 * mesma gravação com o texto completo. Mesmo código dos testes de regressão
 * (`__fixtures__/dynamics-metrics.ts`); as metas das avaliações de 2026-10-07 saem no fim.
 *
 *   npx tsx scripts/dev/lipsync-dynamics.ts [fixture|all] [--transcript-delay 1.5] [--seeds 40] [--json saida.json]
 */
import { writeFileSync } from "node:fs"

import { BLINK_BOUNDARY_AFTER_SECONDS, BLINK_BOUNDARY_BEFORE_SECONDS, BLINK_RATE_TAIL_SECONDS, mean, measureAudioOnlyMouth, measureBehavior, measureDynamics, summarizeContrast, withCompleteTranscript, type BehaviorMetrics, type DynamicsMetrics } from "../../src/lib/avatar/lipsync/__fixtures__/dynamics-metrics"
import { buildReplaySchedule, listFixtureIds, loadFixture } from "../../src/lib/avatar/lipsync/__fixtures__/load-fixture"

const args = process.argv.slice(2)
const option = (name: string) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const transcriptDelay = Number(option("--transcript-delay") ?? 0)
const jsonPath = option("--json")
const seeds = Number(option("--seeds") ?? 40)
const target = args.find((arg, index) => !arg.startsWith("--") && !(index > 0 && args[index - 1]!.startsWith("--"))) ?? "all"
const ids = target === "all" ? listFixtureIds() : [target]

const results: DynamicsMetrics[] = []
for (const id of ids) {
  const schedule = buildReplaySchedule(loadFixture(id), { clockOffset: 50 })
  const m = measureDynamics(schedule, { replay: { transcriptDelay } })
  results.push(m)
  const lagRow = m.lag.byLag.filter((row) => row.lagMs % 25 === 0).map((row) => `${row.lagMs}:${row.r.toFixed(2)}`).join(" ")
  console.log(`\n== ${id}${transcriptDelay ? ` (texto +${transcriptDelay}s)` : ""}  fala ${m.speechSeconds.toFixed(2)} s · ${m.syllablesPerSecond.toFixed(1)} sílabas/s`)
  console.log(`  defasagem boca×som: melhor lag ${m.lag.bestMs} ms (r=${m.lag.r.toFixed(2)})  [${lagRow}]  (lag>0 = som depois da boca)`)
  console.log(`  mandíbula: média ${m.jaw.meanSpeaking.toFixed(2)} falando · ${(100 * m.jaw.nearlyClosedRatio).toFixed(0)}% quase fechada · picos ${m.jaw.peaksPerSecond.toFixed(1)}/s · profundidade por sílaba p50 ${m.jaw.depthP50.toFixed(2)} (teto ${m.jaw.idealDepthP50.toFixed(2)}) p10 ${m.jaw.depthP10.toFixed(2)} · por pico p50 ${m.jaw.peakDepthP50.toFixed(2)}`)
  console.log(`  velocidade máx. ${m.velocity.max.toFixed(1)}/s · maior Δ em 20 ms ${m.velocity.maxStep20ms.toFixed(3)} · saltos >0,2 em 20 ms: ${m.velocity.pops}`)
  console.log(`  bilabiais selados (lipClose≥0,9): ${m.bilabials.sealed}/${m.bilabials.total} · tempo selado p10 ${m.bilabials.sealMsP10.toFixed(0)} ms p50 ${m.bilabials.sealMsP50.toFixed(0)} ms`)
  console.log(`  mostrado × final: maior Δjaw ${m.rewrite.maxJawDelta.toFixed(3)} · quadros Δ>0,05: ${m.rewrite.framesOver} · quadros "só áudio": ${m.rewrite.audioOnlyFrames}`)
  console.log(`  ênfase: ${m.emphasis.pulsesPerSecond.toFixed(2)} pulsos/s · palavras ${m.emphasis.wordsPerSecond.toFixed(2)}/s`)
  const shapes = m.emphasis.byShape
  console.log(`  acentos por tipo: queda ${shapes.fall.toFixed(2)}/s · subida ${shapes.rise.toFixed(2)}/s · pico ${shapes.peak.toFixed(2)}/s · nucleares ${m.emphasis.nuclear} (${m.emphasis.nuclearFalls} em queda)`)
  console.log(`    ${m.accents.map((a) => `${(a.t - m.track.start).toFixed(2)}s ${a.shape === "fall" ? "↘" : a.shape === "rise" ? "↗" : "∧"}${a.nuclear ? "N" : ""}(${a.direction >= 0 ? "+" : ""}${a.direction.toFixed(2)})`).join(" ")}`)
}

const contrast = summarizeContrast(results)
console.log("\n== contraste por classe (centro do fone, linha do tempo final)")
for (const row of contrast) {
  console.log(`  ${row.group.padEnd(12)} n=${String(row.n).padStart(3)}  jaw mostrado ${row.jaw.toFixed(2)} × alvo ${row.target.toFixed(2)} (${row.ratio >= 1 ? "+" : ""}${((row.ratio - 1) * 100).toFixed(0)}%) · arredond. ${row.rounding.toFixed(2)} · ${row.durationMs.toFixed(0)} ms`)
}
const unrounded = results.flatMap((m) => m.unroundedRounding).sort((a, b) => a - b)
const unroundedMean = mean(unrounded)
const unroundedP90 = unrounded[Math.floor(unrounded.length * 0.9)] ?? Number.NaN
console.log(`  vogais não arredondadas: arredondamento médio ${unroundedMean.toFixed(3)} · p90 ${unroundedP90.toFixed(3)} (n=${unrounded.length})`)

// Metas da avaliação de 2026-10-07 (só as capturas inteiras; um fixture isolado só informa).
if (ids.length > 1) {
  const ratioOf = (group: string) => contrast.find((row) => row.group === group)!.ratio
  const within = (ratio: number) => Math.abs(ratio - 1) <= 0.25
  const checks: Array<[string, boolean, string]> = [
    ...["a (aberto)", "é/ó", "s/z/x/j", "f/v", "t/d/n/l"].map((group): [string, boolean, string] => [`jaw ${group} dentro de ±25% do alvo`, within(ratioOf(group)), `${((ratioOf(group) - 1) * 100).toFixed(0)}%`]),
    ["profundidade silábica p50 ≥ 0,2 (todas)", results.every((m) => m.jaw.depthP50 >= 0.2), results.map((m) => m.jaw.depthP50.toFixed(2)).join(" ")],
    ["arredondamento em vogais não arredondadas ≤ 0,08", unroundedMean <= 0.08, unroundedMean.toFixed(3)],
    ["lag boca×som dentro de ±20 ms", results.every((m) => Math.abs(m.lag.bestMs) <= 20), results.map((m) => m.lag.bestMs).join(" ")],
    ["zero saltos", results.every((m) => m.velocity.pops === 0), results.map((m) => m.velocity.pops).join(" ")],
    ["todo bilabial selado", results.every((m) => m.bilabials.sealed === m.bilabials.total), results.map((m) => `${m.bilabials.sealed}/${m.bilabials.total}`).join(" ")],
    ["ênfase 0,6–1,0 pulsos/s (média)", (() => { const p = mean(results.map((m) => m.emphasis.pulsesPerSecond)); return p >= 0.6 && p <= 1.0 })(), results.map((m) => m.emphasis.pulsesPerSecond.toFixed(2)).join(" ")],
  ]
  console.log("\n== metas")
  for (const [label, ok, detail] of checks) console.log(`  ${ok ? "OK  " : "FALHA"} ${label}  (${detail})`)
}

// Comportamento: tocar a fala mostrada no controlador (sementes diferentes = takes diferentes).
const behaviorOn = measureBehavior(results, { seeds, prosodicBlinks: true })
const behaviorOff = measureBehavior(results, { seeds, prosodicBlinks: false })
const total = (key: "fall" | "rise" | "peak") => results.reduce((acc, m) => acc + m.emphasis.byShape[key] * m.speechSeconds, 0)
const speechTotal = results.reduce((acc, m) => acc + m.speechSeconds, 0)
console.log(`\n== acentos por tipo (todas as capturas, ${speechTotal.toFixed(1)} s de fala)`)
console.log(`  queda ${(total("fall") / speechTotal).toFixed(2)}/s (${total("fall").toFixed(0)}) · subida ${(total("rise") / speechTotal).toFixed(2)}/s (${total("rise").toFixed(0)}) · pico ${(total("peak") / speechTotal).toFixed(2)}/s (${total("peak").toFixed(0)}) · nucleares ${results.reduce((a, m) => a + m.emphasis.nuclear, 0)} (${results.reduce((a, m) => a + m.emphasis.nuclearFalls, 0)} em queda)`)
const printBehavior = (label: string, b: BehaviorMetrics) => {
  console.log(`\n== comportamento — ${label} (${b.seeds} sementes, ${b.speakingSeconds.toFixed(1)} s falando por semente)`)
  for (const key of ["fall", "nuclear", "peak", "rise"] as const) {
    const r = b.response[key]
    const name = { fall: "queda  ", nuclear: "nuclear não ascendente", peak: "pico   ", rise: "subida " }[key].padEnd(22)
    console.log(`  ${name} n=${r.n.toFixed(0).padStart(3)}  cabeça ${r.headDeg >= 0 ? "+" : ""}${r.headDeg.toFixed(2)}° (${r.headDeg >= 0 ? "para baixo" : "para cima"}) · sobrancelha +${r.brow.toFixed(3)}`)
  }
  const k = b.blinks
  console.log(`  piscadas: ${k.perMinute.toFixed(1)}/min no turno + ${BLINK_RATE_TAIL_SECONDS} s (${k.perMinuteSpeaking.toFixed(1)}/min só falando) · ${(100 * k.nearBoundary).toFixed(0)}% no fim de frase (−${BLINK_BOUNDARY_BEFORE_SECONDS}…+${BLINK_BOUNDARY_AFTER_SECONDS} s da pausa; acaso ${(100 * k.chance).toFixed(0)}%) · mediana até a fronteira ${(1000 * k.medianOffset).toFixed(0)} ms · durante acento forte ${(100 * k.duringAccent).toFixed(0)}%`)
}
printBehavior("piscada atraída pelo fim de frase (padrão)", behaviorOn)
printBehavior("piscada só aleatória (como antes)", behaviorOff)

if (ids.length > 1) {
  const r = behaviorOn.response
  const checks: Array<[string, boolean, string]> = [
    ["queda e nuclear: cabeça para baixo (≥ +1°)", r.fall.headDeg >= 1 && r.nuclear.headDeg >= 1, `${r.fall.headDeg.toFixed(2)}° / ${r.nuclear.headDeg.toFixed(2)}°`],
    ["subida: cabeça para cima (≤ −0,3°), nunca aceno para baixo", r.rise.headDeg <= -0.3, `${r.rise.headDeg.toFixed(2)}°`],
    ["sobrancelha: subida ≥ 2× queda", r.rise.brow >= 2 * r.fall.brow, `${r.rise.brow.toFixed(3)} × ${r.fall.brow.toFixed(3)}`],
    ["piscada: taxa a ±20% da aleatória", Math.abs(behaviorOn.blinks.perMinute / behaviorOff.blinks.perMinute - 1) <= 0.2, `${behaviorOn.blinks.perMinute.toFixed(1)} × ${behaviorOff.blinks.perMinute.toFixed(1)}/min`],
    ["piscada: no fim de frase ≥ 1,8× o acaso", behaviorOn.blinks.nearBoundary >= 1.8 * behaviorOn.blinks.chance, `${(100 * behaviorOn.blinks.nearBoundary).toFixed(0)}% × acaso ${(100 * behaviorOn.blinks.chance).toFixed(0)}% (aleatória ${(100 * behaviorOff.blinks.nearBoundary).toFixed(0)}%)`],
  ]
  console.log("\n== metas do comportamento por tipo de acento")
  for (const [label, ok, detail] of checks) console.log(`  ${ok ? "OK  " : "FALHA"} ${label}  (${detail})`)
}

if (ids.length > 1 && !transcriptDelay) {
  console.log("\n== fala sem texto: capturas completas lidas SEM a transcrição (boca final só-áudio × do texto)")
  const comparisons = ids.filter((id) => !id.endsWith("-texto-incompleto")).map((id) => measureAudioOnlyMouth(buildReplaySchedule(loadFixture(id), { clockOffset: 50 })))
  for (const c of comparisons) console.log(`  ${c.id.padEnd(28)} mandíbula ${c.audioOnlyJaw.toFixed(3)} × ${c.textJaw.toFixed(3)} (×${(c.audioOnlyJaw / c.textJaw).toFixed(2)}) · r ${c.r.toFixed(2)} · erro médio ${c.meanAbsError.toFixed(3)} · saltos ${c.pops}`)
  console.log(`  média: r ${mean(comparisons.map((c) => c.r)).toFixed(2)} · erro ${mean(comparisons.map((c) => c.meanAbsError)).toFixed(3)}`)
  console.log("\n== transcrição incompleta × a mesma gravação com o texto completo")
  for (const id of ids) {
    const complete = withCompleteTranscript(buildReplaySchedule(loadFixture(id), { clockOffset: 50 }))
    const m = results.find((r) => r.id === id)
    if (!complete || !m) continue
    const reference = measureDynamics(complete)
    console.log(`  ${id.padEnd(40)} mandíbula ${m.jaw.meanSpeaking.toFixed(3)} × ${reference.jaw.meanSpeaking.toFixed(3)} · profundidade ${m.jaw.depthP50.toFixed(2)} × ${reference.jaw.depthP50.toFixed(2)} · acentos ${m.accents.length} × ${reference.accents.length}`)
  }
}

if (jsonPath) {
  const perFixture = results.map((m) => ({ id: m.id, speechSeconds: m.speechSeconds, syllablesPerSecond: m.syllablesPerSecond, lag: m.lag, jaw: m.jaw, velocity: m.velocity, bilabials: m.bilabials, rewrite: m.rewrite, emphasis: m.emphasis, accents: m.accents, boundaries: m.boundaries.map((b) => b - m.track.start) }))
  writeFileSync(jsonPath, JSON.stringify({ transcriptDelay, results: perFixture, contrast, unrounded: { mean: unroundedMean, p90: unroundedP90 }, behavior: { prosodicBlinks: behaviorOn, randomBlinks: behaviorOff } }, null, 2))
  console.log(`\nJSON: ${jsonPath}`)
}
