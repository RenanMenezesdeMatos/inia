import { buildFixturePdf, gridTable, PAGE_WIDTH, paragraph, type FixtureImage, type FixtureOp, type FixturePage } from "../../../src/modules/knowledge/testing/pdf-layout-fixture.js"

/**
 * CORPUS SINTÉTICO da medição PDF → Markdown. Conteúdo fictício (nenhum dado da operação real). Cada PDF cobre um caso pedido: digital
 * simples, manual com tabelas, duas colunas, digitalizado e misto. Os PDFs de navegador (com e sem tags, fontes reais embutidas) saem
 * do HTML em `chrome-corpus.ts`; os digitalizados usam imagens JPEG geradas de páginas verdadeiras em `generate-corpus.ts`.
 */
const LEFT = 56
const WIDTH = PAGE_WIDTH - LEFT * 2

function margins(page: number, total: number, header: string): FixtureOp[] {
  return [
    { kind: "text", x: LEFT, y: 36, text: header, size: 8 },
    { kind: "text", x: LEFT, y: 812, text: `Página ${page} de ${total}`, size: 8 },
  ]
}

type Flow = { ops: FixtureOp[]; y: number }
const start = (y = 70): Flow => ({ ops: [], y })
function title(flow: Flow, text: string, size = 18) {
  flow.ops.push({ kind: "text", x: LEFT, y: flow.y + size, text, size, font: "bold" })
  flow.y += size * 1.9
}
function subtitle(flow: Flow, text: string, size = 13) {
  flow.ops.push({ kind: "text", x: LEFT, y: flow.y + size, text, size, font: "bold" })
  flow.y += size * 1.8
}
/** Título do tamanho do corpo, só em negrito, como em muitos manuais gerados pelo Word. */
function boldLabel(flow: Flow, text: string) {
  flow.ops.push({ kind: "text", x: LEFT, y: flow.y + 11, text, size: 11, font: "bold" })
  flow.y += 19
}
function para(flow: Flow, text: string) {
  const written = paragraph(text, { x: LEFT, y: flow.y + 11, width: WIDTH })
  flow.ops.push(...written.ops)
  flow.y = written.y + 6
}
/** Linhas já quebradas à mão: é como o hífen no fim da linha aparece num PDF. */
function rawLines(flow: Flow, lines: readonly string[]) {
  for (const line of lines) {
    flow.ops.push({ kind: "text", x: LEFT, y: flow.y + 11, text: line, size: 11 })
    flow.y += 14.8
  }
  flow.y += 6
}
function bullets(flow: Flow, items: readonly string[], marker = "•") {
  for (const item of items) {
    flow.ops.push({ kind: "text", x: LEFT + 6, y: flow.y + 11, text: marker, size: 11 })
    const written = paragraph(item, { x: LEFT + 20, y: flow.y + 11, width: WIDTH - 20 })
    flow.ops.push(...written.ops)
    flow.y = written.y + 2
  }
  flow.y += 6
}
function numbered(flow: Flow, items: readonly string[]) {
  items.forEach((item, index) => {
    flow.ops.push({ kind: "text", x: LEFT + 6, y: flow.y + 11, text: `${index + 1}.`, size: 11 })
    const written = paragraph(item, { x: LEFT + 24, y: flow.y + 11, width: WIDTH - 24 })
    flow.ops.push(...written.ops)
    flow.y = written.y + 2
  })
  flow.y += 6
}
const finish = (flow: Flow, page: number, total: number, header: string): FixturePage => [...margins(page, total, header), ...flow.ops]

const FILLER = "Esta orientação vale para todos os canais de atendimento e deve ser consultada antes de qualquer registro no sistema, sempre conferindo os dados informados pelo cliente durante o contato."

