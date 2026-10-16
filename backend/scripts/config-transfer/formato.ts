/**
 * Pacote de configuração — o que `config:exportar` grava e `config:importar` lê (IT-INIA-010).
 *
 * Leva o CATÁLOGO que se monta pela Administração (domínios, indicadores, flags, governança, bases, argumentários, agentes,
 * orquestradores, workflows e o cenário da INIA) de uma instalação para outra. Nunca leva dados de operação (pessoas,
 * medições, chamadas, feedbacks, execuções): grupos e pessoas citados pela configuração são procurados no destino pelo nome
 * e pela matrícula, ou trocados pelo de-para.
 *
 * Pasta do pacote:
 *   pacote.json   — os itens (este formato)
 *   selecao.csv   — uma linha por item, coluna `incluir` (sim/não) editável no Excel
 *   de-para.csv   — grupos, subgrupos e pessoas que não existem no destino com o mesmo nome/matrícula (a simulação preenche)
 *   arquivos/     — arquivo original das bases que vieram de PDF/DOCX
 *   imagens/      — imagens do cenário da INIA
 */

export const FORMATO_PACOTE = 1

/** Ordem de criação no destino: cada tipo só depende de tipos anteriores (a estratégia de diagnóstico de um indicador cita uma
 * flag pelo nome; o agente usa bases e domínio; o workflow, agentes, orquestradores, flags e indicadores). */
export const TIPOS = ["ASSUNTO", "DOMINIO", "FLAG", "INDICADOR", "ASSUNTO_PROIBIDO", "GLOSSARIO", "BASE", "ARGUMENTARIO", "AGENTE", "ORQUESTRADOR", "WORKFLOW", "CENARIO"] as const
export type TipoItem = (typeof TIPOS)[number]

/** Nome de cada tipo na planilha e nos relatórios. */
export const ROTULO_TIPO: Record<TipoItem, string> = {
  ASSUNTO: "Assunto das bases",
  DOMINIO: "Domínio de negócio",
  INDICADOR: "Indicador",
  FLAG: "Flag de canal",
  ASSUNTO_PROIBIDO: "Assunto proibido",
  GLOSSARIO: "Glossário",
  BASE: "Base de conhecimento",
  ARGUMENTARIO: "Argumentário",
  AGENTE: "Agente",
  ORQUESTRADOR: "Orquestrador",
  WORKFLOW: "Workflow",
  CENARIO: "Cenário da INIA",
}

/** Alcance (grupo/subgrupo) pelo NOME — os ids mudam de uma instalação para outra. */
export type Alcance = { tipo: "TODOS" } | { tipo: "GRUPO"; grupo: string } | { tipo: "SUBGRUPO"; grupo: string; subgrupo: string }
export type RefPessoa = { matricula: string | null; nome: string; cargo: string }

/** Referência de um workflow a algo de fora do grafo, pelo id que tem NA ORIGEM (o grafo é reescrito com o id do destino). */
export type RefWorkflow =
  | { idOrigem: string; tipo: "ITEM"; item: string }
  | { idOrigem: string; tipo: "PESSOA"; pessoa: RefPessoa }
  | { idOrigem: string; tipo: "GRUPO"; grupo: string }
  | { idOrigem: string; tipo: "SUBGRUPO"; grupo: string; subgrupo: string }
  | { idOrigem: string; tipo: "NAO_TRANSFERIVEL"; descricao: string }

