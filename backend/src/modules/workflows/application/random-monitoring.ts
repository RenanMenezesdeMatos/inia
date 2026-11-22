import type { Database } from "../../../infrastructure/database/pool.js"
import { qualityCallSqlPredicate } from "../../interactions/domain/quality-call-rule.js"
import type { RandomMonitoringSample } from "../../feedback-engine/domain/node-output.js"
import { notMonitoredSql } from "../../feedback-engine/infrastructure/delivery-guards-sql.js"

/**
 * MONITORIA ALEATÓRIA — `RANDOM_MONITORING_SAMPLE_V2` (V1 até 21/11/2026; mudanças abaixo da constante).
 *
 * "Chamar agente" com gatilho por Agenda (ou Manual por colaborador), fonte "Amostra de chamadas" e formato "Avaliação de processo":
 * a cada execução, UMA chamada do colaborador é sorteada no período e analisada pelo motor de feedback, pelo mesmo caminho da Flag.
 * A frequência (diária, a cada N dias, semanal…) é a do gatilho; o sorteio é independente do resultado da chamada — uma ligação
 * perfeita também é monitorada e o operador recebe o reconhecimento.
 *
 * Entra no sorteio só a chamada que dá para avaliar: do colaborador, no período, com transcrição, com a duração mínima da organização
 * (regra geral de chamada curta, `QUALITY_CALL_MIN_DURATION_V1`) e ainda sem monitoria (`ONE_MONITORING_PER_CALL_V1`).
 *
 * Reprodutível, nunca Math.random: a ordem é o hash de (semente + id), com a semente = execução + colaborador + janela; outra execução tem
 * outra semente. A nova tentativa da mesma execução reaproveita a chamada já sorteada (`priorRandomMonitoringPick`).
 */
export const RANDOM_MONITORING_SAMPLE_VERSION = "RANDOM_MONITORING_SAMPLE_V2" as const
/*
 * V2 (22/11/2026, auditoria run-9):
 *  - a exclusão das chamadas JÁ MONITORADAS é feita no próprio SQL do sorteio (`notMonitoredSql`, a mesma definição de
 *    `ONE_MONITORING_PER_CALL_V1` da entrega única) — numa consulta só, sobre TODAS as elegíveis. A V1 conferia só as 25 primeiras do
 *    sorteio, uma a uma, e depois afirmava "todas as elegíveis já tinham monitoria" (SFW-04/QA-05/DADOS-01);
 *  - a janela usa o fuso da ORGANIZAÇÃO (`resolveOrganizationTimezone`) — a V1 usava o fuso padrão (SFW-05);
 *  - a nova tentativa da MESMA execução reaproveita a chamada já sorteada (gravada no `trigger` da análise, `priorRandomMonitoringPick`)
 *    e nunca sorteia outra — uma análise paga que falhou não é seguida de outra análise paga sobre outra chamada (SFW-05);
 *  - "tem transcrição" sem descomprimir o texto inteiro de cada candidata: `octet_length` lê o tamanho guardado; só a transcrição curta
 *    (que fica no próprio registro, sem compressão) é conferida contra "só espaços" (B-07);
 *  - versão, mínimo de segundos, período, janela, fuso e semente ficam gravados também quando há chamada sorteada (ARQ-04).
 */
export const RANDOM_MONITORING_SELECTION_REASON = "Chamada sorteada para a monitoria de qualidade do período."
/** Semente do sorteio: a identidade da EXECUÇÃO + colaborador + janela (mesma composição do sorteio do feedback de atendimento). */
export function randomMonitoringSeedOf(input: { enrollmentId: string; operatorId: string; window: { start: Date; end: Date } }): string {
  return `${input.enrollmentId}:${input.operatorId}:${input.window.start.toISOString()}:${input.window.end.toISOString()}`
}

/**
 * Transcrição com conteúdo, sem descomprimir: acima deste tamanho (bytes) o texto é tido como não vazio pelo tamanho guardado
 * (`octet_length` não lê o conteúdo); abaixo dele — o texto fica no próprio registro, sem compressão — confere-se que não é só espaço.
 */
