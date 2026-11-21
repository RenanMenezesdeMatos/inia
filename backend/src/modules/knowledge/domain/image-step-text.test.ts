import { describe, expect, it } from "vitest"

import { IMAGE_STEP_TEXT_MAX, imageStepText } from "./image-step-text.js"

/** Os mesmos casos estão em `frontend/src/lib/knowledge/image-step-text.test.ts`: as duas cópias da regra não podem divergir. */
const at = (text: string, marker: string) => text.indexOf(marker) + marker.length

describe("texto da base junto de uma imagem (IMAGE_STEP_TEXT_V1)", () => {
  it("print entre dois passos: o passo que ele ilustra é o item de lista que termina ali", () => {
    const text = "## Abertura\n1. Acesse o portal.\n2. Clique em **Novo chamado**.\n3. Preencha o CPF."
    expect(imageStepText(text, at(text, "chamado**."))).toBe("2. Clique em Novo chamado.")
  })

  it("parágrafo de várias linhas antes da imagem vem inteiro", () => {
    const text = "Introdução.\n\nNa tela de cadastro,\nconfira o endereço do cliente.\n\nOutro parágrafo."
    expect(imageStepText(text, at(text, "cliente."))).toBe("Na tela de cadastro, confira o endereço do cliente.")
  })

  it("item de lista com linha de continuação vem com ela", () => {
    const text = "- Abra a ficha\n  e vá à aba Contrato.\n- Salve."
    expect(imageStepText(text, at(text, "Contrato."))).toBe("- Abra a ficha e vá à aba Contrato.")
  })

  it("logo depois do título, vale o texto seguinte (a legenda ou o passo)", () => {
    const text = "## Tela de consulta\nFigura 2: tela de consulta do protocolo.\n\nDepois, confirme."
    expect(imageStepText(text, at(text, "consulta"))).toBe("Figura 2: tela de consulta do protocolo.")
  })

  it("no começo do texto, vale o primeiro bloco depois", () => {
    expect(imageStepText("Selecione o motivo.\n1. Outro passo.", 0)).toBe("Selecione o motivo.")
  })

  it("depois de uma tabela, o passo não é uma linha da tabela", () => {
    const text = "| Campo | Valor |\n| --- | --- |\n| CPF | 123 |\n\nConfira os dados."
    expect(imageStepText(text, at(text, "| CPF | 123 |"))).toBe("Confira os dados.")
  })

  it("sem texto por perto, nada: a tela não inventa descrição", () => {
    expect(imageStepText("", 0)).toBeNull()
    expect(imageStepText("## Só o título", 14)).toBeNull()
    expect(imageStepText("## Título\n\n## Outro título", 9)).toBeNull()
  })

  it("texto longo é cortado numa palavra, com reticências", () => {
    const text = `${"palavra ".repeat(120)}fim.`
    const result = imageStepText(text, text.length)!
    expect(result.length).toBeLessThanOrEqual(IMAGE_STEP_TEXT_MAX)
    expect(result.endsWith("palavra…")).toBe(true)
  })

  it("posição no meio de uma linha vale o fim dela; posição fora do texto vale a borda", () => {
    const text = "1. Clique em Enviar.\n2. Aguarde."
    expect(imageStepText(text, 4)).toBe("1. Clique em Enviar.")
    expect(imageStepText(text, 999)).toBe("2. Aguarde.")
    expect(imageStepText(text, -5)).toBe("1. Clique em Enviar.")
  })
})
