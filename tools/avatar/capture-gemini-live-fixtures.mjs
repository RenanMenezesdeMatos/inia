/**
 * Captura respostas REAIS do Gemini Live com o mesmo modelo/configuração do avatar da INIA e grava,
 * para cada caso, o áudio (WAV 24 kHz) e a linha do tempo de chegada de cada chunk de áudio e de cada
 * fragmento de transcrição. Essas fixtures alimentam os testes de lip-sync e o laboratório
 * /dev/avatar-lab sem custo de API.
 *
 *   node tools/avatar/capture-gemini-live-fixtures.mjs <casos.json> <pasta-de-saída> [--voice Kore]
 *
 * Sessão igual à de produção (`frontend/src/lib/realtime/gemini-live-protocol.ts › buildSetupMessage`):
 * só áudio, voz explícita (padrão "Kore", a de `backend/src/config/inia-voice.ts`; `--voice ""` = voz
 * padrão do Live, como as capturas de 2026-09-24), transcrição de entrada e de saída, push-to-talk
 * (detecção automática de atividade desligada).
 *
 * Casos: `{ id, prompt }` manda o pedido como TEXTO (`clientContent`); `{ id, audioPrompt }` manda a
 * pergunta FALADA — sintetizada no Mac (`say -v Luciana`, PCM16 16 kHz) e enviada como o microfone do
 * avatar (`activityStart` → chunks de 40 ms no ritmo real → `activityEnd`). `t` dos eventos = ms desde o
 * fim do pedido (envio do texto ou `activityEnd`).
 *
 * `events` só tem os quatro tipos que o replay entende (áudio, transcrição de saída, generationComplete,
 * turnComplete); o resto (transcrição da pergunta falada, uso de tokens) fica em `extra`.
 *
 * Usa GEMINI_API_KEY de backend/.env (lida localmente, nunca impressa). Custo: uma sessão curta por
 * caso — ~US$ 0,02 por minuto de áudio gerado (tabela pública do Live, áudio de saída).
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
// Num worktree sem backend/.env, aponte o do checkout principal: INIA_BACKEND_ENV=/caminho/backend/.env
const envText = fs.readFileSync(process.env.INIA_BACKEND_ENV ?? path.join(repo, "backend/.env"), "utf8")
const key = envText.match(/^GEMINI_API_KEY=(.*)$/m)[1].trim().replace(/^["']|["']$/g, "")
const MODEL = "models/gemini-2.5-flash-native-audio-latest"
const URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${key}`
const args = process.argv.slice(2)
const voiceIndex = args.indexOf("--voice")
const VOICE = voiceIndex >= 0 ? args[voiceIndex + 1] : "Kore"
const [casesFile, outDir = "."] = args.filter((arg, index) => !arg.startsWith("--") && !(index > 0 && args[index - 1] === "--voice"))
const cases = JSON.parse(fs.readFileSync(casesFile, "utf8"))
fs.mkdirSync(outDir, { recursive: true })
const SYSTEM = "Você é a INIA, uma mentora virtual simpática e atenciosa. Fale sempre em português do Brasil, com naturalidade e ritmo de conversa. Quando o usuário pedir para dizer um texto, diga exatamente esse texto, sem acrescentar nada antes ou depois."
const MIC_RATE = 16000
const MIC_CHUNK_SAMPLES = 640 // 40 ms

/** Pergunta falada: `say` (voz pt-BR do Mac) → WAV PCM16 16 kHz mono → amostras. */
function synthesizeQuestion(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inia-live-"))
  const aiff = path.join(dir, "q.aiff")
  const wav = path.join(dir, "q.wav")
  execFileSync("say", ["-v", "Luciana", "-o", aiff, text])
  execFileSync("afconvert", ["-f", "WAVE", "-d", `LEI16@${MIC_RATE}`, "-c", "1", aiff, wav])
  const buffer = fs.readFileSync(wav)
  fs.rmSync(dir, { recursive: true, force: true })
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32LE(offset + 4)
    if (buffer.toString("ascii", offset, offset + 4) === "data") return buffer.subarray(offset + 8, offset + 8 + size)
    offset += 8 + size + (size % 2)
  }
  throw new Error("WAV sintetizado sem bloco data")
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function runCase(c) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL)
    const events = []
    const extra = []
    let t0 = null
    const timer = setTimeout(() => { ws.close(); reject(new Error("timeout " + c.id)) }, 120000)
    const now = () => performance.now() - (t0 ?? performance.now())
    ws.addEventListener("open", () => {
      const generationConfig = { responseModalities: ["AUDIO"], ...(VOICE ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } } : {}) }
      ws.send(JSON.stringify({ setup: { model: MODEL, generationConfig, systemInstruction: { parts: [{ text: SYSTEM }] }, inputAudioTranscription: {}, outputAudioTranscription: {}, realtimeInputConfig: { automaticActivityDetection: { disabled: true } } } }))
    })
    ws.addEventListener("message", async (ev) => {
      const text = typeof ev.data === "string" ? ev.data : Buffer.from(await ev.data.arrayBuffer()).toString("utf8")
      const msg = JSON.parse(text)
      if (msg.setupComplete) {
        if (c.prompt) {
          t0 = performance.now()
          ws.send(JSON.stringify({ clientContent: { turns: [{ role: "user", parts: [{ text: c.prompt }] }], turnComplete: true } }))
          return
        }
        // Pergunta falada, no ritmo do microfone.
        const pcm = synthesizeQuestion(c.audioPrompt)
        ws.send(JSON.stringify({ realtimeInput: { activityStart: {} } }))
        for (let offset = 0; offset < pcm.length; offset += MIC_CHUNK_SAMPLES * 2) {
          ws.send(JSON.stringify({ realtimeInput: { audio: { data: pcm.subarray(offset, offset + MIC_CHUNK_SAMPLES * 2).toString("base64"), mimeType: `audio/pcm;rate=${MIC_RATE}` } } }))
          await sleep((MIC_CHUNK_SAMPLES / MIC_RATE) * 1000)
        }
        t0 = performance.now()
        ws.send(JSON.stringify({ realtimeInput: { activityEnd: {} } }))
        return
      }
      const t = now()
      if (msg.usageMetadata) extra.push({ t, usageMetadata: msg.usageMetadata })
      const sc = msg.serverContent
      if (!sc) {
        if (!msg.usageMetadata) extra.push({ t, other: Object.keys(msg) })
        return
      }
      if (sc.inputTranscription?.text) extra.push({ t, inputTranscript: sc.inputTranscription.text })
      for (const p of sc.modelTurn?.parts ?? []) if (p.inlineData?.data) events.push({ t, audio: p.inlineData.data, mime: p.inlineData.mimeType })
      if (sc.outputTranscription?.text) events.push({ t, transcript: sc.outputTranscription.text })
      if (sc.interrupted) extra.push({ t, interrupted: true })
      if (sc.generationComplete) events.push({ t, generationComplete: true })
      if (sc.turnComplete) {
        events.push({ t, turnComplete: true })
        clearTimeout(timer); ws.close(); resolve({ events, extra })
      }
    })
    ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("ws error " + c.id)) })
    ws.addEventListener("close", (e) => { if (e.code !== 1000 && e.code !== 1005) console.error("close", c.id, e.code, e.reason) })
  })
}

