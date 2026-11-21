import { describe, expect, it } from "vitest"
import { IMAGE_STEP_TEXT_MAX, IMAGE_STEP_TEXT_VERSION, imageStepText } from "../domain/image-step-text.js"
import { IMAGE_STEP_TEXT_CASES, positionOf, type ImageStepExpectation } from "./image-step-text-cases.js"

/**
 * `IMAGE_STEP_TEXT_V1` nos dois lados (run-8, ARQ-06): a cópia do servidor e a do navegador (carregada do código-fonte do frontend, sem
 * cópia) respondem o mesmo caderno. Mudar a regra exige mudar as duas cópias, o caderno e a versão.
 */
type Rule = { imageStepText: (text: string, at: number) => string | null; IMAGE_STEP_TEXT_MAX: number; IMAGE_STEP_TEXT_VERSION: string }

const BROWSER_RULE_URL = new URL("../../../../../frontend/src/lib/knowledge/image-step-text.ts", import.meta.url)

function expectResult(result: string | null, expected: ImageStepExpectation) {
  if (expected === null || typeof expected === "string") return expect(result).toBe(expected)
  expect(result!.length).toBeLessThanOrEqual(expected.maxLength)
  expect(result!.endsWith(expected.endsWith)).toBe(true)
}

describe("texto da base junto de uma imagem — servidor e navegador respondem o mesmo caderno", async () => {
  const browser = (await import(BROWSER_RULE_URL.href)) as Rule
  const sides: [string, Rule][] = [["servidor", { imageStepText, IMAGE_STEP_TEXT_MAX, IMAGE_STEP_TEXT_VERSION }], ["navegador", browser]]

  it("mesma versão e mesmo teto nos dois lados", () => {
    expect(browser.IMAGE_STEP_TEXT_VERSION).toBe(IMAGE_STEP_TEXT_VERSION)
    expect(browser.IMAGE_STEP_TEXT_MAX).toBe(IMAGE_STEP_TEXT_MAX)
  })

  for (const [side, rule] of sides) {
    it.each(IMAGE_STEP_TEXT_CASES)(`${side}: $name`, (testCase) => expectResult(rule.imageStepText(testCase.text, positionOf(testCase)), testCase.expected))
  }
})
