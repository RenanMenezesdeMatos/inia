"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Eye,
  FolderOpen,
  Hash,
  Info,
  List,
  ListChecks,
  Plus,
  ToggleLeft,
  Trash2,
  Type,
  Workflow,
  X,
} from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  buildStructuredOutputJsonSchema,
  buildStructuredOutputPreview,
  countStructuredFields,
  describeStructuredField,
  flattenStructuredOutput,
  joinStructuredPath,
  STRUCTURED_OUTPUT_FIELD_TYPE_HINTS,
  STRUCTURED_OUTPUT_FIELD_TYPE_LABELS,
  STRUCTURED_OUTPUT_MAX_DEPTH,
  suggestStructuredOutputKey,
  validateStructuredOutputDefinition,
  type StructuredOutputDefinition,
  type StructuredOutputFieldType,
  type StructuredOutputIssue,
  type StructuredOutputNode,
  type StructuredOutputReview,
  type StructuredOutputSource,
  type StructuredOutputUsage,
} from "@/schemas/admin/structured-output"
import { cn } from "@/lib/utils"

/* ------------------------------------------------------------------------------------------ */
/* Estado de edição: a definição + um id transitório por nó (nunca persistido) + "chave        */
/* editada à mão" (nunca sobrescrita pela sugestão automática depois disso — Parte AD).        */
/* ------------------------------------------------------------------------------------------ */

type EditorField = {
  uid: string
  kind: "FIELD"
  key: string
  label: string
  type: StructuredOutputFieldType
  required: boolean
  description: string
  example: string
  minimum: string
  maximum: string
  options: { value: string; label: string }[]
  keyTouched: boolean
}
type EditorGroup = { uid: string; kind: "GROUP"; key: string; label: string; description: string; children: EditorNode[]; keyTouched: boolean }
type EditorNode = EditorField | EditorGroup

let uidCounter = 0
function nextUid(): string {
  uidCounter += 1
  return `so-${uidCounter}`
}

function toEditor(nodes: StructuredOutputNode[]): EditorNode[] {
  return nodes.map((node) => {
    if (node.kind === "GROUP") return { uid: nextUid(), kind: "GROUP", key: node.key, label: node.label, description: node.description ?? "", children: toEditor(node.children), keyTouched: true }
    return {
      uid: nextUid(),
      kind: "FIELD",
      key: node.key,
      label: node.label,
      type: node.type,
      required: node.required,
      description: node.description ?? "",
      example: node.example ?? "",
      minimum: node.minimum !== undefined ? String(node.minimum) : "",
      maximum: node.maximum !== undefined ? String(node.maximum) : "",
      options: (node.options ?? []).map((option) => ({ value: option.value, label: option.label ?? "" })),
      keyTouched: true,
    }
  })
}

function parseNumber(text: string): number | undefined {
  const trimmed = text.trim().replace(",", ".")
  if (trimmed === "") return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

function toDefinition(nodes: EditorNode[]): StructuredOutputDefinition {
  function convert(items: EditorNode[]): StructuredOutputNode[] {
    return items.map((node) => {
      if (node.kind === "GROUP") {
        return { kind: "GROUP", key: node.key.trim(), label: node.label.trim(), ...(node.description.trim() ? { description: node.description.trim() } : {}), children: convert(node.children) }
      }
      const minimum = parseNumber(node.minimum)
      const maximum = parseNumber(node.maximum)
      return {
        kind: "FIELD",
        key: node.key.trim(),
        label: node.label.trim(),
        type: node.type,
        required: node.required,
        ...(node.description.trim() ? { description: node.description.trim() } : {}),
        ...(node.type === "STRING" && node.example.trim() ? { example: node.example.trim() } : {}),
        ...(node.type === "NUMBER" && minimum !== undefined ? { minimum } : {}),
        ...(node.type === "NUMBER" && maximum !== undefined ? { maximum } : {}),
        ...(node.type === "ENUM" ? { options: node.options.map((option) => ({ value: option.value.trim(), ...(option.label.trim() ? { label: option.label.trim() } : {}) })) } : {}),
      }
    })
  }
  return { schemaVersion: 1, nodes: convert(nodes) }
}

function newField(): EditorField {
  return { uid: nextUid(), kind: "FIELD", key: "", label: "", type: "STRING", required: false, description: "", example: "", minimum: "", maximum: "", options: [], keyTouched: false }
}
function newGroup(): EditorGroup {
  return { uid: nextUid(), kind: "GROUP", key: "", label: "", description: "", children: [], keyTouched: false }
}

/** Atualiza um nó (por uid) em qualquer profundidade — retorna uma nova árvore. */
function updateNode(nodes: EditorNode[], uid: string, updater: (node: EditorNode) => EditorNode): EditorNode[] {
  return nodes.map((node) => {
    if (node.uid === uid) return updater(node)
    if (node.kind === "GROUP") return { ...node, children: updateNode(node.children, uid, updater) }
    return node
  })
}

function removeNode(nodes: EditorNode[], uid: string): EditorNode[] {
  return nodes.filter((node) => node.uid !== uid).map((node) => (node.kind === "GROUP" ? { ...node, children: removeNode(node.children, uid) } : node))
}

function moveNode(nodes: EditorNode[], uid: string, direction: -1 | 1): EditorNode[] {
  const index = nodes.findIndex((node) => node.uid === uid)
  if (index !== -1) {
    const target = index + direction
    if (target < 0 || target >= nodes.length) return nodes
    const next = [...nodes]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved!)
    return next
  }
  return nodes.map((node) => (node.kind === "GROUP" ? { ...node, children: moveNode(node.children, uid, direction) } : node))
}

