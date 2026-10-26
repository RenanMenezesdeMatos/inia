/**
 * CENÁRIO "TMA EM REPARO" DA LARISSA MONTEIRO + PRÁTICA DE TMA PLANTADA (22/10/2026, pedido do usuário) — dados FICTÍCIOS.
 *
 * Para ver ponta a ponta um feedback de TMA no assunto Reparo — com as pesquisas por produto (cada chamada é de um produto, e as
 * regras de reparo mudam por produto: teste básico, prazo, visita) — e a boa prática de TMA desse assunto citada no texto.
 *
 * O que grava (ids DETERMINÍSTICOS; `--reset` remove só esses ids):
 *   1. Prática de TMA plantada: 8 operadores "TESTE BP TMA · Operador 01–08" no Subgrupo "Teste boas práticas" do Grupo
 *      B2C · Atendimento Geral, com FECHAMENTO OFICIAL de TMA de setembro/2026 (4 no 1º quartil, 4 fora dele) e 6 chamadas de Reparo
 *      de cada um em setembro, com transcrição. Os do 1º quartil fazem mais um comportamento OPCIONAL: oferecer o resumo do chamado
 *      por SMS (protocolo, prazo e próximo passo) para o cliente não precisar anotar — sem deixar de dizer o protocolo e o prazo;
 *      nas outras chamadas o cliente pede para repetir o protocolo enquanto procura uma caneta. "Pedir desculpas pelo transtorno" é a
 *      isca (igual nos dois). O processo é cumprido igualmente pelos dois grupos (testes do produto e prazo certos). O que a análise
 *      achar é o que foi plantado: prova o fluxo, não é descoberta sobre a operação.
 *      V3 (22/10): o SMS é dito como ALGO A MAIS ("Além disso, também vou te mandar por SMS um resumo…") — na V2 ("assim você não
 *      precisa anotar") a descoberta o descreveu como "dispensando anotação" e a checagem de obrigação leu como troca da fala.
 *      V2 (22/10, depois da 1ª análise): saíram "agrupar numa pergunta só os dados da visita" (contraria "as orientações deverão ser
 *      transmitidas uma etapa por vez" do procedimento de Reparo de Banda Larga — a checagem de obrigação recusou, com razão) e
 *      "antecipar as etapas no início" (sobrepõe "Informar o que será feito" do Jeito Vivo de Atender). As transcrições dos
 *      operadores de teste são reescritas por `--apply`; as da Larissa nunca mudam.
 *   2. Larissa: 5 chamadas de Reparo de base (23/09–09/10, duração normal, processo certo) e 6 chamadas de Reparo em 21/10, depois de
 *      a configuração do cenário TESTE PRODUTOS valer (bases às 18:41 UTC, "Vale para" dos argumentários gerais às 21:22 UTC), uma por
 *      produto (Banda Larga, Linha Móvel, SIP, DDR, IP Dedicado, Colocation), longas, com erros plantados: teste básico do produto
 *      pulado (4 de 6) e prazo diferente do que o produto define (3 de 6). Medição diária de TMA e de Atendimentos de 01–21/10 (alta
 *      em 15–21/10). A medição de 21/10 é a que o Workflow manual de TMA pela medição usa.
 *
 * Nenhuma chamada passa pela ingestão (nenhum Workflow dispara sozinho) e nada aqui roda IA.
 *
 *   npx tsx scripts/dev/larissa-scenario/boas-praticas/tma-reparo.ts            # ensaio (nada gravado)
 *   npx tsx scripts/dev/larissa-scenario/boas-praticas/tma-reparo.ts --apply
 *   npx tsx scripts/dev/larissa-scenario/boas-praticas/tma-reparo.ts --reset    # remove só o que este cenário gravou (pelos ids)
 */
import { createHash } from "node:crypto"
import { pool } from "../../../../src/infrastructure/database/pool.js"

const ORG = "00000000-0000-4000-8000-000000000001"
const LARISSA = "de00ae6a-c8c9-490a-816b-e3cc8cf18986"
const TEAM = "de006e47-4ec0-4b54-8a7e-8bd28f7cc6e0" // B2C · Atendimento Geral
const TEST_SUBTEAM_NAME = "Teste boas práticas"
const SOURCE = "TESTE_BP_TMA"
const PERIOD = "2026-09"
const TARGET = 400
const apply = process.argv.includes("--apply")
const reset = process.argv.includes("--reset")

