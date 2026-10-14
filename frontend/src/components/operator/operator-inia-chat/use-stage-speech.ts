import { useRef, useState } from "react"
import type { IniaVoiceEngine } from "../feedback-application/feedback-workspace-context"
import { STAGE_LAND_WAIT_MS, STAGE_WORD_MS, type StageUtterance } from "./stage-speech"

/**
 * Fala da INIA no PALCO (sessão de feedback): o balão sobre a cabeça dela e o pouso na conversa — o estado do balão e as
 * funções que o abrem, alimentam e pousam. Chamadas também pelos eventos da sessão de voz (criados uma vez): só leem refs e
 * setters. `voice` dá o ritmo da fala (alinhamento do lip-sync no instante ouvido).
 */
export function useStageSpeech(voice: IniaVoiceEngine) {
  const [stageUtterance, setStageUtterance] = useState<StageUtterance | null>(null)
  const stageUtteranceRef = useRef<StageUtterance | null>(null)
  const stageKeyRef = useRef(0)
  /** Texto da fala ao vivo do turno atual (chega antes do áudio; o balão revela no ritmo da voz). */
  const stageTranscriptRef = useRef("")
  /** Mensagens que ainda estão no balão (aparecem na conversa quando a fala pousa). */
  const [stageHiddenIds, setStageHiddenIds] = useState<ReadonlySet<number>>(() => new Set())
  /** A apresentação (1ª mensagem da aplicação): onde a fala da apresentação pousa. */
  const presentationLandRef = useRef<number | null>(null)
  /** Resposta de especialista (consulta pela voz) à espera da fala que a diz: pousa nela quando a fala começar e terminar. */
  const specialistLandRef = useRef<number | null>(null)
  /** A frase de chegada ("Vamos continuar de onde paramos.") fica no balão até ela falar ou a pessoa interagir. */
  const [stageGreeting, setStageGreeting] = useState(true)

  function setStage(next: StageUtterance | null) {
    stageUtteranceRef.current = next
    setStageUtterance(next)
  }

  function hideOnStage(id: number) {
    setStageHiddenIds((current) => (current.has(id) ? current : new Set(current).add(id)))
  }

  function revealOnStage(id: number) {
    setStageHiddenIds((current) => {
      if (!current.has(id)) return current
      const next = new Set(current)
      next.delete(id)
      return next
    })
  }

  /**
   * Começa uma fala no balão. `landOn` = a mensagem onde ela pousa (null = ainda não existe: chega no fim do turno). `heard` = o
   * ritmo do texto: sem ele, o da VOZ (alinhamento do lip-sync no instante ouvido — também com ela no mudo, o áudio segue sem som;
   * sem alinhamento, pelo tempo); texto sem voz passa o relógio de leitura.
   */
  function beginStageUtterance(text: string, landOn: number | null, options: { heard?: () => number } = {}): number {
    const startedAt = performance.now()
    const heard = options.heard ?? (() => {
      const at = voice.playback.heardTime()
      const aligned = at === null ? 0 : (voice.lipsync.heardWordCount?.(at) ?? 0)
      return aligned > 0 ? aligned : Math.floor((performance.now() - startedAt) / STAGE_WORD_MS)
    })
    const key = ++stageKeyRef.current
    setStage({ key, text, ended: false, landOn: landOn === null ? null : String(landOn), heard })
    setStageGreeting(false)
    return key
  }

  function appendStageText(text: string) {
    const current = stageUtteranceRef.current
    if (current && !current.ended) setStage({ ...current, text: current.text + text })
  }

  /** A fala terminou (ou foi cortada — `heardText` = o que soou): pousa na mensagem, que aparece agora na conversa. */
  function endStageUtterance(heardText?: string | null, key?: number) {
    const current = stageUtteranceRef.current
    if (!current || current.ended || (key !== undefined && current.key !== key)) return
    setStage({ ...current, ended: true, text: heardText ? heardText : current.text })
    if (current.landOn !== null) {
      revealOnStage(Number(current.landOn))
      return
    }
    const waiting = current.key
    window.setTimeout(() => {
      const latest = stageUtteranceRef.current
      if (latest?.key === waiting && latest.landOn === null) setStage(null)
    }, STAGE_LAND_WAIT_MS)
  }

  /** A mensagem da fala chegou (fim do turno na rede): esconde até o pouso — ou pousa já, se a fala terminou. */
  function attachStageMessage(id: number, key?: number): void {
    const current = stageUtteranceRef.current
    if (!current || current.landOn !== null || (key !== undefined && current.key !== key)) return
    if (!current.ended) hideOnStage(id)
    setStage({ ...current, landOn: String(id) })
  }

  /**
   * Palco: a resposta do especialista é o que ela vai falar — fica fora da conversa e pousa quando a fala termina. Fala em curso
   * (ex.: "vou consultar…") = pousa nela; senão, na próxima fala do turno.
   */
  function landSpecialistOnStage(id: number) {
    const current = stageUtteranceRef.current
    if (current && !current.ended && current.landOn === null) {
      attachStageMessage(id)
      return
    }
    hideOnStage(id)
    specialistLandRef.current = id
  }

  function takeSpecialistLanding(): number | null {
    const id = specialistLandRef.current
    specialistLandRef.current = null
    return id
  }

  function handleSpeechLanded(key: number) {
    if (stageUtteranceRef.current?.key === key) setStage(null)
  }

  function clearStage() {
    setStage(null)
    stageTranscriptRef.current = ""
    presentationLandRef.current = null
    specialistLandRef.current = null
    setStageHiddenIds((current) => (current.size === 0 ? current : new Set()))
  }

  return {
    stageUtterance, stageUtteranceRef, stageTranscriptRef, stageHiddenIds, presentationLandRef, stageGreeting, setStageGreeting,
    setStage, hideOnStage, revealOnStage, beginStageUtterance, appendStageText, endStageUtterance, attachStageMessage,
    landSpecialistOnStage, takeSpecialistLanding, handleSpeechLanded, clearStage,
  }
}
