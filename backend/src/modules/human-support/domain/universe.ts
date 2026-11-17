import type { OperatingUniverse } from "../../operating-universe/domain/operating-universe.js"

/**
 * UNIVERSO DE ATUAÇÃO NO APOIO COM ANJO (B2B, B2C e B2X são universos separados — `docs/dev/memoria/universo-de-atuacao.md`). Só vale
 * com a exigência ativada na organização; desligada, nada muda. O universo do pedido é o do OPERADOR no cadastro (`people.
 * operating_universe`), lido do banco a cada decisão — não há carimbo no pedido.
 *
 * Anjo: atende o operador do MESMO universo, ou qualquer um se tiver `operating_universes.all` num escopo que cubra o lugar do pedido
 * (organização, o Grupo ou o Subgrupo dele). Operador ou Anjo pendente (sem universo) só se encontram pela permissão de todos.
 */
export type AnjoUniverseInput = {
  enforced: boolean
  operatorUniverse: OperatingUniverse | null
  anjoUniverse: OperatingUniverse | null
  /** O Anjo tem `operating_universes.all` num escopo que cobre o Grupo/Subgrupo do pedido. */
  anjoAllUniversesOnPlace: boolean
}

export function anjoServesOperatorUniverse(input: AnjoUniverseInput): boolean {
  if (!input.enforced) return true
  if (input.anjoAllUniversesOnPlace) return true
  return input.operatorUniverse !== null && input.anjoUniverse === input.operatorUniverse
}

