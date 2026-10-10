import type { EmissionTable } from "./emission-model"

/**
 * Parâmetros do modelo acústico (ver `emission-model.ts`): por classe, [média, desvio, lado] de
 * eRel, eLoc, mid, low, high, voice. Ajustada à mão (fonética acústica do PT-BR) contra as capturas —
 * ver `emission-model.ts`. 2026-10-08: "f" (labiodentalVoiceless) aceita fricção fraca e parcialmente
 * sonora — a voz Kore diz "feedback" com o "f" quase sonoro e o alinhamento escorregava ~1 s.
 */
export const EMISSION_TABLE: EmissionTable = {
  pause: [[-45, 10, 1], [-30, 10, 1], [0, 20, 0], [0, 20, 0], [0.3, 0.5, 0], [0.2, 0.4, 0]],
  vowel: [[-3, 5, -1], [-2, 4, -1], [-9, 6, 0], [2.5, 3, 0], [0.01, 0.05, 0], [0.95, 0.1, 0]],
  glide: [[-6, 5, 0], [-4, 4, 0], [-12, 7, 0], [3, 3, 0], [0.01, 0.05, 0], [0.95, 0.1, 0]],
  nasal: [[-10, 5, 0], [-9, 5, 0], [-22, 5, 0], [6, 4, 0], [0.01, 0.05, 0], [0.9, 0.15, 0]],
  liquid: [[-8, 5, 0], [-7, 5, 0], [-14, 6, 0], [4, 4, 0], [0.02, 0.06, 0], [0.9, 0.15, 0]],
  stopVoiceless: [[-28, 10, 0], [-25, 10, 0], [-10, 10, 0], [10, 10, 0], [0.3, 0.35, 0], [0.2, 0.3, 0]],
  stopVoiced: [[-18, 8, 0], [-16, 8, 0], [-20, 8, 0], [8, 6, 0], [0.05, 0.15, 0], [0.6, 0.3, 0]],
  affricateVoiceless: [[-18, 8, 0], [-16, 8, 0], [-8, 8, 0], [15, 8, 0], [0.75, 0.3, 0], [0.2, 0.3, 0]],
  affricateVoiced: [[-14, 7, 0], [-12, 7, 0], [-10, 8, 0], [10, 8, 0], [0.5, 0.3, 0], [0.5, 0.3, 0]],
  sibilantVoiceless: [[-14, 7, 0], [-12, 7, 0], [-3, 6, 0], [18, 6, 0], [0.9, 0.15, 0], [0.15, 0.25, 0]],
  sibilantVoiced: [[-13, 7, 0], [-11, 7, 0], [-8, 8, 0], [10, 8, 0], [0.55, 0.3, 0], [0.6, 0.3, 0]],
  labiodentalVoiceless: [[-22, 10, 0], [-20, 10, 0], [-6, 8, 0], [10, 8, 0], [0.45, 0.4, 0], [0.3, 0.5, 0]],
  labiodentalVoiced: [[-14, 6, 0], [-12, 6, 0], [-14, 7, 0], [6, 5, 0], [0.15, 0.2, 0], [0.8, 0.2, 0]],
  rhotic: [[-16, 7, 0], [-14, 7, 0], [-10, 8, 0], [5, 5, 0], [0.15, 0.2, 0], [0.4, 0.3, 0]],
}
