/**
 * CADERNO ÚNICO da regra `IMAGE_STEP_TEXT_V1` (o texto da base junto de uma imagem). O servidor calcula para o chat
 * (`knowledge/domain/image-step-text.ts`); o navegador, para a leitura e "O que a IA lê" sobre o texto que está na tela, inclusive o do
 * rascunho (`frontend/src/lib/knowledge/image-step-text.ts`). As duas cópias respondem estes casos em `image-step-text.parity.test.ts`
 * (run-8, ARQ-06): antes, cada lado tinha os próprios testes copiados e uma correção num lado só passava verde nos dois.
 */
export type ImageStepPosition = number | { afterText: string }
export type ImageStepExpectation = string | null | { maxLength: number; endsWith: string }
export type ImageStepCase = { name: string; text: string; at: ImageStepPosition; expected: ImageStepExpectation }

const longText = `${"palavra ".repeat(120)}fim.`

export const IMAGE_STEP_TEXT_CASES: readonly ImageStepCase[] = [
  { name: "print entre dois passos: o passo que ele ilustra é o item de lista que termina ali", text: "## Abertura\n1. Acesse o portal.\n2. Clique em **Novo chamado**.\n3. Preencha o CPF.", at: { afterText: "chamado**." }, expected: "2. Clique em Novo chamado." },
  { name: "parágrafo de várias linhas antes da imagem vem inteiro", text: "Introdução.\n\nNa tela de cadastro,\nconfira o endereço do cliente.\n\nOutro parágrafo.", at: { afterText: "cliente." }, expected: "Na tela de cadastro, confira o endereço do cliente." },
  { name: "item de lista com linha de continuação vem com ela", text: "- Abra a ficha\n  e vá à aba Contrato.\n- Salve.", at: { afterText: "Contrato." }, expected: "- Abra a ficha e vá à aba Contrato." },
  { name: "logo depois do título, vale o texto seguinte (a legenda ou o passo)", text: "## Tela de consulta\nFigura 2: tela de consulta do protocolo.\n\nDepois, confirme.", at: { afterText: "consulta" }, expected: "Figura 2: tela de consulta do protocolo." },
  { name: "no começo do texto, vale o primeiro bloco depois", text: "Selecione o motivo.\n1. Outro passo.", at: 0, expected: "Selecione o motivo." },
  { name: "depois de uma tabela, o passo não é uma linha da tabela", text: "| Campo | Valor |\n| --- | --- |\n| CPF | 123 |\n\nConfira os dados.", at: { afterText: "| CPF | 123 |" }, expected: "Confira os dados." },
  { name: "texto vazio: nada (a tela não inventa descrição)", text: "", at: 0, expected: null },
  { name: "só o título: nada", text: "## Só o título", at: 14, expected: null },
  { name: "entre dois títulos: nada", text: "## Título\n\n## Outro título", at: 9, expected: null },
  { name: "texto longo é cortado numa palavra, com reticências", text: longText, at: longText.length, expected: { maxLength: 400, endsWith: "palavra…" } },
  { name: "posição no meio de uma linha vale o fim dela", text: "1. Clique em Enviar.\n2. Aguarde.", at: 4, expected: "1. Clique em Enviar." },
  { name: "posição depois do fim vale a última borda", text: "1. Clique em Enviar.\n2. Aguarde.", at: 999, expected: "2. Aguarde." },
  { name: "posição antes do começo vale a primeira borda", text: "1. Clique em Enviar.\n2. Aguarde.", at: -5, expected: "1. Clique em Enviar." },
]

/** Posição do caso no texto (logo depois do trecho indicado, como `placeImages` põe a imagem no fim da linha). */
export const positionOf = (testCase: ImageStepCase) => (typeof testCase.at === "number" ? testCase.at : testCase.text.indexOf(testCase.at.afterText) + testCase.at.afterText.length)
