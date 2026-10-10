import type { SpeechPlayback } from "@/lib/avatar/audio/types"

/**
 * Gravação de demonstração do laboratório: o Canvas do avatar (`captureStream`) + EXATAMENTE o
 * áudio que vai ao alto-falante (`playback.tapOutput` num `MediaStreamAudioDestinationNode`) →
 * WebM. Só navegador; as partes puras (formato, destino do upload, nome) são testadas.
 */

/** Ordem de preferência: VP9/Opus, depois VP8/Opus, depois o WebM que o navegador escolher. */
export const RECORDING_MIME_CANDIDATES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"] as const

export function pickRecordingMimeType(isTypeSupported: (type: string) => boolean): string | null {
  return RECORDING_MIME_CANDIDATES.find((type) => isTypeSupported(type)) ?? null
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"])

/**
 * `?upload=http://127.0.0.1:PORT/caminho` — receptor de desenvolvimento para o orquestrador
 * recolher o vídeo sem download manual. Só http(s) de loopback com porta explícita: um link
 * qualquer nunca faz o laboratório enviar a gravação para fora da máquina.
 */
export function parseUploadTarget(search: string): URL | null {
  const raw = new URLSearchParams(search).get("upload")
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  if (!LOOPBACK_HOSTS.has(url.hostname) || !url.port) return null
  if (url.username || url.password) return null
  return url
}

/** `inia-avatar-frase-01-apresentacao-20260925-021530.webm` (hora local). */
export function recordingFileName(label: string, at: Date): string {
  const slug =
    label
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "demo"
  const pad = (value: number) => String(value).padStart(2, "0")
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
  return `inia-avatar-${slug}-${stamp}.webm`
}

export type DemoRecording = {
  readonly mimeType: string
  /** Há faixa de áudio (sem AudioContext ainda, grava só vídeo). */
  readonly hasAudio: boolean
  /** Para e devolve o WebM completo. */
  stop(): Promise<Blob>
  /** Descarta a gravação (desmontagem). */
  cancel(): void
}

export type StartDemoRecordingOptions = {
  canvas: HTMLCanvasElement
  playback: SpeechPlayback
  fps?: number
  videoBitsPerSecond?: number
}

export function startDemoRecording({ canvas, playback, fps = 30, videoBitsPerSecond = 8_000_000 }: StartDemoRecordingOptions): DemoRecording {
  if (typeof MediaRecorder === "undefined") throw new Error("Este navegador não tem MediaRecorder.")
  const mimeType = pickRecordingMimeType((type) => MediaRecorder.isTypeSupported(type))
  if (!mimeType) throw new Error("Este navegador não grava WebM (VP9/VP8).")
  const video = canvas.captureStream(fps)
  const context = playback.context
  let untap: (() => void) | null = null
  let audioTracks: MediaStreamTrack[] = []
  if (context && context.state !== "closed") {
    const destination = context.createMediaStreamDestination()
    untap = playback.tapOutput(destination)
    audioTracks = destination.stream.getAudioTracks()
  }
  const stream = new MediaStream([...video.getVideoTracks(), ...audioTracks])
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond, audioBitsPerSecond: 128_000 })
  const chunks: Blob[] = []
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  })
  const release = () => {
    untap?.()
    untap = null
    for (const track of stream.getTracks()) track.stop()
  }
  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.addEventListener("stop", () => {
      release()
      resolve(new Blob(chunks, { type: mimeType.split(";")[0] }))
    })
    recorder.addEventListener("error", (event) => {
      release()
      reject(event instanceof ErrorEvent && event.error instanceof Error ? event.error : new Error("Falha na gravação."))
    })
  })
  // Fatias de 250 ms: parar no meio de uma fala não perde o último trecho.
  recorder.start(250)
  return {
    mimeType,
    hasAudio: audioTracks.length > 0,
    stop() {
      if (recorder.state !== "inactive") recorder.stop()
      return stopped
    },
    cancel() {
      stopped.catch(() => {})
      if (recorder.state !== "inactive") recorder.stop()
      else release()
    },
  }
}

export type UploadResult = { ok: boolean; status: number; body: string; opaque: boolean }

/**
 * POST do WebM para o receptor de desenvolvimento (corpo = o próprio vídeo; nome na query). O
 * receptor está em outra origem: sem CORS a primeira tentativa falha e a segunda vai em `no-cors`
 * (chega do mesmo jeito, mas a resposta é opaca — status desconhecido).
 */
export async function uploadRecording(target: URL, blob: Blob, fileName: string): Promise<UploadResult> {
  const url = new URL(target)
  url.searchParams.set("name", fileName)
  try {
    const response = await fetch(url, { method: "POST", body: blob })
    const body = (await response.text()).slice(0, 500)
    return { ok: response.ok, status: response.status, body, opaque: false }
  } catch {
    await fetch(url, { method: "POST", body: blob, mode: "no-cors" })
    return { ok: true, status: 0, body: "", opaque: true }
  }
}