/** Digital simples: títulos por tamanho, listas, hífen de fim de linha, cabeçalho e rodapé repetidos. */
export function simplesPages(): FixturePage[] {
  const header = "Procedimento interno — Operadora Exemplo"
  const page1 = start()
  title(page1, "Segunda via de fatura")
  subtitle(page1, "1. Quando emitir")
  para(page1, "A segunda via pode ser emitida para faturas dos últimos 12 meses, contados a partir do mês de referência. Faturas anteriores a esse período são solicitadas à área de Arquivo Financeiro.")
  subtitle(page1, "2. Canais disponíveis")
  bullets(page1, ["Aplicativo da operadora, na opção Minhas Faturas.", "Portal do cliente, na área logada.", "Loja própria, com documento original com foto."])
  para(page1, FILLER)
  const page2 = start()
  subtitle(page2, "3. Envio por e-mail")
  rawLines(page2, ["O envio da fatura por e-mail é concluído em até 15 minutos depois do registro. Durante o atendi-", "mento, confirme o endereço cadastrado e leia o e-mail em voz alta para o cliente antes de enviar. O", "atendimento só termina depois dessa confirmação, e o plano pré-", "pago não recebe fatura por e-mail."])
  subtitle(page2, "4. Passo a passo")
  numbered(page2, ["Confirmar o titular com CPF e data de nascimento.", "Selecionar o mês de referência da fatura.", "Registrar o protocolo e informá-lo ao cliente."])
  para(page2, FILLER)
  const page3 = start()
  subtitle(page3, "5. Fatura vencida")
  para(page3, "Fatura vencida há mais de 90 dias não tem segunda via pelo atendimento: encaminhe o cliente para a Recuperação de Crédito, que informa o boleto atualizado com juros.")
  subtitle(page3, "6. Cobrança da emissão")
  para(page3, "A primeira segunda via de cada mês é gratuita. A partir da segunda solicitação no mesmo mês, é cobrada a taxa de R$ 4,90 na fatura seguinte.")
  para(page3, FILLER)
  return [finish(page1, 1, 3, header), finish(page2, 2, 3, header), finish(page3, 3, 3, header)]
}

/** Manual com tabelas: grade em traço, grade em retângulo fino, colunas alinhadas sem grade e tabela que atravessa a página. */
export function manualTabelasPages(): FixturePage[] {
  const header = "Manual de Reparo — Operadora Exemplo"
  const total = 6
  const page1 = start()
  title(page1, "Manual de prazos de reparo")
  para(page1, "Este manual reúne os prazos e as condições de reparo por produto. Consulte a tabela do produto antes de informar qualquer prazo ao cliente. Prazos contam a partir da abertura da solicitação.")
  boldLabel(page1, "1. Como abrir a solicitação")
  bullets(page1, ["Testar a linha remotamente antes de abrir o reparo.", "Registrar o sintoma relatado pelo cliente com as palavras dele.", "Informar o protocolo e o prazo do produto."])
  para(page1, FILLER)
  const page2 = start()
  boldLabel(page2, "2. Prazos por produto")
  para(page2, "A tabela abaixo mostra o prazo de reparo de cada produto e o canal em que a solicitação é aberta.")
  const table1 = gridTable([
    ["Produto", "Prazo de reparo", "Canal de abertura", "Taxa de visita"],
    ["Banda Larga Fibra", "24 horas", "Aplicativo", "Sem taxa"],
    ["Banda Larga Cabo", "48 horas", "Central", "R$ 35,00"],
    ["Linha Fixa", "72 horas", "Central", "Sem taxa"],
    ["TV por Assinatura", "36 horas", "Aplicativo", "R$ 25,00"],
    ["IP Dedicado", "4 horas", "Gerente de contas", "Sem taxa"],
  ], { x: LEFT, y: page2.y + 4, columnWidths: [140, 110, 120, 113], style: "stroke" })
  page2.ops.push(...table1.ops)
  page2.y = table1.y + 16
  para(page2, FILLER)
  const page3 = start()
  boldLabel(page3, "3. Prazos de análise")
  para(page3, "Quando o reparo não resolve, a solicitação passa por análise. O prazo depende da situação registrada.")
  const table2 = gridTable([
    ["Situação", "Prazo de análise", "Responsável"],
    ["Reincidência em 30 dias", "2 dias úteis", "Qualidade de Rede"],
    ["Troca de equipamento", "5 dias úteis", "Logística"],
    ["Contestação de taxa de visita", "10 dias úteis", "Financeiro"],
    ["Cliente sem cobertura", "15 dias úteis", ""],
  ], { x: LEFT, y: page3.y + 4, columnWidths: [190, 130, 163], style: "thin" })
  page3.ops.push(...table2.ops)
  page3.y = table2.y + 16
  para(page3, "Na situação de cliente sem cobertura não há responsável fixo: o caso segue para a Regional da localidade.")
  boldLabel(page3, "3.1 Encaminhamento por tipo de falha")
  const table2b = gridTable([
    ["Falha", "Como identificar", "Encaminhamento"],
    ["Sinal intermitente", "Quedas repetidas no mesmo dia, confirmadas pelo teste remoto da linha e pelo relato do cliente", "Abrir visita técnica em até 24 horas e avisar o cliente pelo aplicativo"],
    ["Lentidão em horário de pico", "Velocidade abaixo de 40% do contratado em três medições feitas no mesmo período do dia", "Registrar as medições e enviar para Engenharia de Capacidade em até 2 dias úteis"],
    ["Equipamento sem energia", "Luzes apagadas mesmo com a tomada testada pelo cliente durante a ligação", "Trocar o equipamento pelo envio expresso, sem visita técnica e sem custo"],
  ], { x: LEFT, y: page3.y + 2, columnWidths: [110, 190, 183], style: "stroke" })
  page3.ops.push(...table2b.ops)
  page3.y = table2b.y + 12
  const page4 = start()
  boldLabel(page4, "4. Créditos por demora")
  para(page4, "Quando o prazo de reparo não é cumprido, o cliente recebe crédito na fatura seguinte, conforme a demora.")
  const credits: readonly (readonly [string, string, string])[] = [["Demora", "Crédito", "Limite mensal"], ["Até 24 horas", "R$ 10,00", "R$ 30,00"], ["De 24 a 72 horas", "R$ 25,00", "R$ 75,00"], ["Mais de 72 horas", "R$ 60,00", "R$ 120,00"]]
  credits.forEach((row, index) => {
    const y = page4.y + 12 + index * 16
    const font = index === 0 ? "bold" as const : "regular" as const
    page4.ops.push({ kind: "text", x: LEFT, y, text: row[0], size: 10, font }, { kind: "text", x: LEFT + 180, y, text: row[1], size: 10, font }, { kind: "text", x: LEFT + 320, y, text: row[2], size: 10, font })
  })
  page4.y += 12 + credits.length * 16 + 8
  para(page4, FILLER)
  const regions = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul"]
  const techs = ["Fibra", "Cabo", "Rádio", "Satélite"]
  const coverage: string[][] = []
  regions.forEach((region, regionIndex) => techs.forEach((tech, techIndex) => coverage.push([region, tech, `${6 + regionIndex + techIndex * 2} horas`, `Equipe ${region} ${techIndex + 1}`])))
  const head = ["Região", "Tecnologia", "Atendimento em campo", "Equipe"]
  const page5 = start()
  boldLabel(page5, "5. Atendimento em campo por região")
  para(page5, "O prazo de atendimento em campo depende da região e da tecnologia. A tabela continua na página seguinte.")
  const table3 = gridTable([head, ...coverage.slice(0, 11)], { x: LEFT, y: page5.y + 4, columnWidths: [110, 110, 140, 123], style: "stroke" })
  page5.ops.push(...table3.ops)
  const page6 = start()
  const table4 = gridTable([head, ...coverage.slice(11)], { x: LEFT, y: page6.y + 4, columnWidths: [110, 110, 140, 123], style: "stroke" })
  page6.ops.push(...table4.ops)
  page6.y = table4.y + 16
  para(page6, "Fora dessas janelas, o atendimento em campo depende de autorização da Coordenação de Campo.")
  return [page1, page2, page3, page4, page5, page6].map((flow, index) => finish(flow, index + 1, total, header))
}

