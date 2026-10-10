import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"

// "Gerar feedback de atendimento" só publica com o módulo ligado (a mesma flag das rotas de QA) — os casos o usam ligado,
// e o caso "só backend" do módulo desligado troca o valor durante o teste.
vi.mock("../../../config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../config/env.js")>()
  return { env: { ...original.env, INIA_INTERACTION_FEEDBACK_PIPELINE: "ON" } }
})
import { env } from "../../../config/env.js"
import { loadOfficialModelWorkflows } from "../testing/official-model-workflows.js"
import { ACCEPTED, BACKEND_ONLY, BACKEND_ONLY_CODES, BACKEND_ONLY_MESSAGES, MIRRORED } from "../testing/publish-validation-parity-cases.js"
import { sweepSamples } from "../testing/publish-validation-parity-sweep.js"
import { backendVerdict, EDITOR_VALIDATION_PATH, editorIssues, SCHEMA_ERROR_CODE, type EditorIssue, type ParitySetup } from "../testing/publish-validation-parity.js"

/**
 * PARIDADE entre a validação de publicação do BACKEND (fonte da verdade: `validateWorkflowForPublish`, a do botão Publicar e
 * do dry-run) e a validação LOCAL do editor (`frontend/src/schemas/admin/workflow-validation.ts`), sobre o MESMO Workflow.
 * O editor espelha as regras à mão para avisar no canvas antes de publicar; enquanto ele mostra problema local o dry-run nem
 * é chamado (use-publish-validation.ts) — por isso uma regra a mais no editor bloqueia o que o backend aceitaria, e uma a
 * menos só aparece depois, no dry-run.
 *
 * Cada problema do editor declara o código da regra do backend que espelha; a comparação é regra a regra (código + nó). O
 * texto difere de propósito (o editor fala no contexto do canvas). Catálogo, regras "só backend" e casos de borda que os
 * dois lados publicam em testing/publish-validation-parity-cases.ts. Não há divergência tolerada: o backend é a fonte da
 * verdade e qualquer diferença (nos casos ou na varredura) falha este teste.
 */

const codesOf = (issues: EditorIssue[]) => [...new Set(issues.map((issue) => issue.code))].sort()
const explain = (backend: unknown, editor: EditorIssue[]) => `backend: ${JSON.stringify(backend)}\neditor: ${JSON.stringify(editor, null, 2)}`

afterEach(() => {
  env.INIA_INTERACTION_FEEDBACK_PIPELINE = "ON"
})

describe("paridade da validação de publicação — os 22 Workflows-modelo", () => {
  const FLAG_VALUE_TYPES: Record<string, "BOOLEAN" | "NUMERIC"> = {
    "60c9cda8-63de-4443-b6b6-7f7c66e91931": "BOOLEAN",
    "383e42c6-898c-4c35-b94c-6e40ff696ab5": "NUMERIC",
    "de009d6c-decd-4a03-87cb-fbc7052289b0": "BOOLEAN",
  }
  const models = loadOfficialModelWorkflows()

  it.each(models.map((model) => [model.key, model] as const))("Modelo %s — publicável nos dois lados", async (_key, model) => {
    const setup: ParitySetup = {
      trigger: model.trigger,
      flagValueType: model.trigger.kind === "channel_flag" ? FLAG_VALUE_TYPES[model.trigger.channelFlagId] : undefined,
      consolidated: Boolean(model.consolidatedStructure),
      graph: model.graph,
      operationalAggregation: { TMA: "WEIGHTED_AVERAGE", MONITORIA_QUALIDADE: "WEIGHTED_AVERAGE", NOTA_URA: "WEIGHTED_AVERAGE", ADERENCIA: "RATE" },
    }
    const backend = await backendVerdict(setup)
    const editor = await editorIssues(setup)
    expect(backend, explain(backend, editor)).toBeNull()
    expect(editor, explain(backend, editor)).toEqual([])
  })
})

describe("paridade da validação de publicação — regras espelhadas: mesmo código, mesmo nó", () => {
  it.each(MIRRORED.map((item) => [`${item.family} · ${item.name}`, item] as const))("%s", async (_name, item) => {
    const backend = await backendVerdict(item.setup)
    const editor = await editorIssues(item.setup)
    const details = explain(backend, editor)
    expect(backend?.code, details).toBe(item.code)
    if (backend?.nodeId && item.nodeId) expect(backend.nodeId, details).toBe(item.nodeId)
    expect(codesOf(editor), details).toEqual([...new Set([item.code, ...(item.alsoCodes ?? [])])].sort())
    const sameRule = editor.filter((issue) => issue.code === item.code)
    expect([...new Set(sameRule.map((issue) => issue.nodeId))].sort(), details).toEqual([item.nodeId, ...(item.alsoNodeIds ?? [])].sort())
  })
})

describe("paridade da validação de publicação — regras só do backend (dependem de banco/ambiente; o dry-run cobre o editor)", () => {
  it.each(BACKEND_ONLY.map((item) => [`${item.name} (${item.reason})`, item] as const))("%s", async (_name, item) => {
    if (item.env === "INTERACTION_FEEDBACK_OFF") env.INIA_INTERACTION_FEEDBACK_PIPELINE = "OFF"
    const backend = await backendVerdict(item.setup)
    const editor = await editorIssues(item.setup)
    const details = explain(backend, editor)
    expect(backend?.code, details).toBe(item.code)
    if (item.nodeId) expect(backend?.nodeId, details).toBe(item.nodeId)
    expect(editor, details).toEqual([])
  })
})

