import { describe, expect, it } from "vitest"
import { normalizeForSpeech, tokenizeForSpeech } from "./normalize"

describe("normalizeForSpeech", () => {
  it.each([
    // Cardinais, decimais, ordinais.
    ["Em 2026 temos 1.234 casos.", "em dois mil e vinte e seis temos mil duzentos e trinta e quatro casos."],
    ["O valor é 3,5 e 0,25.", "o valor é três vírgula cinco e zero vírgula vinte e cinco."],
    ["Ficou em 1º lugar e na 2ª posição.", "ficou em primeiro lugar e na segunda posição."],
    ["É o 21º dia.", "é o vigésimo primeiro dia."],
    ["São 1.000.001 e 2.500.", "são um milhão e um e dois mil e quinhentos."],
    ["-5 graus", "menos cinco graus"],
    // Concordância de gênero com o substantivo seguinte (também através de "mil").
    ["Tenho 2 horas, 1 hora e 21 pessoas.", "tenho duas horas, uma hora e vinte e uma pessoas."],
    ["Foram 2 mil vendas e 2 mil clientes.", "foram duas mil vendas e dois mil clientes."],
    ["São 200 pessoas e 2 problemas.", "são duzentas pessoas e dois problemas."],
    // Horas.
    ["Chegue às 8h30, ou 8:30, às 8h.", "chegue às oito e trinta, ou oito e trinta, às oito horas."],
    ["Começa 1h e acaba 12h30.", "começa uma hora e acaba doze e trinta."],
    ["Foram 8h30min.", "foram oito horas e trinta minutos."],
    ["Às 12:00h.", "às doze horas."],
    // Dinheiro.
    ["Custa R$ 10,50 hoje.", "custa dez reais e cinquenta centavos hoje."],
    ["Só R$10, R$ 1,00 e R$ 0,50.", "só dez reais, um real e cinquenta centavos."],
    ["R$ 1.234,56", "mil duzentos e trinta e quatro reais e cinquenta e seis centavos"],
    ["R$ 2 mil e R$ 2 milhões.", "dois mil reais e dois milhões de reais."],
    ["US$ 5 ou € 20", "cinco dólares ou vinte euros"],
    // Porcentagem, vezes, unidades.
    ["Subiu 15% e 2,5 %.", "subiu quinze por cento e dois vírgula cinco por cento."],
    ["100% certo", "cem por cento certo"],
    ["Faça 3x por semana.", "faça três vezes por semana."],
    ["Corri 10km em 30min.", "corri dez quilômetros em trinta minutos."],
    // Abreviações: o ponto da abreviação não é fim de frase.
    ["O Sr. Silva e a Sra. Lima falaram com o Dr. Paulo etc. e tal.", "o senhor silva e a senhora lima falaram com o doutor paulo etcétera, e tal."],
    ["Veja o nº 5 na pág. 2.", "veja o número cinco na página dois."],
    ["vc sabia?", "você sabia?"],
    // Siglas: lidas como palavra (INIA) × soletradas (≤ 4 letras desconhecidas).
    ["A INIA mede o TMA e o NPS.", "a inia mede o tê eme á e o ene pê ésse."],
    ["O CEP, a ONG e o SAC.", "o cép, a ong e o sac."],
    ["O KPI e a TI.", "o cá pê i e a tê i."],
    ["Isso é B2B e 4G.", "isso é bê dois bê e quatro gê."],
    // Maiúsculas de ênfase não são siglas.
    ["VOCÊ CONSEGUE! MUITO BEM, HOJE.", "você consegue! muito bem, hoje."],
    // Emoji, Markdown, URLs e e-mails não são falados.
    ["Olá 👋🏽 **muito** bem! Veja https://inia.ai/x e _isso_.", "olá muito bem! veja e isso."],
    ["Use o [link](https://x.com) agora.", "use o link agora."],
    ["Escreva para fale@inia.ai ou www.inia.com.br hoje", "escreva para ou hoje"],
    ["`código` e ~~riscado~~ 🎉", "código e riscado"],
    // Estrangeirismos ficam para o léxico do G2P.
    ["Mande um e-mail pelo WhatsApp.", "mande um e-mail pelo whatsapp."],
    // Separadores dentro do token.
    ["e/ou a+b Olá,Mundo", "e ou a mais bê olá mundo"],
    ["Nota 9,5/10", "nota nove vírgula cinco dez"],
    // Datas.
    ["Dia 24/09/2026 às 14h15.", "dia vinte e quatro de setembro de dois mil e vinte e seis às catorze e quinze."],
    // Pausas: travessão, reticências, quebras de linha de listas e títulos.
    ["Ele disse... bem — talvez.", "ele disse... bem, talvez."],
    ["- item um\n- item dois", "item um, item dois"],
    ["Olá!\n\n### Título\n1. Primeiro passo", "olá! título, primeiro passo"],
    ["Parágrafo um\n\nParágrafo dois", "parágrafo um. parágrafo dois"],
  ])("%j → %j", (input, expected) => {
    expect(normalizeForSpeech(input)).toBe(expected)
  })

  it("texto sem nada falável vira string vazia", () => {
    expect(normalizeForSpeech("")).toBe("")
    expect(normalizeForSpeech("... 🎉 —")).toBe("")
  })
})

