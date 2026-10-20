/**
 * `npm run config:importar` — leva um pacote de configuração (`config:exportar`) para OUTRA instalação da INIA pela API dela,
 * com a conta de um Administrador geral do destino. Passo a passo: IT-INIA-010.
 *
 *   npm run config:importar -- --pacote <pasta> --destino https://inia.empresa.com.br              → SIMULAÇÃO (não grava nada)
 *   npm run config:importar -- --pacote <pasta> --destino https://inia.empresa.com.br --executar  → cria no destino
 *   npm run config:importar -- --pacote <pasta> --sair                                           → encerra a sessão
 *
 * Só CRIA: o que já existe no destino com o mesmo nome/código fica como está (rodar de novo continua de onde parou). Workflows
 * entram sempre como rascunho. Grupos, subgrupos e pessoas são procurados pelo nome/matrícula ou trocados pelo de-para.csv.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { extname, join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { ask, fail, say } from "../../src/infrastructure/installation/cli.js"
import { ClienteInia, ErroApi, perguntarSenha } from "./cliente.js"
import { FORMATO_PACOTE, ROTULO_TIPO, chaveDe, lerArquivoDoPacote, chaveDoItem, gerarDePara, lerDePara, lerSelecao, normalizar, type Item, type Pacote, type TipoItem } from "./formato.js"
import { chaveDeAlcance, chaveNoDestino, descreverPlano, montarPlano, type AlcanceResolvido, type Destino, type Grupo, type LinhaDoPlano, type Pessoa, type Plano } from "./plano.js"

const { values } = parseArgs({
  options: {
    pacote: { type: "string" },
    destino: { type: "string" },
    email: { type: "string" },
    executar: { type: "boolean", default: false },
    sair: { type: "boolean", default: false },
  },
})
const pastaInicial = process.env.INIT_CWD ?? process.cwd()
if (!values.pacote) fail('Informe a pasta do pacote: --pacote "<pasta criada pelo config:exportar>"')
const pasta = resolve(pastaInicial, values.pacote)

if (values.sair) {
  say((await ClienteInia.sair(pasta)) ? "Sessão encerrada no destino e apagada deste computador." : "Não havia sessão gravada para este pacote.")
  process.exit(0)
}
if (!values.destino) fail("Informe o endereço da INIA de destino: --destino https://inia.empresa.com.br")
if (!existsSync(join(pasta, "pacote.json"))) fail(`Não encontrei ${join(pasta, "pacote.json")} — gere o pacote com npm run config:exportar.`)

const pacote = JSON.parse(readFileSync(join(pasta, "pacote.json"), "utf8")) as Pacote
if (pacote.formato !== FORMATO_PACOTE) fail(`Pacote no formato ${pacote.formato}; esta versão da INIA lê o formato ${FORMATO_PACOTE}. Exporte de novo.`)
const selecao = existsSync(join(pasta, "selecao.csv")) ? lerSelecao(readFileSync(join(pasta, "selecao.csv"), "utf8")) : new Map<string, boolean>()
const deParaAtual = existsSync(join(pasta, "de-para.csv")) ? lerDePara(readFileSync(join(pasta, "de-para.csv"), "utf8")) : []
// Antes de qualquer conexão (simulação inclusive): todo arquivo citado fica dentro do pacote e é o que foi exportado.
for (const item of pacote.itens) {
  const citados = item.tipo === "BASE" ? (item.dados.arquivo ? [item.dados.arquivo] : []) : item.tipo === "CENARIO" ? item.dados.imagens : []
  for (const arquivo of citados) {
    try {
      lerArquivoDoPacote(pasta, arquivo.caminho, arquivo.sha256, (absoluto) => readFileSync(absoluto))
    } catch (error) {
      fail(`${item.nome}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

// ─── Sessão ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

async function conectar(destino: string): Promise<ClienteInia> {
  const retomada = await ClienteInia.retomar(pasta, destino, values.email)
  if (retomada) {
    say(`Usando a sessão já aberta em ${destino} (para encerrar: --sair).`)
    return retomada
  }
  const email = values.email ?? (await ask("E-mail do Administrador geral no destino"))
  const senha = await perguntarSenha(`Senha de ${email} em ${destino} (não aparece enquanto digita): `)
  const cliente = await ClienteInia.entrar(pasta, destino, email, senha)
  say("✓ Login feito. A sessão fica guardada no seu perfil (fora do pacote) até você rodar com --sair (ou expirar).")
  return cliente
}

// ─── Leitura do destino ──────────────────────────────────────────────────────────────────────────────────────────────────

type Linha = Record<string, unknown>
const lista = (dados: unknown): Linha[] => (Array.isArray(dados) ? (dados as Linha[]) : ((dados as { items?: Linha[] } | null)?.items ?? []))
const texto = (valor: unknown) => (typeof valor === "string" ? valor : valor === null || valor === undefined ? "" : String(valor))

async function lerDestino(cliente: ClienteInia, itens: Item[]): Promise<Destino> {
  const itensDoDestino = new Map<string, { id: string; nome: string }>()
  const registrar = (tipo: TipoItem, linhas: Linha[], chave: (linha: Linha) => string, nome: (linha: Linha) => string = chave) => {
    for (const linha of linhas)
      itensDoDestino.set(chaveNoDestino(tipo, chave(linha)), {
        id: texto(linha.id),
        nome: nome(linha),
      })
  }
  registrar("ASSUNTO", lista(await cliente.get("/api/v1/admin/org-structure/subjects")), (linha) => texto(linha.name))
  registrar(
    "DOMINIO",
    lista(await cliente.get("/api/v1/admin/business-domains?includeInactive=true")),
    (linha) => texto(linha.code),
    (linha) => texto(linha.name),
  )
  const indicadores = lista(await cliente.get("/api/v1/admin/indicator-rules"))
  registrar(
    "INDICADOR",
    indicadores,
    (linha) => texto(linha.code),
    (linha) => texto(linha.name),
  )
  registrar("FLAG", lista(await cliente.get("/api/v1/admin/channel-flags")), (linha) => `${texto(linha.channel)}/${texto(linha.flagName)}`)
  registrar("ASSUNTO_PROIBIDO", lista(await cliente.get("/api/v1/admin/prohibited-topics")), (linha) => texto(linha.name))
  registrar("GLOSSARIO", lista(await cliente.get("/api/v1/admin/glossary")), (linha) => texto(linha.term))
  registrar("BASE", lista(await cliente.get("/api/v1/admin/knowledge")), (linha) => texto(linha.title))
  registrar("ARGUMENTARIO", lista(await cliente.get("/api/v1/admin/argument-scripts")), (linha) => texto(linha.name))
  registrar("AGENTE", lista(await cliente.get("/api/v1/admin/agents")), (linha) => texto(linha.name))
  const orquestradores = lista(await cliente.get("/api/v1/admin/assistant-orchestrators"))
  registrar("ORQUESTRADOR", orquestradores, (linha) => texto(linha.name))
  registrar("WORKFLOW", lista(await cliente.get("/api/v1/admin/workflows")), (linha) => texto(linha.name))
  const cenarios = await cliente.get<{
    scenes: Linha[]
    defaultSceneId: string | null
  }>("/api/v1/admin/inia-scenes")
  registrar("CENARIO", cenarios.scenes, (linha) => texto(linha.name))

  const grupos = new Map<string, Grupo>()
  for (const grupo of lista(await cliente.get("/api/v1/admin/org-structure/teams"))) {
    const subgrupos = new Map(lista(grupo.subteams).map((subgrupo) => [normalizar(texto(subgrupo.name)), { id: texto(subgrupo.id), nome: texto(subgrupo.name) }]))
    grupos.set(normalizar(texto(grupo.name)), {
      id: texto(grupo.id),
      nome: texto(grupo.name),
      subgrupos,
    })
  }
  const pessoas = new Map<string, Pessoa>()
  for (const pessoa of lista(await cliente.get("/api/v1/admin/users"))) {
    const registro: Pessoa = {
      id: texto(pessoa.id),
      nome: texto(pessoa.name),
      ativo: pessoa.active === true,
      cargo: texto(pessoa.role),
    }
    // Matrícula primeiro; quem não tem matrícula é achado pelo nome (só se o nome for único e a pessoa estiver ativa).
    if (pessoa.matricula) pessoas.set(normalizar(texto(pessoa.matricula)), registro)
    else if (!pessoas.has(normalizar(registro.nome))) pessoas.set(normalizar(registro.nome), registro)
  }

  // Complementos de indicador que já existe: só se o destino ainda não tiver glossário / estratégia.
  const indicadoresSemGlossario = new Set(indicadores.filter((linha) => !linha.glossaryDescription).map((linha) => texto(linha.code).toUpperCase()))
  const indicadoresSemEstrategia = new Set<string>()
  const idDoIndicador = new Map(indicadores.map((linha) => [texto(linha.code).toUpperCase(), texto(linha.id)]))
  for (const item of itens) {
    if (item.tipo !== "INDICADOR" || !item.dados.estrategia) continue
    const id = idDoIndicador.get(item.dados.definicao.code.toUpperCase())
    if (!id) continue
    // Sem versão PUBLICADA (nunca configurada ou só rascunho) = sem estratégia: a importação publica a do pacote.
    const visao = await cliente.get<{ published: unknown }>(`/api/v1/admin/indicator-diagnostic-strategies/indicators/${id}`)
    if (!visao.published) indicadoresSemEstrategia.add(item.dados.definicao.code.toUpperCase())
  }

  const chatAtivoPorAlcance = new Map<string, string>()
  for (const orquestrador of orquestradores) {
    if (orquestrador.active !== true || orquestrador.invocationMode === "WORKFLOW") continue
    const alcance: AlcanceResolvido = orquestrador.subteamId
      ? {
          scopeType: "SUBTEAM",
          teamId: texto(orquestrador.teamId),
          subteamId: texto(orquestrador.subteamId),
        }
      : orquestrador.teamId
        ? { scopeType: "TEAM", teamId: texto(orquestrador.teamId) }
        : { scopeType: "ALL_TEAMS" }
    chatAtivoPorAlcance.set(chaveDeAlcance(alcance), texto(orquestrador.name))
  }

  const padrao = cenarios.scenes.find((cenario) => cenario.id === cenarios.defaultSceneId)
  return {
    itens: itensDoDestino,
    grupos,
    pessoas,
    indicadoresSemGlossario,
    indicadoresSemEstrategia,
    chatAtivoPorAlcance,
    cenarios: cenarios.scenes.map((cenario) => ({
      nome: texto(cenario.name),
      inicio: (cenario.scheduleStart as string | null) ?? null,
      fim: (cenario.scheduleEnd as string | null) ?? null,
    })),
    cenarioPadrao: padrao ? texto(padrao.name) : null,
  }
}

// ─── Execução ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const MIME_POR_EXTENSAO: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
}

function arquivoDoPacote(caminho: string, sha256: string): Blob {
  const conteudo = lerArquivoDoPacote(pasta, caminho, sha256, (absoluto) => readFileSync(absoluto))
  return new Blob([new Uint8Array(conteudo)], {
    type: MIME_POR_EXTENSAO[extname(caminho).toLowerCase()] ?? "application/octet-stream",
  })
}

/** Remove null/undefined (os schemas da API aceitam o campo ausente, nem sempre o null). */
function semVazios<T extends Record<string, unknown>>(objeto: T): Partial<T> {
  return Object.fromEntries(Object.entries(objeto).filter(([, valor]) => valor !== null && valor !== undefined)) as Partial<T>
}

