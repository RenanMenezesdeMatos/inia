// Normalizes raw mic RMS (rarely above ~0.1 for a typical unprocessed
// getUserMedia stream at conversational volume) into a 0–1 range that
// actually reads as visible movement in a pulse effect.
export function normalizedMicLevel(level: number): number {
  return Math.min(1, level * 9)
}

// Brilho do composer com o microfone aberto, proporcional ao nível já normalizado (0–1).
export function micGlow(level: number): string {
  return `0 0 0 ${3 + level * 10}px rgba(102,0,153,${0.1 + level * 0.35})`
}

// Estado inicial do "pulso" atrás do botão do microfone; o nível real é escrito direto no DOM
// (`paintMicLevel`). Objeto constante: re-renders do chat não reescrevem o que o nível pintou.
export const MIC_PULSE_REST_STYLE: React.CSSProperties = { transform: "scale(1.2)", opacity: 0.25, transition: "transform 80ms ease-out, opacity 80ms ease-out" }

export const MIC_GLOW_REST_STYLE: React.CSSProperties = { boxShadow: micGlow(0) }

export const WAVEFORM_BAR_COUNT = 28