const COLUMN_LEFT_X = LEFT
const COLUMN_WIDTH = 228
const COLUMN_RIGHT_X = LEFT + COLUMN_WIDTH + 27

/** Boletim em duas colunas. `order = "column"` grava coluna por coluna; `order = "row"` grava linha a linha, intercalando as colunas. */
export function duasColunasPages(order: "column" | "row"): FixturePage[] {
  const header = "Boletim de Retenção — Operadora Exemplo"
  type Column = { lines: string[] }
  const write = (left: readonly string[], right: readonly string[], y0: number): FixtureOp[] => {
    const toLines = (paragraphs: readonly string[]): string[] => paragraphs.flatMap((text, index) => {
      const lines = paragraph(text, { x: 0, y: 0, width: COLUMN_WIDTH, size: 10 }).ops.flatMap((op) => (op.kind === "text" ? [op.text] : []))
      return index < paragraphs.length - 1 ? [...lines, ""] : lines
    })
    const columns: [Column, Column] = [{ lines: toLines(left) }, { lines: toLines(right) }]
    const lineOp = (column: 0 | 1, index: number): FixtureOp | null => {
      const text = columns[column].lines[index]
      return text ? { kind: "text", x: column === 0 ? COLUMN_LEFT_X : COLUMN_RIGHT_X, y: y0 + index * 13, text, size: 10 } : null
    }
    const ops: FixtureOp[] = []
    const rows = Math.max(columns[0].lines.length, columns[1].lines.length)
    if (order === "column") {
      for (const column of [0, 1] as const) for (let index = 0; index < rows; index += 1) {
        const op = lineOp(column, index)
        if (op) ops.push(op)
      }
    } else {
      for (let index = 0; index < rows; index += 1) for (const column of [0, 1] as const) {
        const op = lineOp(column, index)
        if (op) ops.push(op)
      }
    }
    return ops
  }
  const page1: FixtureOp[] = [
    { kind: "text", x: LEFT, y: 90, text: "Boletim de regras de retenção", size: 18, font: "bold" },
    ...write(
      [
        "O desconto de fidelidade de 20% é oferecido a clientes com mais de 24 meses de casa que pedem o cancelamento por preço, desde que não tenham recebido outro desconto no último semestre.",
        "Para quem tem menos de 24 meses de casa, a oferta é a troca para um plano de valor menor, sem multa, mantendo a fidelização que já estava em curso no contrato.",
      ],
      [
        "A multa de cancelamento antecipado é proporcional aos meses que faltam para o fim da fidelização e nunca passa de R$ 300,00 por linha, valor que vale para todos os estados.",
        "Clientes em área sem cobertura de fibra são isentos da multa quando apresentam o protocolo de inviabilidade técnica aberto há pelo menos 7 dias na central de atendimento.",
      ],
      120,
    ),
    { kind: "text", x: LEFT, y: 780, text: "Nota: regras válidas para os contratos assinados a partir de janeiro de 2026 em todas as regionais.", size: 8 },
  ]
  const page2: FixtureOp[] = write(
    [
      "A portabilidade para outra operadora é concluída em até 3 dias úteis depois do pedido do cliente. Durante esse prazo, o atendimento não oferece desconto novo para reverter a decisão.",
      "Para o cancelamento por mudança de endereço, confirme antes a viabilidade no novo endereço: havendo cobertura, a oferta é a transferência sem custo e sem nova fidelização.",
    ],
    [
      "O cancelamento por falecimento do titular é isento de multa em qualquer caso e exige a certidão de óbito, enviada pelo portal ou entregue em uma loja própria da operadora.",
      "Pedidos de cancelamento feitos em até 7 dias depois da contratação pela internet ou por telefone seguem o direito de arrependimento, com devolução integral dos valores pagos.",
    ],
    90,
  )
  return [[...margins(1, 2, header), ...page1], [...margins(2, 2, header), ...page2]]
}