const alcanceNoCorpo = (alcance: AlcanceResolvido | null) =>
  !alcance || alcance.scopeType === "ALL_TEAMS"
    ? { scopeType: "ALL_TEAMS" }
    : alcance.scopeType === "TEAM"
      ? { scopeType: "TEAM", teamId: alcance.teamId }
      : {
          scopeType: "SUBTEAM",
          teamId: alcance.teamId,
          subteamId: alcance.subteamId,
        }

async function executar(cliente: ClienteInia, plano: Plano, estado: Destino): Promise<void> {
  const ids = new Map<string, string>()
  for (const linha of plano.linhas) if (linha.idDestino) ids.set(chaveDoItem(linha.item), linha.idDestino)
  const idDe = (tipo: TipoItem, chave: string): string | null => ids.get(chaveDe(tipo, chave)) ?? estado.itens.get(chaveNoDestino(tipo, chave))?.id ?? null
  const criados: { tipo: string; nome: string; id: string; avisos?: string[] }[] = []
  let cenarioPadraoCriado: string | null = null

  say("")
  for (const linha of plano.linhas) {
    if (linha.situacao === "EXISTE" && linha.complementos.length && linha.item.tipo === "INDICADOR") {
      const avisos = await complementarIndicador(cliente, linha.item, linha.idDestino!, linha.complementos, idDe)
      say(
        `  ✓ ${ROTULO_TIPO.INDICADOR} "${linha.item.nome}" (já existia): ${linha.complementos.map((c) => (c === "GLOSSARIO" ? "glossário" : "estratégia de diagnóstico")).join(" e ")} acrescentado(s)`,
      )
      for (const aviso of avisos) say(`    ⚠ ${aviso}`)
      continue
    }
    if (linha.situacao !== "CRIAR") continue
    const item = linha.item
    const registro: Registro = { desfazer: null, avisos: [] }
    try {
      const id = await criar(cliente, linha, idDe, registro)
      ids.set(chaveDoItem(item), id)
      criados.push({ tipo: ROTULO_TIPO[item.tipo], nome: item.nome, id, ...(registro.avisos.length ? { avisos: registro.avisos } : {}) })
      if (item.tipo === "CENARIO" && item.dados.padrao && !estado.cenarioPadrao) cenarioPadraoCriado = id
      say(`  ✓ ${ROTULO_TIPO[item.tipo]} "${item.nome}"`)
      for (const aviso of registro.avisos) say(`    ⚠ ${aviso}`)
    } catch (error) {
      gravarResultado(criados, `${ROTULO_TIPO[item.tipo]} "${item.nome}": ${error instanceof Error ? error.message : String(error)}`)
      const detalhe = error instanceof ErroApi && error.detalhes ? `\n    detalhes: ${JSON.stringify(error.detalhes).slice(0, 600)}` : ""
      // O item que falhou no meio (ex.: indicador criado e estratégia recusada) é desfeito, para a próxima rodada criá-lo inteiro.
      let desfeito = "Nada deste item ficou no destino."
      if (registro.desfazer) {
        try {
          await cliente.excluir(registro.desfazer)
          desfeito = "O que já tinha sido criado deste item foi desfeito."
        } catch {
          desfeito = "ATENÇÃO: este item ficou pela metade no destino e não consegui desfazê-lo — apague-o pela tela antes de rodar de novo."
        }
      }
      fail(
        `${ROTULO_TIPO[item.tipo]} "${item.nome}" falhou: ${error instanceof Error ? error.message : String(error)}${error instanceof ErroApi ? ` (${error.codigo})` : ""}${detalhe}\n` +
          `  ${desfeito}\n` +
          `  ${criados.length} item(ns) foram criados antes da falha (resultado-importacao.json) e ficam: corrija e rode de novo, a importação continua de onde parou.`,
      )
    }
  }
  if (cenarioPadraoCriado) {
    await cliente.put("/api/v1/admin/inia-scenes/default", {
      sceneId: cenarioPadraoCriado,
    })
    say("  ✓ Cenário padrão definido")
  }
  gravarResultado(criados, null)
  say(`\n✓ Importação concluída: ${criados.length} item(ns) criados. Resultado: ${join(pasta, "resultado-importacao.json")}`)
  say("  Workflows entraram como rascunho: revise e publique no editor de cada um. Ao terminar, encerre a sessão: --sair")
}