const idOf = (name: string) => {
  const hex = createHash("sha256").update(`inia-scenario-bp-tma:${name}`).digest("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
// Gerador reproduzível (o mesmo resultado em toda execução).
let seed = 0x5bd1e995
const next = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000)
const pick = <T,>(items: readonly T[]) => items[Math.floor(next() * items.length)]!
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(next() * 10)).join("")
const cnpj = () => `${digits(2)}.${digits(3)}.${digits(3)}/0001-${digits(2)}`
const protocol = () => `2026${digits(8)}`

const CUSTOMERS = ["Patrícia", "Rogério", "Sandra", "Tiago", "Vanessa", "Wagner", "Yasmin", "Otávio", "Lúcia", "Marcos", "Helena", "Fernando"]
const COMPANIES = ["Transportes Serra Azul", "Clínica Bem Viver", "Padaria Trigo Bom", "Contábil Horizonte", "Metalúrgica Forte", "Escola Saber Mais", "Farmácia Vida", "Logística Rápida", "Hotel Mar Calmo", "Gráfica Ponto Certo"]
const STREETS = ["Rua das Acácias", "Avenida Beira Mar", "Rua Barão de Studart", "Avenida Santos Dumont", "Rua Pereira Filgueiras", "Avenida Dom Luís"]

// ---------------------------------------------------------------------------------------------
// 1. Prática de TMA plantada (operadores de teste, setembro)
// ---------------------------------------------------------------------------------------------
type TestProduct = "BANDA_LARGA" | "LINHA_ANALOGICA" | "SIP" | "DDR"
type Behavior = "SMS_SUMMARY" | "APOLOGY"
const OPERATORS = [
  { n: 1, first: "Renata", quartile: "Q1", value: 305 }, { n: 2, first: "Caio", quartile: "Q1", value: 318 },
  { n: 3, first: "Juliana", quartile: "Q1", value: 326 }, { n: 4, first: "Marcelo", quartile: "Q1", value: 340 },
  { n: 5, first: "Priscila", quartile: "Q2", value: 410 }, { n: 6, first: "Otávio", quartile: "Q3", value: 470 },
  { n: 7, first: "Simone", quartile: "Q3", value: 505 }, { n: 8, first: "Rafael", quartile: "Q4", value: 560 },
] as const
const TOP_PRESENCE: Record<Behavior, number[]> = { SMS_SUMMARY: [1, 1, 1, 1, 1, 0], APOLOGY: [1, 0, 1, 0, 1, 0] }
const REF_PRESENCE: Record<Behavior, number[]> = { SMS_SUMMARY: [0, 0, 1, 0, 0, 0], APOLOGY: [0, 1, 0, 1, 0, 1] }
const rotate = (list: number[], by: number) => list.map((_, index) => list[(index + by) % list.length]!)
const TEST_PRODUCTS: TestProduct[] = ["BANDA_LARGA", "LINHA_ANALOGICA", "SIP", "DDR", "BANDA_LARGA", "LINHA_ANALOGICA"]
const SEPTEMBER_DAYS = ["2026-09-02", "2026-09-04", "2026-09-09", "2026-09-11", "2026-09-15", "2026-09-17", "2026-09-22", "2026-09-24", "2026-09-26"]

