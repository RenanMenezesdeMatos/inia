import { DomainError } from "../../../shared/domain/domain-error.js"
import { flowGraphSchema, type FlowGraph } from "./graph-schema.js"

/**
 * Rascunho × publicação: o rascunho é trabalho em andamento e aceita em branco o que a pessoa ainda vai preencher; só a
 * publicação exige o grafo completo. Antes, salvar passava pelo schema completo, e uma etapa recém-adicionada não podia ser
 * salva ("salvar e continuar depois" era impossível). O schema completo continua sendo UM só (`flowGraphSchema`): aqui só se
 * decide o que pode estar em branco. O motor nunca lê rascunho: ele lê `workflow_versions`, que só recebe grafo completo.
 *
 * Só valem o texto em branco e a lista vazia nestes campos. Campo ausente, tipo errado ou valor inválido continuam recusados.
 */
const UUID_FILLER = "00000000-0000-4000-8000-000000000000"

type TolerantField = { filler: unknown; guidance: string }

const TOLERANT_FIELDS: Readonly<Record<string, TolerantField>> = {
  agentId: { filler: UUID_FILLER, guidance: "escolha o agente" },
  orchestratorId: { filler: UUID_FILLER, guidance: "escolha o orquestrador" },
  variableId: { filler: UUID_FILLER, guidance: "escolha a variável" },
  policyId: { filler: UUID_FILLER, guidance: "escolha a política de acompanhamento" },
  userId: { filler: UUID_FILLER, guidance: "escolha a pessoa" },
  sourceNodeId: { filler: "preenchido", guidance: "escolha a origem" },
  previousReviewNodeId: { filler: "preenchido", guidance: "escolha a revisão anterior" },
  source: { filler: "preenchido", guidance: "escolha o conteúdo a entregar" },
  sourcePath: { filler: "preenchido", guidance: "escolha a origem do valor" },
  contentSource: { filler: "preenchido", guidance: "escolha o conteúdo" },
  instruction: { filler: "preenchido", guidance: "preencha a instrução" },
  indicatorCode: { filler: "PREENCHIDO", guidance: "escolha o indicador" },
  surfaces: { filler: ["NOTIFICATION"], guidance: "escolha onde entregar" },
  businessDomainIds: { filler: [UUID_FILLER], guidance: "escolha os domínios de negócio" },
}

type Path = (string | number)[]
type BlankField = { path: Path; key: string; blank: string | [] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function blankValueOf(value: unknown): string | [] | null {
  if (typeof value === "string") return value.trim() === "" ? "" : null
  if (Array.isArray(value)) return value.length === 0 ? [] : null
  return null
}

/** Campos em branco tolerados dentro de um `config`, em qualquer profundidade (regras de um grupo, critério de seleção…). */
function collectBlankFields(value: unknown, path: Path = []): BlankField[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => collectBlankFields(item, [...path, index]))
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = [...path, key]
    const blank = Object.hasOwn(TOLERANT_FIELDS, key) ? blankValueOf(child) : null
    return blank === null ? collectBlankFields(child, childPath) : [{ path: childPath, key, blank }]
  })
}

/**
 * O objeto onde fica o último trecho do caminho, andando SÓ por chaves próprias. O corpo da requisição pode trazer `__proto__`
 * como chave (o JSON.parse a cria assim) e o schema a remove: seguir o caminho por herança chegava a Object.prototype, e devolver
 * o branco ali trocava `toString` de todo o processo da API (achado da varredura de 06/11/2026).
 */
function ownParentOf(root: unknown, path: Path): Record<string | number, unknown> | null {
  let cursor: unknown = root
  for (const segment of path.slice(0, -1)) {
    if (typeof cursor !== "object" || cursor === null || !Object.hasOwn(cursor, segment)) return null
    cursor = (cursor as Record<string | number, unknown>)[segment]
  }
  return typeof cursor === "object" && cursor !== null ? (cursor as Record<string | number, unknown>) : null
}

function setAt(root: unknown, path: Path, value: unknown): void {
  const parent = ownParentOf(root, path)
  const key = path[path.length - 1]!
  if (parent && Object.hasOwn(parent, key)) parent[key] = value
}

/** Devolve o branco só onde o campo sobreviveu ao schema: campo desconhecido é removido por ele e continua removido. */
function restoreAt(root: unknown, path: Path, value: unknown): void {
  setAt(root, path, value)
}

function rawNodesOf(raw: unknown): unknown[] {
  return isRecord(raw) && Array.isArray(raw.nodes) ? raw.nodes : []
}

/**
 * Lê um rascunho, aceitando em branco o que a pessoa ainda vai preencher. Todo o resto passa pelo schema completo, normalizado
 * como sempre, e o erro continua sendo o `ZodError` dele. O tipo devolvido é `FlowGraph` com a ressalva dos campos em branco:
 * serve para gravar e para as checagens de edição, nunca para publicar ou simular (use `parseCompleteGraph`).
 */
export function parseDraftGraph(raw: unknown): FlowGraph {
  const blanksByNode = rawNodesOf(raw).map((node) => collectBlankFields(isRecord(node) ? node.config : undefined))
  if (blanksByNode.every((blanks) => blanks.length === 0)) return flowGraphSchema.parse(raw)

  // Passa pelo schema com os brancos preenchidos e os devolve depois: uma regra só, sem um segundo schema para manter igual.
  const filled = structuredClone(raw) as { nodes: { config: unknown }[] }
  blanksByNode.forEach((blanks, index) => {
    for (const { path, key } of blanks) setAt(filled.nodes[index]!.config, path, structuredClone(TOLERANT_FIELDS[key]!.filler))
  })
  const parsed = flowGraphSchema.parse(filled)
  blanksByNode.forEach((blanks, index) => {
    for (const { path, blank } of blanks) restoreAt(parsed.nodes[index]!.config, path, blank)
  })
  return parsed
}

function incompleteNodeError(label: unknown, nodeId: unknown, guidance: string): DomainError {
  const where = typeof label === "string" && label.trim() ? `Em "${label.trim()}"` : "Em uma etapa ainda sem nome"
  return new DomainError(`${where}, ${guidance}.`, "VALIDATION_ERROR", 422, typeof nodeId === "string" ? { nodeId } : undefined)
}

/**
 * O grafo que pode rodar: sem nada em branco. Recusa apontando a etapa e o que falta (`details.nodeId`, como as demais regras
 * de publicação), para a tela levar até ela. Usada pela publicação, pelo dry-run e pelo QA Lab.
 */
export function parseCompleteGraph(raw: unknown): FlowGraph {
  for (const node of rawNodesOf(raw)) {
    if (!isRecord(node)) continue
    const blank = collectBlankFields(node.config)[0]
    if (blank) throw incompleteNodeError(node.label, node.id, TOLERANT_FIELDS[blank.key]!.guidance)
  }
  const parsed = flowGraphSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  const nodesAt = parsed.error.issues[0]?.path.indexOf("nodes") ?? -1
  const index = nodesAt === -1 ? undefined : parsed.error.issues[0]?.path[nodesAt + 1]
  const node = typeof index === "number" ? rawNodesOf(raw)[index] : undefined
  if (isRecord(node)) throw incompleteNodeError(node.label, node.id, "revise a configuração desta etapa")
  throw new DomainError("O fluxo salvo tem dados inválidos. Abra o editor e salve o rascunho de novo.", "VALIDATION_ERROR", 422)
}
