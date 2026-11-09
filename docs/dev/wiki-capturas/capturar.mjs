// Tira os prints da Wiki de Workflows da tela real, com a API simulada e dados fictícios, e calcula as marcações pelos próprios campos.
// Veja como rodar no README desta pasta. Só `--apenas=id1,id2` limita o que é capturado.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, "../../..")
const FRONT = process.env.FRONT_URL ?? "http://127.0.0.1:3451"
const API = process.env.API_URL ?? "http://127.0.0.1:3452"
const OUT = path.join(REPO, "frontend/public/wiki-capturas/workflows")
const MANIFEST = path.join(REPO, "frontend/src/components/wiki/workflow-demo/demo-shots.json")
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

const { DEMO_CELL, DEMO_GRAPHS } = await import("../../../frontend/src/components/wiki/workflow-demo/demo-graphs.ts")
const requireFromFront = createRequire(path.join(REPO, "frontend/package.json"))
const sharp = requireFromFront("sharp")
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE ?? "playwright-core")

/** Cada print: em qual workflow, qual etapa abrir e quais rótulos marcar. `marks[].near` é o texto na tela ao lado do qual fica o número. */
const SHOTS = [
  { id: "canvas-dois-momentos-do-dia", workflow: "dois-momentos-do-dia", area: "canvas", caption: "O fluxo no editor: Gatilho, Chamar agente, Output e Fim", alt: "Canvas do editor com o fluxo de orientação em dois momentos do dia", marks: [] },
  { id: "canvas-nota-ura-baixa", workflow: "nota-ura-baixa", area: "canvas", caption: "O fluxo no editor, com as saídas Sim e Não da Condição", alt: "Canvas do editor com o fluxo de feedback por nota URA baixa", marks: [] },
  { id: "canvas-orientar-e-reavaliar", workflow: "orientar-e-reavaliar", area: "canvas", caption: "O fluxo no editor, com a espera e a reavaliação", alt: "Canvas do editor com o fluxo de orientar e reavaliar", marks: [] },
  { id: "canvas-revisao-antes-da-entrega", workflow: "revisao-antes-da-entrega", area: "canvas", caption: "O fluxo no editor, com as três saídas da Revisão humana", alt: "Canvas do editor com o fluxo de revisão humana antes da entrega", marks: [] },
  { id: "canvas-destaques-do-mes", workflow: "destaques-do-mes", area: "canvas", caption: "O fluxo no editor: selecionar, aplicar, consolidar e entregar", alt: "Canvas do editor com o fluxo de destaques do mês", marks: [] },
  { id: "canvas-politica-de-acompanhamento", workflow: "politica-de-acompanhamento", area: "canvas", caption: "O fluxo no editor, com o nó de política", alt: "Canvas do editor com o fluxo de política de acompanhamento", marks: [] },

  { id: "agenda-dois-horarios", workflow: "dois-momentos-do-dia", node: "Todo dia às 09:00 e às 15:00", caption: "Gatilho por agenda com dois horários", alt: "Painel do Gatilho: Por agenda, Horário/calendário, Diariamente, horários 09:00 e 15:00", marks: [
    { near: "Tipo de gatilho", text: "Escolha \"Por agenda\"." },
    { near: "Frequência", text: "A frequência vale para todos os horários." },
    { near: "Horários", text: "Cada horário da lista é um disparo independente." },
    { near: "Próximas execuções", text: "A prévia mostra os próximos disparos." },
  ] },
  { id: "agente-amostra-monitoria", workflow: "dois-momentos-do-dia", node: "Analisar uma chamada do dia", caption: "Fonte de dados do \"Chamar agente\" numa agenda", alt: "Painel do Chamar agente com a Fonte de dados: amostra de chamadas, 1 chamada, período Hoje", marks: [
    { near: "Agente", text: "Quem analisa." },
    { near: "O que avaliar", text: "De onde vêm os dados: uma amostra de chamadas." },
    { near: "Quantas chamadas amostrar", text: "Só o resultado da última segue adiante." },
    { near: "Período avaliado", text: "O período é diferente do momento do disparo." },
  ] },
  { id: "output-acompanhamento", workflow: "dois-momentos-do-dia", node: "Orientação ao colaborador", caption: "Output: quem recebe, onde aparece e o que entregar", alt: "Painel do Output: O próprio colaborador, Acompanhamento, conteúdo a publicar", marks: [
    { near: "Destinatário", text: "Quem recebe." },
    { near: "Onde entregar", text: "Onde aparece." },
    { near: "Conteúdo a publicar", text: "O que é entregue." },
  ] },
  { id: "flag-nota-ura", workflow: "nota-ura-baixa", node: "Chegou uma nota na URA", caption: "Gatilho por Flag de canal", alt: "Painel do Gatilho: Flag de canal, flag VOICE nota_ura", marks: [
    { near: "Tipo de gatilho", text: "Escolha \"Flag de canal\"." },
    { near: "Flag do canal", text: "A flag que dispara a jornada." },
  ] },
  { id: "condicao-nota-ura", workflow: "nota-ura-baixa", node: "Nota da URA ≤ 2?", caption: "Condição: é aqui que fica o limite", alt: "Painel da Condição: valor do gatilho, é menor ou igual a 2", marks: [
    { near: "Baseado em", text: "Compara o valor que veio no gatilho." },
    { near: "Condição", last: true, text: "A comparação." },
    { near: "Valor", text: "O limite. O 2 é só um exemplo." },
  ] },
  { id: "agente-avaliacao-processo", workflow: "nota-ura-baixa", node: "Analisar a chamada", caption: "Chamar agente com Avaliação de processo", alt: "Painel do Chamar agente com o formato Avaliação de processo", marks: [
    { near: "Agente", text: "Quem analisa a chamada." },
    { near: "Formato da análise", text: "Só disponível com a chamada no gatilho." },
  ] },
  { id: "gerar-feedback", workflow: "nota-ura-baixa", node: "Gerar feedback", caption: "Gerar feedback: origem e tipo", alt: "Painel do Gerar feedback com a origem e o tipo Monitoria", marks: [
    { near: "Origem", text: "De qual análise o feedback nasce." },
    { near: "Tipo", text: "Monitoria ou Indicador." },
  ] },
  { id: "gatilho-indicador", workflow: "orientar-e-reavaliar", node: "Nova medição de TMA", caption: "Gatilho por Indicador", alt: "Painel do Gatilho: Indicador, TMA", marks: [
    { near: "Tipo de gatilho", text: "Escolha \"Indicador\"." },
    { near: "Indicador", last: true, text: "Cada medição nova inicia uma execução." },
  ] },
  { id: "condicao-indicador", workflow: "orientar-e-reavaliar", node: "TMA médio (7 dias) acima da meta?", caption: "Condição sobre indicador: período e referência", alt: "Painel da Condição: valor do indicador, média ponderada, últimos 7 dias, meta vigente", marks: [
    { near: "O que deseja analisar?", text: "Valor, atingimento, PRV ou quartil." },
    { near: "Analisar", text: "Como somar as medições do período." },
    { near: "Período", text: "Quais dias entram, não importa quando disparou." },
    { near: "Referência da comparação", text: "Meta vigente, valor fixo ou período anterior." },
  ] },
  { id: "agente-indicador", workflow: "orientar-e-reavaliar", node: "Analisar o indicador", caption: "Chamar agente com gatilho por Indicador", alt: "Painel do Chamar agente com o formato de feedback do indicador", marks: [
    { near: "Formato da análise", text: "Só o resultado oficial, ou o diagnóstico." },
  ] },
  { id: "aguardar", workflow: "orientar-e-reavaliar", node: "Aguardar 7 dias", caption: "Aguardar: uma pausa de tempo fixo", alt: "Painel do Aguardar: duração 7, unidade Dias", marks: [
    { near: "Duração", text: "Quanto tempo." },
    { near: "Unidade", text: "Minutos, horas ou dias." },
  ] },
  { id: "escalonar", workflow: "orientar-e-reavaliar", node: "Encaminhar ao Supervisor", caption: "Escalonar: encaminha e não espera", alt: "Painel do Escalonar: destino, cargo, conteúdo, onde entregar, motivo e depois", marks: [
    { near: "Destino", text: "Para quem sobe, pela hierarquia." },
    { near: "Onde entregar", text: "Onde aparece." },
    { near: "Após escalonar", text: "Continua o fluxo ou encerra o caminho." },
  ] },
  { id: "orquestrador", workflow: "revisao-antes-da-entrega", node: "Analisar com os especialistas", caption: "Orquestrador: a IA coordena os especialistas", alt: "Painel do Orquestrador: orquestrador, instrução e roteamento", marks: [
    { near: "Orquestrador", nth: 1, text: "Só os publicados para workflows." },
    { near: "Instrução", text: "O que este nó pede." },
    { near: "Roteamento", text: "A IA escolhe, ou os domínios são fixos." },
  ] },
  { id: "revisao-humana", workflow: "revisao-antes-da-entrega", node: "Revisão do Supervisor", caption: "Revisão humana: para o fluxo até a decisão", alt: "Painel da Revisão humana: revisor, cargo, conteúdo e instrução", marks: [
    { near: "Revisor", text: "Quem decide." },
    { near: "Conteúdo a revisar (opcional)", text: "O que a pessoa lê antes de decidir." },
    { near: "Instrução para o revisor (opcional)", text: "O que conferir." },
  ] },
  { id: "configuracoes-consolidado", workflow: "destaques-do-mes", area: "settings", caption: "Configurações do workflow: uma estrutura consolidada", alt: "Configurações do workflow com o Alvo da avaliação em uma estrutura consolidada", marks: [
    { near: "Abrangência", text: "Onde o Workflow pode atuar." },
    { near: "Alvo da avaliação", text: "Colaboradores individualmente, ou uma estrutura." },
    { near: "População / Estrutura", text: "Qual estrutura será analisada." },
  ] },
  { id: "selecionar-ranking", workflow: "destaques-do-mes", node: "Melhor PRV de cada Subgrupo", caption: "Selecionar colaboradores por ranking", alt: "Painel do Selecionar colaboradores: por ranking, valor, atingimento do PRV, melhores desempenhos por Subgrupo", marks: [
    { near: "Modo de seleção", text: "Por critério ou por ranking." },
    { near: "Selecionar", text: "Quantos entram." },
    { near: "Separar ranking por", text: "A quantidade vale para cada parte." },
  ] },
  { id: "agente-fechamentos", workflow: "destaques-do-mes", node: "Escrever o reconhecimento", caption: "Chamar agente com a fonte de fechamentos oficiais", alt: "Painel do Chamar agente: fechamentos oficiais, quantos fechamentos e formato", marks: [
    { near: "O que avaliar", text: "O fechamento oficial, lido pronto." },
    { near: "Quantos fechamentos (competências)", text: "Quantos meses." },
    { near: "Formato da análise", text: "O sistema informa a posição e a meta; o agente só escreve." },
  ] },
  { id: "output-gestao", workflow: "destaques-do-mes", node: "Destaques do mês à Diretoria", caption: "Output depois de consolidar: destinatário da gestão", alt: "Painel do Output: cargo específico, Diretor, Acompanhamento", marks: [
    { near: "Destinatário", text: "Aqui não existe \"O próprio colaborador\"." },
    { near: "Cargo", text: "Resolvido pela estrutura: exatamente uma pessoa." },
  ] },
  { id: "politica", workflow: "politica-de-acompanhamento", node: "Avaliar política de acompanhamento", caption: "Avaliar política de acompanhamento", alt: "Painel do nó de política: política, modo e referências", marks: [
    { near: "Política de acompanhamento", text: "Só as publicadas no seu escopo." },
    { near: "Modo", text: "Recomendar, ou abrir conforme a política." },
    { near: "Referências de análise (opcional)", text: "Nós anteriores usados como fonte." },
  ] },
  { id: "condicao-politica", workflow: "politica-de-acompanhamento", node: "Ficou inconclusiva?", caption: "Condição sobre o resultado da política", alt: "Painel da Condição: resultado de um nó anterior, campo Ficou inconclusiva", marks: [
    { near: "Baseado em", text: "Lê o resultado de um nó anterior." },
    { near: "Campo", text: "Os campos da política aparecem na lista." },
  ] },
  { id: "output-feedback", workflow: "nota-ura-baixa", node: "Orientação ao colaborador", caption: "Output do feedback gerado", alt: "Painel do Output com o conteúdo Feedback confiável: Gerar feedback", marks: [
    { near: "Destinatário", text: "Quem recebe." },
    { near: "Onde entregar", text: "Onde aparece." },
    { near: "Conteúdo a publicar", text: "Com gatilho por Flag, só o que passou por \"Gerar feedback\"." },
  ] },
  { id: "gerar-feedback-indicador", workflow: "orientar-e-reavaliar", node: "Gerar feedback", caption: "Gerar feedback do tipo Indicador", alt: "Painel do Gerar feedback com o tipo Indicador", marks: [
    { near: "Origem", text: "De qual análise o feedback nasce." },
    { near: "Tipo", text: "Indicador usa os dados oficiais do sistema." },
  ] },
  { id: "definir-variavel", workflow: "orientar-e-reavaliar", node: "Guardar o recado de evolução", caption: "Definir variável com valor fixo", alt: "Painel do Definir variável: variável, origem do valor e valor", marks: [
    { near: "Variável", text: "A variável criada para este Workflow." },
    { near: "Origem do valor", text: "Fixo ou dinâmico." },
  ] },
  { id: "output-lider", workflow: "orientar-e-reavaliar", node: "Avisar o Supervisor da evolução", caption: "Output para a liderança, com uma variável como conteúdo", alt: "Painel do Output: Supervisor do operador, Notificação, conteúdo em variável", marks: [
    { near: "Destinatário", text: "A liderança da pessoa." },
    { near: "Conteúdo a publicar", text: "A variável definida antes." },
  ] },
  { id: "flag-contestacao", workflow: "revisao-antes-da-entrega", node: "Chamada com contestação", caption: "Gatilho por Flag de canal", alt: "Painel do Gatilho: Flag de canal, flag VOICE contestacao", marks: [
    { near: "Flag do canal", text: "A flag que dispara a jornada." },
  ] },
  { id: "condicao-contestacao", workflow: "revisao-antes-da-entrega", node: "Contestação confirmada?", caption: "Condição sobre uma flag de verdadeiro ou falso", alt: "Painel da Condição: valor do gatilho, quando a flag vier verdadeira", marks: [
    { near: "Quando a flag vier", text: "Aqui não há limite: só verdadeira ou falsa." },
  ] },
  { id: "gerar-feedback-orquestrador", workflow: "revisao-antes-da-entrega", node: "Gerar feedback", caption: "Gerar feedback a partir do Orquestrador", alt: "Painel do Gerar feedback com o Orquestrador como origem", marks: [
    { near: "Origem", text: "O resultado do Orquestrador." },
  ] },
  { id: "output-feedback-aprovado", workflow: "revisao-antes-da-entrega", node: "Orientação ao colaborador", caption: "Output na saída Aprovado", alt: "Painel do Output com o conteúdo do Gerar feedback", marks: [
    { near: "Conteúdo a publicar", text: "O mesmo conteúdo que o Supervisor revisou." },
  ] },
  { id: "escalonar-gerente", workflow: "revisao-antes-da-entrega", node: "Encaminhar ao Gerente", caption: "Escalonar na saída Escalar", alt: "Painel do Escalonar: cargo Gerente, conteúdo do Orquestrador, encerrar este branch", marks: [
    { near: "Destino", text: "Para quem sobe, pela hierarquia." },
    { near: "Após escalonar", text: "Aqui, o caminho termina." },
  ] },
  { id: "aplicar", workflow: "destaques-do-mes", node: "Aplicar individualmente", caption: "Aplicar individualmente: sem configuração própria", alt: "Painel do Aplicar individualmente com a origem e o comportamento", marks: [
    { near: "Origem", text: "A coleção criada pela seleção." },
  ] },
  { id: "output-reconhecimento", workflow: "destaques-do-mes", node: "Reconhecimento ao colaborador", caption: "Output do reconhecimento", alt: "Painel do Output: o próprio colaborador, Acompanhamento, resultado do Especialista de Reconhecimento", marks: [
    { near: "Destinatário", text: "Só existe entre \"Aplicar individualmente\" e \"Consolidar resultados\"." },
    { near: "Conteúdo a publicar", text: "O resultado do agente desta pessoa." },
  ] },
  { id: "consolidar", workflow: "destaques-do-mes", node: "Consolidar resultados", caption: "Consolidar resultados: espera todas as execuções", alt: "Painel do Consolidar resultados com a origem e a espera", marks: [
    { near: "Origem", text: "O \"Aplicar individualmente\" correspondente." },
    { near: "Aguardar", text: "Segue só quando todas terminam." },
  ] },
  { id: "sintese", workflow: "destaques-do-mes", node: "Resumir para a liderança", caption: "Agente de síntese, depois de consolidar", alt: "Painel do Chamar agente com a missão da síntese", marks: [
    { near: "Missão da síntese", text: "O que a liderança precisa saber." },
  ] },
  { id: "agenda-mensal", workflow: "politica-de-acompanhamento", node: "Todo dia 5 às 09:00", caption: "Gatilho por agenda mensal", alt: "Painel do Gatilho: Por agenda, Mensalmente, dia 5 às 09:00", marks: [
    { near: "Frequência", text: "Mensalmente." },
    { near: "Dia", text: "O dia do mês." },
  ] },
  { id: "output-aviso", workflow: "politica-de-acompanhamento", node: "Avisar o Supervisor", caption: "Output do aviso de dados insuficientes", alt: "Painel do Output: Supervisor do operador, Notificação, conteúdo em variável", marks: [
    { near: "Destinatário", text: "A liderança da pessoa." },
    { near: "Onde entregar", text: "No sino." },
  ] },
  { id: "acompanhamento-colaborador", area: "operator", caption: "O que o colaborador vê no Acompanhamento", alt: "Acompanhamento do colaborador com um feedback de monitoria fictício", marks: [
    { near: "Caio, olhei o atendimento sobre a cobrança na fatura.", text: "A orientação começa pelo contexto da chamada." },
    { near: "Entenda este feedback", text: "Os detalhes abrem aqui: a fala, a regra e o que fazer." },
    { near: "Confirmar ciência", text: "A pessoa confirma que leu, com login e senha." },
  ] },
]