describe("tokenizeForSpeech", () => {
  it("guarda pausa, pergunta e a inicial falada da próxima palavra (sândi)", () => {
    const { tokens } = tokenizeForSpeech("Olá! Tudo bem? Sim, os 2 amigos e o TMA.")
    expect(tokens.map((token) => [token.text, token.pauseAfter, token.questionEnd, token.nextInitial])).toEqual([
      ["Olá", "long", false, null],
      ["Tudo", "none", false, "b"],
      ["bem", "long", true, null],
      ["Sim", "short", false, null],
      ["os", "none", false, "d"], // "2" = "dois"
      ["2", "none", false, "a"],
      ["amigos", "none", false, "e"],
      ["e", "none", false, "o"],
      ["o", "none", false, "t"], // "TMA" = "tê eme á"
      ["TMA", "long", false, null],
    ])
  })

  it("posições apontam para o texto original, incluindo a pontuação", () => {
    const text = "Custa R$ 10,50, ok?"
    const { tokens } = tokenizeForSpeech(text)
    expect(tokens.map((token) => text.slice(token.start, token.end))).toEqual(["Custa", "R$ 10,50,", "ok?"])
    expect(tokens[1].words).toEqual(["dez", "reais", "e", "cinquenta", "centavos"])
  })

  it("modo incremental: devolve só o que está completo e diz até onde consumiu", () => {
    const partial = tokenizeForSpeech("Vamos juntos rev", { final: false })
    expect(partial.tokens.map((token) => token.text)).toEqual(["Vamos", "juntos"])
    expect(partial.consumed).toBe("Vamos juntos ".length)
    // Pontuação inequívoca fecha o token; vírgula depois de dígito pode ser decimal.
    expect(tokenizeForSpeech("mentora.", { final: false }).tokens).toHaveLength(1)
    expect(tokenizeForSpeech("custa 10,", { final: false }).tokens.map((token) => token.text)).toEqual(["custa"])
    // Abreviação: o ponto pode ser só da abreviação ("Sr." + " Silva").
    expect(tokenizeForSpeech("o Sr.", { final: false }).tokens.map((token) => token.text)).toEqual(["o"])
    // Palavra com -s final espera a inicial da seguinte; sem -s, basta a primeira letra.
    expect(tokenizeForSpeech("os ", { final: false }).tokens).toEqual([])
    expect(tokenizeForSpeech("os a", { final: false }).tokens.map((token) => token.nextInitial)).toEqual(["a"])
    expect(tokenizeForSpeech("os 1", { final: false }).tokens).toEqual([])
    expect(tokenizeForSpeech("os 13 ", { final: false }).tokens.map((token) => token.nextInitial)).toEqual(["t"])
  })

  it("marcadores de lista e títulos Markdown no início da linha não são falados", () => {
    const { tokens } = tokenizeForSpeech("## Passos\n1. Ouvir\n2) Revisar\n* Agir\n> Nota")
    expect(tokens.map((token) => token.words.join(" "))).toEqual(["passos", "ouvir", "revisar", "agir", "nota"])
    expect(tokens.map((token) => token.pauseAfter)).toEqual(["short", "short", "short", "short", "none"])
  })
})
