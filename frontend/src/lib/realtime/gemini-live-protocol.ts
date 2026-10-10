/**
 * Formato das mensagens do Gemini Live (BidiGenerateContent) usado pelo transporte de voz — só o
 * subconjunto que a INIA lê/escreve, sem nenhuma lógica de sessão.
 */

/**
 * Sessão efêmera criada pelo backend (POST /api/v1/realtime/sessions); a chave da API nunca chega aqui. A configuração da sessão
 * (instrução, ferramentas, voz, transcrições, push-to-talk) também não: o backend a monta e a TRAVA no token — o provedor usa a do
 * token e ignora o `setup` que o navegador mandar (risco R-04 da auditoria de 08/10/2026).
 */
export type EphemeralSession = { wsUrl: string; model: string; expiresAt: string }

export type GeminiServerMessage = {
  setupComplete?: unknown
  serverContent?: {
    modelTurn?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> }
    inputTranscription?: { text?: string }
    outputTranscription?: { text?: string }
    /** Fim da geração: todo o áudio/texto da resposta já foi enviado (o `turnComplete` vem depois). */
    generationComplete?: boolean
    turnComplete?: boolean
    /** Geração cancelada (ex.: `activityStart` durante a fala); seguido de `turnComplete`, sem `generationComplete`. */
    interrupted?: boolean
  }
  toolCall?: { functionCalls?: Array<{ id?: string; name: string; args?: Record<string, unknown> }> }
  goAway?: { timeLeft?: string }
}

/**
 * O protocolo exige que a primeira mensagem seja um `setup`, mas o token já leva a configuração inteira e o provedor ignora a do
 * cliente (verificado contra a API real em 08/10/2026, inclusive com instrução e ferramentas diferentes): daqui só sai o modelo.
 */
export function buildSetupMessage(session: EphemeralSession): unknown {
  return { setup: { model: session.model } }
}

/** Parte de áudio da resposta (PCM16 24 kHz); ausência de mimeType é tratada como áudio. */
export function isAudioPart(part: { inlineData?: { data?: string; mimeType?: string } }): part is { inlineData: { data: string; mimeType?: string } } {
  const inline = part.inlineData
  if (!inline?.data) return false
  return !inline.mimeType || inline.mimeType.startsWith("audio/")
}

// A transcrição ao vivo do Gemini Live (recurso ainda beta) às vezes vaza um token de controle
// interno como texto literal (ex.: "<ctrl46>", visto duas vezes seguidas no início de um turno real
// em 2026-09-12) em vez de resolvê-lo em fala — nunca aconteceu no caminho de texto
// (generateContent), só na transcrição de áudio. Filtra na origem, antes de acumular no transcript,
// mostrar na tela ou alimentar o lip-sync. Espaços são preservados: os fragmentos chegam no meio de
// palavras (" e escuta").
export function sanitizeTranscriptFragment(text: string): string {
  return text.replace(/<ctrl\d+>/gi, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
}

export function safeParse(raw: string): GeminiServerMessage | null {
  try {
    const value: unknown = JSON.parse(raw)
    return value && typeof value === "object" ? (value as GeminiServerMessage) : null
  } catch {
    return null
  }
}

/** O Live entrega texto ou Blob (dependendo do navegador); ArrayBuffer por garantia. */
export async function readSocketData(data: unknown): Promise<string> {
  if (typeof data === "string") return data
  if (typeof Blob !== "undefined" && data instanceof Blob) return data.text()
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data)
  return String(data)
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  // Em blocos: String.fromCharCode com milhares de argumentos estoura a pilha.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
