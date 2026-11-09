import { describe, expect, it, vi } from "vitest"

vi.mock("../../../config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../config/env.js")>()
  return { env: { ...original.env, INIA_INTERACTION_FEEDBACK_PIPELINE: "ON" } }
})
import { agent, condition, edge, endNode, escalate, FLAG_BOOLEAN, humanReview, output, setVariable, triggerNode, VARIABLE_A } from "../testing/publish-validation-parity-cases.js"
import { backendVerdict, editorIssues, type ParitySetup } from "../testing/publish-validation-parity.js"

/**
 * P5b e WF-41 (`docs/qa/workflows/propostas.md`): referência a etapa que não existe ou que não vem antes no fluxo, e origem em
 * variável. Os dois lados precisam recusar com o mesmo código, na mesma etapa.
 */

type Node = ReturnType<typeof triggerNode>
const setup = (nodes: Node[], edges: ReturnType<typeof edge>[], extra: Partial<ParitySetup> = {}): ParitySetup => ({ ...FLAG_BOOLEAN, consolidated: false, graph: { nodes, edges }, ...extra })
const chain = (...nodes: Node[]) => setup(nodes, nodes.slice(0, -1).map((node, index) => edge(node.id, "always", nodes[index + 1]!.id)))

const GONE = "nodeOutputs.sumiu"
const AGENT = "nodeOutputs.agent"
const rule = (sourcePath: string) => ({ comparator: "EQUALS", group: { operator: "ALL", rules: [{ sourcePath, comparator: "GT", thresholdNumeric: 3 }] } })
const simple = (sourcePath: string) => ({ sourcePath, thresholdNumeric: 3 })

/** Condição ANTES do agente: a origem no agente existe, mas ainda não rodou. */
const conditionBeforeAgent = (config: Record<string, unknown>) =>
  setup(
    [triggerNode(), condition("cond", config), agent(), output("out", AGENT), endNode()],
    [edge("trigger", "always", "cond"), edge("cond", "true", "agent"), edge("cond", "false", "end"), edge("agent", "always", "out"), edge("out", "always", "end")],
  )
/** Condição DEPOIS do agente. */
const conditionAfterAgent = (config: Record<string, unknown>) =>
  setup(
    [triggerNode(), agent(), condition("cond", config), output("out", AGENT), endNode()],
    [edge("trigger", "always", "agent"), edge("agent", "always", "cond"), edge("cond", "true", "out"), edge("cond", "false", "end"), edge("out", "always", "end")],
  )
const REVIEW_EXITS = (target: string) => [edge("review", "approved", target), edge("review", "rejected", "end"), edge("review", "escalated", "end")]
const reviewBeforeAgent = (contentSource: string) =>
  setup(
    [triggerNode(), humanReview("review", { contentSource }), agent(), output("out", AGENT), endNode()],
    [edge("trigger", "always", "review"), ...REVIEW_EXITS("agent"), edge("agent", "always", "out"), edge("out", "always", "end")],
  )
const reviewAfterAgent = (contentSource: string) =>
  setup(
    [triggerNode(), agent(), humanReview("review", { contentSource }), output("out", AGENT), endNode()],
    [edge("trigger", "always", "agent"), edge("agent", "always", "review"), ...REVIEW_EXITS("out"), edge("out", "always", "end")],
  )

const VARIABLE = `variables.${VARIABLE_A}`
const setText = () => setVariable("sv", { value: "Texto" })
const withVariable = (base: ParitySetup): ParitySetup => ({ ...base, variables: [{ id: VARIABLE_A, type: "TEXT", name: "Texto" }] })

