import manifest from "./demo-shots.json"
import type { DemoShot } from "./demo-types"

/**
 * Os prints das demonstrações. `demo-shots.json` é gerado por `docs/dev/wiki-capturas/capturar.mjs`, que abre o editor real com a API
 * simulada e dados fictícios, tira a imagem e calcula as marcações pelos próprios campos da tela. Não edite o JSON à mão.
 */
export const DEMO_SHOTS: Record<string, DemoShot> = manifest as Record<string, DemoShot>
