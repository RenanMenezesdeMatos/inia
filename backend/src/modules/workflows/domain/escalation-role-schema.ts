import { z } from "zod"

// Extraído de graph-schema.ts para ser importável tanto por ActionConfig (ESCALATE) quanto por
// OutputTarget (output-schema.ts) sem criar um import circular entre os dois.
// COORDINATOR fica entre Operador e Supervisor na cadeia de reports_to_id (ver migration 037) —
// alvo real de Human Review/Escalate/Output, não só um rótulo.
export const escalationRoleSchema = z.enum(["COORDINATOR", "SUPERVISOR", "MANAGER", "SENIOR_MANAGER", "DIRECTOR"])
export type EscalationRole = z.infer<typeof escalationRoleSchema>