/** Misto: páginas com texto, páginas só com imagem e uma página com texto e imagem grande. A numeração das páginas precisa continuar certa. */
export function mistoPages(scanned: FixtureImage, photo: FixtureImage): FixturePage[] {
  const header = "Guia de Atendimento — Operadora Exemplo"
  const total = 5
  const page1 = start()
  title(page1, "Guia de atendimento a clientes corporativos")
  subtitle(page1, "1. Abertura do chamado")
  para(page1, "Chamados de clientes corporativos são abertos pelo gerente de contas ou pela central 0800 exclusiva, em qualquer horário. O número do contrato é obrigatório na abertura.")
  para(page1, FILLER)
  const page3 = start()
  subtitle(page3, "3. Equipamentos em comodato")
  para(page3, "O equipamento em comodato com defeito é trocado em até 5 dias úteis, sem custo. Ao final do contrato, a devolução deve ocorrer em até 30 dias, sob pena de cobrança do valor de tabela.")
  const photoOp: FixtureOp = { kind: "image", x: LEFT, y: page3.y + 10, width: WIDTH, height: 420, image: photo }
  page3.ops.push(photoOp)
  const page5 = start()
  subtitle(page5, "5. Encerramento do chamado")
  para(page5, "O chamado corporativo só é encerrado com o aceite do responsável técnico do cliente, registrado em até 48 horas depois da conclusão. Sem o aceite nesse prazo, o encerramento é automático.")
  para(page5, FILLER)
  const scannedPage = (page: number): FixturePage => [{ kind: "image", x: 0, y: 0, width: PAGE_WIDTH, height: 842, image: scanned }, { kind: "text", x: LEFT, y: 812, text: `${page}`, size: 8 }]
  return [finish(page1, 1, total, header), scannedPage(2), finish(page3, 3, total, header), scannedPage(4), finish(page5, 5, total, header)]
}

export function scannedPages(images: readonly FixtureImage[]): FixturePage[] {
  return images.map((image) => [{ kind: "image", x: 0, y: 0, width: PAGE_WIDTH, height: 842, image }])
}

export const pdfOf = (pages: readonly FixturePage[]) => buildFixturePdf(pages)
