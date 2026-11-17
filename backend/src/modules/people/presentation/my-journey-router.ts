import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { sessionUser } from "../../auth/presentation/session-user.js"
import { buildMyJourney } from "../application/my-journey.js"

const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value, "Data inválida.")

/** Só `week` (qualquer data da semana). Qualquer outro parâmetro (personId, matrícula…) é descartado: a pessoa vem da sessão. */
// Ano limitado: uma data como 9999-12-31 levaria a semana para "+010000" e o SQL `::date` daria 500 (run-6 JA-03).
const querySchema = z.object({ week: DATE.refine((value) => value >= "2000-01-01" && value <= "2099-12-31", "Data fora do intervalo aceito.").optional() })

/**
 * `/api/v1/my-journey` — "Minha jornada": a escala da PRÓPRIA pessoa logada (semana de segunda a domingo). Somente leitura,
 * sem identificador de pessoa na rota; não depende das permissões do Calendário da equipe.
 */
export function createMyJourneyRouter(db: Database, now: () => Date = () => new Date()) {
  const router = Router()
  router.get("/", async (request, response, next) => {
    try {
      const query = querySchema.parse(request.query)
      response.setHeader("Cache-Control", "no-store")
      response.json({ data: await buildMyJourney(db, sessionUser(request), { weekOf: query.week, now: now() }) })
    } catch (error) {
      next(error)
    }
  })
  return router
}
