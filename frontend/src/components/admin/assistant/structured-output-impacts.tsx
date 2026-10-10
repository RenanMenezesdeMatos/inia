"use client"

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

export type StructuredOutputImpact = {
  workflowId: string
  workflowName: string
  published: boolean
  nodeId: string
  nodeLabel: string
  path: string
  change:
    | { kind: "REMOVED"; path: string }
    | { kind: "TYPE_CHANGED"; path: string; from: string; to: string }
    | { kind: "ENUM_OPTION_REMOVED"; path: string; values: string[] }
    | { kind: "REQUIRED_ADDED"; path: string }
    | { kind: "RANGE_NARROWED"; path: string; from: { minimum?: number; maximum?: number }; to: { minimum?: number; maximum?: number } }
}

export type StructuredOutputImpactDetails = { message: string; impacts: StructuredOutputImpact[] }

function describeChange(impact: StructuredOutputImpact): string {
  switch (impact.change.kind) {
    case "REMOVED":
      return "deixaria de existir"
    case "TYPE_CHANGED":
      return "mudaria de tipo"
    case "ENUM_OPTION_REMOVED":
      return `perderia a(s) opção(ões) ${impact.change.values.join(", ")}`
    case "REQUIRED_ADDED":
      return `depende do resultado, e "${impact.change.path}" passaria a ser obrigatório (respostas sem ele ficariam inválidas por inteiro)`
    case "RANGE_NARROWED":
      return `depende do resultado, e a faixa de "${impact.change.path}" ficaria mais estreita (valores antes aceitos invalidariam o resultado por inteiro)`
  }
}

/**
 * Confirmação forte (Parte Z do construtor visual): o backend recusou a gravação porque a
 * mudança no resultado estruturado afeta Workflows em RASCUNHO (409 STRUCTURED_OUTPUT_IN_USE_DRAFT).
 * Publicado nunca chega aqui — é bloqueio sem alternativa (STRUCTURED_OUTPUT_IN_USE_PUBLISHED).
 */
export function StructuredOutputImpactDialog({ details, pending, onCancel, onConfirm }: { details: StructuredOutputImpactDetails | null; pending: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <AlertDialog open={details !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent data-testid="structured-output-impact-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Esta alteração afeta Workflows em rascunho</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>Os rascunhos abaixo usam dados que deixariam de existir ou mudariam. Eles precisarão ser ajustados antes de publicar.</p>
              <ul className="list-disc space-y-1 pl-5">
                {(details?.impacts ?? []).map((impact) => (
                  <li key={`${impact.workflowId}-${impact.nodeId}-${impact.path}`}>
                    <span className="font-medium text-foreground">{impact.workflowName}</span> › {impact.nodeLabel}: <code className="font-mono text-xs">{impact.path}</code> {describeChange(impact)}.
                  </li>
                ))}
              </ul>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={onConfirm}>
            Salvar mesmo assim
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
