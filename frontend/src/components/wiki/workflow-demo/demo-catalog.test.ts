import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { flowGraphSchema, NODE_TYPE_LABELS, nodeBranches, type FlowNodeType } from "@/schemas/admin/workflow-graph.schema"
import { validateWorkflowGraph } from "@/schemas/admin/workflow-validation"
import { feedbackViewSchema } from "@/schemas/feedbacks/feedback-view.schema"
import type { WorkflowTrigger } from "@/schemas/admin/workflow.schema"

import { DEMO_EXAMPLES, examplesTeachingAction, examplesTeachingNode, examplesTeachingTrigger, scenesOf } from "./demo-catalog"
import { FICTIONAL_VARIABLE } from "./demo-graphs"
import { DEMO_SHOTS } from "./demo-shots"
import type { DemoField } from "./demo-types"
import { ACTION_GUIDES, NODE_GUIDES, TRIGGER_GUIDES } from "./node-guides"

const SRC = path.resolve(__dirname, "../../..")

function sourcesIn(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name)
    if (statSync(full).isDirectory()) return sourcesIn(full)
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [full] : []
  })
}

/** Tudo o que o editor escreve na tela: os formulários e os catálogos de rótulos. */
const EDITOR_TEXT = [
  ...sourcesIn(path.join(SRC, "components/admin/workflows")),
  ...sourcesIn(path.join(SRC, "schemas/admin")).filter((file) => /workflow|population|consolidated|structure-anchor/.test(file)),
]
  .map((file) => readFileSync(file, "utf-8"))
  .join("\n")

const panelFields = (): { where: string; field: DemoField }[] =>
  DEMO_EXAMPLES.flatMap((example) => Object.values(example.scenes).flatMap((scene) => (scene.panel?.fields ?? []).map((field) => ({ where: `${example.slug}/${scene.id}`, field }))))

describe("exemplos da Wiki — fiéis ao módulo", () => {
  it.each(DEMO_EXAMPLES.map((example) => [example.slug, example] as const))("%s é um grafo válido e publicável no editor", (_slug, example) => {
    const graph = flowGraphSchema.parse(example.definition.graph)
    const issues = validateWorkflowGraph(graph, example.definition.trigger as WorkflowTrigger, new Map(), new Map([[FICTIONAL_VARIABLE, { type: "TEXT", name: "Recado" }]]), Boolean(example.definition.consolidatedStructure))
    expect(issues).toEqual([])
  })

  it("cada desfecho anda só por ligações que existem no grafo, e pela saída declarada", () => {
    for (const example of DEMO_EXAMPLES) {
      const { nodes, edges } = example.definition.graph
      for (const scenario of example.scenarios) {
        const path = scenesOf(example, scenario).map((scene) => scene.nodeId).filter((nodeId, index, all) => nodeId !== all[index - 1])
        for (const nodeId of path) expect(nodes.some((node) => node.id === nodeId), `${example.slug}: nó ${nodeId}`).toBe(true)
        for (let index = 1; index < path.length; index += 1) {
          // Coleção vazia: "Aplicar individualmente" não cria execuções e o par "Consolidar resultados" (achado pela topologia) resolve na hora.
          const source = nodes.find((node) => node.id === path[index - 1])
          const target = nodes.find((node) => node.id === path[index])
          if (source?.type === "apply_individually" && target?.type === "consolidate_results") continue
          expect(edges.some((edge) => edge.source === path[index - 1] && edge.target === path[index]), `${example.slug}/${scenario.id}: ${path[index - 1]} → ${path[index]}`).toBe(true)
        }
      }
    }
  })

  it("todo nó tem rótulo no mapa, e toda cena pertence a algum desfecho", () => {
    for (const example of DEMO_EXAMPLES) {
      for (const node of example.definition.graph.nodes) expect(example.mapLabels[node.id], `${example.slug}: ${node.id}`).toBeTruthy()
      const used = new Set(example.scenarios.flatMap((scenario) => scenario.scenes))
      for (const id of Object.keys(example.scenes)) expect(used.has(id), `${example.slug}: cena ${id} sem desfecho`).toBe(true)
    }
  })

  it("todo rótulo de campo existe no editor", () => {
    const missing = panelFields().filter(({ field }) => !EDITOR_TEXT.includes(field.label)).map(({ where, field }) => `${where}: ${field.label}`)
    expect(missing).toEqual([])
  })

  it("todo valor marcado como opção existe no editor", () => {
    const missing = panelFields().filter(({ field }) => field.option && !EDITOR_TEXT.includes(field.value)).map(({ where, field }) => `${where}: ${field.label} = ${field.value}`)
    expect(missing).toEqual([])
  })

  it("os guias usam os mesmos rótulos e opções do editor", () => {
    const fields = [...Object.values(NODE_GUIDES), ...Object.values(TRIGGER_GUIDES), ...Object.values(ACTION_GUIDES)].flatMap((guide) => guide.values)
    expect(fields.filter((field) => !EDITOR_TEXT.includes(field.label)).map((field) => field.label)).toEqual([])
    expect(fields.filter((field) => field.option && !EDITOR_TEXT.includes(field.value)).map((field) => field.value)).toEqual([])
  })

  it("as prévias de feedback são o mesmo formato que o Acompanhamento recebe", () => {
    for (const example of DEMO_EXAMPLES) {
      for (const scene of Object.values(example.scenes)) {
        if (scene.preview?.kind === "feedback") expect(() => feedbackViewSchema.parse((scene.preview as { view: unknown }).view), `${example.slug}/${scene.id}`).not.toThrow()
      }
    }
  })

  it("Sim, Não e Sem dados só aparecem onde o nó tem essa saída", () => {
    const withNoData = DEMO_EXAMPLES.flatMap((example) => example.definition.graph.nodes.filter((node) => node.type === "condition" && nodeBranches(node).some((branch) => branch.id === "no_data")).map((node) => `${example.slug}/${node.id}`))
    expect(withNoData.sort()).toEqual(["orientar-e-reavaliar/fora-da-meta", "orientar-e-reavaliar/reavaliacao"])
  })

  it("os dois horários são um gatilho só, sem uma espera fazendo as vezes do segundo horário", () => {
    const example = DEMO_EXAMPLES.find((candidate) => candidate.slug === "dois-momentos-do-dia")!
    expect(example.definition.trigger).toMatchObject({ kind: "schedule", times: ["09:00", "15:00"], frequency: { type: "DAILY" } })
    expect(example.definition.graph.nodes.some((node) => node.type === "wait")).toBe(false)
    expect(example.definition.graph.nodes.some((node) => node.type === "action" && node.config.actionType === "GENERATE_FEEDBACK")).toBe(false)
  })

  it("o limite da nota URA é identificado como exemplo", () => {
    const example = DEMO_EXAMPLES.find((candidate) => candidate.slug === "nota-ura-baixa")!
    const limit = example.scenes["condicao-baixa"]!.panel!.fields.find((field) => field.label === "Valor")!
    expect(limit.illustrative).toBe(true)
  })
})