const only = process.argv.find((arg) => arg.startsWith("--apenas="))?.slice("--apenas=".length).split(",")
const selected = only ? SHOTS.filter((shot) => only.includes(shot.id)) : SHOTS

mkdirSync(OUT, { recursive: true })
const manifest = JSON.parse(readFileSync(MANIFEST, "utf-8"))

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const context = await browser.newContext({ viewport: { width: 1180, height: 1500 }, deviceScaleFactor: 2, locale: "pt-BR", timezoneId: "America/Fortaleza", colorScheme: "light", reducedMotion: "reduce" })
await context.addCookies([{ name: "inia_session", value: "exemplo-ficticio", url: FRONT }])
const page = await context.newPage()
page.setDefaultTimeout(60_000)

async function openEditor(workflow) {
  await fetch(`${API}/__captura/quem?papel=ADMIN`)
  await page.goto(`${FRONT}/admin/workflows/${workflow}`, { waitUntil: "domcontentloaded" })
  await page.locator(".react-flow__node").first().waitFor()
  await page.waitForTimeout(1200)
}

/** Recorte da área pedida, sem o vazio abaixo do conteúdo. */
async function regionOf(shot) {
  if (shot.area === "canvas") {
    const box = await page.locator(".react-flow").first().boundingBox()
    return { root: page.locator(".react-flow").first(), clip: box }
  }
  if (shot.area === "settings") {
    await page.getByRole("button", { name: "Configurações do workflow" }).click()
    const sheet = page.getByRole("dialog").last()
    await sheet.waitFor()
    await page.waitForTimeout(600)
    const box = await sheet.boundingBox()
    // O botão flutuante da INIA fica fixo no canto: a altura termina antes dele.
    return { root: sheet, clip: { ...box, height: box.height - 120 } }
  }
  if (shot.area === "operator") {
    await fetch(`${API}/__captura/quem?papel=OPERATOR`)
    await page.goto(`${FRONT}/operator`, { waitUntil: "domcontentloaded" })
    const card = page.locator('[data-slot="feedback-card"]').first()
    await card.waitFor()
    await page.waitForTimeout(1500)
    const box = await card.boundingBox()
    const footer = await page.getByText("Este conteúdo foi útil?").first().boundingBox()
    const bottom = footer ? footer.y + footer.height + 16 : box.y + box.height
    return { root: page.locator("main").first(), clip: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: bottom - box.y + 8 } }
  }
  const node = page.locator(".react-flow__node").filter({ hasText: shot.node }).first()
  await node.click({ force: true })
  const aside = page.locator("aside").filter({ has: page.locator('input[aria-label], input') }).last()
  await aside.waitFor()
  await page.waitForTimeout(700)
  // Mede o conteúdo inteiro do painel: o painel rola, então os elementos abaixo da dobra têm de caber na janela.
  const measured = await aside.evaluate((element) => {
    const children = [...element.children]
    const top = element.getBoundingClientRect().top
    return Math.ceil(Math.max(...children.map((child) => child.getBoundingClientRect().bottom)) - top + 32)
  })
  await page.setViewportSize({ width: 1180, height: Math.min(Math.max(1800, measured + 420), 3200) })
  await page.waitForTimeout(500)
  const box = await aside.boundingBox()
  const bottom = await aside.evaluate((element) => Math.max(...[...element.children].map((child) => child.getBoundingClientRect().bottom)))
  return { root: aside, clip: { x: box.x, y: box.y, width: box.width, height: Math.ceil(bottom - box.y + 16) } }
}