export type DadosItem = {
  ASSUNTO: { name: string; description: string | null; active: boolean }
  DOMINIO: { code: string; name: string; description: string | null; active: boolean }
  INDICADOR: {
    definicao: {
      code: string
      name: string
      unit: string
      desiredDirection: string
      operationalAggregation: string
      dailySupported: boolean
      minimumSampleSize: number | null
      minimumCoverage: number | null
      officialClosureSupported: boolean
      provesWorkActivity: boolean
      availabilityPolicy: unknown
      unjustifiedAbsencePolicy: string
      iconKey: string | null
      active: boolean
    }
    glossario: { description: string; interpretation: string; goodPractices: string; feedbackGuidance: string } | null
    /** Versão PUBLICADA da estratégia de diagnóstico; domínios permitidos pelo código (os ids mudam). */
    estrategia: { config: Record<string, unknown>; dominiosPermitidos: string[]; ativa: boolean } | null
  }
  FLAG: { channel: string; flagName: string; valueType: string; description: string | null; label: string | null; iconKey: string | null; active: boolean }
  ASSUNTO_PROIBIDO: { name: string; requiredBehavior: string; active: boolean }
  GLOSSARIO: { term: string; definition: string; feedbackApplication: string; active: boolean }
  BASE: {
    title: string
    documentType: string
    /** Conteúdo da versão publicada (null = a base nunca foi publicada na origem: vai só como rascunho). */
    publicado: string | null
    /** Rascunho mais novo que a publicação (ou o único conteúdo, se nunca publicada). */
    rascunho: string | null
    alcances: Alcance[]
    /** null = todos os assuntos. */
    assuntos: string[] | null
    arquivo: { caminho: string; nomeOriginal: string; sha256: string } | null
    governancaCheckpoints: boolean
  }
  ARGUMENTARIO: {
    name: string
    dominio: string
    alcance: Alcance
    publicado: { content: unknown; base: string | null; sourceReference: string | null } | null
    rascunho: { content: unknown; base: string | null; sourceReference: string | null } | null
    arquivado: boolean
  }
  AGENTE: {
    name: string
    agentType: string
    objective: string
    description: string
    contextPrompt: string
    alcance: Alcance
    bases: string[]
    specialtyKind: string | null
    dominio: string | null
    capability: string | null
    consolidatedInput: boolean
    specialty: string | null
    recommendSupportMaterials: boolean
    investigationCapabilities: string[]
    actionLimitsEnabled: boolean
    actionLimits: string | null
    active: boolean
  }
  ORQUESTRADOR: {
    name: string
    alcance: Alcance
    agenteOrquestrador: string
    especialistas: string[]
    invocationMode: string
    structuredOutput: unknown
    outputInstructions: string | null
    outputSchema: unknown
    routingPolicy: string | null
    routingDomains: string[]
    policyKind: string | null
    policyDomains: string[]
    recommendSupportMaterials: boolean
    active: boolean
  }
  WORKFLOW: {
    name: string
    description: string | null
    alcance: Alcance
    /** Gatilho como está na origem; o de flag aponta para a flag pelo item (`flag`), não pelo id. */
    gatilho: Record<string, unknown>
    flagGatilho: string | null
    grafo: unknown
    populationFilter: unknown
    consolidatedStructure: unknown
    referencias: RefWorkflow[]
    active: boolean
    publicadoNaOrigem: boolean
  }
  CENARIO: {
    name: string
    scheduleStart: string | null
    scheduleEnd: string | null
    blur: number
    dim: number
    padrao: boolean
    imagens: { label: string; start: string | null; end: string | null; primary: boolean; caminho: string; sha256: string }[]
  }
}

export type Item<T extends TipoItem = TipoItem> = {
  [K in T]: {
    tipo: K
    /** Chave natural, única por tipo: código (domínio/indicador), canal/nome (flag) ou nome. */
    chave: string
    nome: string
    idOrigem: string
    /** Itens sem os quais este não funciona (`TIPO:chave`). */
    dependencias: string[]
    /** Itens que este usa mas que podem faltar (a ligação é descartada com aviso). */
    opcionais: string[]
    sugestao: { incluir: boolean; motivo: string }
    dados: DadosItem[K]
  }
}[T]

export type Pacote = {
  formato: typeof FORMATO_PACOTE
  geradoEm: string
  origem: { organizacao: string; banco: string }
  itens: Item[]
}

export const chaveDe = (tipo: TipoItem, chave: string) => `${tipo}:${chave}`
export const chaveDoItem = (item: Pick<Item, "tipo" | "chave">) => chaveDe(item.tipo, item.chave)
export const normalizar = (texto: string) => texto.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR")

export function descreverAlcance(alcance: Alcance): string {
  if (alcance.tipo === "TODOS") return "Todos os grupos"
  return alcance.tipo === "GRUPO" ? alcance.grupo : `${alcance.grupo} / ${alcance.subgrupo}`
}