function testCall(op: string, product: TestProduct, has: Set<Behavior>): string {
  const customer = pick(CUSTOMERS)
  const company = pick(COMPANIES)
  const street = `${pick(STREETS)}, ${digits(3)}`
  const phone = `(85) 9${digits(4)}-${digits(4)}`
  const problem: Record<TestProduct, string> = {
    BANDA_LARGA: "A internet do escritório parou desde cedo.",
    LINHA_ANALOGICA: "A linha fixa da recepção está muda.",
    SIP: "Os ramais do tronco SIP não estão completando ligação.",
    DDR: "Uma parte dos ramais do DDR não recebe chamada.",
  }
  const lines = [
    `Operador: Vivo Empresas, ${pick(["bom dia", "boa tarde"])}, meu nome é ${op}. Com quem eu falo?`,
    `Cliente: Oi, aqui é ${customer}, da ${company}. ${problem[product]}`,
  ]
  lines.push(`Operador: Me confirma o CNPJ da empresa, por favor?`, `Cliente: É ${cnpj()}.`)
  if (product === "BANDA_LARGA") lines.push(`Operador: Obrigado. Desliga o modem da tomada por trinta segundos, liga de novo e me diz como ficaram as luzes?`, `Cliente: Pronto. A luz de internet continua vermelha.`, `Operador: Fiz também o teste remoto aqui e ele falhou. Vou abrir o chamado com visita técnica.`)
  if (product === "LINHA_ANALOGICA") lines.push(`Operador: Obrigado. Tem tom de discagem? Testa o aparelho em outra tomada, por favor.`, `Cliente: Em outra tomada também fica mudo, sem tom.`, `Operador: Então é preciso visita técnica. Vou abrir o chamado.`)
  if (product === "SIP" || product === "DDR") lines.push(...(product === "DDR" ? [`Operador: Qual é a faixa de ramais afetada?`, `Cliente: Do 2100 ao 2150.`] : []), `Operador: Vou fazer o teste remoto do tronco agora.`, `Cliente: Tudo bem.`, `Operador: O teste mostrou falha no tronco. Vou abrir o chamado empresarial.`)
  if (has.has("APOLOGY")) lines.push(`Operador: Peço desculpas pelo transtorno.`)
  const visit = product === "BANDA_LARGA" || product === "LINHA_ANALOGICA"
  lines.push(`Operador: ${visit ? "Qual o endereço onde está o equipamento?" : "Qual o nome do contato técnico?"}`, `Cliente: ${visit ? street : "É o Jorge, da TI"}.`, `Operador: E um telefone de contato?`, `Cliente: ${phone}.`)
  if (visit) lines.push(`Operador: Tem preferência de período?`, `Cliente: Pode ser de manhã.`)
  const deadline: Record<TestProduct, string> = {
    BANDA_LARGA: "O prazo de reparo é de 24 horas.",
    LINHA_ANALOGICA: "O prazo de reparo é de 48 horas, e o técnico vai numa janela de 4 horas no período que você escolheu.",
    SIP: "O prazo de solução é de 4 horas.",
    DDR: "O prazo de solução é de 8 horas.",
  }
  const number = protocol()
  if (has.has("SMS_SUMMARY")) lines.push(`Operador: Chamado aberto. O protocolo é ${number}. ${deadline[product]} Além disso, também vou te mandar por SMS um resumo com o protocolo, o prazo e o próximo passo, para você ter tudo por escrito.`, `Cliente: Ah, ótimo, obrigado.`)
  else lines.push(`Operador: Chamado aberto. O protocolo é ${number}. ${deadline[product]}`, `Cliente: Pera, deixa eu pegar uma caneta... pode repetir o protocolo?`, `Operador: Claro: ${number.split("").join(" ")}.`, `Cliente: Anotei. Obrigado.`)
  lines.push(`Operador: A Vivo agradece o contato. Tenha ${pick(["um bom dia", "uma boa tarde"])}!`)
  return lines.join("\n")
}

