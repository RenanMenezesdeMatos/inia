import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"

/**
 * RESPOSTA EM ANDAMENTO DO CHAT (19/11/2026, migration 245).
 *
 * Regra: **sair da tela não cancela a resposta; só o pedido explícito cancela.**
 * - Sair da tela = trocar de aba do navegador, trocar de área da INIA (o chat desmonta), trocar de conversa, recarregar ou fechar
 *   a página, perder a conexão. A resposta continua sendo gerada e é GRAVADA na conversa; quem volta vê o indicador ("ainda
 *   respondendo", com a etapa real) e depois a resposta, sem perguntar de novo.
 * - Cancelar de propósito = o botão "Parar" (`POST /realtime/messages/:clientMessageId/cancel`). Aí as chamadas de IA desta
 *   resposta param (a vaga volta) e nada da resposta é gravado — a pergunta já foi.
 *
 * Uma linha por resposta em andamento (`assistant_reply_runs`), apagada ao terminar. O "Parar" pode cair em outra instância da API:
 * na mesma, o cancelamento é imediato; em outra, a instância que gera lê `cancel_requested_at` no batimento (≤ ~3 s).
 * Falha de banco aqui NUNCA impede a resposta: o registro é auxiliar (log e segue).
 *
 * Limites (run-8, achado SL-01 — sem o cancelamento pela desconexão, o AI-09 voltava a valer): no máximo
 * `MAX_REPLIES_IN_FLIGHT_PER_PERSON` respostas em andamento por pessoa (a 4ª pergunta simultânea recebe 429 antes de qualquer
 * chamada de IA) e duração máxima de `REPLY_MAX_DURATION_MS` no servidor (a rota soma esse prazo ao sinal do "Parar").
 * A mesma pergunta (mesma chave do cliente) já em andamento recebe 409 em vez de rodar de novo (SL-04).
 */

export type ReplyRunKey = { organizationId: string; ownerPersonId: string; clientMessageId: string }
export type ReplyRunStart = ReplyRunKey & { conversationId: string; questionInteractionId: string }
/** O que a tela que volta precisa: a pergunta ainda sem resposta, a chave para o "Parar" e a etapa atual. */
export type PendingReply = { questionInteractionId: string; clientMessageId: string; label: string | null; startedAt: string }

export type ReplyRunHandle = {
  /** Abortado SÓ pelo pedido explícito de cancelamento (nunca pela conexão). */
  signal: AbortSignal
  /** Etapa atual (o mesmo rótulo do evento `status`), para quem volta à tela. */
  stage(label: string): void
  /** Fim (gravada, falhou ou cancelada): a linha sai. */
  finish(): Promise<void>
}

export type ReplyRunRegistry = {
  /** Lança 409 `ASSISTANT_REPLY_IN_PROGRESS` quando a mesma pergunta já está sendo respondida (batimento recente). */
  start(input: ReplyRunStart): Promise<ReplyRunHandle>
  /** Respostas desta pessoa em andamento agora (batimento recente, sem "Parar"). */
  inFlight(input: { organizationId: string; ownerPersonId: string }): Promise<number>
  /** `true` = havia uma resposta em andamento com esta chave (desta pessoa) e ela foi cancelada. */
  requestCancel(key: ReplyRunKey): Promise<boolean>
  pending(input: { organizationId: string; ownerPersonId: string; conversationId: string }): Promise<PendingReply | null>
}

/** Batimento da linha (e leitura do cancelamento vindo de outra instância). */
export const REPLY_RUN_HEARTBEAT_MS = 3_000
/** Sem batimento há mais que isso = o processo que gerava morreu: não conta mais como em andamento. */
export const REPLY_RUN_STALE_MS = 20_000

