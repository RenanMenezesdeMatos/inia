import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { isApprovedQaStatus, validateReviewDecision } from "./feedback-review.js"

const proposed = { observed: "a", whyItMatters: "b", whatYouCanDo: "c" }

describe("V1.5.0/V1.5.5 — regras da avaliação de QA", () => {
  it("QA aprova só com APPROVED_* (o gate completo também olha a disposição — feedback-delivery-policy)", () => {
    expect(["PENDING_REVIEW", "APPROVED_UNCHANGED", "APPROVED_EDITED", "REJECTED", "NOT_SELECTED_FOR_QA"].map((status) => isApprovedQaStatus(status as never))).toEqual([false, true, true, false, false])
  })
  it("item não selecionado para QA (AUTO_DELIVER) não é avaliável", () => {
    expect(validateReviewDecision("NOT_SELECTED_FOR_QA", proposed, { decision: "APPROVED_UNCHANGED" })).toEqual({ ok: false, error: "NOT_SELECTED_FOR_QA" })
  })
  it("decisões inválidas são recusadas com motivo explícito", () => {
    expect(validateReviewDecision("APPROVED_UNCHANGED", proposed, { decision: "REJECTED", reasonCategory: "TONE" })).toEqual({ ok: false, error: "REVIEW_ALREADY_DECIDED" })
    expect(validateReviewDecision("PENDING_REVIEW", proposed, { decision: "APPROVED_UNCHANGED", finalWording: proposed })).toEqual({ ok: false, error: "FINAL_WORDING_NOT_ALLOWED" })
    expect(validateReviewDecision("PENDING_REVIEW", proposed, { decision: "APPROVED_EDITED", reasonCategory: "OTHER", finalWording: { ...proposed, observed: " a " } })).toEqual({ ok: false, error: "FINAL_WORDING_UNCHANGED" })
    expect(validateReviewDecision("PENDING_REVIEW", proposed, { decision: "APPROVED_EDITED", reasonCategory: "OTHER", finalWording: { ...proposed, observed: "  " } })).toEqual({ ok: false, error: "FINAL_WORDING_EMPTY" })
    expect(validateReviewDecision("PENDING_REVIEW", proposed, { decision: "REJECTED", reasonCategory: "INVENTED" as never })).toEqual({ ok: false, error: "UNKNOWN_REASON" })
    expect(validateReviewDecision("PENDING_REVIEW", proposed, { decision: "REJECTED", reasonCategory: "TONE", comment: "x".repeat(2001) })).toEqual({ ok: false, error: "COMMENT_TOO_LONG" })
    expect(validateReviewDecision("PENDING_REVIEW", proposed, { decision: "APPROVED_UNCHANGED" })).toEqual({ ok: true, finalWording: null })
  })
  it("flag nasce OFF; o pipeline só roda pela ação de Workflow (V1.5.10) atrás da fronteira de efeitos; só o app monta os routers de QA; o runtime usa a política do PILOTO salvo configuração explícita", () => {
    const root = resolve(__dirname, "../../..")
    expect(readFileSync(join(root, "config", "env.ts"), "utf8")).toMatch(/INIA_INTERACTION_FEEDBACK_PIPELINE: z\.enum\(\["OFF", "ON"\]\)\.default\("OFF"\)/)
    const files: { path: string; text: string }[] = []
    const walk = (dir: string) => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push({ path: path.slice(root.length + 1), text: readFileSync(path, "utf8") }) } }
    walk(root)
    // V1.5.12: a camada de confiabilidade do Workflow (modules/reliable-feedback) reusa DE PROPÓSITO o redator, a política e
    // a tela de QA deste módulo — é parte do mesmo núcleo, não um consumidor externo.
    // O inventário gerado do catálogo de erros só CITA caminhos (texto), não importa nada.
    const outside = files.filter((file) => !file.path.startsWith(join("modules", "interaction-feedback")) && !file.path.startsWith(join("modules", "reliable-feedback")) && !file.path.endsWith(".generated.ts"))
    // Fora do módulo, só estes importam application/infrastructure/domain: o servidor liga o VARREDOR (V1.5.6); o Workflow
    // pluga a geração na fronteira de efeitos, executa a ação e valida o publish (V1.5.10); o QA Lab simula sem gravar; a
    // aplicação de feedback conversacional LÊ a entrega do próprio colaborador pela MESMA projeção do Acompanhamento (só leitura)
    // e a confirmação de ciência com login e senha grava a ciência pela MESMA função `acknowledgeFeedbackDelivery`. A Monitoria de
    // usabilidade LÊ as entregas (só leitura) por um ponto único (`usage-analytics/application/feedback-sources.ts`).
    expect(outside.filter((file) => /interaction-feedback\/(?:application|infrastructure|domain)\//.test(file.text)).map((file) => file.path).sort()).toEqual(
      [join("main", "server.ts"), join("modules", "feedback-application", "application", "feedback-application-service.ts"), join("modules", "feedback-application", "application", "read-confirmation-service.ts"), join("modules", "qa-lab", "application", "simulation-effect-sink.ts"), join("modules", "usage-analytics", "application", "feedback-sources.ts"), join("modules", "workflows", "application", "effect-sink.ts"), join("modules", "workflows", "application", "interaction-feedback-action.ts"), join("modules", "workflows", "application", "publish-validation", "trigger-context.ts")].sort(),
    )
    expect([...readFileSync(join(root, "main", "server.ts"), "utf8").matchAll(/interaction-feedback\/[^"]+/g)].map((match) => match[0])).toEqual(["interaction-feedback/application/feedback-delivery-sweeper.js"])
    expect([...readFileSync(join(root, "modules", "workflows", "application", "effect-sink.ts"), "utf8").matchAll(/interaction-feedback\/[^"]+/g)].map((match) => match[0])).toEqual(["interaction-feedback/application/workflow-interaction-feedback-effects.js"])
    // O executor do Workflow nunca chama o pipeline direto: só pela fronteira de efeitos (produção grava; QA Lab simula).
    expect(readFileSync(join(root, "modules", "workflows", "application", "interaction-feedback-action.ts"), "utf8")).not.toMatch(/runInteractionFeedbackPipeline|generateInteractionFeedback\(|createInteractionFeedbackGenerationDeps|FeedbackWriter/)
    expect(readFileSync(join(root, "modules", "interaction-feedback", "application", "feedback-delivery-sweeper.ts"), "utf8")).not.toMatch(/runInteractionFeedbackPipeline|createInteractionFeedbackPipelineDeps|FeedbackWriter|generateForRoute/)
    expect(outside.filter((file) => /interaction-feedback\/presentation\//.test(file.text)).map((file) => file.path)).toEqual([join("main", "app.ts")])
    // O pipeline (que chama o redator) só é executado pela geração idempotente e pela simulação — ambas dentro do módulo.
    expect(files.filter((file) => /runInteractionFeedbackPipeline\(/.test(file.text) && !file.path.endsWith("interaction-feedback-pipeline.ts")).map((file) => file.path).sort()).toEqual(
      [join("modules", "interaction-feedback", "application", "generate-interaction-feedback.ts"), join("modules", "interaction-feedback", "application", "simulate-interaction-feedback.ts")].sort(),
    )
    expect(files.filter((file) => /createInteractionFeedbackPipelineDeps\(/.test(file.text) && !file.path.endsWith("pipeline-wiring.ts")).map((file) => file.path)).toEqual([])
    // O caminho do Workflow nunca passa pelo Planner da investigação (runtime de investigação/planejamento).
    for (const path of ["prepare-interaction-for-feedback.ts", "generate-interaction-feedback.ts", "simulate-interaction-feedback.ts", "workflow-interaction-feedback-effects.ts"]) {
      expect(readFileSync(join(root, "modules", "interaction-feedback", "application", path), "utf8")).not.toMatch(/from "[^"]*(?:investigation-runtime|run-agent|tool-executor)[^"]*"|runInvestigation\(|phase: "PLANNING"/)
    }
    // A montagem de runtime nunca habilita AUTO_DELIVER: usa a política do piloto (100% HOLD_FOR_QA).
    // V1.5.9: a política vem de configuração EXPLÍCITA; sem ela, o runtime continua no PILOTO (nunca muda por omissão).
    expect(readFileSync(join(root, "modules", "interaction-feedback", "application", "pipeline-wiring.ts"), "utf8")).toMatch(/deliveryPolicy: FEEDBACK_DELIVERY_POLICIES\[env\.INIA_FEEDBACK_DELIVERY_POLICY\]/)
    expect(readFileSync(join(root, "config", "env.ts"), "utf8")).toMatch(/INIA_FEEDBACK_DELIVERY_POLICY: z\.enum\(\["PILOT_V1", "AUTONOMOUS_V1"\]\)\.default\("PILOT_V1"\)/)
    // Nenhuma superfície de entrega (Acompanhamento, notificação, chat, avatar) lê a entrega do feedback de interação.
    expect(files.filter((file) => /deliverableItems\(|deliveryStateOf\(/.test(file.text) && !file.path.startsWith(join("modules", "interaction-feedback"))).map((file) => file.path)).toEqual([])
  })
})