function gravarResultado(criados: { tipo: string; nome: string; id: string; avisos?: string[] }[], falha: string | null) {
  writeFileSync(
    join(pasta, "resultado-importacao.json"),
    JSON.stringify(
      {
        concluidoEm: new Date().toISOString(),
        destino: values.destino,
        falha,
        criados,
      },
      null,
      2,
    ),
  )
}

type IdDe = (tipo: TipoItem, chave: string) => string | null
/** Endereço para desfazer o item se um passo depois da criação falhar (DELETE) e avisos do que entrou diferente da origem. */
type Registro = { desfazer: string | null; avisos: string[] }

async function criar(cliente: ClienteInia, linha: LinhaDoPlano, idDe: IdDe, registro: Registro): Promise<string> {
  const item = linha.item
  switch (item.tipo) {
    case "ASSUNTO":
      return (
        await cliente.post<{ id: string }>(
          "/api/v1/admin/org-structure/subjects",
          semVazios({
            name: item.dados.name,
            description: item.dados.description,
          }),
        )
      ).id
    case "DOMINIO":
      return (await cliente.post<{ id: string }>("/api/v1/admin/business-domains", semVazios({ ...item.dados }))).id
    case "INDICADOR": {
      const id = (await cliente.post<{ id: string }>("/api/v1/admin/indicator-rules/definitions", semVazios({ ...item.dados.definicao }))).id
      registro.desfazer = `/api/v1/admin/indicator-rules/definitions/${id}`
      registro.avisos.push(...(await complementarIndicador(cliente, item, id, [...(item.dados.glossario ? (["GLOSSARIO"] as const) : []), ...(item.dados.estrategia ? (["ESTRATEGIA"] as const) : [])], idDe)))
      return id
    }
    case "FLAG": {
      const { active, ...dados } = item.dados
      const id = (await cliente.post<{ id: string }>("/api/v1/admin/channel-flags", semVazios(dados))).id
      registro.desfazer = `/api/v1/admin/channel-flags/${id}`
      if (!active)
        await cliente.patch(`/api/v1/admin/channel-flags/${id}`, {
          active: false,
        })
      return id
    }
    case "ASSUNTO_PROIBIDO": {
      const id = (
        await cliente.post<{ id: string }>("/api/v1/admin/prohibited-topics", {
          name: item.dados.name,
          requiredBehavior: item.dados.requiredBehavior,
        })
      ).id
      if (!item.dados.active)
        await cliente.patch(`/api/v1/admin/prohibited-topics/${id}`, {
          active: false,
        })
      return id
    }
    case "GLOSSARIO": {
      const id = (
        await cliente.post<{ id: string }>("/api/v1/admin/glossary", {
          term: item.dados.term,
          definition: item.dados.definition,
          feedbackApplication: item.dados.feedbackApplication,
        })
      ).id
      if (!item.dados.active) await cliente.patch(`/api/v1/admin/glossary/${id}`, { active: false })
      return id
    }
    case "BASE":
      return criarBase(cliente, linha, item as Item<"BASE">, idDe, registro)
    case "ARGUMENTARIO":
      return criarArgumentario(cliente, linha, item as Item<"ARGUMENTARIO">, idDe, registro)
    case "AGENTE": {
      const dados = item.dados
      const especialidade = dados.specialtyKind
        ? {
            specialtyKind: dados.specialtyKind,
            businessDomainId: dados.dominio ? idDe("DOMINIO", dados.dominio) : null,
            capability: dados.capability,
            consolidatedInput: dados.consolidatedInput,
          }
        : dados.specialty
          ? { specialty: dados.specialty }
          : {}
      const corpo = {
        name: dados.name,
        agentType: dados.agentType,
        objective: dados.objective,
        description: dados.description,
        contextPrompt: dados.contextPrompt,
        ...alcanceNoCorpo(linha.alcance),
        knowledgeDocumentIds: dados.bases.map((titulo) => idDe("BASE", titulo)).filter((id): id is string => Boolean(id)),
        ...semVazios(especialidade),
        recommendSupportMaterials: dados.recommendSupportMaterials,
        investigationCapabilities: dados.investigationCapabilities,
        actionLimitsEnabled: dados.actionLimitsEnabled,
        ...semVazios({ actionLimits: dados.actionLimits }),
      }
      const id = (await cliente.post<{ id: string }>("/api/v1/admin/agents", corpo)).id
      registro.desfazer = `/api/v1/admin/agents/${id}`
      if (!dados.active) await cliente.patch(`/api/v1/admin/agents/${id}`, { active: false })
      return id
    }
    case "ORQUESTRADOR": {
      const dados = item.dados
      const saida = dados.structuredOutput
        ? { structuredOutput: dados.structuredOutput }
        : semVazios({
            outputInstructions: dados.outputInstructions,
            outputSchema: dados.outputSchema,
          })
      const politica = dados.routingPolicy
        ? {
            routingPolicy: dados.routingPolicy,
            ...(dados.routingPolicy === "DOMAINS" ? { routingDomains: dados.routingDomains } : {}),
          }
        : dados.policyKind
          ? { policyKind: dados.policyKind, policyDomains: dados.policyDomains }
          : {}
      const corpo = {
        name: dados.name,
        ...alcanceNoCorpo(linha.alcance),
        orchestratorAgentId: idDe("AGENTE", dados.agenteOrquestrador),
        specialistAgentIds: dados.especialistas.map((nome) => idDe("AGENTE", nome)),
        invocationMode: dados.invocationMode,
        recommendSupportMaterials: dados.recommendSupportMaterials,
        ...saida,
        ...politica,
      }
      const id = (await cliente.post<{ id: string }>("/api/v1/admin/assistant-orchestrators", corpo)).id
      registro.desfazer = `/api/v1/admin/assistant-orchestrators/${id}`
      if (!dados.active)
        await cliente.patch(`/api/v1/admin/assistant-orchestrators/${id}`, {
          active: false,
        })
      return id
    }
    case "WORKFLOW":
      return criarWorkflow(cliente, linha, item as Item<"WORKFLOW">, idDe, registro)
    case "CENARIO": {
      const dados = item.dados
      const formulario = new FormData()
      formulario.set("name", dados.name)
      if (dados.scheduleStart && dados.scheduleEnd) {
        formulario.set("scheduleStart", dados.scheduleStart)
        formulario.set("scheduleEnd", dados.scheduleEnd)
      }
      formulario.set("blur", String(dados.blur))
      formulario.set("dim", String(dados.dim))
      formulario.set(
        "images",
        JSON.stringify(
          dados.imagens.map((imagem, indice) => ({
            file: `file-${indice}`,
            label: imagem.label,
            start: imagem.start,
            end: imagem.end,
            primary: imagem.primary,
          })),
        ),
      )
      dados.imagens.forEach((imagem, indice) => formulario.set(`file-${indice}`, arquivoDoPacote(imagem.caminho, imagem.sha256), imagem.caminho.split("/").pop()))
      return (await cliente.postFormulario<{ id: string }>("/api/v1/admin/inia-scenes", formulario)).id
    }
  }
}

