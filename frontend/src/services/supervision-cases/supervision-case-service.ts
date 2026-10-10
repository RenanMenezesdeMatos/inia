import { cookies } from "next/headers"

import { supervisionCaseSchema, type SupervisionCase } from "@/schemas/supervision-cases/supervision-case.schema"
import { SESSION_COOKIE_NAME } from "@/services/auth/auth-service"

const API_URL = process.env.INIA_API_URL ?? process.env.NEXT_PUBLIC_INIA_API_URL ?? "http://localhost:3333"

const demoCase: SupervisionCase = {
  id: "00000000-0000-4000-8000-000000000100",
  title: "TMA elevado com risco de retrabalho",
  summary: "A INIA correlacionou atendimentos longos com repetição de validações no encerramento e ausência do checklist operacional.",
  status: "DIAGNOSED", priority: "P1", indicatorCode: "TMA", indicatorValue: "6m21s", indicatorTarget: "≤ 5m",
  rootCause: "Repetição de validações e fechamento sem uso consistente do checklist previsto no procedimento.", confidence: 0.91,
  operator: { id: "demo-operator", name: "Ana Lima" }, team: { id: "demo-team", name: "Retenção B2B" }, updatedAt: new Date().toISOString(),
  evidences: [
    { id: "ev-1", type: "INDICATOR", title: "TMA acima da meta", description: "TMA permaneceu acima de 5 minutos em cinco dos últimos sete dias, atingindo 6m21s no fechamento mais recente.", sourceType: "indicator_measurement", sourceId: "demo-tma-7d", occurredAt: new Date().toISOString() },
    { id: "ev-2", type: "TRANSCRIPT", title: "Validação repetida no encerramento", description: "Em três interações, perguntas já confirmadas foram repetidas antes do encerramento, alongando o atendimento sem alterar a solução.", sourceType: "transcript_segment", sourceId: "demo-transcript-3", occurredAt: new Date().toISOString() },
    { id: "ev-3", type: "PROCEDURE", title: "Checklist de encerramento não evidenciado", description: "O procedimento PROC-ATD-014 orienta confirmação objetiva dos próximos passos e registro antes do encerramento.", sourceType: "knowledge_version", sourceId: "PROC-ATD-014-v3", occurredAt: new Date().toISOString() },
  ],
  recommendations: [{ id: "rec-1", actionType: "COACHING_1_1", description: "Realizar coaching com dois exemplos reais e aplicar o checklist de encerramento nas próximas cinco interações.", expectedImpact: "Reduzir TMA sem comprometer qualidade e diminuir risco de recontato.", dueAt: null }],
  feedbacks: [{ id: "feedback-demo", status: "APPROVED", impactedIndicator: "TMA — 6m21s para uma meta de até 5m", evidenceFound: "Cinco de sete dias acima da meta e repetição de validações em três transcrições.", observedBehavior: "Perguntas já respondidas voltaram a ser confirmadas no encerramento, sem mudança de solução.", relatedProcedure: "PROC-ATD-014 v3 — checklist de encerramento e registro dos próximos passos.", recommendation: "Aplicar o checklist nas próximas cinco interações e revisar dois atendimentos com a supervisão.", suggestedApproach: "Organize o fechamento em três passos: confirme a solução, explique o próximo passo e registre antes de encerrar." }],
}

export async function fetchSupervisionCase(id: string): Promise<SupervisionCase> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
    const response = await fetch(`${API_URL}/api/v1/supervision-cases/${id}`, {
      headers: token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : undefined,
      cache: "no-store",
    })
    if (!response.ok) throw new Error(`API returned ${response.status}`)
    const payload: unknown = await response.json()
    return supervisionCaseSchema.parse((payload as { data: unknown }).data)
  } catch {
    return { ...demoCase, id }
  }
}