describe("exemplos da Wiki — cobertura", () => {
  it("todos os tipos de nó são ensinados em algum exemplo", () => {
    for (const type of Object.keys(NODE_TYPE_LABELS) as FlowNodeType[]) expect(examplesTeachingNode(type).length, type).toBeGreaterThan(0)
  })

  it("todas as ações oferecidas em nós novos são ensinadas em algum exemplo", () => {
    for (const action of Object.keys(ACTION_GUIDES) as (keyof typeof ACTION_GUIDES)[]) expect(examplesTeachingAction(action).length, action).toBeGreaterThan(0)
  })

  it("Flag, Indicador e Agenda têm jornada completa; o Manual tem guia e link para a página própria", () => {
    for (const kind of ["channel_flag", "indicator", "schedule"] as const) expect(examplesTeachingTrigger(kind).length, kind).toBeGreaterThan(0)
    expect(TRIGGER_GUIDES.manual.where).toContain("Executar agora")
  })

  it("todo guia tem situação real, onde encontrar e a cena", () => {
    for (const guide of [...Object.values(NODE_GUIDES), ...Object.values(TRIGGER_GUIDES), ...Object.values(ACTION_GUIDES)]) {
      expect(guide.situation.length).toBeGreaterThan(10)
      expect(guide.where.length).toBeGreaterThan(5)
      expect(guide.scene.receives.length).toBeGreaterThan(3)
      expect(guide.scene.produces.length).toBeGreaterThan(3)
    }
  })
})

describe("exemplos da Wiki — prints", () => {
  it("todo print citado existe, com arquivo em public/", () => {
    const publicDir = path.resolve(SRC, "../public")
    for (const example of DEMO_EXAMPLES) {
      for (const scene of Object.values(example.scenes)) {
        for (const id of scene.shots ?? []) {
          const shot = DEMO_SHOTS[id]
          expect(shot, `${example.slug}/${scene.id}: ${id}`).toBeDefined()
          expect(existsSync(path.join(publicDir, shot!.src)), shot!.src).toBe(true)
        }
      }
    }
  })

  it("print e ilustração nunca se confundem, e as marcações ficam dentro da imagem", () => {
    for (const shot of Object.values(DEMO_SHOTS)) {
      expect(["print", "illustration"]).toContain(shot.kind)
      for (const marker of shot.markers) {
        expect(marker.x).toBeGreaterThanOrEqual(0)
        expect(marker.x).toBeLessThanOrEqual(100)
        expect(marker.y).toBeGreaterThanOrEqual(0)
        expect(marker.y).toBeLessThanOrEqual(100)
      }
    }
  })
})

describe("demonstração estritamente didática", () => {
  const DEMO_SOURCES = sourcesIn(__dirname).map((file) => [path.basename(file), readFileSync(file, "utf-8")] as const)

  it.each(DEMO_SOURCES)("%s não chama API, fila, runtime nem QA Lab", (_name, source) => {
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|EventSource|WebSocket/)
    expect(source).not.toMatch(/from "@\/(services|queries)\//)
    expect(source).not.toMatch(/use[A-Z]\w*(Query|Mutation)\(/)
    expect(source).not.toMatch(/qa-lab|simulate|localStorage|sessionStorage/i)
  })

  it("o player não avalia regra: não compara valores nem lê configuração de condição", () => {
    const player = DEMO_SOURCES.find(([name]) => name === "demo-player.tsx")![1]
    expect(player).not.toMatch(/thresholdNumeric|comparator|historicalQuery|nodeBranches/)
  })
})
