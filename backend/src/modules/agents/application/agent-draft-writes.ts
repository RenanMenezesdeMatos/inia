import type { Database } from "../../../infrastructure/database/pool.js"
import type { ManageableScopes } from "../../auth/application/manageable-scopes.js"
import type { AgentConfig } from "../domain/agent-config.js"
import { assertKnowledge, assertNameAvailable, authorizeAgentConfig } from "./agent-config-rules.js"
import { diffConfigs, fieldChange, recordAgentHistory, versionLabel } from "./agent-history.js"
import { publishAgentDraft, saveAgentDraft, writeLiveAgentConfig, type AgentActor, type AgentLifecycleRow } from "./agent-versions.js"

/**
 * As duas escritas do ciclo de vida que o cadastro do agente e a associação a partir da base fazem do MESMO jeito (run-8, ARQ-02: antes,
 * cada rota repetia a sequência). Rodam dentro da transação de quem chama, com a linha do agente travada (`lifecycleForWrite`).
 */

type Queryable = Pick<Database, "query">

/**
 * Salva `config` como rascunho e registra o que mudou em relação a `base`. Agente nunca publicado não tem versão em uso a proteger: a
 * linha viva acompanha o rascunho (lista, busca), mas nada o executa fora do teste.
 */
export async function saveDraftWithHistory(client: Queryable, lifecycle: AgentLifecycleRow, base: AgentConfig, config: AgentConfig, actor: AgentActor): Promise<void> {
  await saveAgentDraft(client, lifecycle, config, actor)
  if (!lifecycle.currentVersionId) await writeLiveAgentConfig(client, lifecycle.organizationId, lifecycle.id, config)
  const changes = diffConfigs(base, config)
  if (changes.length > 0) await recordAgentHistory(client, lifecycle.organizationId, { agentId: lifecycle.id, action: "UPDATED", actor, changes, configs: [base, config] })
}

/**
 * Publica o rascunho como versão nova, imutável e vigente, com a revalidação de sempre: quem publica alcança o alcance do rascunho, as
 * bases existem e cabem no Grupo, o nome continua livre. Não mexe em `active` e não concede permissão a ninguém.
 */
export async function publishCheckedDraft(client: Queryable, lifecycle: AgentLifecycleRow, scopes: ManageableScopes, actor: AgentActor): Promise<{ id: string; number: number }> {
  authorizeAgentConfig(scopes, lifecycle.draftConfig)
  if (lifecycle.draftConfig) {
    await assertKnowledge(client, lifecycle.organizationId, lifecycle.draftConfig)
    await assertNameAvailable(client, lifecycle.organizationId, lifecycle.draftConfig.name, lifecycle.id)
  }
  const published = await publishAgentDraft(client, lifecycle, actor)
  await recordAgentHistory(client, lifecycle.organizationId, { agentId: lifecycle.id, action: "PUBLISHED", actor, changes: [fieldChange("version", versionLabel(lifecycle.currentVersionNumber), versionLabel(published.number))] })
  return published
}