// ─── Sugestão do que é teste ─────────────────────────────────────────────────────────────────────────────────────────────

const PADROES_DE_TESTE: { padrao: RegExp; motivo: string }[] = [
  // "TESTE - Agente…", "TESTE: …" ou tudo em maiúsculas — nunca "Teste de confirmação…" (argumentário de verdade).
  { padrao: /^\s*teste\s*[-–—:]/i, motivo: "nome indica teste" },
  { padrao: /^\s*TESTE\b/, motivo: "nome indica teste" },
  { padrao: /^\s*\[poc tools\]/i, motivo: "prova de conceito de Tools" },
  { padrao: /\bsmoke\b/i, motivo: "smoke (teste técnico)" },
  { padrao: /^\s*qa\s*·/i, motivo: "QA (teste técnico)" },
  { padrao: /^\s*golden (demo|smoke)\b/i, motivo: "roteiro de teste (golden)" },
  { padrao: /^\s*demo\s*·/i, motivo: "demonstração" },
  { padrao: /\(demo\)/i, motivo: "demonstração" },
  { padrao: /\(demonstra[çc][ãa]o\)/i, motivo: "demonstração" },
]

/** Primeira sugestão de cada item (o administrador revisa na planilha): nome de teste, flag de smoke, grupo de demonstração. */
export function sugerirInclusao(nome: string, extras: { alcances?: Alcance[]; motivoFixo?: string | null } = {}): { incluir: boolean; motivo: string } {
  if (extras.motivoFixo) return { incluir: false, motivo: extras.motivoFixo }
  const teste = PADROES_DE_TESTE.find(({ padrao }) => padrao.test(nome))
  if (teste) return { incluir: false, motivo: teste.motivo }
  const grupoDemo = (extras.alcances ?? []).find((alcance) => alcance.tipo !== "TODOS" && /\bdemo\b/i.test(alcance.grupo))
  if (grupoDemo && grupoDemo.tipo !== "TODOS") return { incluir: false, motivo: `alcance no grupo de demonstração "${grupoDemo.grupo}"` }
  return { incluir: true, motivo: "" }
}

/** Item que depende de outro sugerido como "não" também sai — senão a importação bloquearia por dependência. */
export function propagarExclusoes(itens: Item[]): void {
  const porChave = new Map(itens.map((item) => [chaveDoItem(item), item]))
  for (let mudou = true; mudou; ) {
    mudou = false
    for (const item of itens) {
      if (!item.sugestao.incluir) continue
      const fora = item.dependencias.map((chave) => porChave.get(chave)).find((dependencia) => dependencia && !dependencia.sugestao.incluir)
      if (!fora) continue
      item.sugestao = { incluir: false, motivo: `depende de ${ROTULO_TIPO[fora.tipo].toLowerCase()} "${fora.nome}", que ficou de fora` }
      mudou = true
    }
  }
}

// ─── CSV (Excel BR: ponto e vírgula, UTF-8 com BOM) ──────────────────────────────────────────────────────────────────────

const BOM = "\uFEFF"

function campoCsv(valor: string): string {
  return /[;"\r\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor
}

export function gerarCsv(cabecalho: string[], linhas: string[][]): string {
  return BOM + [cabecalho, ...linhas].map((linha) => linha.map(campoCsv).join(";")).join("\r\n") + "\r\n"
}

/** Lê o CSV de volta aceitando `;` ou `,` (o Excel de outra região pode trocar) e aspas com quebras de linha. */
export function lerCsv(texto: string): Record<string, string>[] {
  const conteudo = texto.replace(/^\uFEFF/, "")
  const primeiraLinha = conteudo.split(/\r?\n/, 1)[0] ?? ""
  const separador = primeiraLinha.includes(";") ? ";" : ","
  const linhas: string[][] = []
  let campo = ""
  let linha: string[] = []
  let aspas = false
  for (let i = 0; i < conteudo.length; i++) {
    const c = conteudo[i]!
    if (aspas) {
      if (c === '"' && conteudo[i + 1] === '"') {
        campo += '"'
        i++
      } else if (c === '"') aspas = false
      else campo += c
      continue
    }
    if (c === '"') aspas = true
    else if (c === separador) {
      linha.push(campo)
      campo = ""
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && conteudo[i + 1] === "\n") i++
      linha.push(campo)
      linhas.push(linha)
      linha = []
      campo = ""
    } else campo += c
  }
  if (campo !== "" || linha.length) {
    linha.push(campo)
    linhas.push(linha)
  }
  const [cabecalho, ...dados] = linhas.filter((valores) => valores.some((valor) => valor.trim() !== ""))
  if (!cabecalho) return []
  const nomes = cabecalho.map((nome) => normalizar(nome))
  return dados.map((valores) => Object.fromEntries(nomes.map((nome, indice) => [nome, (valores[indice] ?? "").trim()])))
}

