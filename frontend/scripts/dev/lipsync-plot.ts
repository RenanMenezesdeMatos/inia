/**
 * Laboratório do lip-sync (só dev): reproduz uma captura real do Gemini Live no motor de lip-sync
 * e desenha um PNG com as características do áudio, os fones alinhados e as curvas da boca.
 *
 *   npx tsx scripts/dev/lipsync-plot.ts [fixture|all] [--from 0] [--to 6] [--out dir] [--pps 250]
 *   npx tsx scripts/dev/lipsync-plot.ts frase-05-labiais
 *   npx tsx scripts/dev/lipsync-plot.ts resposta-longa --from 20 --to 32
 *
 * Painéis (tempo relativo ao início do áudio; uma faixa por até 6 s):
 *   1. energia (cinza), envelope da banda de vogais (verde), piso de silêncio (vermelho),
 *      núcleos detectados (azul), pausas (fundo cinza);
 *   2. vozeamento (roxo) e razão de alta frequência (laranja), 0..1;
 *   3. fones alinhados (vogal verde, bilabial vermelho, labiodental rosa, fricativa azul, pausa
 *      cinza, só-áudio amarelo) com o rótulo;
 *   4. boca amostrada a cada 5 ms: jaw (preto), lipClose (vermelho), lowerLipTuck (rosa),
 *      round+pucker (verde), spread (azul).
 *
 * O PNG é gerado por um codificador mínimo (node:zlib) e fonte bitmap 3×5 — sem dependências.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { deflateSync } from "node:zlib"

import { AudioFeatureExtractor } from "../../src/lib/avatar/lipsync/audio-features"
import { buildReplaySchedule, listFixtureIds, loadFixture, replayIntoEngine } from "../../src/lib/avatar/lipsync/__fixtures__/load-fixture"
import { PHONES, isBilabial, isLabiodental } from "../../src/lib/avatar/lipsync/phones"
import { phonemizeText } from "../../src/lib/avatar/lipsync/pt-br/g2p"
import { SpeechLandmarks } from "../../src/lib/avatar/lipsync/speech-landmarks"
import { createSpeechLipsyncEngine } from "../../src/lib/avatar/lipsync/speech-lipsync-engine"
import { createSpeechFrame } from "../../src/lib/avatar/lipsync/types"

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const positional = args.filter((arg, index) => !arg.startsWith("--") && !(index > 0 && args[index - 1]!.startsWith("--")))
const target = positional[0] ?? "all"
const from = Number(flag("--from") ?? "0")
const toArg = flag("--to")
const outDir = flag("--out") ?? path.join(os.tmpdir(), "lipsync-plots")
const ids = target === "all" ? listFixtureIds() : [target]

// ---------------------------------------------------------------------------
// Imagem RGB + PNG
// ---------------------------------------------------------------------------

type Color = readonly [number, number, number]

class Canvas {
  readonly data: Uint8Array
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8Array(width * height * 3).fill(255)
  }
  set(x: number, y: number, [r, g, b]: Color, alpha = 1): void {
    x = Math.round(x)
    y = Math.round(y)
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return
    const i = (y * this.width + x) * 3
    this.data[i] = Math.round(this.data[i]! * (1 - alpha) + r * alpha)
    this.data[i + 1] = Math.round(this.data[i + 1]! * (1 - alpha) + g * alpha)
    this.data[i + 2] = Math.round(this.data[i + 2]! * (1 - alpha) + b * alpha)
  }
  rect(x0: number, y0: number, x1: number, y1: number, color: Color, alpha = 1): void {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(this.height, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(this.width, Math.ceil(x1)); x++) this.set(x, y, color, alpha)
    }
  }
  line(x0: number, y0: number, x1: number, y1: number, color: Color, alpha = 1): void {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))))
    for (let s = 0; s <= steps; s++) this.set(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps, color, alpha)
  }
  text(x: number, y: number, value: string, color: Color, scale = 2): void {
    let cursor = x
    for (const char of value) {
      const glyph = GLYPHS[char] ?? GLYPHS[char.toLowerCase()] ?? GLYPHS["?"]!
      const rows = glyph.split("/")
      rows.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) if (row[rx] === "#") this.rect(cursor + rx * scale, y + ry * scale, cursor + (rx + 1) * scale, y + (ry + 1) * scale, color)
      })
      cursor += 4 * scale
    }
  }
  png(): Buffer {
    const raw = Buffer.alloc((this.width * 3 + 1) * this.height)
    for (let y = 0; y < this.height; y++) {
      raw[y * (this.width * 3 + 1)] = 0
      Buffer.from(this.data.buffer, y * this.width * 3, this.width * 3).copy(raw, y * (this.width * 3 + 1) + 1)
    }
    const header = Buffer.alloc(13)
    header.writeUInt32BE(this.width, 0)
    header.writeUInt32BE(this.height, 4)
    header[8] = 8
    header[9] = 2
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))])
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(body.length)
  const typed = Buffer.concat([Buffer.from(type, "ascii"), body])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))
  return Buffer.concat([length, typed, crc])
}

// Fonte bitmap 3×5 (linhas separadas por "/").
const GLYPHS: Record<string, string> = {
  "'": ".#./.#./.../.../...", "0": "###/#.#/#.#/#.#/###", "1": ".#./##./.#./.#./###", "2": "###/..#/###/#../###", "3": "###/..#/.##/..#/###",
  "4": "#.#/#.#/###/..#/..#", "5": "###/#../###/..#/###", "6": "###/#../###/#.#/###", "7": "###/..#/.#./.#./.#.",
  "8": "###/#.#/###/#.#/###", "9": "###/#.#/###/..#/###",
  a: ".../.##/#.#/#.#/.##", b: "#../##./#.#/#.#/##.", c: ".../.##/#../#../.##", d: "..#/.##/#.#/#.#/.##",
  e: ".../##./###/#../.##", f: ".##/#../###/#../#..", g: ".##/#.#/.##/..#/##.", h: "#../##./#.#/#.#/#.#",
  i: ".#./.../.#./.#./.#.", j: "..#/.../..#/#.#/.#.", k: "#../#.#/##./#.#/#.#", l: "##./.#./.#./.#./###",
  m: ".../#.#/###/#.#/#.#", n: ".../##./#.#/#.#/#.#", o: ".../.#./#.#/#.#/.#.", p: ".../##./#.#/##./#..",
  q: ".../.##/#.#/.##/..#", r: ".../#.#/##./#../#..", s: ".../.##/.#./..#/##.", t: ".#./###/.#./.#./.##",
  u: ".../#.#/#.#/#.#/.##", v: ".../#.#/#.#/#.#/.#.", w: ".../#.#/#.#/###/#.#", x: ".../#.#/.#./.#./#.#",
  y: "#.#/#.#/.##/..#/##.", z: ".../###/.#./#../###",
  A: ".#./#.#/###/#.#/#.#", E: "###/#../##./#../###", I: "###/.#./.#./.#./###", J: "..#/..#/..#/#.#/.#.",
  L: "#../#../#../#../###", N: "#.#/###/###/#.#/#.#", O: ".#./#.#/#.#/#.#/.#.", R: "##./#.#/##./#.#/#.#",
  S: ".##/#../.#./..#/##.", Z: "###/..#/.#./#../###",
  ".": ".../.../.../.../.#.", "-": ".../.../###/.../...", _: ".../.../.../.../###", "~": ".../.../.##/##./...",
  ":": ".../.#./.../.#./...", "/": "..#/..#/.#./#../#..", "=": ".../###/.../###/...", "?": "##./..#/.#./.../.#.",
  ",": ".../.../.../.#./#..", "(": ".#./#../#../#../.#.", ")": ".#./..#/..#/..#/.#.", "%": "#.#/..#/.#./#../#.#",
  " ": ".../.../.../.../...", "+": ".../.#./###/.#./...", "|": ".#./.#./.#./.#./.#.",
}

// ---------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------

const PX_PER_SECOND = Number(flag("--pps") ?? "250")
const MARGIN = 40
const PANEL_FEATURES = 130
const PANEL_VOICING = 60
const PANEL_PHONES = 44
const PANEL_MOUTH = 110
const GAP = 10
const ROW_HEIGHT = PANEL_FEATURES + PANEL_VOICING + PANEL_PHONES + PANEL_MOUTH + GAP * 4 + 16
/** Faixa de ~1.500 px: com `--pps 600` cada linha cobre 2,5 s (rótulos legíveis). */
const ROW_SECONDS = 1500 / PX_PER_SECOND