/** Glossário e estratégia de diagnóstico. Estratégia que as regras de hoje recusam publicar (ex.: publicada na origem antes de
 * uma regra nova) fica como RASCUNHO no destino, com o motivo no aviso — o indicador entra do mesmo jeito. */
async function complementarIndicador(cliente: ClienteInia, item: Item, id: string, complementos: readonly ("GLOSSARIO" | "ESTRATEGIA")[], idDe: IdDe): Promise<string[]> {
  if (item.tipo !== "INDICADOR") return []
  const { glossario, estrategia } = item.dados
  if (complementos.includes("GLOSSARIO") && glossario)
    await cliente.put("/api/v1/admin/indicator-rules/glossary", {
      indicatorDefinitionId: id,
      ...glossario,
    })
  if (complementos.includes("ESTRATEGIA") && estrategia) {
    const config = {
      ...estrategia.config,
      allowedBusinessDomainIds: estrategia.dominiosPermitidos.map((codigo) => idDe("DOMINIO", codigo)).filter(Boolean),
    }
    await cliente.put(`/api/v1/admin/indicator-diagnostic-strategies/indicators/${id}/draft`, { config })
    try {
      await cliente.post(`/api/v1/admin/indicator-diagnostic-strategies/indicators/${id}/publish`)
    } catch (error) {
      if (!(error instanceof ErroApi) || error.status !== 422) throw error
      const problemas = ((error.detalhes as { issues?: { message?: string }[] } | undefined)?.issues ?? []).map((issue) => issue.message).filter(Boolean)
      return [`a estratégia de diagnóstico ficou em RASCUNHO no destino (as regras de hoje não deixam publicar: ${problemas.join("; ") || error.message}) — complete em Indicadores › Estratégia de diagnóstico e publique`]
    }
    if (!estrategia.ativa) await cliente.post(`/api/v1/admin/indicator-diagnostic-strategies/indicators/${id}/active`, { active: false })
  }
  return []
}