const REFUSED: { name: string; setup: ParitySetup; code: string; nodeId: string }[] = [
  { name: "Output: etapa que não existe", setup: chain(triggerNode(), agent(), output("bad", GONE), output("out", AGENT), endNode()), code: "WORKFLOW_INVALID_OUTPUT", nodeId: "bad" },
  { name: "Output: etapa que vem depois", setup: chain(triggerNode(), output("bad", AGENT), agent(), output("out", AGENT), endNode()), code: "WORKFLOW_INVALID_OUTPUT", nodeId: "bad" },
  { name: "Condição: etapa que não existe", setup: conditionAfterAgent(simple(GONE)), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { name: "Condição: etapa que vem depois", setup: conditionBeforeAgent(simple(AGENT)), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { name: "Regra de grupo: etapa que não existe", setup: conditionAfterAgent(rule(GONE)), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { name: "Regra de grupo: etapa que vem depois", setup: conditionBeforeAgent(rule(AGENT)), code: "WORKFLOW_INVALID_CONDITION", nodeId: "cond" },
  { name: "Revisão: etapa que não existe", setup: reviewAfterAgent(GONE), code: "WORKFLOW_INVALID_HUMAN_REVIEW", nodeId: "review" },
  { name: "Revisão: etapa que vem depois", setup: reviewBeforeAgent(AGENT), code: "WORKFLOW_INVALID_HUMAN_REVIEW", nodeId: "review" },
  { name: "Escalonar: etapa que não existe", setup: chain(triggerNode(), agent(), escalate("esc", { contentSource: GONE }), output("out", AGENT), endNode()), code: "WORKFLOW_INVALID_ACTION", nodeId: "esc" },
  { name: "Escalonar: etapa que vem depois", setup: chain(triggerNode(), escalate("esc", { contentSource: AGENT }), agent(), output("out", AGENT), endNode()), code: "WORKFLOW_INVALID_ACTION", nodeId: "esc" },
  { name: "Output: variável que não existe", setup: withVariable(chain(triggerNode(), agent(), output("bad", "variables.0a7a0000-0000-4000-8000-0000000000ee"), output("out", AGENT), endNode())), code: "WORKFLOW_INVALID_OUTPUT", nodeId: "bad" },
  { name: "Output: variável que nenhuma etapa anterior define", setup: withVariable(chain(triggerNode(), agent(), output("bad", VARIABLE), setText(), output("out", AGENT), endNode())), code: "WORKFLOW_INVALID_OUTPUT", nodeId: "bad" },
  { name: "Output: variável no Acompanhamento do próprio colaborador", setup: withVariable(chain(triggerNode(), setText(), agent(), output("bad", VARIABLE, { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"] }), output("out", AGENT), endNode())), code: "WORKFLOW_INVALID_OUTPUT", nodeId: "bad" },
  { name: "Revisão: variável que nenhuma etapa anterior define", setup: withVariable(reviewAfterAgent(VARIABLE)), code: "WORKFLOW_INVALID_HUMAN_REVIEW", nodeId: "review" },
  { name: "Escalonar: variável que nenhuma etapa anterior define", setup: withVariable(chain(triggerNode(), agent(), escalate("esc", { contentSource: VARIABLE }), output("out", AGENT), endNode())), code: "WORKFLOW_INVALID_ACTION", nodeId: "esc" },
]

const ACCEPTED: { name: string; setup: ParitySetup }[] = [
  { name: "Output com a origem antes dele", setup: chain(triggerNode(), agent(), output("out", AGENT), endNode()) },
  { name: "Condição com a origem antes dela", setup: conditionAfterAgent(simple(AGENT)) },
  { name: "Regra de grupo com a origem antes dela", setup: conditionAfterAgent(rule(AGENT)) },
  { name: "Condição sobre o gatilho", setup: conditionAfterAgent(simple("nodeOutputs.trigger")) },
  { name: "Revisão com a origem antes dela", setup: reviewAfterAgent(AGENT) },
  { name: "Escalonar com a origem antes dele", setup: chain(triggerNode(), agent(), escalate("esc", { contentSource: AGENT }), output("out", AGENT), endNode()) },
  { name: "Escalonar sem conteúdo", setup: chain(triggerNode(), agent(), escalate("esc"), output("out", AGENT), endNode()) },
  { name: "Output para a gestão com variável definida antes", setup: withVariable(chain(triggerNode(), setText(), agent(), output("var", VARIABLE), output("out", AGENT), endNode())) },
  { name: "Chat do próprio colaborador com variável definida antes", setup: withVariable(chain(triggerNode(), setText(), agent(), output("var", VARIABLE, { target: { type: "CURRENT_OPERATOR" }, surfaces: ["CHAT"] }), output("out", AGENT), endNode())) },
  { name: "Escalonar com variável definida antes", setup: withVariable(chain(triggerNode(), setText(), agent(), escalate("esc", { contentSource: VARIABLE }), output("out", AGENT), endNode())) },
]

describe("P5b · paridade das referências a etapas", () => {
  it.each(REFUSED)("recusa nos dois lados: $name", async ({ setup: caseSetup, code, nodeId }) => {
    expect(await backendVerdict(caseSetup)).toMatchObject({ code, nodeId })
    const editor = await editorIssues(caseSetup)
    expect(editor.filter((issue) => issue.nodeId === nodeId).map((issue) => issue.code)).toContain(code)
  })

  it.each(ACCEPTED)("controle, aceita nos dois lados: $name", async ({ setup: caseSetup }) => {
    expect(await backendVerdict(caseSetup)).toBeNull()
    expect(await editorIssues(caseSetup)).toEqual([])
  })
})
