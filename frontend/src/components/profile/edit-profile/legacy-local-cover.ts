import { COVER_PRESETS, type CoverPreset } from "@/schemas/profile/my-profile.schema"

/**
 * Capa salva pela versão anterior APENAS no navegador, em chaves globais (sem dono): não prova a quem pertence. Nunca é
 * aplicada automaticamente — o editor mostra à pessoa logada e só vira capa dela se ela confirmar; em seguida as chaves são
 * apagadas (confirmando ou descartando).
 */
const COVER_KEY = "inia.operator.profile-cover"
const CUSTOM_COVER_KEY = "inia.operator.custom-profile-cover"

export type LegacyLocalCover = { kind: "preset"; preset: CoverPreset } | { kind: "custom"; dataUrl: string }

export function readLegacyLocalCover(): LegacyLocalCover | null {
  try {
    const stored = window.localStorage.getItem(COVER_KEY)
    if (stored === "custom") {
      const dataUrl = window.localStorage.getItem(CUSTOM_COVER_KEY)
      return dataUrl && dataUrl.startsWith("data:image/") ? { kind: "custom", dataUrl } : null
    }
    return stored && (COVER_PRESETS as readonly string[]).includes(stored) ? { kind: "preset", preset: stored as CoverPreset } : null
  } catch {
    return null
  }
}

export function clearLegacyLocalCover() {
  try {
    window.localStorage.removeItem(COVER_KEY)
    window.localStorage.removeItem(CUSTOM_COVER_KEY)
  } catch {
    // armazenamento indisponível: nada a limpar
  }
}
