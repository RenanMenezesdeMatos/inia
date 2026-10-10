import { triggerDataOrigin } from "../workflow.schema"
import type { ValidationContext } from "./types"

// Família INDICADOR E ESTRATÉGIA: diagnóstico do fechamento do PRV e diagnóstico do indicador.
// Espelho do backend: workflows/application/publish-validation/indicator-diagnosis.ts.

/** Diagnóstico do fechamento do PRV e diagnóstico do indicador: de onde vem o dado oficial que eles analisam. */
export function validateDiagnosisSources(context: ValidationContext): void {
  const { graph, trigger, issues } = context
  // Indicator Diagnosis V1 — diagnóstico do fechamento do PRV: Agenda + fonte "Fechamentos oficiais" (mesma regra do backend).
  for (const node of graph.nodes) {
    if (node.type === "action" && node.config.actionType === "CALL_AGENT" && node.config.outputContract === "PRV_CLOSING_DIAGNOSIS" && (triggerDataOrigin(trigger) !== "schedule" || node.config.scheduledDataSource?.kind !== "PERFORMANCE")) {
      issues.push({ nodeId: node.id, code: "WORKFLOW_PRV_DIAGNOSIS_REQUIRES_SCHEDULE", message: "\"Diagnóstico do fechamento do PRV\" parte do fechamento oficial — só com gatilho por Agenda e a fonte de dados \"Fechamentos oficiais\"." })
    }
  }

  // V1.6.1 — diagnóstico do indicador parte da medição do gatilho por Indicador; V2 — ou do fechamento oficial de UM indicador
  // escolhido (Agenda + "Fechamentos oficiais"). Mesma regra do backend.
  if (triggerDataOrigin(trigger) !== "indicator") {
    for (const node of graph.nodes) {
      if (node.type !== "action" || node.config.actionType !== "CALL_AGENT" || node.config.outputContract !== "INDICATOR_DIAGNOSIS") continue
      if (triggerDataOrigin(trigger) === "schedule" && node.config.scheduledDataSource?.kind === "PERFORMANCE") {
        if (!node.config.scheduledDataSource.indicatorCode) issues.push({ nodeId: node.id, code: "WORKFLOW_INDICATOR_DIAGNOSIS_REQUIRES_INDICATOR", message: "Escolha o indicador que será diagnosticado." })
        continue
      }
      issues.push({ nodeId: node.id, code: "WORKFLOW_INDICATOR_DIAGNOSIS_REQUIRES_INDICATOR", message: triggerDataOrigin(trigger) === "schedule" ? "\"Diagnóstico do indicador\" com gatilho por Agenda precisa da fonte \"Fechamentos oficiais\" e de um indicador escolhido." : "\"Diagnóstico do indicador\" parte da medição de um indicador — só disponível com gatilho por Indicador." })
    }
  }
}