// ---------------------------------------------------------------------------------------------
// 2. Larissa — base (processo certo, duração normal) e 21/10 (erros plantados, longas)
// ---------------------------------------------------------------------------------------------
type LarissaCall = { key: string; local: string; seconds: number; product: string; failures: string[]; lines: string[] }
const L = "Larissa"
const BASELINE: LarissaCall[] = [
  { key: "L-BASE-1", local: "2026-09-23T10:20", seconds: 352, product: "Banda Larga", failures: [], lines: [
    `Operador: Vivo Empresas, bom dia, meu nome é ${L}. Com quem eu falo?`, `Cliente: Bom dia, aqui é a Helena, da Clínica Bem Viver. A internet caiu.`,
    `Operador: Me confirma o CNPJ, por favor?`, `Cliente: ${cnpj()}.`,
    `Operador: Desliga o modem da tomada por trinta segundos, liga de novo e me diz como ficaram as luzes?`, `Cliente: A luz de internet ficou vermelha.`,
    `Operador: O teste remoto também falhou. Vou abrir o chamado com visita técnica. Qual o endereço do equipamento?`, `Cliente: ${pick(STREETS)}, ${digits(3)}.`,
    `Operador: Um telefone de contato?`, `Cliente: (85) 9${digits(4)}-${digits(4)}.`,
    `Operador: Chamado aberto, protocolo ${protocol()}. O prazo de reparo é de 24 horas.`, `Cliente: Obrigada.`, `Operador: A Vivo agradece o contato. Tenha um bom dia!`] },
  { key: "L-BASE-2", local: "2026-09-29T14:05", seconds: 338, product: "Linha Móvel", failures: [], lines: [
    `Operador: Vivo Empresas, boa tarde, meu nome é ${L}. Com quem eu falo?`, `Cliente: Oi, é o Fernando, da Logística Rápida. O celular da empresa está sem sinal.`,
    `Operador: Me confirma o CNPJ, por favor?`, `Cliente: ${cnpj()}.`,
    `Operador: Verifiquei a cobertura no seu endereço e está normal. Reinicia o aparelho, por favor?`, `Cliente: Reiniciei, continua sem sinal.`,
    `Operador: Vou reconfigurar o APN com você: vá em Configurações, Rede móvel, Nomes dos pontos de acesso.`, `Cliente: Pronto, configurei. Continua sem sinal.`,
    `Operador: Linha móvel não tem visita técnica. Vou abrir a análise de rede, com prazo de até 72 horas. O protocolo é ${protocol()}.`, `Cliente: Certo.`, `Operador: A Vivo agradece o contato. Tenha uma boa tarde!`] },
  { key: "L-BASE-3", local: "2026-10-02T09:40", seconds: 365, product: "SIP", failures: [], lines: [
    `Operador: Vivo Empresas, bom dia, meu nome é ${L}. Com quem eu falo?`, `Cliente: Bom dia, aqui é o Marcos, da Contábil Horizonte. Os ramais do SIP não completam ligação.`,
    `Operador: Me confirma o CNPJ, por favor?`, `Cliente: ${cnpj()}.`,
    `Operador: Vou fazer o teste remoto do tronco agora.`, `Cliente: Ok.`, `Operador: O teste mostrou falha. Vou abrir o chamado empresarial. Qual o nome do contato técnico?`, `Cliente: É a Bianca, da TI.`,
    `Operador: Chamado aberto, protocolo ${protocol()}. O prazo de solução do SIP é de 4 horas.`, `Cliente: Obrigado.`, `Operador: A Vivo agradece o contato. Tenha um bom dia!`] },
  { key: "L-BASE-4", local: "2026-10-06T15:15", seconds: 371, product: "Linha analógica", failures: [], lines: [
    `Operador: Vivo Empresas, boa tarde, meu nome é ${L}. Com quem eu falo?`, `Cliente: Oi, é a Lúcia, da Padaria Trigo Bom. O telefone fixo está mudo.`,
    `Operador: Me confirma o CNPJ, por favor?`, `Cliente: ${cnpj()}.`,
    `Operador: Tem tom de discagem? Testa o aparelho em outra tomada, por favor.`, `Cliente: Sem tom em nenhuma tomada.`,
    `Operador: Vou abrir o chamado com visita técnica. O prazo de reparo é de 48 horas e o técnico vai numa janela de 4 horas. Prefere manhã ou tarde?`, `Cliente: De manhã.`,
    `Operador: Protocolo ${protocol()}.`, `Cliente: Obrigada.`, `Operador: A Vivo agradece o contato. Tenha uma boa tarde!`] },
  { key: "L-BASE-5", local: "2026-10-09T11:30", seconds: 344, product: "DDR", failures: [], lines: [
    `Operador: Vivo Empresas, bom dia, meu nome é ${L}. Com quem eu falo?`, `Cliente: Bom dia, aqui é o Wagner, da Metalúrgica Forte. Parte dos ramais do DDR não recebe chamada.`,
    `Operador: Me confirma o CNPJ, por favor? E qual é a faixa de ramais afetada?`, `Cliente: ${cnpj()}. Do 3000 ao 3020.`,
    `Operador: Vou fazer o teste remoto do tronco.`, `Cliente: Ok.`, `Operador: Deu falha. Vou abrir o chamado empresarial. Qual o nome do contato técnico?`, `Cliente: É o Danilo.`,
    `Operador: Chamado aberto, protocolo ${protocol()}. O prazo de solução do DDR é de 8 horas.`, `Cliente: Obrigado.`, `Operador: A Vivo agradece o contato. Tenha um bom dia!`] },
]
const CURRENT: LarissaCall[] = [
  { key: "L-OUT-1-BL", local: "2026-10-21T18:40", seconds: 812, product: "Banda Larga", failures: ["Teste básico do produto pulado (reiniciar o modem e ver as luzes)"], lines: [
    `Operador: Vivo Empresas, boa noite, meu nome é ${L}. Com quem eu falo?`, `Cliente: Boa noite, aqui é a Sandra, do Hotel Mar Calmo. A internet da recepção parou.`,
    `Operador: Me confirma o CNPJ, por favor?`, `Cliente: ${cnpj()}.`,
    `Operador: Certo. Vou abrir direto um chamado com visita técnica para a sua internet.`, `Cliente: Precisa fazer algum teste antes?`, `Operador: Não precisa, o técnico vê isso lá.`,
    `Operador: Qual o endereço onde está o equipamento?`, `Cliente: Avenida Beira Mar, ${digits(4)}.`, `Operador: E um telefone de contato?`, `Cliente: Deixa eu pegar aqui... (85) 9${digits(4)}-${digits(4)}.`,
    `Operador: Tem preferência de período?`, `Cliente: Pode ser de manhã.`, `Operador: E o nome de quem vai receber o técnico?`, `Cliente: O Paulo, da manutenção.`,
    `Operador: Chamado aberto, protocolo ${protocol()}. O prazo de reparo é de 24 horas.`, `Cliente: Tá bom.`, `Operador: A Vivo agradece o contato. Tenha uma boa noite!`] },
  { key: "L-OUT-2-LM", local: "2026-10-21T19:20", seconds: 785, product: "Linha Móvel", failures: ["Teste básico do produto pulado (cobertura, reinício e APN)", "Prometeu visita técnica, que a Linha Móvel não tem (o certo é a análise de rede, até 72 horas)"], lines: [
    `Operador: Vivo Empresas, boa noite, meu nome é ${L}. Com quem eu falo?`, `Cliente: Oi, é o Tiago, da Transportes Serra Azul. O celular do motorista está sem internet o dia todo.`,
    `Operador: Me confirma o CNPJ, por favor?`, `Cliente: ${cnpj()}.`,
    `Operador: Vou abrir um chamado para a linha móvel. Um técnico vai até vocês amanhã para ver o aparelho.`, `Cliente: Um técnico? Ele está na estrada.`, `Operador: Então me passa o endereço da base de vocês.`, `Cliente: Rua Pereira Filgueiras, ${digits(3)}.`,
    `Operador: E um telefone de contato?`, `Cliente: (85) 9${digits(4)}-${digits(4)}.`, `Operador: Chamado aberto, protocolo ${protocol()}.`, `Cliente: Tá.`, `Operador: A Vivo agradece o contato. Tenha uma boa noite!`] },
  { key: "L-OUT-3-SIP", local: "2026-10-21T20:00", seconds: 798, product: "SIP", failures: ["Teste básico do produto pulado (teste remoto do tronco)", "Prazo diferente do produto (disse 24 horas; o SIP é 4 horas)"], lines: [
    `Operador: Vivo Empresas, boa noite, meu nome é ${L}. Com quem eu falo?`, `Cliente: Boa noite, é a Yasmin, da Escola Saber Mais. Os ramais do nosso tronco SIP não completam ligação.`,
    `Operador: Me confirma o CNPJ, por favor?`, `Cliente: ${cnpj()}.`,
    `Operador: Vou abrir o chamado empresarial. Qual o nome do contato técnico?`, `Cliente: É o Rodrigo, da TI.`, `Operador: E um telefone dele?`, `Cliente: Só um minuto... (85) 9${digits(4)}-${digits(4)}.`,
    `Operador: Chamado aberto, protocolo ${protocol()}. O prazo de solução é de 24 horas.`, `Cliente: Vinte e quatro horas? A escola fica sem telefone o dia todo.`, `Operador: É o prazo do chamado.`, `Cliente: Tá bom.`, `Operador: A Vivo agradece o contato. Tenha uma boa noite!`] },
  { key: "L-OUT-4-DDR", local: "2026-10-21T20:40", seconds: 776, product: "DDR", failures: ["Teste básico do produto pulado (teste remoto do tronco)"], lines: [
    `Operador: Vivo Empresas, boa noite, meu nome é ${L}. Com quem eu falo?`, `Cliente: Boa noite, aqui é o Otávio, da Gráfica Ponto Certo. Metade dos ramais do DDR não recebe chamada.`,
    `Operador: Me confirma o CNPJ, por favor?`, `Cliente: ${cnpj()}.`, `Operador: Qual é a faixa de ramais afetada?`, `Cliente: Do 4100 ao 4180.`,
    `Operador: Vou abrir o chamado empresarial. Qual o nome do contato técnico?`, `Cliente: É a Carol.`, `Operador: E um telefone?`, `Cliente: Deixa eu ver... (85) 9${digits(4)}-${digits(4)}.`,
    `Operador: Chamado aberto, protocolo ${protocol()}. O prazo de solução do DDR é de 8 horas.`, `Cliente: Ok, obrigado.`, `Operador: A Vivo agradece o contato. Tenha uma boa noite!`] },
  { key: "L-OUT-5-IPD", local: "2026-10-21T21:20", seconds: 841, product: "IP Dedicado", failures: ["Não pediu o resultado do ping/traceroute que o cliente fez", "Prazo diferente do produto (disse 24 horas; o IP Dedicado é 4 horas)"], lines: [
    `Operador: Vivo Empresas, boa noite, meu nome é ${L}. Com quem eu falo?`, `Cliente: Boa noite, aqui é o Rogério, da Contábil Horizonte. O nosso IP Dedicado está fora desde as seis da tarde.`,
    `Operador: Me confirma o CNPJ e o número da LP, por favor?`, `Cliente: ${cnpj()}. A LP é ${digits(2)}${digits(6)}.`,
    `Cliente: Eu já rodei um ping e um traceroute aqui, se ajudar.`, `Operador: Tudo bem. Vou abrir o chamado no NOC com o número da LP.`,
    `Operador: Funciona assim: o NOC recebe o chamado, faz o diagnóstico do link pela rede, aciona o fornecedor da última milha se for o caso e, se precisar, manda um técnico até o seu equipamento. Você recebe as atualizações por e-mail no contato técnico cadastrado.`,
    `Cliente: Hum, entendi mais ou menos.`, `Operador: O protocolo é ${protocol()} e o prazo de solução é de 24 horas.`, `Cliente: Ok.`, `Operador: A Vivo agradece o contato. Tenha uma boa noite!`] },
  { key: "L-OUT-6-COLO", local: "2026-10-21T22:00", seconds: 803, product: "Colocation", failures: ["Prazo diferente do produto (disse 4 horas; o Colocation é 2 horas)", "Agendou acesso ao datacenter para hoje, sem as 24 horas de antecedência e sem pedir os nomes autorizados"], lines: [
    `Operador: Vivo Empresas, boa noite, meu nome é ${L}. Com quem eu falo?`, `Cliente: Boa noite, é a Vanessa, da Farmácia Vida. O nosso servidor no colocation parou de responder.`,
    `Operador: Me confirma o CNPJ e o número da LP, por favor?`, `Cliente: ${cnpj()}. A LP é ${digits(2)}${digits(6)}.`,
    `Operador: Vou abrir o chamado no NOC. O prazo de solução é de 4 horas.`, `Cliente: E se precisar alguém nosso ir até o datacenter?`, `Operador: Pode ir ainda hoje, eu já deixo agendado.`, `Cliente: Ah, que bom.`,
    `Operador: O protocolo é ${protocol()}.`, `Cliente: Obrigada.`, `Operador: A Vivo agradece o contato. Tenha uma boa noite!`] },
]
/** TMA diário da Larissa em outubro (dias úteis; 12/10 é feriado): normal até 14/10, alto em 15–21/10. */
const LARISSA_DAILY: { date: string; value: number; contacts: number }[] = [
  ["2026-10-01", 372, 31], ["2026-10-02", 385, 30], ["2026-10-05", 379, 32], ["2026-10-06", 391, 29], ["2026-10-07", 368, 31], ["2026-10-08", 383, 30],
  ["2026-10-09", 376, 31], ["2026-10-13", 389, 30], ["2026-10-14", 381, 29], ["2026-10-15", 702, 27], ["2026-10-16", 718, 26], ["2026-10-19", 731, 27],
  ["2026-10-20", 744, 25], ["2026-10-21", 756, 26],
].map(([date, value, contacts]) => ({ date: date as string, value: value as number, contacts: contacts as number }))