async function criarBase(cliente: ClienteInia, linha: LinhaDoPlano, item: Item<"BASE">, idDe: IdDe, registro: Registro): Promise<string> {
  const dados = item.dados
  const orgScopes = linha.alcances.map(alcanceNoCorpo)
  const subjectScopes = dados.assuntos
    ? dados.assuntos.map((assunto) => ({
        scopeType: "SUBJECT",
        subjectId: idDe("ASSUNTO", assunto),
      }))
    : [{ scopeType: "ALL_SUBJECTS" }]
  const conteudoInicial = (dados.publicado ?? dados.rascunho ?? "").trim()
  let id: string
  if (dados.arquivo) {
    // Mantém o arquivo original (o "baixar original" da tela); o texto extraído no destino vira a versão 1 e, se diferir do
    // texto publicado na origem (que pode ter sido editado depois), o texto da origem entra como versão 2.
    const formulario = new FormData()
    formulario.set("title", dados.title)
    formulario.set("documentType", dados.documentType)
    formulario.set("orgScopes", JSON.stringify(orgScopes))
    formulario.set("subjectScopes", JSON.stringify(subjectScopes))
    formulario.set("file", arquivoDoPacote(dados.arquivo.caminho, dados.arquivo.sha256), dados.arquivo.nomeOriginal)
    id = (await cliente.postFormulario<{ id: string }>("/api/v1/admin/knowledge", formulario)).id
    registro.desfazer = `/api/v1/admin/knowledge/${id}`
    const detalhe = await cliente.get<{ latestVersion?: { content?: string } }>(`/api/v1/admin/knowledge/${id}`)
    const igual = (detalhe.latestVersion?.content ?? "").trim() === conteudoInicial
    if (dados.publicado !== null) await cliente.patch(`/api/v1/admin/knowledge/${id}`, igual ? { status: "PUBLISHED" } : { content: conteudoInicial, status: "PUBLISHED" })
    else if (!igual)
      await cliente.patch(`/api/v1/admin/knowledge/${id}`, {
        content: conteudoInicial,
      })
  } else {
    id = (
      await cliente.post<{ id: string }>("/api/v1/admin/knowledge", {
        title: dados.title,
        documentType: dados.documentType,
        content: conteudoInicial,
        orgScopes: JSON.stringify(orgScopes),
        subjectScopes: JSON.stringify(subjectScopes),
      })
    ).id
    registro.desfazer = `/api/v1/admin/knowledge/${id}`
    if (dados.publicado !== null)
      await cliente.patch(`/api/v1/admin/knowledge/${id}`, {
        status: "PUBLISHED",
      })
  }
  if (dados.publicado !== null && dados.rascunho !== null)
    await cliente.patch(`/api/v1/admin/knowledge/${id}`, {
      content: dados.rascunho.trim(),
    })
  if (dados.governancaCheckpoints)
    await cliente.post(`/api/v1/admin/checkpoints/documents/${id}/governance`, {
      enabled: true,
    })
  return id
}

