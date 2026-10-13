import { cookies } from "next/headers"

import {
  operatorIndicatorsDataSchema,
  operatorProfileSchema,
  type OperatorIndicator,
  type OperatorIndicatorHistory,
  type OperatorIndicatorsData,
  type OperatorProfile,
} from "@/schemas/operator"
import type { FeedbackOrigin } from "@/schemas/feedbacks/feedback-origin.schema"
import { ROLE_LABELS, type PlatformRole } from "@/schemas/auth/auth.schema"
import type { FeedbackSupportMaterial } from "@/schemas/feedbacks/support-material.schema"
import type { FeedbackView } from "@/schemas/feedbacks/feedback-view.schema"
import { formatFeedTimestamp } from "@/lib/format/date"

import { SESSION_COOKIE_NAME } from "@/services/auth/auth-service"
import { redirectIfSessionEnded } from "@/services/auth/server-session"

const API_URL = process.env.INIA_API_URL ?? process.env.NEXT_PUBLIC_INIA_API_URL ?? "http://localhost:3333"

type OperatorProfileRow = {
  name: string
  role: string
  avatarUrl: string | null
}

type OperatorIndicatorRow = {
  code: string
  name: string
  unit: string
  value: number
  targetValue: number | null
  direction: "LOWER" | "HIGHER"
  achieved: boolean | null
  periodStart: string
  periodEnd: string
  glossaryDescription: string | null
  goodPractices: string | null
  feedbackGuidance: string | null
}

type OperatorFeedbackRow = {
  id: string
  kind: "INDICATOR" | "MONITORING"
  status: string
  summary: string
  impactedIndicator: string | null
  evidenceFound: string | null
  observedBehavior: string | null
  relatedProcedure: string | null
  recommendation: string | null
  createdAt: string
  /** Instante canônico do feed (publicação; senão criação) — o backend já ordena por ele, mais recente primeiro. */
  occurredAt?: string
  acknowledgedAt: string | null
  supportMaterials?: FeedbackSupportMaterial[]
  /** Feedback por Flag V2 — view model publicado (null = feedback anterior). */
  feedbackView?: FeedbackView | null
  /** Feedback de atendimento anterior (sem view model): título pelo assunto da interação vinculada, ou neutro — calculado na leitura. */
  heading?: { title: string; subtitle: string | null } | null
  /** Motivo do feedback (flag, rotina, avulsa, indicador) + ícone — selo do cabeçalho do item. */
  origin?: FeedbackOrigin | null
}

function formatIndicatorValue(value: number, unit: string): string {
  if (unit === "SECONDS") {
    const minutes = Math.floor(value / 60)
    const seconds = Math.round(value % 60)
    return `${minutes}m${seconds.toString().padStart(2, "0")}s`
  }
  if (unit === "PERCENT") return `${Math.round(value * 10) / 10}%`
  return `${Math.round(value * 10) / 10}`
}

function mapIndicators(rows: OperatorIndicatorRow[]): OperatorIndicator[] {
  const latestByCode = new Map<string, OperatorIndicatorRow>()
  for (const row of rows) if (!latestByCode.has(row.code)) latestByCode.set(row.code, row)

  return [...latestByCode.values()].map((row, index) => ({
    id: row.code,
    title: row.name,
    value: formatIndicatorValue(row.value, row.unit),
    meta: row.targetValue !== null ? `Meta: ${formatIndicatorValue(row.targetValue, row.unit)}` : "Sem meta definida para o período",
    status: row.achieved === false ? "attention" : "good",
    priority: index,
    description: row.glossaryDescription ?? undefined,
    recommendation: row.feedbackGuidance ?? row.goodPractices ?? undefined,
    actions: [],
    relatedHistoryIds: [],
  }))
}

function mapHistory(rows: OperatorFeedbackRow[]): OperatorIndicatorHistory[] {
  return rows.map((row) => {
    const kind = row.kind === "MONITORING" ? "monitoria_feedback" : row.kind === "INDICATOR" ? "indicator_feedback" : "reading"
    return {
      id: row.id,
      title: row.heading?.title ?? row.impactedIndicator ?? (kind === "indicator_feedback" ? "Feedback de indicador" : "Feedback da INIA"),
      subtitle: row.heading?.subtitle ?? null,
      message: row.summary || row.recommendation || row.evidenceFound || "Novo feedback disponível.",
      occurredAt: row.occurredAt ?? row.createdAt,
      timestamp: formatFeedTimestamp(row.occurredAt ?? row.createdAt),
      kind,
      presentation:
        kind === "monitoria_feedback"
          ? { label: "Monitoria", iconKey: "clipboard-check", tone: "warning" }
          : kind === "indicator_feedback"
            ? { label: "Indicador", iconKey: "target", tone: "quality" }
            : { label: "Leitura do dia", iconKey: "sun", tone: "info" },
      feedback: {
        recommendation: row.recommendation ?? undefined,
        evidenceFound: row.evidenceFound ?? undefined,
        observedBehavior: row.observedBehavior ?? undefined,
        relatedProcedure: row.relatedProcedure ?? undefined,
        supportMaterials: row.supportMaterials ?? [],
        view: row.feedbackView ?? null,
      },
      origin: row.origin ?? null,
      // Só feedbacks publicados podem receber ciência — para os demais o campo fica ausente.
      ...(row.status === "PUBLISHED" ? { acknowledgedAt: row.acknowledgedAt } : {}),
    }
  })
}

async function fetchOperatorOverview(): Promise<{
  profile: OperatorProfileRow
  indicators: OperatorIndicatorRow[]
  feedbacks: OperatorFeedbackRow[]
}> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  const response = await fetch(`${API_URL}/api/v1/operator/overview`, {
    headers: token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : undefined,
    cache: "no-store",
  })
  await redirectIfSessionEnded(response)
  if (!response.ok) throw new Error(`API retornou ${response.status} ao buscar dados do operador.`)
  const payload = (await response.json()) as { data: { profile: OperatorProfileRow; indicators: OperatorIndicatorRow[]; feedbacks: OperatorFeedbackRow[] } }
  return payload.data
}

/** Perfil de header a partir de qualquer usuário autenticado (operador ou gestor). */
export function buildProfileHeader(profile: { name: string; role: string; avatarUrl: string | null; jobTitle?: string | null }): OperatorProfile {
  return operatorProfileSchema.parse({
    name: profile.name,
    role: profile.jobTitle ?? ROLE_LABELS[profile.role as PlatformRole] ?? profile.role,
    avatarUrl: profile.avatarUrl,
    periodLabel: new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
    assistantName: "INIA",
    assistantImage: "/INIA.png",
  })
}

/**
 * Surface Acompanhamento do operador: perfil do header + feed de feedbacks + contexto leve pro
 * chat — UMA chamada ao overview (antes eram duas, uma por função). O PRV e os indicadores
 * analíticos NÃO passam mais por aqui: vêm da área de analytics (fonte oficial).
 */
export async function fetchOperatorSurface(): Promise<{ profile: OperatorProfile; indicators: OperatorIndicatorsData }> {
  const { profile, indicators, feedbacks } = await fetchOperatorOverview()
  return {
    profile: buildProfileHeader(profile),
    indicators: operatorIndicatorsDataSchema.parse({ current: mapIndicators(indicators), history: mapHistory(feedbacks) }),
  }
}
