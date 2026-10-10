import type { Database } from "../../../infrastructure/database/pool.js"
import { displayNameOf, addressNameOf, type PersonPresentation } from "../domain/person-presentation.js"
import { loadPersonPresentation } from "./person-presentation-loader.js"

export type SessionIdentity = {
  /** Nome CADASTRAL (fornecido pelo cliente) — nunca substituído pelo preferido. */
  name: string
  preferredName: string | null
  displayName: string
  addressName: string | null
  avatarUrl: string | null
  avatarSource: PersonPresentation["avatarSource"]
  jobTitle: string | null
  teamId: string | null
  teamName: string | null
}

type SessionUser = { organizationId: string; personId: string; name: string; avatarUrl: string | null; jobTitle: string | null; teamId: string | null; teamName: string | null }

/**
 * Identidade do cabeçalho lida AO VIVO do banco (organização + pessoa da sessão). Sem registro (ex.: pessoa removida entre o
 * login e agora), cai no snapshot do token — a sessão continua funcionando.
 */
export async function loadIdentityForSession(db: Pick<Database, "query">, user: SessionUser): Promise<SessionIdentity> {
  const [presentation, professional] = await Promise.all([
    loadPersonPresentation(db, user.organizationId, user.personId),
    db.query<{ job_title: string | null; team_id: string | null; team_name: string | null }>(
      `select p.job_title, p.team_id, t.name team_name from people p left join teams t on t.id = p.team_id where p.organization_id = $1 and p.id = $2`,
      [user.organizationId, user.personId],
    ),
  ])
  const row = professional.rows[0]
  if (!presentation || !row) {
    const source = { registeredName: user.name, preferredName: null }
    return { name: user.name, preferredName: null, displayName: displayNameOf(source), addressName: addressNameOf(source), avatarUrl: user.avatarUrl, avatarSource: user.avatarUrl ? "CORPORATE" : "NONE", jobTitle: user.jobTitle, teamId: user.teamId, teamName: user.teamName }
  }
  return {
    name: presentation.registeredName,
    preferredName: presentation.preferredName,
    displayName: presentation.displayName,
    addressName: presentation.addressName,
    avatarUrl: presentation.avatarUrl,
    avatarSource: presentation.avatarSource,
    jobTitle: row.job_title,
    teamId: row.team_id,
    teamName: row.team_name,
  }
}