function insertInto(nodes: EditorNode[], parentUid: string | null, node: EditorNode): EditorNode[] {
  if (parentUid === null) return [...nodes, node]
  return nodes.map((item) => (item.kind === "GROUP" ? (item.uid === parentUid ? { ...item, children: [...item.children, node] } : { ...item, children: insertInto(item.children, parentUid, node) }) : item))
}

function duplicateNode(nodes: EditorNode[], uid: string): EditorNode[] {
  const index = nodes.findIndex((node) => node.uid === uid)
  if (index !== -1) {
    const original = nodes[index]!
    if (original.kind !== "FIELD") return nodes
    const copy: EditorField = { ...original, uid: nextUid(), key: `${original.key}Copia`, label: `${original.label} (cópia)`, options: original.options.map((option) => ({ ...option })), keyTouched: true }
    const next = [...nodes]
    next.splice(index + 1, 0, copy)
    return next
  }
  return nodes.map((node) => (node.kind === "GROUP" ? { ...node, children: duplicateNode(node.children, uid) } : node))
}

/** Path técnico de cada uid (para issues, uso em Workflows e preview "analise.assunto"). */
function pathsByUid(nodes: EditorNode[], parentPath = "", sink = new Map<string, { path: string; depth: number; parentLabel: string | null }>(), parentLabel: string | null = null, depth = 1) {
  for (const node of nodes) {
    const path = joinStructuredPath(parentPath, node.key.trim())
    sink.set(node.uid, { path, depth, parentLabel })
    if (node.kind === "GROUP") pathsByUid(node.children, path, sink, node.label.trim() || node.key, depth + 1)
  }
  return sink
}

const TYPE_ICONS: Record<StructuredOutputFieldType, typeof Type> = { STRING: Type, NUMBER: Hash, BOOLEAN: ToggleLeft, ENUM: ListChecks, ARRAY: List }

/* ------------------------------------------------------------------------------------------ */

export type StructuredOutputBuilderProps = {
  /** Definição inicial (o construtor é dono do estado de edição; remonte com `key` para recarregar). */
  initialDefinition: StructuredOutputDefinition | null
  /** Ligado = o Orquestrador produz resultado estruturado; desligado = só texto livre. */
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  /** Emitido a cada edição (sem request): definição atual + problemas de validação. */
  onChange: (definition: StructuredOutputDefinition, issues: StructuredOutputIssue[]) => void
  /** Onde cada path é usado em Workflows (GET …/structured-output-usage). */
  usage?: StructuredOutputUsage[]
  source?: StructuredOutputSource
  review?: StructuredOutputReview | null
  /** Instrução gerada pelo backend na última gravação (visão técnica) — null quando nunca salvo. */
  savedInstructions?: string | null
  /** Texto legado (só quando `source` = LEGACY_INSTRUCTIONS): mostrado read-only para o admin converter. */
  legacyInstructions?: string | null
}