async function criarArgumentario(cliente: ClienteInia, linha: LinhaDoPlano, item: Item<"ARGUMENTARIO">, idDe: IdDe, registro: Registro): Promise<string> {
  const dados = item.dados
  const versao = (origem: NonNullable<typeof dados.publicado>) =>
    semVazios({
      content: origem.content,
      sourceDocumentId: origem.base ? idDe("BASE", origem.base) : null,
      sourceReference: origem.sourceReference,
    })
  const primeira = dados.publicado ?? dados.rascunho
  const corpo = {
    name: dados.name,
    businessDomainId: idDe("DOMINIO", dados.dominio),
    scope: alcanceNoCorpo(linha.alcance),
    ...(primeira ? versao(primeira) : {}),
  }
  const id = (await cliente.post<{ id: string }>("/api/v1/admin/argument-scripts", corpo)).id
  registro.desfazer = `/api/v1/admin/argument-scripts/${id}`
  if (dados.publicado) {
    await cliente.post(`/api/v1/admin/argument-scripts/${id}/publish`, {})
    if (dados.rascunho) await cliente.patch(`/api/v1/admin/argument-scripts/${id}`, versao(dados.rascunho))
  }
  if (dados.arquivado) await cliente.post(`/api/v1/admin/argument-scripts/${id}/archive`, {})
  return id
}