/** Teto de respostas do chat em andamento ao mesmo tempo por pessoa (uma pessoa digita uma pergunta por vez; 3 dá folga a abas). */
export const MAX_REPLIES_IN_FLIGHT_PER_PERSON = 3
/** Duração máxima de uma resposta do chat no servidor (o Orquestrador com rodadas e especialistas leva bem menos que isso). */
export const REPLY_MAX_DURATION_MS = 4 * 60_000
/** Duração máxima de uma consulta da voz (`/tool-call`): a fala não espera mais que isso. */
export const TOOL_CALL_MAX_DURATION_MS = 2 * 60_000
/** Linhas sem batimento há mais que isso saem na próxima resposta de qualquer pessoa (processo que morreu). */
const ORPHAN_ROW_TTL = "10 minutes"

export const replyInProgress = () =>
  new DomainError("Esta pergunta ainda está sendo respondida. Aguarde a resposta aparecer na conversa.", "ASSISTANT_REPLY_IN_PROGRESS", 409)
export const tooManyRepliesInFlight = () =>
  new DomainError(`Você já tem ${MAX_REPLIES_IN_FLIGHT_PER_PERSON} respostas da INIA em andamento. Espere uma delas terminar e pergunte de novo.`, "ASSISTANT_REPLIES_IN_FLIGHT", 429)

export const replyRunKeyOf = (key: ReplyRunKey) => `${key.organizationId}:${key.ownerPersonId}:${key.clientMessageId}`
const warn = (event: string, error: unknown) => console.warn(JSON.stringify({ event, message: (error as Error)?.message ?? String(error) }))

/** Cancelamento local (mesma instância) — compartilhado pelas duas implementações. */
export function createLocalReplyCancellations() {
  const running = new Map<string, AbortController>()
  return {
    open(key: ReplyRunKey) {
      const controller = new AbortController()
      running.set(replyRunKeyOf(key), controller)
      return controller
    },
    close(key: ReplyRunKey, controller: AbortController) {
      if (running.get(replyRunKeyOf(key)) === controller) running.delete(replyRunKeyOf(key))
    },
    cancel(key: ReplyRunKey) {
      const controller = running.get(replyRunKeyOf(key))
      if (!controller) return false
      controller.abort()
      return true
    },
  }
}