export const TRANSCRIPT_INLINE_BYTES = 2_000

/** O sorteio: elegíveis (todas as que passam nos critérios), ainda sem monitoria, e a escolhida (ordem pela semente). */
export type RandomMonitoringPick =
  | { interactionId: string; eligible: number; unmonitored: number; seed: string }
  | { interactionId: null; eligible: number; unmonitored: 0; seed: string; reason: "NO_ELIGIBLE_CALL" | "ALL_ELIGIBLE_ALREADY_MONITORED" }

export async function pickRandomMonitoringCall(
  db: Pick<Database, "query">,
  input: {
    organizationId: string
    operatorId: string
    enrollmentId: string
    window: { start: Date; end: Date }
    minimumSeconds: number
  },
): Promise<RandomMonitoringPick> {
  const seed = randomMonitoringSeedOf({ enrollmentId: input.enrollmentId, operatorId: input.operatorId, window: input.window })
  // Uma consulta: as elegíveis do período, quantas ainda não têm monitoria e a primeira delas na ordem do sorteio.
  const row = (
    await db.query<{ eligible: string; unmonitored: string; picked: string | null }>(
      `with eligible as (
         select i.id, ${notMonitoredSql("$1", "i.id")} open
           from interactions i
          where i.organization_id = $1 and i.operator_id = $2 and i.started_at >= $3 and i.started_at < $4
            and exists (select 1 from transcripts t where t.interaction_id = i.id and t.organization_id = i.organization_id
                         and (octet_length(t.content) > ${TRANSCRIPT_INLINE_BYTES} or btrim(t.content) <> ''))
            and ${qualityCallSqlPredicate("i", 5)}
       )
       select count(*) eligible, count(*) filter (where open) unmonitored,
              (select e.id::text from eligible e where e.open order by md5($6 || ':' || e.id::text), e.id limit 1) picked
         from eligible`,
      [input.organizationId, input.operatorId, input.window.start.toISOString(), input.window.end.toISOString(), input.minimumSeconds, seed],
    )
  ).rows[0]
  const eligible = Number(row?.eligible ?? 0)
  const unmonitored = Number(row?.unmonitored ?? 0)
  if (row?.picked) return { interactionId: row.picked, eligible, unmonitored, seed }
  return { interactionId: null, eligible, unmonitored: 0, seed, reason: eligible === 0 ? "NO_ELIGIBLE_CALL" : "ALL_ELIGIBLE_ALREADY_MONITORED" }
}

/**
 * A chamada que ESTA execução (matrícula + nó) já sorteou numa tentativa anterior — gravada no `trigger` da análise que o motor criou
 * antes de qualquer chamada de modelo. Nova tentativa reaproveita a escolha; nunca sorteia outra. null = primeira tentativa (ou a
 * anterior parou antes de começar a análise, sem nada pago).
 */
export async function priorRandomMonitoringPick(db: Pick<Database, "query">, input: { organizationId: string; operatorId: string; enrollmentId: string; nodeId: string }): Promise<{ interactionId: string; sample: RandomMonitoringSample | null } | null> {
  const row = (
    await db.query<{ interaction_id: string; sample: RandomMonitoringSample | null }>(
      `select r.interaction_id::text interaction_id, r.trigger -> 'randomSample' sample
         from feedback_analysis_runs r
        where r.organization_id = $1 and r.person_id = $2 and r.kind = 'CALL_ANALYSIS' and r.interaction_id is not null
          and r.trigger ->> 'enrollmentId' = $3 and r.trigger ->> 'nodeId' = $4
          and (r.trigger ? 'randomSample' or r.trigger ->> 'selectionReason' = $5)
        order by r.created_at, r.id
        limit 1`,
      [input.organizationId, input.operatorId, input.enrollmentId, input.nodeId, RANDOM_MONITORING_SELECTION_REASON],
    )
  ).rows[0]
  return row ? { interactionId: row.interaction_id, sample: row.sample ?? null } : null
}