for (const c of cases) {
  const { events, extra } = await runCase(c)
  const audio = events.filter((e) => e.audio)
  const pcm = Buffer.concat(audio.map((e) => Buffer.from(e.audio, "base64")))
  const transcript = events.filter((e) => e.transcript).map((e) => e.transcript).join("")
  // WAV 24 kHz mono PCM16
  const header = Buffer.alloc(44)
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8); header.write("fmt ", 12)
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(24000, 24)
  header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40)
  fs.writeFileSync(path.join(outDir, `${c.id}.wav`), Buffer.concat([header, pcm]))
  const round = (e) => ({ ...e, t: Math.round(e.t) })
  const json = {
    id: c.id,
    model: MODEL,
    voice: VOICE || null,
    prompt: c.prompt ?? null,
    audioPrompt: c.audioPrompt ?? null,
    sampleRate: 24000,
    transcript,
    events: events.map((e) => (e.audio ? { t: Math.round(e.t), audioBytes: Buffer.from(e.audio, "base64").length, mime: e.mime } : round(e))),
    extra: extra.map(round),
  }
  fs.writeFileSync(path.join(outDir, `${c.id}.json`), JSON.stringify(json, null, 1))
  const usage = extra.filter((e) => e.usageMetadata).at(-1)?.usageMetadata
  console.log(c.id, "chunks", audio.length, "audioSec", (pcm.length / 48000).toFixed(2), "first audio at", Math.round(audio[0]?.t), "ms", "last event", Math.round(events.at(-1).t), "| tokens", usage?.totalTokenCount ?? "?", "| transcript:", transcript)
}
