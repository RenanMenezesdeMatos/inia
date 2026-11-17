import { communicationVisibleToSql, loadCommunicationViews } from "../../communications/infrastructure/postgres-communication-store.js"
import type { FollowUpNoticeSource } from "../application/follow-up-notice-source.js"

/** Liga a porta dos comunicados do feed (application/follow-up-notice-source.ts) ao armazenamento Postgres do módulo de comunicados. */
export const communicationNoticeSource: FollowUpNoticeSource = {
  visibleToSql: communicationVisibleToSql,
  loadViews: loadCommunicationViews,
}
