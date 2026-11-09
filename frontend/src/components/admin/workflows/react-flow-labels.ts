import type { AriaLabelConfig } from "@xyflow/react"

/** Textos internos do React Flow em português: controles do canvas e instruções lidas por tecnologia assistiva (WCAG 3.1.2). */
const DIRECTIONS: Record<string, string> = { up: "cima", down: "baixo", left: "a esquerda", right: "a direita" }

export const REACT_FLOW_ARIA_LABELS_PT_BR: Partial<AriaLabelConfig> = {
  "node.a11yDescription.default": "Pressione Enter ou Espaço para selecionar a etapa e Enter de novo para abrir a configuração. Use as setas para movê-la, Delete para removê-la e Esc para cancelar.",
  "node.a11yDescription.keyboardDisabled": "Pressione Enter ou Espaço para selecionar a etapa. Delete remove e Esc cancela.",
  "node.a11yDescription.ariaLiveMessage": ({ direction, x, y }) => `Etapa movida para ${DIRECTIONS[direction] ?? direction}. Posição: x ${x}, y ${y}.`,
  "edge.a11yDescription.default": "Pressione Enter ou Espaço para selecionar a ligação. Delete remove e Esc cancela.",
  "controls.ariaLabel": "Controles do canvas",
  "controls.zoomIn.ariaLabel": "Aproximar",
  "controls.zoomOut.ariaLabel": "Afastar",
  "controls.fitView.ariaLabel": "Ajustar à tela",
  "controls.interactive.ariaLabel": "Travar ou destravar a edição do canvas",
  "minimap.ariaLabel": "Minimapa do fluxo",
  "handle.ariaLabel": "Ponto de ligação",
}