export function createPostgresReplyRunRegistry(db: Database, options: { heartbeatMs?: number; staleMs?: number } = {}): ReplyRunRegistry {
  const heartbeatMs = options.heartbeatMs ?? REPLY_RUN_HEARTBEAT_MS
  const staleMs = options.staleMs ?? REPLY_RUN_STALE_MS
  const local = createLocalReplyCancellations()
  return {
    async start(input) {
      let id: string | null = null
      let duplicate = false
      try {
        // Linhas de processos que morreram saem aqui, de qualquer conversa (sem tarefa periódica própria; a tabela só tem o que está em
        // andamento, então é pequena) — SL-05.
        await db.query(`delete from assistant_reply_runs where heartbeat_at < now() - interval '${ORPHAN_ROW_TTL}'`)
        // A mesma pergunta já em andamento (batimento recente) NÃO é retomada: a linha só é reaproveitada se o processo que a gerava
        // morreu. Sem linha devolvida = em andamento em algum lugar → 409 (SL-04: antes, as duas gerações dividiam a linha).
        const { rows } = await db.query<{ id: string }>(
          `insert into assistant_reply_runs (organization_id, owner_person_id, conversation_id, question_interaction_id, client_message_id)
           values ($1, $2, $3, $4, $5)
           on conflict (organization_id, owner_person_id, client_message_id)
           do update set conversation_id = excluded.conversation_id, question_interaction_id = excluded.question_interaction_id, stage_label = null,
                         started_at = now(), heartbeat_at = now(), cancel_requested_at = null
            where assistant_reply_runs.heartbeat_at < now() - ($6::int * interval '1 millisecond') or assistant_reply_runs.cancel_requested_at is not null
           returning id`,
          [input.organizationId, input.ownerPersonId, input.conversationId, input.questionInteractionId, input.clientMessageId, staleMs],
        )
        id = rows[0]?.id ?? null
        if (id === null) {
          const running = await db.query(
            `select 1 from assistant_reply_runs where organization_id = $1 and owner_person_id = $2 and client_message_id = $3 and cancel_requested_at is null
                and heartbeat_at > now() - ($4::int * interval '1 millisecond')`,
            [input.organizationId, input.ownerPersonId, input.clientMessageId, staleMs],
          )
          duplicate = (running.rowCount ?? 0) > 0
        }
      } catch (error) {
        warn("assistant_reply_run_start_failed", error)
      }
      if (duplicate) throw replyInProgress()
      const controller = local.open(input)
      let lastLabel: string | null = null
      let beating = false
      const timer = id
        ? setInterval(() => {
            if (beating || controller.signal.aborted) return
            beating = true
            db.query<{ cancel_requested_at: Date | null }>(`update assistant_reply_runs set heartbeat_at = now() where id = $1 returning cancel_requested_at`, [id])
              .then(({ rows }) => {
                if (rows[0]?.cancel_requested_at) controller.abort()
              })
              .catch((error: unknown) => warn("assistant_reply_run_heartbeat_failed", error))
              .finally(() => (beating = false))
          }, heartbeatMs)
        : null
      timer?.unref?.()
      return {
        signal: controller.signal,
        stage(label) {
          if (!id || label === lastLabel) return
          lastLabel = label
          db.query(`update assistant_reply_runs set stage_label = $2, heartbeat_at = now() where id = $1`, [id, label.slice(0, 200)]).catch((error: unknown) => warn("assistant_reply_run_stage_failed", error))
        },
        async finish() {
          if (timer) clearInterval(timer)
          local.close(input, controller)
          if (!id) return
          await db.query(`delete from assistant_reply_runs where id = $1`, [id]).catch((error: unknown) => warn("assistant_reply_run_finish_failed", error))
        },
      }
    },
    async inFlight(input) {
      try {
        const { rows } = await db.query<{ count: number }>(
          `select count(*)::int "count" from assistant_reply_runs
            where organization_id = $1 and owner_person_id = $2 and cancel_requested_at is null and heartbeat_at > now() - ($3::int * interval '1 millisecond')`,
          [input.organizationId, input.ownerPersonId, staleMs],
        )
        return rows[0]?.count ?? 0
      } catch (error) {
        warn("assistant_reply_run_in_flight_failed", error)
        return 0
      }
    },
    async requestCancel(key) {
      const here = local.cancel(key)
      try {
        const { rowCount } = await db.query(
          `update assistant_reply_runs set cancel_requested_at = now()
           where organization_id = $1 and owner_person_id = $2 and client_message_id = $3 and cancel_requested_at is null`,
          [key.organizationId, key.ownerPersonId, key.clientMessageId],
        )
        return here || (rowCount ?? 0) > 0
      } catch (error) {
        warn("assistant_reply_run_cancel_failed", error)
        return here
      }
    },
    async pending(input) {
      try {
        const { rows } = await db.query<{ question_interaction_id: string; client_message_id: string; stage_label: string | null; started_at: Date }>(
          `select question_interaction_id, client_message_id, stage_label, started_at
             from assistant_reply_runs
            where organization_id = $1 and owner_person_id = $2 and conversation_id = $3
              and cancel_requested_at is null and heartbeat_at > now() - ($4::int * interval '1 millisecond')
            order by started_at desc limit 1`,
          [input.organizationId, input.ownerPersonId, input.conversationId, staleMs],
        )
        const row = rows[0]
        return row ? { questionInteractionId: row.question_interaction_id, clientMessageId: row.client_message_id, label: row.stage_label, startedAt: new Date(row.started_at).toISOString() } : null
      } catch (error) {
        warn("assistant_reply_run_pending_failed", error)
        return null
      }
    },
  }
}