/** "sim"/"não" da planilha (aceita s, n, x, 1, 0, yes, no). Vazio = não. */
export function lerSimNao(valor: string): boolean {
  return /^(s|sim|x|1|y|yes|true|verdadeiro)$/i.test(valor.normalize("NFD").replace(/[̀-ͯ]/g, "").trim())
}

// ─── selecao.csv ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export const CABECALHO_SELECAO = ["tipo", "nome", "incluir", "motivo", "chave"]

export function gerarSelecao(itens: Item[], escolhasAnteriores: Map<string, boolean>): string {
  const linhas = itens.map((item) => {
    const chave = chaveDoItem(item)
    const anterior = escolhasAnteriores.get(chave)
    const incluir = anterior ?? item.sugestao.incluir
    const motivo = anterior === undefined ? item.sugestao.motivo : anterior === item.sugestao.incluir ? item.sugestao.motivo : "escolha anterior mantida"
    return [ROTULO_TIPO[item.tipo], item.nome, incluir ? "sim" : "não", motivo, chave]
  })
  return gerarCsv(CABECALHO_SELECAO, linhas)
}

/** chave → incluir. */
export function lerSelecao(texto: string): Map<string, boolean> {
  const escolhas = new Map<string, boolean>()
  for (const linha of lerCsv(texto)) if (linha.chave) escolhas.set(linha.chave, lerSimNao(linha.incluir ?? ""))
  return escolhas
}

// ─── de-para.csv ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type TipoDePara = "GRUPO" | "SUBGRUPO" | "PESSOA"
export const CABECALHO_DE_PARA = ["tipo", "origem", "destino", "onde aparece"]

/** Origem/destino como a planilha mostra: grupo = nome; subgrupo = "Grupo / Subgrupo"; pessoa = matrícula (ou nome, sem matrícula). */
export const origemDeSubgrupo = (grupo: string, subgrupo: string) => `${grupo} / ${subgrupo}`
export const origemDePessoa = (pessoa: RefPessoa) => pessoa.matricula ?? pessoa.nome

export function separarSubgrupo(texto: string): { grupo: string; subgrupo: string } | null {
  const posicao = texto.lastIndexOf(" / ")
  if (posicao <= 0) return null
  return { grupo: texto.slice(0, posicao).trim(), subgrupo: texto.slice(posicao + 3).trim() }
}

export type LinhaDePara = { tipo: TipoDePara; origem: string; destino: string; ondeAparece: string }

export function lerDePara(texto: string): LinhaDePara[] {
  return lerCsv(texto)
    .map((linha) => ({ tipo: (linha.tipo ?? "").toUpperCase() as TipoDePara, origem: linha.origem ?? "", destino: linha.destino ?? "", ondeAparece: linha["onde aparece"] ?? "" }))
    .filter((linha) => ["GRUPO", "SUBGRUPO", "PESSOA"].includes(linha.tipo) && linha.origem)
}

export function gerarDePara(linhas: LinhaDePara[]): string {
  return gerarCsv(CABECALHO_DE_PARA, linhas.map((linha) => [linha.tipo, linha.origem, linha.destino, linha.ondeAparece]))
}

/** "HH:MM" de um minuto do dia (faixa de horário das imagens do cenário). */
export function horaDeMinuto(minuto: number | null): string | null {
  if (minuto === null) return null
  return `${String(Math.floor(minuto / 60)).padStart(2, "0")}:${String(minuto % 60).padStart(2, "0")}`
}

export function slug(texto: string): string {
  return (
    texto
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "item"
  )
}