// ---------------------------------------------------------------------------------------------
// Plano (determinístico) e gravação
// ---------------------------------------------------------------------------------------------
type PlannedCall = { id: string; transcriptId: string; externalId: string; operatorKey: string; startedAt: Date; endedAt: Date; transcript: string; note: string }
function plan() {
  const testCalls: (PlannedCall & { behaviors: Behavior[]; top: boolean; product: TestProduct })[] = []
  for (const [opIndex, operator] of OPERATORS.entries()) {
    const top = operator.quartile === "Q1"
    for (let callIndex = 0; callIndex < 6; callIndex += 1) {
      const has = new Set<Behavior>()
      for (const behavior of Object.keys(TOP_PRESENCE) as Behavior[]) if (rotate((top ? TOP_PRESENCE : REF_PRESENCE)[behavior], opIndex)[callIndex] === 1) has.add(behavior)
      const product = TEST_PRODUCTS[(callIndex + opIndex) % TEST_PRODUCTS.length]!
      const day = SEPTEMBER_DAYS[(callIndex + opIndex) % SEPTEMBER_DAYS.length]!
      const startedAt = new Date(`${day}T${String(9 + ((opIndex + callIndex) % 8)).padStart(2, "0")}:${String((opIndex * 7 + callIndex * 11) % 60).padStart(2, "0")}:00-03:00`)
      const seconds = top ? 285 + Math.floor(next() * 60) : 470 + Math.floor(next() * 110)
      const key = `OP${String(operator.n).padStart(2, "0")}-${String(callIndex + 1).padStart(2, "0")}`
      testCalls.push({ id: idOf(`interaction:${key}`), transcriptId: idOf(`transcript:${key}`), externalId: `TESTE-BP-TMA-${key}`, operatorKey: `OP${operator.n}`, startedAt, endedAt: new Date(startedAt.getTime() + seconds * 1000), transcript: testCall(operator.first, product, has), note: [...has].join(",") || "—", behaviors: [...has], top, product })
    }
  }
  const larissaCalls: PlannedCall[] = [...BASELINE, ...CURRENT].map((call) => {
    const startedAt = new Date(`${call.local}:00-03:00`)
    return { id: idOf(`interaction:${call.key}`), transcriptId: idOf(`transcript:${call.key}`), externalId: `TESTE-BP-TMA-${call.key}`, operatorKey: "LARISSA", startedAt, endedAt: new Date(startedAt.getTime() + call.seconds * 1000), transcript: call.lines.join("\n"), note: `${call.product}: ${call.failures.join("; ") || "processo certo"}` }
  })
  return { testCalls, larissaCalls }
}

