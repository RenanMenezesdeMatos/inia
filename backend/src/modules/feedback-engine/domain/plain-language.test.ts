import { describe, expect, it } from "vitest"
import { COMPOSITION_SYSTEM_PROMPT, VERIFICATION_SYSTEM_PROMPT } from "./composition-prompt.js"
import { readabilityOf } from "./readability.js"

/**
 * `PLAIN_LANGUAGE_V1` (21/10/2026). O retorno precisa ser fácil de ler, mas isso nunca muda regras de agentes, base de conhecimento,
 * argumentários, trechos literais nem as sugestões de como falar. Uma seção de linguagem simples no redator foi avaliada em 3 ensaios e
 * retirada (as falas literais da chamada sumiam e a leitura não melhorou). Ficaram: o verificador recusa a paráfrase que troca a ação ou
 * um termo da operação escrito na regra, e a medida de leitura do texto entregue (só acompanha; nunca meta nem trava).
 */
describe("linguagem simples: o que ficou", () => {
  it("linguagem simples é um princípio curto do redator — sem seção de estilo, sem número de palavras, termos da operação mantidos", () => {
    expect(COMPOSITION_SYSTEM_PROMPT).not.toContain("LINGUAGEM SIMPLES")
    expect(COMPOSITION_SYSTEM_PROMPT).toContain("Use linguagem simples: ordem direta (quem fez o quê), frases curtas com uma ideia cada e palavras do dia a dia")
    expect(COMPOSITION_SYSTEM_PROMPT).toContain("os termos da operação (documentos, dados, papéis, setores, produtos) ficam como a regra escreve")
    expect(COMPOSITION_SYSTEM_PROMPT).not.toMatch(/\d+\s*palavras/)
  })
  it("o verificador recusa a paráfrase que troca a ação ou um termo da operação escrito na regra", () => {
    expect(VERIFICATION_SYSTEM_PROMPT).toContain("uma paráfrase mais simples que troca a ação da regra (o quê, quem faz, onde) é UNSUPPORTED_ADDITION")
    expect(VERIFICATION_SYSTEM_PROMPT).toContain("e também a que troca um termo da operação escrito na regra")
  })
})

describe("medida de leitura (READABILITY_PT_V1)", () => {
  const formal = "Na etapa seguinte, você solicitou diretamente os dados sem explicar o motivo do procedimento, sendo necessário explicar previamente a necessidade da validação de segurança para a proteção dos dados do titular."
  const simple = "Depois, você pediu o CPF sem dizer o motivo. Antes de pedir os dados, explique que é uma validação de segurança. Ela protege os dados do titular."
  it("texto em frases curtas e palavras do dia a dia mede mais fácil que o mesmo conteúdo em texto formal", () => {
    const hard = readabilityOf(formal)!
    const easy = readabilityOf(simple)!
    expect(hard.sentences).toBe(1)
    expect(easy.sentences).toBe(3)
    expect(easy.wordsPerSentence).toBeLessThan(hard.wordsPerSentence)
    expect(easy.fleschPt).toBeGreaterThan(hard.fleschPt)
  })
  it("negrito e marcadores de lista não contam; cada item de lista é uma frase; texto vazio não mede", () => {
    const measured = readabilityOf("Antes de transferir:\n- **explique o motivo**\n- informe o protocolo")!
    expect(measured).toMatchObject({ version: "READABILITY_PT_V1", sentences: 3, words: 9 })
    expect(readabilityOf("   ")).toBeNull()
    // Frase que termina numa fala citada com a pontuação dela também conta como frase.
    expect(readabilityOf("Você respondeu “Isso não é comigo.” Depois transferiu a ligação.")!.sentences).toBe(2)
  })
})