async function criarWorkflow(cliente: ClienteInia, linha: LinhaDoPlano, item: Item<"WORKFLOW">, idDe: IdDe, registro: Registro): Promise<string> {
  const dados = item.dados
  // Troca, no texto do gatilho/grafo/modo de avaliação, cada id da origem pelo id do destino (ids são únicos: troca exata).
  const trocas = new Map(linha.trocas)
  for (const ref of dados.referencias) {
    if (ref.tipo !== "ITEM") continue
    const [tipo, ...resto] = ref.item.split(":")
    const id = idDe(tipo as TipoItem, resto.join(":"))
    if (id) trocas.set(ref.idOrigem, id)
  }
  const trocar = <T>(valor: T): T => {
    if (valor === null || valor === undefined) return valor
    let json = JSON.stringify(valor)
    for (const [origem, destino] of trocas) json = json.split(origem).join(destino)
    return JSON.parse(json) as T
  }
  const corpo = {
    name: dados.name,
    ...semVazios({ description: dados.description }),
    ...alcanceNoCorpo(linha.alcance),
    trigger: trocar(dados.gatilho),
  }
  const id = (await cliente.post<{ id: string }>("/api/v1/admin/workflows", corpo)).id
  registro.desfazer = `/api/v1/admin/workflows/${id}`
  await cliente.put(`/api/v1/admin/workflows/${id}/draft`, {
    graph: trocar(dados.grafo),
  })
  if (dados.consolidatedStructure)
    await cliente.put(`/api/v1/admin/workflows/${id}/analysis-config`, {
      mode: "CONSOLIDATED",
      consolidatedStructure: trocar(dados.consolidatedStructure),
    })
  else if (dados.populationFilter && !linha.removerFiltroPopulacional)
    await cliente.put(`/api/v1/admin/workflows/${id}/analysis-config`, {
      mode: "INDIVIDUAL",
      populationFilter: trocar(dados.populationFilter),
    })
  if (!dados.active) await cliente.patch(`/api/v1/admin/workflows/${id}`, { active: false })
  return id
}

