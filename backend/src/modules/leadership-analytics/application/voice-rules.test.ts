import { describe, expect, it } from "vitest"
import { LEADERSHIP_ASK_TOOL } from "./leadership-toolset.js"
import { LEADERSHIP_VOICE_RULES } from "./leadership-context.js"
import { SELF_ASK_TOOL, SELF_VOICE_RULES } from "./self-context.js"

/**
 * Regras da VOZ que encaminha (operador: `self_ask`; liderança: `leadership_ask`). Medido no Gemini Live real em 27/10/2026 com a
 * sessão da Larissa: continuações eram respondidas por DEDUÇÃO do que já tinha sido dito ("então com −25 não precisa abrir reparo,
 * né?" → "Exatamente") e uma pergunta de benefício ganhou um valor inventado ("R$ 450,00"), sem consulta. As regras dizem que
 * continuação vai à ferramenta, que nada se deduz nem se confirma sem ela, que política/benefício/valor/prazo também é consulta e que
 * "não tenho acesso"/"vou consultar" sem ter acionado não vale.
 */
describe.each([
  { who: "operador", rules: SELF_VOICE_RULES, tool: SELF_ASK_TOOL },
  { who: "liderança", rules: LEADERSHIP_VOICE_RULES, tool: LEADERSHIP_ASK_TOOL },
])("voz que encaminha — $who", ({ rules, tool }) => {
  it("continuação também vai à ferramenta; nada se deduz nem se confirma sem ela; repetir só o que a ferramenta trouxe", () => {
    expect(rules).toContain(`Continuação também é uma pergunta nova e vai à ferramenta`)
    expect(rules).toContain(`acione ${tool} de novo com a pergunta e o contexto`)
    expect(rules).toContain("Nunca deduza, complete nem confirme")
    expect(rules).toContain("só repita quando a pessoa pedir para repetir, e exatamente o que a ferramenta trouxe")
  })

  it("política, benefício, valor e prazo também são consulta; sem \"não tenho acesso\" nem \"vou consultar\" sem ter acionado", () => {
    expect(rules).toContain("regras e políticas da empresa, benefícios, valores ou prazos")
    expect(rules).toContain("Nunca diga que não tem acesso, que não sabe, que as bases não cobrem o assunto ou que vai consultar sem ter acionado a ferramenta neste turno")
    expect(rules).toContain("valores, prazos, regras ou procedimentos que não vieram da ferramenta")
  })
})