const client = await pool.connect()
try {
  const tma = (await client.query<{ id: string }>(`select id from indicator_definitions where organization_id = $1 and code = 'TMA'`, [ORG])).rows[0]!.id
  const atendimentos = (await client.query<{ id: string }>(`select id from indicator_definitions where organization_id = $1 and code = 'ATENDIMENTOS'`, [ORG])).rows[0]?.id ?? null
  const subteam = (await client.query<{ id: string }>(`select id from subteams where team_id = $1 and name = $2`, [TEAM, TEST_SUBTEAM_NAME])).rows[0]
  if (!subteam) throw new Error(`Subgrupo "${TEST_SUBTEAM_NAME}" não encontrado no B2C · Atendimento Geral`)
  const { testCalls, larissaCalls } = plan()
  const people = OPERATORS.map((operator) => ({ ...operator, id: idOf(`person:OP${operator.n}`), name: `TESTE BP TMA · Operador ${String(operator.n).padStart(2, "0")}`, closingId: idOf(`closing:OP${operator.n}`) }))
  const personOf = (key: string) => (key === "LARISSA" ? LARISSA : people.find((person) => `OP${person.n}` === key)!.id)
  const calls = [...testCalls, ...larissaCalls]
  const dailyIds = LARISSA_DAILY.flatMap((day) => [idOf(`daily:TMA:${day.date}`), idOf(`daily:ATENDIMENTOS:${day.date}`)])

  if (reset) {
    await client.query("begin")
    const transcripts = await client.query(`delete from transcripts where id = any($1::uuid[])`, [calls.map((call) => call.transcriptId)])
    const interactions = await client.query(`delete from interactions where id = any($1::uuid[])`, [calls.map((call) => call.id)])
    const daily = await client.query(`delete from indicator_measurements where id = any($1::uuid[])`, [dailyIds])
    const closings = await client.query(`delete from employee_indicator_performance where id = any($1::uuid[])`, [people.map((person) => person.closingId)])
    const removed = await client.query(`delete from people where id = any($1::uuid[])`, [people.map((person) => person.id)])
    await client.query("commit")
    console.log(`Removido: ${interactions.rowCount} chamadas (${transcripts.rowCount} transcrições), ${daily.rowCount} medições, ${closings.rowCount} fechamentos, ${removed.rowCount} pessoas.`)
  } else {
    const rate = (top: boolean, behavior: Behavior) => {
      const rows = testCalls.filter((call) => call.top === top)
      return `${Math.round((rows.filter((call) => call.behaviors.includes(behavior)).length / rows.length) * 100)}%`
    }
    console.log(JSON.stringify({
      mode: apply ? "APPLY" : "DRY_RUN",
      operadoresDeTeste: people.map((person) => `${person.name} — TMA ${PERIOD} ${person.value}s ${person.quartile}`),
      praticaPlantada: Object.fromEntries((Object.keys(TOP_PRESENCE) as Behavior[]).map((behavior) => [behavior, `1º quartil ${rate(true, behavior)} × demais ${rate(false, behavior)}`])),
      chamadasDeTeste: testCalls.length,
      larissa: larissaCalls.map((call) => `${call.externalId} ${call.startedAt.toISOString()} ${Math.round((call.endedAt.getTime() - call.startedAt.getTime()) / 1000)}s — ${call.note}`),
      medicaoDiaria: LARISSA_DAILY.map((day) => `${day.date} ${day.value}s`).join(" · "),
      medicaoDoWorkflow: idOf("daily:TMA:2026-10-21"),
    }, null, 1))
    if (apply) {
      await client.query("begin")
      for (const person of people) {
        await client.query(`insert into people (id, organization_id, name, role, team_id, subteam_id) values ($1, $2, $3, 'OPERATOR', $4, $5) on conflict (id) do nothing`, [person.id, ORG, person.name, TEAM, subteam.id])
        await client.query(
          `insert into employee_indicator_performance (id, organization_id, person_id, indicator_definition_id, subteam_id, reference_period, value, target_value, achievement_percent, weight_percent, quartile, source)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, null, $10, $11) on conflict (id) do nothing`,
          [person.closingId, ORG, person.id, tma, subteam.id, PERIOD, person.value, TARGET, Math.round((TARGET / person.value) * 1000) / 10, person.quartile, SOURCE],
        )
      }
      for (const call of calls) {
        await client.query(
          `insert into interactions (id, organization_id, operator_id, reason, channel, started_at, ended_at, external_id) values ($1, $2, $3, 'Reparo', 'VOICE', $4, $5, $6) on conflict (id) do nothing`,
          [call.id, ORG, personOf(call.operatorKey), call.startedAt, call.endedAt, call.externalId],
        )
        // V2: a transcrição dos operadores de TESTE é reescrita (comportamento plantado novo); a da Larissa nunca muda.
        const rewrite = call.operatorKey !== "LARISSA" ? "do update set content = excluded.content where transcripts.content is distinct from excluded.content" : "do nothing"
        await client.query(`insert into transcripts (id, organization_id, interaction_id, version, content, language, confidence) values ($1, $2, $3, 1, $4, 'pt-BR', 0.9) on conflict (id) ${rewrite}`, [call.transcriptId, ORG, call.id, call.transcript])
      }
      for (const day of LARISSA_DAILY) {
        const start = `${day.date} 00:00:00-03`
        const end = `${day.date} 23:59:59-03`
        await client.query(
          `insert into indicator_measurements (id, organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source, granularity, numerator, denominator, sample_count)
           values ($1, $2, $3, 'PERSON', $4, $5, $6, $7, $8, 'DAILY', $9, $10::numeric, $10::int) on conflict (id) do nothing`,
          [idOf(`daily:TMA:${day.date}`), ORG, tma, LARISSA, day.value, start, end, SOURCE, day.value * day.contacts, day.contacts],
        )
        if (atendimentos) await client.query(
          `insert into indicator_measurements (id, organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source, granularity, numerator, denominator, sample_count)
           values ($1, $2, $3, 'PERSON', $4, $5::numeric, $6, $7, $8, 'DAILY', $5::numeric, 1, $5::int) on conflict (id) do nothing`,
          [idOf(`daily:ATENDIMENTOS:${day.date}`), ORG, atendimentos, LARISSA, day.contacts, start, end, SOURCE],
        )
      }
      await client.query(
        `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, null, 'DEV_SCENARIO_BP_TMA_REPARO_APPLIED', 'person', $2, $3)`,
        [ORG, LARISSA, JSON.stringify({ testOperators: people.length, testCalls: testCalls.length, larissaCalls: larissaCalls.length, daily: dailyIds.length, period: PERIOD })],
      )
      await client.query("commit")
      console.log(`Aplicado: ${people.length} operadores de teste com fechamento de ${PERIOD}, ${calls.length} chamadas, ${dailyIds.length} medições diárias.`)
    } else {
      console.log("ENSAIO: nada gravado")
    }
  }
} catch (error) {
  await client.query("rollback").catch(() => undefined)
  throw error
} finally {
  client.release()
  await pool.end()
}