// ─── Fluxo principal (no fim: usa as funções acima) ─────────────────────────────────────────────────────────────────────

async function principal(): Promise<void> {
  try {
    const destino = ClienteInia.normalizarDestino(values.destino!)
    const cliente = await conectar(destino)
    say(`\nLendo o que já existe em ${destino}…`)
    const estado = await lerDestino(cliente, pacote.itens)
    const plano = montarPlano(pacote.itens, selecao, estado, deParaAtual)
    writeFileSync(join(pasta, "de-para.csv"), gerarDePara(plano.dePara))

    const titulo = `${values.executar ? "IMPORTAÇÃO" : "SIMULAÇÃO"} — pacote de ${pacote.origem.organizacao} (${pacote.geradoEm.slice(0, 10)}) → ${destino}`
    const relatorio = descreverPlano(plano, titulo)
    writeFileSync(join(pasta, "relatorio-simulacao.txt"), `${relatorio}\n`)
    say(`\n${relatorio}`)

    if (!values.executar) {
      say(`\nNada foi gravado no destino. Relatório: ${join(pasta, "relatorio-simulacao.txt")}`)
      say(plano.bloqueados ? "Corrija os bloqueados e simule de novo." : `Para criar de verdade, rode o mesmo comando com --executar.`)
      process.exit(0)
    }
    if (plano.bloqueados) fail(`Há ${plano.bloqueados} item(ns) bloqueado(s): nada foi gravado. Corrija (de-para.csv, selecao.csv ou o destino) e rode de novo.`)
    if (!plano.criar && !plano.linhas.some((linha) => linha.complementos.length)) {
      say("\nNada a criar: tudo o que foi selecionado já existe no destino.")
      process.exit(0)
    }
    if (process.stdin.isTTY) {
      const resposta = await ask(`Criar ${plano.criar} item(ns) em ${destino}? (s/n)`, {
        defaultValue: "n",
        validate: (valor) => (/^[sn]$/i.test(valor) ? null : "Responda s ou n."),
      })
      if (resposta.toLowerCase() !== "s") fail("Importação cancelada — nada foi gravado.")
    }
    await executar(cliente, plano, estado)
  } catch (error) {
    if (error instanceof ErroApi) fail(`${error.message} (${error.codigo}${error.status ? `, HTTP ${error.status}` : ""})`)
    fail(error instanceof Error ? error.message : String(error))
  }
}

await principal()