describe("paridade da validação de publicação — casos de borda que os dois lados publicam", () => {
  it.each(ACCEPTED.map((item) => [item.name, item] as const))("%s", async (_name, item) => {
    const backend = await backendVerdict(item.setup)
    const editor = await editorIssues(item.setup)
    const details = explain(backend, editor)
    expect(backend, details).toBeNull()
    expect(editor, details).toEqual([])
  })
})

describe("paridade da validação de publicação — catálogo completo", () => {
  // As regras moram na entrada e nos arquivos de cada família (publish-validation/ no backend, workflow-validation/ no editor).
  const filesIn = (directory: string) => readdirSync(directory).map((file) => path.join(directory, file))
  const here = (file: string) => fileURLToPath(new URL(file, import.meta.url))
  const backendFiles = [here("./validate-workflow-for-publish.ts"), ...filesIn(here("./publish-validation")), here("./validate-indicator-capabilities.ts"), here("./organizational-recipient.ts")]
  const editorFiles = [EDITOR_VALIDATION_PATH, ...filesIn(EDITOR_VALIDATION_PATH.replace(/\.ts$/, ""))]
  const backendSource = backendFiles.map((file) => readFileSync(file, "utf8")).join("\n")
  const editorSource = editorFiles.map((file) => readFileSync(file, "utf8")).join("\n")
  const codePattern = /"(WORKFLOW_[A-Z_]+|INDICATOR_NOT_FOUND|VALIDATION_ERROR)"/g
  const backendCodes = new Set([...backendSource.matchAll(codePattern)].map((match) => match[1]!))
  const editorCodes = new Set([...editorSource.matchAll(codePattern)].map((match) => match[1]!))
  const mirroredCodes = new Set(MIRRORED.flatMap((item) => [item.code, ...(item.alsoCodes ?? [])]))

  it("todo código que o backend lança tem caso: espelhado ou só backend", () => {
    const covered = new Set([...mirroredCodes, ...BACKEND_ONLY.map((item) => item.code)])
    expect([...backendCodes].filter((code) => !covered.has(code)).sort()).toEqual([])
  })

  it("todo código dos casos espelhados existe no código do backend", () => {
    expect([...mirroredCodes].filter((code) => code !== SCHEMA_ERROR_CODE && !backendCodes.has(code)).sort()).toEqual([])
  })

  it("todo código que o editor usa existe no backend (ou é o esquema do rascunho) e tem caso espelhado", () => {
    expect([...editorCodes].filter((code) => code !== SCHEMA_ERROR_CODE && !backendCodes.has(code)).sort()).toEqual([])
    expect([...editorCodes].filter((code) => !mirroredCodes.has(code)).sort()).toEqual([])
  })

  it("o editor nunca usa um código das regras que dependem de banco/ambiente", () => {
    expect([...editorCodes].filter((code) => BACKEND_ONLY_CODES.includes(code))).toEqual([])
    expect(BACKEND_ONLY_CODES.filter((code) => !BACKEND_ONLY.some((item) => item.code === code))).toEqual([])
  })
})

describe("paridade da validação de publicação — varredura determinística sobre mutações dos 22 modelos", () => {
  const SEED = 20261007
  const SAMPLES = 3000

  it(`${SAMPLES} amostras (semente ${SEED}): nenhuma divergência`, async () => {
    const problems: string[] = []
    const seen = { bothValid: 0, sameRule: 0, backendOnly: 0 }
    for (const sample of sweepSamples(SEED, SAMPLES)) {
      const backend = await backendVerdict(sample)
      const editor = await editorIssues(sample)
      const describeSample = () => `#${sample.index} ${sample.trace.join(" · ")}\n${explain(backend, editor)}`
      if (!backend) {
        if (editor.length > 0) problems.push(`editor recusa o que o backend publica: ${describeSample()}`)
        else seen.bothValid++
        continue
      }
      if (BACKEND_ONLY_CODES.includes(backend.code) || BACKEND_ONLY_MESSAGES.some((pattern) => pattern.test(backend.message))) {
        seen.backendOnly++
        continue
      }
      const sameRule = editor.filter((issue) => issue.code === backend.code)
      if (sameRule.length === 0) problems.push(`editor não aponta a regra do backend: ${describeSample()}`)
      else if (backend.nodeId && !sameRule.some((issue) => issue.nodeId === backend.nodeId)) problems.push(`editor aponta a regra em outro nó: ${describeSample()}`)
      else seen.sameRule++
    }
    expect(problems.slice(0, 5).join("\n\n"), `${problems.length} amostra(s) com divergência`).toBe("")
    // A varredura precisa de fato exercitar regras dos dois lados, não só grafos válidos.
    expect(seen.sameRule, JSON.stringify(seen)).toBeGreaterThan(SAMPLES / 3)
  }, 120_000)
})