export function StructuredOutputBuilder({ initialDefinition, enabled, onEnabledChange, onChange, usage = [], source = "NONE", review = null, savedInstructions = null, legacyInstructions = null }: StructuredOutputBuilderProps) {
  const [nodes, setNodes] = useState<EditorNode[]>(() => toEditor(initialDefinition?.nodes ?? []))
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<EditorNode | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [previewOpen, setPreviewOpen] = useState(false)
  const [workflowOpen, setWorkflowOpen] = useState(false)
  const [technicalOpen, setTechnicalOpen] = useState(false)

  const definition = useMemo(() => toDefinition(nodes), [nodes])
  const issues = useMemo(() => validateStructuredOutputDefinition(definition), [definition])
  const paths = useMemo(() => pathsByUid(nodes), [nodes])
  const fields = useMemo(() => flattenStructuredOutput(definition), [definition])
  // Emite para o pai a cada mudança real da definição — nunca request, só estado.
  const lastEmitted = useRef<string>("")
  useEffect(() => {
    const serialized = JSON.stringify(definition)
    if (serialized === lastEmitted.current) return
    lastEmitted.current = serialized
    onChange(definition, issues)
  }, [definition, issues, onChange])

  function usageForUid(uid: string): StructuredOutputUsage[] {
    const info = paths.get(uid)
    if (!info || !info.path) return []
    return usage.filter((entry) => entry.path === info.path || entry.path.startsWith(`${info.path}.`))
  }

  function addNode(parentUid: string | null, kind: "FIELD" | "GROUP") {
    const node = kind === "FIELD" ? newField() : newGroup()
    setNodes((current) => insertInto(current, parentUid, node))
    setSelectedUid(node.uid)
    if (parentUid) setCollapsedGroups((current) => {
      const next = new Set(current)
      next.delete(parentUid)
      return next
    })
    onEnabledChange(true)
  }

  function requestDelete(node: EditorNode) {
    const used = usageForUid(node.uid)
    if ((node.kind === "GROUP" && node.children.length > 0) || used.length > 0) {
      setPendingDelete(node)
      return
    }
    confirmDelete(node)
  }

  function confirmDelete(node: EditorNode) {
    setNodes((current) => removeNode(current, node.uid))
    if (selectedUid === node.uid) setSelectedUid(null)
    setPendingDelete(null)
  }

  const isEmpty = nodes.length === 0
  const totalFields = fields.length

  return (
    <div className="space-y-3" data-testid="structured-output-builder">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <Label className="text-sm font-semibold">Resultado estruturado</Label>
          <p className="text-xs text-muted-foreground">
            Defina os dados que este Orquestrador deve produzir além da resposta em texto. Esses dados poderão ser usados em Condições, Outputs e outros passos do Workflow.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Switch checked={enabled} onCheckedChange={onEnabledChange} aria-label="Produzir resultado estruturado" />
        </div>
      </div>

      {review ? (
        <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300" role="alert" data-testid="structured-output-review">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium">{review.message}</p>
            {review.reason === "KEY_MISMATCH" ? (
              <p>
                {review.unknownInInstructions.length > 0 ? `O texto antigo pedia à IA: ${review.unknownInInstructions.join(", ")}. ` : ""}
                {review.missingInInstructions.length > 0 ? `Campos cadastrados que o texto antigo não pedia: ${review.missingInInstructions.join(", ")}.` : ""}
              </p>
            ) : (
              <p>Não foi possível conferir o texto antigo enviado à IA. Ao salvar, a instrução passa a ser gerada a partir dos campos abaixo.</p>
            )}
          </div>
        </div>
      ) : null}

      {source === "LEGACY_SCHEMA" && !review ? (
        <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
          Configuração antiga convertida automaticamente — os caminhos técnicos foram preservados. Ao salvar, a instrução enviada à IA passa a ser gerada a partir destes campos: revise &quot;O que a IA deve identificar?&quot; em cada um, porque o texto antigo pode conter orientações que não estavam nos campos cadastrados.
        </p>
      ) : null}

      {source === "LEGACY_INSTRUCTIONS" && isEmpty ? (
        <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300" role="alert">
          <p className="font-medium">Este Orquestrador tem uma instrução antiga em texto livre, sem campos cadastrados.</p>
          <p>Ela continua sendo enviada à IA até você montar o resultado estruturado abaixo. Texto atual:</p>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-background/60 p-2 font-mono text-[11px] text-foreground">{legacyInstructions}</pre>
        </div>
      ) : null}

      {!enabled ? (
        <div className="space-y-2 rounded-md border border-dashed p-3">
          <p className="text-sm text-muted-foreground">Este Orquestrador retorna apenas texto livre.</p>
          {!isEmpty ? <p className="text-xs text-muted-foreground">{totalFields} campo(s) configurado(s) serão ignorados enquanto o resultado estruturado estiver desligado.</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => addNode(null, "FIELD")}>
              <Plus className="h-3.5 w-3.5" /> Adicionar campo
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => addNode(null, "GROUP")}>
              <Plus className="h-3.5 w-3.5" /> Adicionar grupo
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-2 rounded-md border bg-muted/40 p-2.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>Você não precisa escrever JSON. Adicione os campos que deseja obter e a INIA gera o formato técnico automaticamente.</p>
          </div>

          {isEmpty ? (
            <div className="space-y-2 rounded-md border border-dashed p-3">
              <p className="text-sm">Quais informações você quer que este Orquestrador produza?</p>
              <p className="text-xs text-muted-foreground">Comece com um campo (ex.: Assunto, Severidade, Requer acompanhamento) ou um grupo para organizar informações relacionadas (ex.: Diagnóstico, Cliente, Próxima ação).</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => addNode(null, "FIELD")}>
                  <Plus className="h-3.5 w-3.5" /> Adicionar campo
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => addNode(null, "GROUP")}>
                  <Plus className="h-3.5 w-3.5" /> Adicionar grupo
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-1" role="tree" aria-label="Resultado estruturado">
              {nodes.map((node, index) => (
                <NodeRow
                  key={node.uid}
                  node={node}
                  depth={0}
                  index={index}
                  siblingsCount={nodes.length}
                  selectedUid={selectedUid}
                  collapsedGroups={collapsedGroups}
                  paths={paths}
                  issues={issues}
                  usageForUid={usageForUid}
                  onSelect={(uid) => setSelectedUid((current) => (current === uid ? null : uid))}
                  onToggleCollapse={(uid) =>
                    setCollapsedGroups((current) => {
                      const next = new Set(current)
                      if (next.has(uid)) next.delete(uid)
                      else next.add(uid)
                      return next
                    })
                  }
                  onUpdate={(uid, updater) => setNodes((current) => updateNode(current, uid, updater))}
                  onMove={(uid, direction) => setNodes((current) => moveNode(current, uid, direction))}
                  onDuplicate={(uid) => setNodes((current) => duplicateNode(current, uid))}
                  onDelete={requestDelete}
                  onAdd={addNode}
                />
              ))}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button type="button" variant="outline" size="sm" aria-label="Adicionar campo na raiz" onClick={() => addNode(null, "FIELD")}>
                  <Plus className="h-3.5 w-3.5" /> Campo
                </Button>
                <Button type="button" variant="outline" size="sm" aria-label="Adicionar grupo na raiz" onClick={() => addNode(null, "GROUP")}>
                  <Plus className="h-3.5 w-3.5" /> Grupo
                </Button>
              </div>
            </div>
          )}

          {issues.some((issue) => issue.nodePath === "") && !isEmpty ? (
            <p className="text-xs text-destructive" role="alert">
              {issues.filter((issue) => issue.nodePath === "").map((issue) => issue.message).join(" ")}
            </p>
          ) : null}

          {!isEmpty ? (
            <div className="space-y-2">
              <Collapsible open={previewOpen} onOpenChange={setPreviewOpen}>
                <CollapsibleTrigger asChild>
                  <button type="button" className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/50">
                    {previewOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <Eye className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">Prévia do resultado</span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-1.5 px-1 pt-2">
                  <p className="text-xs text-muted-foreground">Esta é uma prévia do formato que o Orquestrador deverá devolver. Os valores reais serão preenchidos pela IA durante a execução.</p>
                  <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs" data-testid="structured-output-preview">
                    {JSON.stringify(buildStructuredOutputPreview(definition), null, 2)}
                  </pre>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible open={workflowOpen} onOpenChange={setWorkflowOpen}>
                <CollapsibleTrigger asChild>
                  <button type="button" className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/50">
                    {workflowOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <Workflow className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">Disponível no Workflow</span>
                    <Badge variant="secondary" className="ml-auto">
                      {totalFields}
                    </Badge>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-1.5 px-1 pt-2">
                  <p className="text-xs text-muted-foreground">É assim que estes dados aparecerão para quem configurar uma Condição ou um Output no Workflow Builder.</p>
                  <ul className="space-y-1" data-testid="structured-output-workflow-fields">
                    {fields.map((field) => (
                      <li key={field.path} className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-md border px-2.5 py-1.5 text-sm">
                        <span>{field.label}</span>
                        <span className="text-xs text-muted-foreground">{STRUCTURED_OUTPUT_FIELD_TYPE_LABELS[field.fieldType ?? "STRING"]}</span>
                      </li>
                    ))}
                  </ul>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible open={technicalOpen} onOpenChange={setTechnicalOpen}>
                <CollapsibleTrigger asChild>
                  <button type="button" className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/50">
                    {technicalOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <Code2 className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">Visualizar formato técnico</span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 px-1 pt-2">
                  <div className="space-y-1">
                    <p className="text-xs font-medium">Caminhos técnicos</p>
                    <ul className="space-y-0.5 font-mono text-xs text-muted-foreground" data-testid="structured-output-paths">
                      {fields.map((field) => (
                        <li key={field.path}>{field.path}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium">Schema gerado (JSON Schema)</p>
                    <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-[11px]">{JSON.stringify(buildStructuredOutputJsonSchema(definition), null, 2)}</pre>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium">Instrução enviada à IA</p>
                    {savedInstructions ? (
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-[11px]">{savedInstructions}</pre>
                    ) : (
                      <p className="text-xs text-muted-foreground">Gerada automaticamente ao salvar.</p>
                    )}
                    {savedInstructions ? <p className="text-[11px] text-muted-foreground">Gerada na última gravação — edições ainda não salvas não aparecem aqui.</p> : null}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          ) : null}
        </>
      )}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {pendingDelete?.kind === "GROUP" ? "o grupo" : "o campo"} {pendingDelete?.label.trim() || pendingDelete?.key || "(sem nome)"}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {pendingDelete?.kind === "GROUP" && pendingDelete.children.length > 0 ? (
                  <p>
                    Este grupo possui {countStructuredFields(toDefinition([pendingDelete]).nodes[0]!)} campo(s). Excluir o grupo também removerá esses campos.
                  </p>
                ) : null}
                {pendingDelete && usageForUid(pendingDelete.uid).length > 0 ? (
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">Este dado é usado em Workflows:</p>
                    <ul className="list-disc pl-5">
                      {usageForUid(pendingDelete.uid).map((entry) => (
                        <li key={`${entry.workflowId}-${entry.nodeId}-${entry.path}`}>
                          {entry.workflowName} ({entry.published ? "publicado" : "rascunho"}) › {entry.nodeLabel} — {entry.path}
                        </li>
                      ))}
                    </ul>
                    <p>Ao salvar, a INIA bloqueia a alteração se um Workflow publicado depender deste dado e pede confirmação se for só um rascunho.</p>
                  </div>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingDelete && confirmDelete(pendingDelete)}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/* ------------------------------------------------------------------------------------------ */
/* Linha da árvore + formulário inline do item selecionado                                     */
/* ------------------------------------------------------------------------------------------ */

type NodeRowProps = {
  node: EditorNode
  depth: number
  index: number
  siblingsCount: number
  selectedUid: string | null
  collapsedGroups: Set<string>
  paths: Map<string, { path: string; depth: number; parentLabel: string | null }>
  issues: StructuredOutputIssue[]
  usageForUid: (uid: string) => StructuredOutputUsage[]
  onSelect: (uid: string) => void
  onToggleCollapse: (uid: string) => void
  onUpdate: (uid: string, updater: (node: EditorNode) => EditorNode) => void
  onMove: (uid: string, direction: -1 | 1) => void
  onDuplicate: (uid: string) => void
  onDelete: (node: EditorNode) => void
  onAdd: (parentUid: string | null, kind: "FIELD" | "GROUP") => void
}

function NodeRow(props: NodeRowProps) {
  const { node, depth, index, siblingsCount, selectedUid, collapsedGroups, paths, issues, usageForUid, onSelect, onToggleCollapse, onUpdate, onMove, onDuplicate, onDelete, onAdd } = props
  const info = paths.get(node.uid)
  const path = info?.path ?? ""
  const nodeIssues = issues.filter((issue) => issue.nodePath === path && path !== "")
  const used = usageForUid(node.uid)
  const selected = selectedUid === node.uid
  const collapsed = collapsedGroups.has(node.uid)
  const Icon = node.kind === "GROUP" ? FolderOpen : TYPE_ICONS[node.type]
  const displayLabel = node.label.trim() || "(sem nome)"
  const summary = node.kind === "GROUP" ? `Grupo · ${countStructuredFields(toDefinition([node]).nodes[0]!)} campo(s)` : describeStructuredField(toDefinition([node]).nodes[0]! as Extract<StructuredOutputNode, { kind: "FIELD" }>)
  const canNestGroup = node.kind === "GROUP" && (info?.depth ?? 1) < STRUCTURED_OUTPUT_MAX_DEPTH - 1

  return (
    <div className="space-y-1" role="treeitem" aria-selected={selected} aria-label={displayLabel} data-testid={`structured-node-${path || node.uid}`}>
      <div className={cn("group rounded-md border px-2 py-1.5", selected && "border-primary bg-primary/5", nodeIssues.length > 0 && !selected && "border-destructive/60")} style={{ marginLeft: depth * 14 }}>
        <div className="flex items-start gap-1">
          {node.kind === "GROUP" ? (
            <button type="button" className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted" aria-label={collapsed ? "Expandir grupo" : "Recolher grupo"} onClick={() => onToggleCollapse(node.uid)}>
              {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <span className="w-[22px] shrink-0" />
          )}
          <button type="button" className="flex min-w-0 flex-1 items-start gap-2 text-left" onClick={() => onSelect(node.uid)} aria-expanded={selected} aria-label={`Editar ${displayLabel}`} title={displayLabel}>
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{displayLabel}</span>
          </button>
          {used.length > 0 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="mt-0.5 shrink-0 gap-1 text-[10px]">
                  <Workflow className="h-3 w-3" /> {used.length}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                Usado em: {[...new Set(used.map((entry) => `${entry.workflowName} (${entry.published ? "publicado" : "rascunho"})`))].join(", ")}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        {/* Segunda linha: resumo + ações compactas (o rótulo fica com a largura toda em painéis
            estreitos). As ações ficam sempre visíveis — nada escondido atrás de hover. */}
        <div className="flex items-center justify-between gap-1 pl-[22px]">
          <span className="min-w-0 truncate text-[11px] text-muted-foreground" title={summary}>
            {summary}
          </span>
          <div className="flex shrink-0 items-center">
            <Button type="button" variant="ghost" size="icon" className="h-6 w-6" aria-label="Mover para cima" disabled={index === 0} onClick={() => onMove(node.uid, -1)}>
              <ArrowUp className="h-3 w-3" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-6 w-6" aria-label="Mover para baixo" disabled={index >= siblingsCount - 1} onClick={() => onMove(node.uid, 1)}>
              <ArrowDown className="h-3 w-3" />
            </Button>
            {node.kind === "FIELD" ? (
              <Button type="button" variant="ghost" size="icon" className="h-6 w-6" aria-label="Duplicar campo" onClick={() => onDuplicate(node.uid)}>
                <Copy className="h-3 w-3" />
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-destructive" aria-label={node.kind === "GROUP" ? "Excluir grupo" : "Excluir campo"} onClick={() => onDelete(node)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>

      {nodeIssues.length > 0 && !selected ? (
        <p className="text-xs text-destructive" style={{ marginLeft: depth * 14 + 8 }} role="alert">
          {nodeIssues[0]!.message}
        </p>
      ) : null}

      {selected ? (
        <div className="rounded-md border bg-muted/20 p-3" style={{ marginLeft: depth * 14 }}>
          {node.kind === "GROUP" ? <GroupForm node={node} path={path} parentLabel={info?.parentLabel ?? null} used={used} issues={nodeIssues} onUpdate={onUpdate} /> : <FieldForm node={node} path={path} used={used} issues={nodeIssues} onUpdate={onUpdate} />}
        </div>
      ) : null}

      {node.kind === "GROUP" && !collapsed ? (
        <div className="space-y-1">
          {node.children.map((child, childIndex) => (
            <NodeRow key={child.uid} {...props} node={child} depth={depth + 1} index={childIndex} siblingsCount={node.children.length} />
          ))}
          <div className="flex flex-wrap gap-2" style={{ marginLeft: (depth + 1) * 14 }}>
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" aria-label={`Adicionar campo em ${displayLabel}`} onClick={() => onAdd(node.uid, "FIELD")}>
              <Plus className="h-3 w-3" /> Campo
            </Button>
            {canNestGroup ? (
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" aria-label={`Adicionar grupo em ${displayLabel}`} onClick={() => onAdd(node.uid, "GROUP")}>
                <Plus className="h-3 w-3" /> Grupo
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function KeyField({ node, path, used, onUpdate }: { node: EditorNode; path: string; used: StructuredOutputUsage[]; onUpdate: NodeRowProps["onUpdate"] }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`key-${node.uid}`}>Chave técnica</Label>
      <Input id={`key-${node.uid}`} value={node.key} className="font-mono text-xs" onChange={(event) => onUpdate(node.uid, (current) => ({ ...current, key: event.target.value, keyTouched: true }))} />
      <p className="text-xs text-muted-foreground">
        Identificador interno deste dado. A INIA gera uma sugestão automaticamente. Evite alterar depois que Workflows começarem a usar este campo.
        {path ? (
          <>
            {" "}
            Caminho: <code className="font-mono">{path}</code>
          </>
        ) : null}
      </p>
      {used.length > 0 ? (
        <p className="text-xs text-amber-700 dark:text-amber-300" role="alert">
          Usado em {used.length} referência(s) de Workflow — renomear a chave quebra essas referências.
        </p>
      ) : null}
    </div>
  )
}

function GroupForm({ node, path, parentLabel, used, issues, onUpdate }: { node: EditorGroup; path: string; parentLabel: string | null; used: StructuredOutputUsage[]; issues: StructuredOutputIssue[]; onUpdate: NodeRowProps["onUpdate"] }) {
  const labelRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!node.label) labelRef.current?.focus()
  }, [node.uid]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-3" data-testid="structured-group-form">
      <p className="text-xs text-muted-foreground">Use grupos para organizar informações relacionadas{parentLabel ? ` dentro de ${parentLabel}` : ""}. Exemplos: Diagnóstico, Cliente, Próxima ação.</p>
      <div className="space-y-1.5">
        <Label htmlFor={`label-${node.uid}`}>Nome exibido</Label>
        <Input
          id={`label-${node.uid}`}
          ref={labelRef}
          value={node.label}
          placeholder="Análise"
          onChange={(event) => onUpdate(node.uid, (current) => ({ ...current, label: event.target.value, key: current.keyTouched ? current.key : suggestStructuredOutputKey(event.target.value) }))}
        />
        <p className="text-xs text-muted-foreground">Nome que as pessoas verão na configuração do Workflow.</p>
      </div>
      <KeyField node={node} path={path} used={used} onUpdate={onUpdate} />
      <div className="space-y-1.5">
        <Label htmlFor={`description-${node.uid}`}>Descrição do grupo (opcional)</Label>
        <Textarea id={`description-${node.uid}`} value={node.description} placeholder="Informações resultantes da análise principal da interação." className="min-h-16" onChange={(event) => onUpdate(node.uid, (current) => ({ ...current, description: event.target.value }))} />
      </div>
      {issues.length > 0 ? (
        <ul className="space-y-0.5 text-xs text-destructive" role="alert">
          {issues.map((issue, index) => (
            <li key={index}>{issue.message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function FieldForm({ node, path, used, issues, onUpdate }: { node: EditorField; path: string; used: StructuredOutputUsage[]; issues: StructuredOutputIssue[]; onUpdate: NodeRowProps["onUpdate"] }) {
  const labelRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!node.label) labelRef.current?.focus()
  }, [node.uid]) // eslint-disable-line react-hooks/exhaustive-deps
  const update = (patch: Partial<EditorField>) => onUpdate(node.uid, (current) => ({ ...(current as EditorField), ...patch }))

  return (
    <div className="space-y-3" data-testid="structured-field-form">
      <div className="space-y-1.5">
        <Label htmlFor={`label-${node.uid}`}>Nome exibido</Label>
        <Input
          id={`label-${node.uid}`}
          ref={labelRef}
          value={node.label}
          placeholder="Assunto"
          onChange={(event) => onUpdate(node.uid, (current) => ({ ...current, label: event.target.value, key: current.keyTouched ? current.key : suggestStructuredOutputKey(event.target.value) }))}
        />
        <p className="text-xs text-muted-foreground">Como este dado aparecerá para quem configurar um Workflow.</p>
      </div>

      <KeyField node={node} path={path} used={used} onUpdate={onUpdate} />

      <div className="space-y-1.5">
        <Label htmlFor={`type-${node.uid}`}>Tipo de dado</Label>
        <Select value={node.type} onValueChange={(value) => update({ type: value as StructuredOutputFieldType, options: value === "ENUM" ? node.options : [] })}>
          <SelectTrigger id={`type-${node.uid}`} className="w-full" aria-label="Tipo de dado">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(STRUCTURED_OUTPUT_FIELD_TYPE_LABELS) as StructuredOutputFieldType[]).map((type) => (
              <SelectItem key={type} value={type}>
                {STRUCTURED_OUTPUT_FIELD_TYPE_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Escolha o formato do valor que a IA deverá retornar. {STRUCTURED_OUTPUT_FIELD_TYPE_HINTS[node.type]}</p>
        {used.length > 0 ? <p className="text-xs text-amber-700 dark:text-amber-300">Mudar o tipo de um dado usado em Workflows quebra as comparações já configuradas.</p> : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`description-${node.uid}`}>O que a IA deve identificar?</Label>
        <Textarea
          id={`description-${node.uid}`}
          value={node.description}
          placeholder={
            node.type === "ENUM"
              ? "Classifique a severidade considerando impacto e urgência."
              : node.type === "BOOLEAN"
                ? "Informe Sim quando a interação exigir acompanhamento posterior."
                : "Identifique o principal motivo do contato do cliente em uma frase curta."
          }
          className="min-h-20"
          onChange={(event) => update({ description: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">Explique claramente o que o Orquestrador deve preencher neste campo. Essa instrução será enviada à IA.</p>
      </div>

      {node.type === "STRING" ? (
        <div className="space-y-1.5">
          <Label htmlFor={`example-${node.uid}`}>Exemplo esperado (opcional)</Label>
          <Input id={`example-${node.uid}`} value={node.example} placeholder="Cobrança em duplicidade" onChange={(event) => update({ example: event.target.value })} />
          <p className="text-xs text-muted-foreground">Ajuda a IA e a prévia. Não é um valor fixo.</p>
        </div>
      ) : null}

      {node.type === "NUMBER" ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor={`min-${node.uid}`}>Mínimo (opcional)</Label>
            <Input id={`min-${node.uid}`} type="number" value={node.minimum} placeholder="0" onChange={(event) => update({ minimum: event.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`max-${node.uid}`}>Máximo (opcional)</Label>
            <Input id={`max-${node.uid}`} type="number" value={node.maximum} placeholder="10" onChange={(event) => update({ maximum: event.target.value })} />
          </div>
        </div>
      ) : null}

      {node.type === "ENUM" ? <EnumOptionsEditor node={node} onUpdate={update} used={used} /> : null}

      <div className="flex items-start justify-between gap-3 rounded-md border p-2.5">
        <div className="space-y-0.5">
          <Label htmlFor={`required-${node.uid}`}>Campo obrigatório</Label>
          <p className="text-xs text-muted-foreground">Quando ativado, este dado precisa estar presente para o resultado estruturado ser considerado válido.</p>
        </div>
        <Switch id={`required-${node.uid}`} checked={node.required} onCheckedChange={(checked) => update({ required: checked })} />
      </div>

      {issues.length > 0 ? (
        <ul className="space-y-0.5 text-xs text-destructive" role="alert">
          {issues.map((issue, index) => (
            <li key={index}>{issue.message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function EnumOptionsEditor({ node, onUpdate, used }: { node: EditorField; onUpdate: (patch: Partial<EditorField>) => void; used: StructuredOutputUsage[] }) {
  const [draft, setDraft] = useState("")
  const duplicates = new Set(node.options.map((option) => option.value.trim()).filter((value, index, all) => value && all.indexOf(value) !== index))

  function addOption() {
    const value = draft.trim()
    if (!value) return
    onUpdate({ options: [...node.options, { value, label: "" }] })
    setDraft("")
  }

  return (
    <div className="space-y-2" data-testid="structured-enum-options">
      <div className="space-y-0.5">
        <Label>Valores permitidos</Label>
        <p className="text-xs text-muted-foreground">Valor técnico (ex.: CRITICA) e, se quiser, um rótulo amigável (ex.: Crítica) para o Workflow Builder.</p>
      </div>
      {node.options.length === 0 ? <p className="text-xs text-destructive">Adicione ao menos uma opção.</p> : null}
      <ul className="space-y-1.5">
        {node.options.map((option, index) => (
          <li key={index} className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
            <Input
              value={option.value}
              aria-label={`Valor da opção ${index + 1}`}
              placeholder="ALTA"
              className={cn("min-w-0 flex-1 font-mono text-xs", duplicates.has(option.value.trim()) && "border-destructive")}
              onChange={(event) => onUpdate({ options: node.options.map((item, i) => (i === index ? { ...item, value: event.target.value } : item)) })}
            />
            <Input
              value={option.label}
              aria-label={`Rótulo da opção ${index + 1}`}
              placeholder="Alta (rótulo, opcional)"
              className="min-w-0 flex-1 text-xs"
              onChange={(event) => onUpdate({ options: node.options.map((item, i) => (i === index ? { ...item, label: event.target.value } : item)) })}
            />
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`Remover opção ${option.value || index + 1}`} onClick={() => onUpdate({ options: node.options.filter((_, i) => i !== index) })}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-1.5">
        <Input
          value={draft}
          aria-label="Nova opção"
          placeholder="Nova opção (ex.: CRITICA)"
          className="font-mono text-xs"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              addOption()
            }
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={addOption} disabled={!draft.trim()}>
          <Plus className="h-3.5 w-3.5" /> Adicionar opção
        </Button>
      </div>
      {used.length > 0 ? <p className="text-xs text-amber-700 dark:text-amber-300">Remover uma opção usada por uma Condição de Workflow quebra aquela comparação.</p> : null}
    </div>
  )
}
