/**
 * Captura do microfone para o Gemini Live: PCM16 a 16 kHz em chunks de ~100 ms (worklet
 * `pcm-capture-processor.js`) + nível RMS ~19×/s.
 *
 * Um handle por turno de fala: o microfone só fica aberto entre `startMicCapture()` e `stop()` —
 * encerrar o turno para a MediaStream e fecha o AudioContext de captura (nunca só "muta"), então
 * não há ambiguidade sobre quando a voz está sendo capturada.
 *
 * Falha no meio do caminho (permissão negada, worklet que não carrega) limpa o que já tinha sido
 * aberto — antes, um `addModule` falhando depois do `getUserMedia` deixava o microfone ligado.
 */

export type MicCaptureHandlers = {
  onChunk: (pcm16: ArrayBuffer) => void
  onLevel: (level: number) => void
}

export type MicCapture = {
  readonly context: AudioContext
  stop(): void
}

export type StartMicCapture = (handlers: MicCaptureHandlers) => Promise<MicCapture>

const WORKLET_URL = "/worklets/pcm-capture-processor.js"
const TARGET_SAMPLE_RATE = 16000

export const startMicCapture: StartMicCapture = async (handlers) => {
  let stream: MediaStream | null = null
  let context: AudioContext | null = null
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    context = new AudioContext()
    await context.audioWorklet.addModule(WORKLET_URL)
    const source = context.createMediaStreamSource(stream)
    const node = new AudioWorkletNode(context, "pcm-capture-processor", {
      processorOptions: { targetSampleRate: TARGET_SAMPLE_RATE },
    })
    node.port.onmessage = (event: MessageEvent<ArrayBuffer | { type: "level"; value: number }>) => {
      if (event.data instanceof ArrayBuffer) handlers.onChunk(event.data)
      else if (event.data.type === "level") handlers.onLevel(event.data.value)
    }
    // Não vai para o `destination`: o worklet só observa o sinal, nunca devolve o microfone em voz alta.
    source.connect(node)

    const openStream = stream
    const openContext = context
    let stopped = false
    return {
      context: openContext,
      stop() {
        if (stopped) return
        stopped = true
        node.port.onmessage = null
        node.port.close()
        node.disconnect()
        source.disconnect()
        openStream.getTracks().forEach((track) => track.stop())
        void openContext.close().catch(() => {})
      },
    }
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop())
    if (context) void context.close().catch(() => {})
    throw error
  }
}

/** Mensagem para o usuário a partir da falha do getUserMedia/worklet. */
export function micCaptureErrorMessage(error: unknown): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : ""
  if (name === "NotAllowedError" || name === "SecurityError") return "Permissão do microfone negada. Libere o acesso no navegador para falar com a INIA."
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Nenhum microfone encontrado neste dispositivo."
  if (name === "NotReadableError") return "O microfone está em uso por outro aplicativo."
  return "Não foi possível abrir o microfone."
}
