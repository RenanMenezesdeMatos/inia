import type { Database } from "../../../infrastructure/database/pool.js"

/**
 * O que "Consolidar resultados" grava em `node_outputs[joinNodeId]` do PAI quando todos os filhos
 * de um fan-out chegam a um estado terminal — congelado ali pro resto desta execução (nunca
 * recalculado, mesmo princípio de EmployeeCollectionOutput). `children[].nodeOutputs` é o
 * `node_outputs` INTEIRO daquele filho — já estruturado por construção (cada node handler evita
 * blob/prompt/transcript nele, ver Human Review/Agent/Action/Condition), nunca uma cópia do
 * enrollment inteiro (sem interaction_id/variables/attempts/revision).
 */
export type EmployeeFanInChild = {
  employeeId: string
  childEnrollmentId: string
  status: "completed" | "failed"
  nodeOutputs: Record<string, unknown>
  /** Só presente quando status === "failed" — última mensagem de `flow_dead`. */
  failureReason?: string
}

export type EmployeeFanInOutput = {
  kind: "EMPLOYEE_FAN_IN"
  sourceFanOutNodeId: string
  expectedCount: number
  completedCount: number
  failedCount: number
  joinedAt: string
  children: EmployeeFanInChild[]
}

/** Builder puro — mesma forma usada tanto pela produção (children vindos de linhas do banco)
 * quanto pelo QA Lab (children vindos de EmployeeRun[] em memória), nunca duas implementações do
 * shape do resultado consolidado. */
export function buildEmployeeFanInOutput(fanOutNodeId: string, expectedCount: number, children: EmployeeFanInChild[], now: Date): EmployeeFanInOutput {
  return {
    kind: "EMPLOYEE_FAN_IN",
    sourceFanOutNodeId: fanOutNodeId,
    expectedCount,
    completedCount: children.filter((child) => child.status === "completed").length,
    failedCount: children.filter((child) => child.status === "failed").length,
    joinedAt: now.toISOString(),
    children,
  }
}

/** Prontidão da barreira — 1 query agregada (Parte 69 do pedido: "preferir query agregada"),
 * reaproveitando o índice parcial de `parent_enrollment_id` já existente (049_workflow_fan_out.sql).
 * `completed` conta quem chegou no Join normalmente; `failed` conta quem morreu (`status='dead'` —
 * não existe `'failed'` de verdade neste motor, ver markFailed em engine.ts) antes de chegar lá,
 * pra nunca deixar o pai esperando pra sempre por causa de um filho que falhou (Parte 14/17/67/74). */
/**
 * Um colaborador = uma execução na barreira: a filha bloqueada que ganhou uma nova tentativa (PEN-073) é substituída por ela —
 * enquanto a tentativa roda, o colaborador ainda não chegou; quando ela termina, conta o resultado dela.
 */
const NOT_SUPERSEDED = `not exists (select 1 from workflow_enrollments retry where retry.retry_of_enrollment_id = we.id)`

export async function countFanOutChildren(db: Database, parentEnrollmentId: string, fanOutNodeId: string): Promise<{ completed: number; failed: number }> {
  const result = await db.query<{ completed: string; failed: string }>(
    `select count(*) filter (where status = 'completed') as completed, count(*) filter (where status in ('dead', 'blocked')) as failed
     from workflow_enrollments we
     where parent_enrollment_id = $1 and fan_out_node_id = $2 and ${NOT_SUPERSEDED}`,
    [parentEnrollmentId, fanOutNodeId],
  )
  return { completed: Number(result.rows[0]?.completed ?? 0), failed: Number(result.rows[0]?.failed ?? 0) }
}

/** Detalhe por filho — só chamado UMA vez, quando a barreira já está pronta (nunca a cada poll).
 * `failureReason` vem da última mensagem `flow_dead` gravada por `markFailed` (engine.ts) — 1
 * query em lote pros que morreram, nunca N+1. */
export async function loadFanOutChildren(db: Database, parentEnrollmentId: string, fanOutNodeId: string): Promise<EmployeeFanInChild[]> {
  const rows = await db.query<{ id: string; scheduled_subject_id: string | null; status: string; node_outputs: Record<string, unknown> }>(
    `select id, scheduled_subject_id, status, node_outputs
     from workflow_enrollments we
     where parent_enrollment_id = $1 and fan_out_node_id = $2 and ${NOT_SUPERSEDED}
     order by created_at`,
    [parentEnrollmentId, fanOutNodeId],
  )
  // "Bloqueada — agente inativo" (PEN-073) não volta sozinha: para a barreira, conta como quem não chegou ao Join.
  const notArrived = (status: string) => status === "dead" || status === "blocked"
  const deadIds = rows.rows.filter((row) => notArrived(row.status)).map((row) => row.id)
  const failureReasons = new Map<string, string>()
  if (deadIds.length > 0) {
    const events = await db.query<{ enrollment_id: string; payload: { message?: string } }>(
      `select distinct on (enrollment_id) enrollment_id, payload
       from workflow_enrollment_events
       where enrollment_id = any($1::uuid[]) and event_type in ('flow_dead', 'node_blocked')
       order by enrollment_id, created_at desc`,
      [deadIds],
    )
    for (const row of events.rows) {
      if (typeof row.payload?.message === "string") failureReasons.set(row.enrollment_id, row.payload.message)
    }
  }
  return rows.rows.map((row) => ({
    employeeId: row.scheduled_subject_id ?? "",
    childEnrollmentId: row.id,
    status: notArrived(row.status) ? ("failed" as const) : ("completed" as const),
    nodeOutputs: row.node_outputs ?? {},
    ...(notArrived(row.status) ? { failureReason: failureReasons.get(row.id) ?? "Falha não identificada." } : {}),
  }))
}