const GRAY: Color = [150, 150, 150]
const LIGHT: Color = [232, 232, 232]
const GREEN: Color = [30, 140, 60]
const RED: Color = [210, 40, 40]
const BLUE: Color = [40, 90, 210]
const PURPLE: Color = [140, 60, 180]
const ORANGE: Color = [240, 140, 20]
const PINK: Color = [230, 80, 170]
const BLACK: Color = [20, 20, 20]
const YELLOW: Color = [240, 200, 40]

for (const id of ids) {
  const fixture = loadFixture(id)
  const schedule = buildReplaySchedule(fixture, { clockOffset: 50 })
  const engine = createSpeechLipsyncEngine()
  const started = performance.now()
  replayIntoEngine(engine, schedule)
  const elapsed = performance.now() - started
  const snapshot = engine.debugSnapshot()
  const wordTexts = phonemizeText(fixture.transcript).map((word) => word.text)

  // Marcos recalculados à parte (mesmo código do motor), só para desenhar núcleos/pausas.
  const extractor = new AudioFeatureExtractor()
  for (const step of schedule.steps) if (step.kind === "audio") extractor.push(step.chunk.pcm, step.chunk.startAt, step.chunk.sampleRate)
  extractor.flush()
  const landmarks = new SpeechLandmarks(extractor.store)
  landmarks.update(true)

  const origin = schedule.audioStart
  const totalSeconds = schedule.audioEnd - origin
  const start = Math.max(0, from)
  const end = Math.min(totalSeconds, toArg ? Number(toArg) : totalSeconds)
  const rows = Math.max(1, Math.ceil((end - start) / ROW_SECONDS))
  const width = MARGIN * 2 + ROW_SECONDS * PX_PER_SECOND
  const canvas = new Canvas(width, rows * ROW_HEIGHT + 30)
  canvas.text(MARGIN, 8, `${id}  ${start.toFixed(1)}-${end.toFixed(1)}s  phones=${snapshot.phones.length}  cpu=${elapsed.toFixed(0)}ms`, BLACK)

  const frame = createSpeechFrame()
  for (let row = 0; row < rows; row++) {
    const rowStart = start + row * ROW_SECONDS
    const rowEnd = Math.min(end, rowStart + ROW_SECONDS)
    const top = 30 + row * ROW_HEIGHT
    const x = (t: number) => MARGIN + (t - origin - rowStart) * PX_PER_SECOND
    const inRow = (t: number) => t - origin >= rowStart && t - origin <= rowEnd
    const featuresTop = top
    const voicingTop = featuresTop + PANEL_FEATURES + GAP
    const phonesTop = voicingTop + PANEL_VOICING + GAP
    const mouthTop = phonesTop + PANEL_PHONES + GAP
    const dbY = (db: number) => featuresTop + PANEL_FEATURES * (Math.min(0, Math.max(-75, db)) / -75)
    const unitY = (v: number, panelTop: number, height: number) => panelTop + height * (1 - Math.max(0, Math.min(1, v)))

    // Fundo: pausas e grade de tempo.
    for (const pause of landmarks.pauses) {
      if (pause.end - origin < rowStart || pause.start - origin > rowEnd) continue
      canvas.rect(x(pause.start), featuresTop, x(pause.end), mouthTop + PANEL_MOUTH, LIGHT)
    }
    for (let t = Math.ceil(rowStart * 2) / 2; t <= rowEnd; t += 0.5) {
      const px = MARGIN + (t - rowStart) * PX_PER_SECOND
      canvas.line(px, featuresTop, px, mouthTop + PANEL_MOUTH, [205, 205, 205])
      canvas.text(px + 2, mouthTop + PANEL_MOUTH + 3, t.toFixed(1), GRAY)
    }
    for (const panel of [
      [featuresTop, PANEL_FEATURES],
      [voicingTop, PANEL_VOICING],
      [phonesTop, PANEL_PHONES],
      [mouthTop, PANEL_MOUTH],
    ] as const) {
      canvas.line(MARGIN, panel[0], width - MARGIN, panel[0], [190, 190, 190])
      canvas.line(MARGIN, panel[0] + panel[1], width - MARGIN, panel[0] + panel[1], [190, 190, 190])
    }

    // Painel 1: energia e envelope.
    const store = extractor.store
    let previous: [number, number, number] | null = null
    for (let f = 0; f < store.count; f++) {
      const t = store.time[f]!
      if (!inRow(t)) continue
      const env = f < landmarks.envCount ? landmarks.env[f]! : store.vowelBandDb[f]!
      const point: [number, number, number] = [x(t), dbY(store.energyDb[f]!), dbY(env)]
      if (previous) {
        canvas.line(previous[0], previous[1], point[0], point[1], GRAY)
        canvas.line(previous[0], previous[2], point[0], point[2], GREEN)
      }
      previous = point
    }
    canvas.line(MARGIN, dbY(landmarks.silenceDb), width - MARGIN, dbY(landmarks.silenceDb), RED, 0.4)
    canvas.text(4, dbY(landmarks.silenceDb) - 4, `${Math.round(landmarks.silenceDb)}`, RED, 1)
    for (const nucleus of landmarks.nuclei) {
      if (!inRow(nucleus.time)) continue
      canvas.line(x(nucleus.time), dbY(nucleus.envDb) - 6, x(nucleus.time), dbY(nucleus.envDb) + 6, BLUE)
      canvas.rect(x(nucleus.time) - 1, dbY(nucleus.envDb) - 1, x(nucleus.time) + 2, dbY(nucleus.envDb) + 2, BLUE)
    }

    // Painel 2: vozeamento e alta frequência.
    let prevVoicing: [number, number, number] | null = null
    for (let f = 0; f < store.count; f++) {
      const t = store.time[f]!
      if (!inRow(t)) continue
      const point: [number, number, number] = [x(t), unitY(store.voicing[f]!, voicingTop, PANEL_VOICING), unitY(store.highBandRatio[f]!, voicingTop, PANEL_VOICING)]
      if (prevVoicing) {
        canvas.line(prevVoicing[0], prevVoicing[1], point[0], point[1], PURPLE)
        canvas.line(prevVoicing[0], prevVoicing[2], point[0], point[2], ORANGE)
      }
      prevVoicing = point
    }

    // Painel 3: fones.
    let labelRow = 0
    for (const phone of snapshot.phones) {
      if (phone.end - origin < rowStart || phone.start - origin > rowEnd) continue
      const info = PHONES[phone.phone]
      const color: Color =
        phone.source === "audio-only"
          ? YELLOW
          : phone.phone === "_"
            ? GRAY
            : isBilabial(phone.phone)
              ? RED
              : isLabiodental(phone.phone)
                ? PINK
                : info.class === "vowel"
                  ? GREEN
                  : info.class === "fricative" || info.class === "affricate"
                    ? BLUE
                    : [120, 120, 120]
      canvas.rect(x(phone.start), phonesTop + 2, x(phone.end), phonesTop + 16, color, phone.phone === "_" ? 0.35 : 0.55)
      canvas.line(x(phone.start), phonesTop, x(phone.start), phonesTop + PANEL_PHONES, [90, 90, 90], 0.6)
      if (phone.phone !== "_") {
        labelRow = (labelRow + 1) % 2
        canvas.text(x(phone.start) + 1, phonesTop + 20 + labelRow * 11, phone.phone + (phone.stressed && phone.nucleus ? "'" : ""), BLACK)
      }
      // Bilabiais também no painel de energia: onde o fechamento caiu.
      if (isBilabial(phone.phone)) canvas.rect(x(phone.start), featuresTop, x(phone.end), featuresTop + 5, RED, 0.8)
    }

    // Palavras (sem acento: a fonte bitmap só tem ASCII) no topo do painel de energia.
    let lastWord = -1
    for (const phone of snapshot.phones) {
      if (phone.wordIndex < 0 || phone.wordIndex === lastWord) continue
      lastWord = phone.wordIndex
      if (!inRow(phone.start)) continue
      const text = (wordTexts[phone.wordIndex] ?? "?").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      canvas.text(x(phone.start) + 1, featuresTop + 3 + (phone.wordIndex % 2) * 11, text, BLUE)
    }

    // Painel 4: boca.
    let prevMouth: [number, number, number, number, number, number] | null = null
    for (let t = origin + rowStart; t <= origin + rowEnd; t += 0.005) {
      engine.sample(t, frame)
      const m = frame.mouth
      const point: [number, number, number, number, number, number] = [x(t), unitY(m.jaw / 0.7, mouthTop, PANEL_MOUTH), unitY(m.lipClose, mouthTop, PANEL_MOUTH), unitY(m.lowerLipTuck, mouthTop, PANEL_MOUTH), unitY(Math.max(m.round, m.pucker), mouthTop, PANEL_MOUTH), unitY(m.spread, mouthTop, PANEL_MOUTH)]
      if (prevMouth) {
        canvas.line(prevMouth[0], prevMouth[4], point[0], point[4], GREEN, 0.7)
        canvas.line(prevMouth[0], prevMouth[5], point[0], point[5], BLUE, 0.6)
        canvas.line(prevMouth[0], prevMouth[3], point[0], point[3], PINK)
        canvas.line(prevMouth[0], prevMouth[2], point[0], point[2], RED)
        canvas.line(prevMouth[0], prevMouth[1], point[0], point[1], BLACK)
      }
      prevMouth = point
    }
  }

  mkdirSync(outDir, { recursive: true })
  const file = path.join(outDir, `${id}${start > 0 || toArg ? `-${start}-${end.toFixed(0)}` : ""}.png`)
  writeFileSync(file, canvas.png())
  console.log(`${file}  (${snapshot.phones.length} fones, ${elapsed.toFixed(1)} ms)`)
}
