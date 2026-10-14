import { describe, expect, it } from "vitest"

import { plainTextOf } from "./plain-text"

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean)

describe("plainTextOf", () => {
  it("negrito no MEIO do parágrafo some sem separar a pontuação (o caso do balão do feedback de TMA)", () => {
    const narrative = "Marina, seu TMA de 01/10 a 07/10 foi de **10min20s**, para meta de **8min30s**. A diferença está na **troca de titularidade**: 12min40s nesse assunto."
    expect(plainTextOf(narrative)).toBe("Marina, seu TMA de 01/10 a 07/10 foi de 10min20s, para meta de 8min30s. A diferença está na troca de titularidade: 12min40s nesse assunto.")
    // Nenhuma palavra a mais nem a menos: o balão revela a fala palavra por palavra no ritmo da voz.
    expect(words(plainTextOf(narrative))).toHaveLength(words(narrative).length)
  })

  it("rótulo em negrito no início do parágrafo e negrito com sublinhados", () => {
    expect(plainTextOf("**O que aconteceu:** você consultou o procedimento em partes.")).toBe("O que aconteceu: você consultou o procedimento em partes.")
    expect(plainTextOf("Foi __bem__ melhor.")).toBe("Foi bem melhor.")
  })

  it("itálico com * e com _, sem mexer em sublinhado no meio de palavra", () => {
    expect(plainTextOf("Confirme o *cenário* antes e _depois_ explique.")).toBe("Confirme o cenário antes e depois explique.")
    expect(plainTextOf("***Atenção***: veja o status HOLD_FOR_QA e o arquivo nota_final.pdf")).toBe("Atenção: veja o status HOLD_FOR_QA e o arquivo nota_final.pdf")
  })

  it("links e imagens ficam só com o texto; endereço solto entre <> fica como texto", () => {
    expect(plainTextOf("Veja [Abrir processo ↗](/materiais/1d000000-0000-4000-8000-000000000001) e [o guia](https://inia.local/x).")).toBe("Veja Abrir processo ↗ e o guia.")
    expect(plainTextOf("![Gráfico do TMA](https://inia.local/g.png) e <https://inia.local/y>")).toBe("Gráfico do TMA e https://inia.local/y")
  })

  it("texto AINDA chegando: marcação sem par no fim não aparece e não muda as palavras de antes", () => {
    expect(plainTextOf("foi de **10min")).toBe("foi de 10min")
    expect(plainTextOf("na **troca de")).toBe("na troca de")
    expect(plainTextOf("veja [Abrir processo](/materiais/1d00")).toBe("veja Abrir processo")
    expect(plainTextOf("e _depois")).toBe("e depois")
  })

  it("títulos, citações, listas, caixas de seleção, tabela, código e tachado", () => {
    const markdown = [
      "## O que ajustar",
      "> Ponto de atenção",
      "- [ ] **Prazo da análise**",
      "* Item com `código`",
      "1. Primeiro passo",
      "",
      "| Indicador | Valor |",
      "|---|---|",
      "| TMA | 514 s |",
      "---",
      "~~antigo~~ novo",
      "```",
      "trecho",
      "```",
    ].join("\n")
    expect(plainTextOf(markdown)).toBe(["O que ajustar", "Ponto de atenção", "Prazo da análise", "Item com código", "1. Primeiro passo", "", "Indicador Valor", "", "TMA 514 s", "", "antigo novo", "trecho"].join("\n"))
  })

  it("texto já limpo (a fala preparada) não muda", () => {
    const speech = "Oi, Marina. Este feedback se refere aos seus resultados do período de 1 de outubro de 2026 a 7 de outubro de 2026. O que aconteceu: você consultou o procedimento em partes — 2 de 5, “Só um momento.”"
    expect(plainTextOf(speech)).toBe(speech)
  })
})