for (const shot of selected) {
  // No canvas, a altura acompanha o tamanho do fluxo: o editor ajusta o zoom para caber, e o texto fica legível no print.
  const canvasRows = shot.area === "canvas" ? Math.max(...DEMO_GRAPHS.find((definition) => definition.slug === shot.workflow).graph.nodes.map((node) => node.position.y)) / DEMO_CELL.y + 1 : 0
  await page.setViewportSize({ width: 1180, height: shot.area === "canvas" ? Math.max(860, Math.round(canvasRows * 190 + 240)) : 1800 })
  if (shot.workflow) await openEditor(shot.workflow)
  const { root, clip } = await regionOf(shot)
  const png = await page.screenshot({ clip, animations: "disabled" })
  const output = path.join(OUT, `${shot.id}.webp`)
  const image = sharp(png)
  const metadata = await image.metadata()
  await image.webp({ quality: 84 }).toFile(output)

  const markers = []
  for (const [index, mark] of shot.marks.entries()) {
    const matches = root.getByText(mark.near, { exact: true })
    const target = mark.last ? matches.last() : mark.nth ? matches.nth(mark.nth) : matches.first()
    // A largura do TEXTO, não a da caixa: rótulos de formulário ocupam a linha inteira, e o número ficaria sempre na borda.
    const box = await target.evaluate((element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      const rect = range.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    })
    if (!box.width) throw new Error(`${shot.id}: marcação sem alvo: ${mark.near}`)
    const x = Math.min(((box.x + box.width + 14 - clip.x) / clip.width) * 100, 97)
    const y = ((box.y + box.height / 2 - clip.y) / clip.height) * 100
    markers.push({ n: index + 1, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, text: mark.text })
  }
  manifest[shot.id] = { id: shot.id, src: `/wiki-capturas/workflows/${shot.id}.webp`, width: metadata.width, height: metadata.height, alt: shot.alt, caption: shot.caption, kind: "print", markers }
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`ok ${shot.id} ${metadata.width}x${metadata.height}`)
}

await browser.close()
