import type { Database } from "../../../infrastructure/database/pool.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { lastClosedReferencePeriod } from "../domain/official-closure-policy.js"

/** Contexto de fechamento oficial de UMA request: fuso da organização + último fechamento possível. */
export type OfficialClosureContext = { now: Date; timeZone: string; lastClosedPeriod: string }

export async function resolveOfficialClosure(db: Database, organizationId: string, now: Date): Promise<OfficialClosureContext> {
  const timeZone = await resolveOrganizationTimezone(db, organizationId)
  return { now, timeZone, lastClosedPeriod: lastClosedReferencePeriod(now, timeZone) }
}
