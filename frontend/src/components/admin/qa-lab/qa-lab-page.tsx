"use client"

import { Suspense } from "react"
import { Bot, FlaskConical, History, MessageSquareText, Waypoints, Zap } from "lucide-react"

import { FeedbackQualityPanel } from "@/components/feedback-review/feedback-quality-page"

import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/surface"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { AgentLab } from "./agent-lab"
import { OrchestratorLab } from "./orchestrator-lab"
import { QaHistory } from "./qa-history"
import { WorkflowLab } from "./workflow-lab"

/**
 * QA Lab (/admin/simulate) — exclusivo do administrador global (a rota e todas as APIs
 * validam isso; aqui é só a UI). A aba Feedbacks (QA de feedback) tem regra própria: capability explícita
 * FEEDBACK_QUALITY_REVIEW, também acessível fora da Administração em /qa-lab/feedbacks. Princípio: UM RECURSO + UM CONTEXTO + UMA EXECUÇÃO — a mesma
 * engine de produção, sem fan-out, sem outros workflows, sem side effects reais.
 */
/** `feedbackQaEnabled` = módulo de QA de feedback LIGADO neste ambiente (`features` do /auth/me). Desligado = a aba nem existe
 * — módulo desligado nunca aparece como "sem permissão" (V1.5.8a). */
export function QaLabPage({ feedbackQaEnabled = false }: { feedbackQaEnabled?: boolean }) {
  return (
    <div className="space-y-5">
      <PageHeader icon={FlaskConical} title="QA Lab" description="Teste Agents, Orchestrators e Workflows de forma isolada, segura e controlada." />
      <Card>
        <CardContent>
          <Tabs defaultValue="workflow" className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">O que deseja testar?</p>
              <TabsList>
                <TabsTrigger value="workflow" className="gap-1">
                  <Zap className="h-4 w-4" /> Workflow
                </TabsTrigger>
                <TabsTrigger value="agent" className="gap-1">
                  <Bot className="h-4 w-4" /> Agent
                </TabsTrigger>
                <TabsTrigger value="orchestrator" className="gap-1">
                  <Waypoints className="h-4 w-4" /> Orchestrator
                </TabsTrigger>
                {feedbackQaEnabled ? (
                  <TabsTrigger value="feedbacks" className="gap-1">
                    <MessageSquareText className="h-4 w-4" /> Feedbacks
                  </TabsTrigger>
                ) : null}
                <TabsTrigger value="history" className="gap-1">
                  <History className="h-4 w-4" /> Histórico de QA
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="workflow">
              <WorkflowLab />
            </TabsContent>
            <TabsContent value="agent">
              <AgentLab />
            </TabsContent>
            <TabsContent value="orchestrator">
              <OrchestratorLab />
            </TabsContent>
            {feedbackQaEnabled ? (
              <TabsContent value="feedbacks">
                {/* QA de qualidade do feedback: exige a permissão do papel QA de feedback (403 real = sem permissão). */}
                <Suspense>
                  <FeedbackQualityPanel />
                </Suspense>
              </TabsContent>
            ) : null}
            <TabsContent value="history">
              <QaHistory />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
