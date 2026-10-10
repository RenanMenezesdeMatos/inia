import { z } from "zod"

/**
 * Material de apoio recomendado num Feedback, já resolvido pelo backend para quem está lendo:
 * `available: true` traz o título REAL do material e o motivo escrito pela IA; `available: false`
 * é o marcador neutro de "não está mais disponível para você" (despublicado, removido ou fora do
 * alcance) — sem título nem motivo, e sem link. A URL nunca vem da API nem do modelo: o frontend
 * monta a rota a partir do id (lib/knowledge/material-href.ts).
 */
export const feedbackSupportMaterialSchema = z.discriminatedUnion("available", [
  z.object({ materialId: z.string(), available: z.literal(true), title: z.string(), reason: z.string() }),
  z.object({ materialId: z.string(), available: z.literal(false) }),
])

export type FeedbackSupportMaterial = z.infer<typeof feedbackSupportMaterialSchema>
