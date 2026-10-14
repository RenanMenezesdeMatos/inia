import type { Database } from "../../../infrastructure/database/pool.js"
import type { Queryable } from "../../people/application/schedule-exception-service.js"
import { resolveByRoleChain } from "../../workflows/application/enrollment-subject.js"
import type { EscalationRole } from "../../workflows/domain/escalation-role-schema.js"
import { RESPONSIBLE_ROLE_LABELS, type ResponsibleRole } from "../domain/intervention-type.js"

/**
 * Responsável (ou aprovador) de uma intervenção pela cadeia do colaborador: o LÍDER DIRETO é quem ele reporta (ativo), qualquer
 * que seja o nível; um nível hierárquico é o primeiro na cadeia com esse nível — o mesmo resolvedor do Escalar/Revisão humana.
 */
export async function resolveResponsibleId(db: Queryable | Database, personId: string, role: ResponsibleRole): Promise<string | null> {
  if (role === "DIRECT_LEADER") {
    const row = await db.query<{ id: string }>(`select l.id from people p join people l on l.id = p.reports_to_id where p.id = $1 and l.active`, [personId])
    return row.rows[0]?.id ?? null
  }
  return (await resolveByRoleChain(db as Database, personId, [role as EscalationRole]))[0]?.id ?? null
}

/** Mensagem de negócio quando a cadeia não tem quem assumir. */
export function unresolvedResponsibleMessage(role: ResponsibleRole, personName: string, typeName: string, what: "ser responsável por" | "aprovar"): string {
  return role === "DIRECT_LEADER"
    ? `${personName} não tem líder direto ativo para ${what} "${typeName}".`
    : `Não há ${RESPONSIBLE_ROLE_LABELS[role]} na cadeia de ${personName} para ${what} "${typeName}".`
}
