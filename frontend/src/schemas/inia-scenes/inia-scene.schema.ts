import { z } from "zod"

/**
 * O que o colaborador vê AGORA na organização (o fundo atrás da INIA): o cenário pela data local e a imagem pelo horário
 * local (faixas diárias no fuso da organização). Nulo = palco padrão, sem imagem. O backend resolve; a tela só exibe.
 */
export const currentIniaSceneSchema = z.object({
  id: z.string(),
  name: z.string(),
  imageId: z.string().default(""),
  imageLabel: z.string().default(""),
  imageUrl: z.string(),
  width: z.number(),
  height: z.number(),
  blur: z.number().default(0.5),
  dim: z.number().default(0),
  reason: z.enum(["SCHEDULED", "DEFAULT"]),
  imageReason: z.enum(["SLOT", "PRIMARY"]).default("PRIMARY"),
})
export type CurrentIniaScene = z.infer<typeof currentIniaSceneSchema>
/**
 * `now` = instante do servidor na resolução; `nextChangeAt` = quando o que aparece muda (outra imagem ou outro cenário) — a
 * tela pede de novo nesse instante, medido pelo relógio do SERVIDOR (atraso do relógio local não importa). `upcoming` = a
 * imagem que vem depois, para pré-carregar pouco antes da troca.
 */
export const currentIniaSceneStateSchema = z.object({
  scene: currentIniaSceneSchema.nullable(),
  now: z.string().nullable().default(null),
  nextChangeAt: z.string().nullable().default(null),
  upcoming: z.object({ imageUrl: z.string() }).nullable().default(null),
})
export type CurrentIniaSceneState = z.infer<typeof currentIniaSceneStateSchema>

export const INIA_SCENE_STATUSES = ["LIVE", "UPCOMING", "ENDED", "STANDBY"] as const
export const iniaSceneImageSchema = z.object({
  id: z.string(),
  label: z.string(),
  imageUrl: z.string(),
  width: z.number(),
  height: z.number(),
  byteSize: z.number(),
  isPrimary: z.boolean(),
  /** Faixa diária "HH:MM" (início inclusivo, fim exclusivo) no fuso da organização; nulos = sem faixa. */
  start: z.string().nullable(),
  end: z.string().nullable(),
})
export type IniaSceneImage = z.infer<typeof iniaSceneImageSchema>

export const iniaSceneSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Imagem principal. */
  imageUrl: z.string(),
  width: z.number(),
  height: z.number(),
  byteSize: z.number(),
  blur: z.number().default(0.5),
  dim: z.number().default(0),
  scheduleStart: z.string().nullable(),
  scheduleEnd: z.string().nullable(),
  isDefault: z.boolean(),
  status: z.enum(INIA_SCENE_STATUSES),
  /** Em ordem de horário (faixas pelo início; sem faixa por último). */
  images: z.array(iniaSceneImageSchema),
  /** A imagem deste cenário no horário local de agora. */
  activeImageId: z.string(),
  nextImageChange: z.object({ time: z.string(), imageId: z.string(), nextDay: z.boolean() }).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type IniaScene = z.infer<typeof iniaSceneSchema>

export const iniaScenesOverviewSchema = z.object({
  today: z.string(),
  timeZone: z.string(),
  now: z.string(),
  localTime: z.string(),
  defaultSceneId: z.string().nullable(),
  current: z.object({ sceneId: z.string(), imageId: z.string(), reason: z.enum(["SCHEDULED", "DEFAULT"]), imageReason: z.enum(["SLOT", "PRIMARY"]) }).nullable(),
  nextChange: z.object({ at: z.string(), date: z.string(), time: z.string(), sceneId: z.string().nullable(), imageId: z.string().nullable() }).nullable(),
  /** Ordem do backend: agendados pela data de início (ano completo), depois os sem período. A tela não reordena. */
  scenes: z.array(iniaSceneSchema),
})
export type IniaScenesOverview = z.infer<typeof iniaScenesOverviewSchema>

/** Desfoque do fundo em px (vale igual no palco e no painel; a prévia da Administração encolhe junto). Mesmos limites e grade (centésimos) do backend. */
export const INIA_SCENE_BLUR = { min: 0, max: 3, step: 0.01, default: 0.5 } as const
/** Escurecimento do fundo em % (máscara preta sobre a imagem). Mesmos limites do backend. */
export const INIA_SCENE_DIM = { min: 0, max: 100, step: 1, default: 0 } as const
/** Imagens por cenário e tamanho da identificação (mesmos limites do backend). */
export const INIA_SCENE_IMAGES = { max: 8, labelMax: 40 } as const

/** Mesmos limites do backend (a tela antecipa; o backend valida pelo conteúdo). */
export const INIA_SCENE_IMAGE_RULES = { maxBytes: 8 * 1024 * 1024, minWidth: 1280, minHeight: 640, accept: "image/jpeg,image/png,image/webp" } as const
