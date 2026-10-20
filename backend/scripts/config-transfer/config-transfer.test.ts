import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { arquivoDaSessao } from "./cliente.js"
import { chaveDoItem, gerarCsv, lerArquivoDoPacote, gerarDePara, gerarSelecao, lerCsv, lerDePara, lerSelecao, lerSimNao, propagarExclusoes, sugerirInclusao, type DadosItem, type Item, type TipoItem } from "./formato.js"
import { chaveNoDestino, descreverPlano, montarPlano, type Destino } from "./plano.js"

function item<T extends TipoItem>(tipo: T, chave: string, dados: Partial<DadosItem[T]> = {}, extra: Partial<Pick<Item, "dependencias" | "opcionais">> = {}): Item {
  return { tipo, chave, nome: chave, idOrigem: `id-${chave}`, dependencias: extra.dependencias ?? [], opcionais: extra.opcionais ?? [], sugestao: { incluir: true, motivo: "" }, dados: dados as DadosItem[T] } as Item
}

function agente(nome: string, extra: Partial<DadosItem["AGENTE"]> = {}, dependencias: string[] = []): Item {
  return item(
    "AGENTE",
    nome,
    { name: nome, agentType: "CUSTOM", objective: "Objetivo do agente", description: "Descrição do agente", contextPrompt: "Contexto do agente com mais de dez caracteres", alcance: { tipo: "TODOS" }, bases: [], specialtyKind: null, dominio: null, capability: null, consolidatedInput: false, specialty: null, recommendSupportMaterials: false, investigationCapabilities: [], actionLimitsEnabled: false, actionLimits: null, active: true, ...extra },
    { dependencias },
  )
}

function workflow(nome: string, extra: Partial<DadosItem["WORKFLOW"]> = {}, dependencias: string[] = []): Item {
  return item("WORKFLOW", nome, { name: nome, description: null, alcance: { tipo: "TODOS" }, gatilho: { kind: "manual", context: "COLLABORATOR" }, flagGatilho: null, grafo: { nodes: [], edges: [] }, populationFilter: null, consolidatedStructure: null, referencias: [], active: false, publicadoNaOrigem: false, ...extra }, { dependencias })
}

function destinoVazio(extra: Partial<Destino> = {}): Destino {
  return { itens: new Map(), grupos: new Map(), pessoas: new Map(), indicadoresSemGlossario: new Set(), indicadoresSemEstrategia: new Set(), chatAtivoPorAlcance: new Map(), cenarios: [], cenarioPadrao: null, ...extra }
}

const todosMarcados = (itens: Item[]) => new Map(itens.map((i) => [chaveDoItem(i), true]))
const situacaoDe = (plano: ReturnType<typeof montarPlano>, chave: string) => plano.linhas.find((linha) => chaveDoItem(linha.item) === chave)

describe("planilhas do pacote (CSV do Excel BR)", () => {
  it("ida e volta com ponto e vírgula, aspas, quebra de linha e BOM", () => {
    const csv = gerarCsv(["tipo", "nome"], [["Agente", 'Nome; com "aspas"\ne quebra']])
    expect(csv.startsWith("﻿")).toBe(true)
    expect(lerCsv(csv)).toEqual([{ tipo: "Agente", nome: 'Nome; com "aspas"\ne quebra' }])
  })

  it("aceita vírgula quando o Excel de outra região troca o separador", () => {
    expect(lerCsv("tipo,origem,destino\r\nGRUPO,A,B\r\n")).toEqual([{ tipo: "GRUPO", origem: "A", destino: "B" }])
  })

  it("sim/não aceita as formas comuns e vazio é não", () => {
    for (const valor of ["sim", "SIM", "s", "x", "1", "yes"]) expect(lerSimNao(valor)).toBe(true)
    for (const valor of ["não", "nao", "N", "", "0"]) expect(lerSimNao(valor)).toBe(false)
  })

  it("exportar de novo mantém a escolha do administrador", () => {
    const itens = [agente("A"), agente("B")]
    const primeira = lerSelecao(gerarSelecao(itens, new Map()))
    expect(primeira.get("AGENTE:A")).toBe(true)
    const editada = new Map(primeira).set("AGENTE:A", false)
    expect(lerSelecao(gerarSelecao(itens, editada)).get("AGENTE:A")).toBe(false)
  })

  it("de-para lê só os tipos conhecidos", () => {
    const linhas = lerDePara(gerarDePara([{ tipo: "PESSOA", origem: "M-1", destino: "M-2", ondeAparece: "x" }]) + "OUTRO;a;b;\r\n")
    expect(linhas).toEqual([{ tipo: "PESSOA", origem: "M-1", destino: "M-2", ondeAparece: "x" }])
  })
})

describe("sugestão do que é teste", () => {
  it("marca TESTE -, [POC TOOLS], smoke, QA ·, golden e demonstração", () => {
    for (const nome of ["TESTE - Agente", "teste: x", "[POC TOOLS] Algo", "Smoke V1.5.12 · indicador", "QA · Quartil", "Golden demo · Larissa", "Demo · Revisão", "RH (Demo)", "Fluxo (demonstração)"]) {
      expect(sugerirInclusao(nome).incluir, nome).toBe(false)
    }
  })

  it("não confunde conteúdo de verdade que começa com 'Teste de'", () => {
    expect(sugerirInclusao("Teste de confirmação e resultado da tratativa").incluir).toBe(true)
  })

  it("alcance num grupo de demonstração também sai", () => {
    expect(sugerirInclusao("INIA", { alcances: [{ tipo: "GRUPO", grupo: "Atendimento Demo" }] })).toEqual({ incluir: false, motivo: 'alcance no grupo de demonstração "Atendimento Demo"' })
  })

  it("quem depende de item fora também sai (em cadeia)", () => {
    const fora = agente("TESTE - Base")
    fora.sugestao = { incluir: false, motivo: "nome indica teste" }
    const orquestrador = item("ORQUESTRADOR", "Orq", {}, { dependencias: ["AGENTE:TESTE - Base"] })
    const fluxo = workflow("Fluxo", {}, ["ORQUESTRADOR:Orq"])
    propagarExclusoes([fora, orquestrador, fluxo])
    expect(orquestrador.sugestao.incluir).toBe(false)
    expect(fluxo.sugestao).toEqual({ incluir: false, motivo: 'depende de orquestrador "Orq", que ficou de fora' })
  })
})

describe("plano da importação", () => {
  it("cria o que falta, mantém o que já existe e ignora o que não foi marcado", () => {
    const itens = [item("DOMINIO", "FATURAMENTO", { code: "FATURAMENTO" }), agente("Especialista", { dominio: "FATURAMENTO" }, ["DOMINIO:FATURAMENTO"]), agente("Fora")]
    const destino = destinoVazio({ itens: new Map([[chaveNoDestino("DOMINIO", "faturamento"), { id: "d1", nome: "Faturamento" }]]) })
    const plano = montarPlano(itens, new Map([["DOMINIO:FATURAMENTO", true], ["AGENTE:Especialista", true]]), destino, [])
    expect(situacaoDe(plano, "DOMINIO:FATURAMENTO")).toMatchObject({ situacao: "EXISTE", idDestino: "d1" })
    expect(situacaoDe(plano, "AGENTE:Especialista")?.situacao).toBe("CRIAR")
    expect(situacaoDe(plano, "AGENTE:Fora")?.situacao).toBe("FORA")
  })

  it("dependência fora da seleção mas já no destino não bloqueia; ausente nos dois bloqueia", () => {
    const itens = [item("INDICADOR", "TMA", { definicao: { code: "TMA" } as DadosItem["INDICADOR"]["definicao"] }), workflow("Usa TMA", {}, ["INDICADOR:TMA"]), workflow("Usa NPS", {}, ["INDICADOR:NPS"])]
    const destino = destinoVazio({ itens: new Map([[chaveNoDestino("INDICADOR", "TMA"), { id: "i1", nome: "TMA" }]]) })
    const plano = montarPlano(itens, new Map([["WORKFLOW:Usa TMA", true], ["WORKFLOW:Usa NPS", true]]), destino, [])
    expect(situacaoDe(plano, "WORKFLOW:Usa TMA")?.situacao).toBe("CRIAR")
    expect(situacaoDe(plano, "WORKFLOW:Usa NPS")).toMatchObject({ situacao: "BLOQUEADO", motivos: ['precisa de indicador "NPS", que não vai junto nem existe no destino'] })
  })

  it("ligação opcional que falta vira aviso, não bloqueio", () => {
    const itens = [agente("Com base", { bases: ["Manual"] }), item("BASE", "Manual", {})]
    itens[0]!.opcionais = ["BASE:Manual"]
    const plano = montarPlano(itens, new Map([["AGENTE:Com base", true]]), destinoVazio(), [])
    expect(situacaoDe(plano, "AGENTE:Com base")).toMatchObject({ situacao: "CRIAR", avisos: ['base de conhecimento "Manual" não vai junto nem existe no destino — a ligação fica de fora'] })
  })

  it("grupo inexistente bloqueia e entra no de-para; com o de-para preenchido, resolve", () => {
    const itens = [agente("Retenção", { alcance: { tipo: "GRUPO", grupo: "B2C · Retenção" } })]
    const grupos = new Map([["b2c · atendimento geral", { id: "g1", nome: "B2C · Atendimento Geral", subgrupos: new Map([["voz", { id: "s1", nome: "Voz" }]]) }]])
    const sem = montarPlano(itens, todosMarcados(itens), destinoVazio({ grupos }), [])
    expect(sem.bloqueados).toBe(1)
    expect(sem.dePara).toEqual([{ tipo: "GRUPO", origem: "B2C · Retenção", destino: "", ondeAparece: 'Agente "Retenção"' }])
    const com = montarPlano(itens, todosMarcados(itens), destinoVazio({ grupos }), [{ tipo: "GRUPO", origem: "B2C · Retenção", destino: "B2C · Atendimento Geral / Voz", ondeAparece: "" }])
    expect(situacaoDe(com, "AGENTE:Retenção")).toMatchObject({ situacao: "CRIAR", alcance: { scopeType: "SUBTEAM", teamId: "g1", subteamId: "s1" } })
    expect(com.dePara[0]?.ondeAparece).toBe('Agente "Retenção"')
  })

  it("pessoa inativa no destino pede de-para; a matrícula do substituto resolve e troca o id no workflow", () => {
    const fluxo = workflow("Resumo", { referencias: [{ idOrigem: "p-old", tipo: "PESSOA", pessoa: { matricula: "DIR-001", nome: "João", cargo: "DIRECTOR" } }] })
    const pessoas = new Map([
      ["dir-001", { id: "x", nome: "João", ativo: false, cargo: "DIRECTOR" }],
      ["dir-101", { id: "p-new", nome: "Ricardo", ativo: true, cargo: "DIRECTOR" }],
    ])
    const sem = montarPlano([fluxo], todosMarcados([fluxo]), destinoVazio({ pessoas }), [])
    expect(situacaoDe(sem, "WORKFLOW:Resumo")?.motivos[0]).toContain("está inativa no destino")
    const com = montarPlano([fluxo], todosMarcados([fluxo]), destinoVazio({ pessoas }), [{ tipo: "PESSOA", origem: "DIR-001", destino: "DIR-101", ondeAparece: "" }])
    expect(situacaoDe(com, "WORKFLOW:Resumo")?.trocas.get("p-old")).toBe("p-new")
  })

  it("TODOS no de-para vale para alcance e filtro de população, nunca para âncora de estrutura", () => {
    const filtro = workflow("Filtro", { populationFilter: { kind: "SUBTEAM", subteamId: "s-old" }, referencias: [{ idOrigem: "s-old", tipo: "SUBGRUPO", grupo: "G", subgrupo: "S" }] })
    const ancora = workflow("Âncora", { consolidatedStructure: { kind: "TEAM", teamId: "t-old" }, referencias: [{ idOrigem: "t-old", tipo: "GRUPO", grupo: "Velho" }] })
    const dePara = [
      { tipo: "SUBGRUPO" as const, origem: "G / S", destino: "TODOS", ondeAparece: "" },
      { tipo: "GRUPO" as const, origem: "Velho", destino: "TODOS", ondeAparece: "" },
    ]
    const plano = montarPlano([filtro, ancora], todosMarcados([filtro, ancora]), destinoVazio(), dePara)
    expect(situacaoDe(plano, "WORKFLOW:Filtro")).toMatchObject({ situacao: "CRIAR", removerFiltroPopulacional: true })
    expect(situacaoDe(plano, "WORKFLOW:Âncora")?.situacao).toBe("BLOQUEADO")
  })

  it("dentro do workflow, subgrupo trocado por grupo bloqueia (o id troca no lugar e o kind ao lado não muda)", () => {
    const filtro = workflow("Filtro", { populationFilter: { kind: "SUBTEAM", subteamId: "s-old" }, referencias: [{ idOrigem: "s-old", tipo: "SUBGRUPO", grupo: "G", subgrupo: "S" }] })
    const grupos = new Map([["g2", { id: "g2-id", nome: "G2", subgrupos: new Map([["voz", { id: "v-id", nome: "Voz" }]]) }]])
    const paraGrupo = montarPlano([filtro], todosMarcados([filtro]), destinoVazio({ grupos }), [{ tipo: "SUBGRUPO", origem: "G / S", destino: "G2", ondeAparece: "" }])
    expect(situacaoDe(paraGrupo, "WORKFLOW:Filtro")?.motivos[0]).toContain("precisa virar outro subgrupo")
    const paraSubgrupo = montarPlano([filtro], todosMarcados([filtro]), destinoVazio({ grupos }), [{ tipo: "SUBGRUPO", origem: "G / S", destino: "G2 / Voz", ondeAparece: "" }])
    expect(situacaoDe(paraSubgrupo, "WORKFLOW:Filtro")?.trocas.get("s-old")).toBe("v-id")
  })

  it("só um orquestrador ativo de chat por alcance", () => {
    const chat = item("ORQUESTRADOR", "Chat", { name: "Chat", alcance: { tipo: "TODOS" }, active: true, invocationMode: "INTERACTIVE" } as DadosItem["ORQUESTRADOR"])
    const plano = montarPlano([chat], todosMarcados([chat]), destinoVazio({ chatAtivoPorAlcance: new Map([["ALL_TEAMS", "INIA da nuvem"]]) }), [])
    expect(situacaoDe(plano, "ORQUESTRADOR:Chat")?.motivos[0]).toContain('"INIA da nuvem"')
  })

  it("cenário com período que encontra outro do destino bloqueia", () => {
    const natal = item("CENARIO", "Natal", { name: "Natal", scheduleStart: "2026-12-01", scheduleEnd: "2026-12-26", padrao: false, imagens: [] } as unknown as DadosItem["CENARIO"])
    const plano = montarPlano([natal], todosMarcados([natal]), destinoVazio({ cenarios: [{ nome: "Fim de ano", inicio: "2026-12-20", fim: "2027-01-05" }] }), [])
    expect(situacaoDe(plano, "CENARIO:Natal")?.situacao).toBe("BLOQUEADO")
  })

  it("indicador que já existe ganha só os complementos que faltam", () => {
    const tma = item("INDICADOR", "TMA", { definicao: { code: "TMA" }, glossario: { description: "d", interpretation: "i", goodPractices: "g", feedbackGuidance: "f" }, estrategia: { config: {}, dominiosPermitidos: [], ativa: true } } as unknown as DadosItem["INDICADOR"])
    const destino = destinoVazio({ itens: new Map([[chaveNoDestino("INDICADOR", "TMA"), { id: "i1", nome: "TMA" }]]), indicadoresSemEstrategia: new Set(["TMA"]) })
    const plano = montarPlano([tma], todosMarcados([tma]), destino, [])
    expect(situacaoDe(plano, "INDICADOR:TMA")).toMatchObject({ situacao: "EXISTE", complementos: ["ESTRATEGIA"] })
    expect(descreverPlano(plano, "t")).toContain("acrescenta a estratégia de diagnóstico, que ele ainda não tem")
  })
})

describe("arquivos do pacote e sessão (auditoria de segurança 17/10/2026, AUTH-9/AUTH-10)", () => {
  const pasta = mkdtempSync(join(tmpdir(), "inia-pacote-"))
  mkdirSync(join(pasta, "arquivos"))
  writeFileSync(join(pasta, "arquivos", "manual.pdf"), "conteudo-do-manual")
  writeFileSync(join(pasta, "fora.txt"), "segredo")
  const sha = (texto: string) => createHash("sha256").update(texto).digest("hex")
  const ler = (absoluto: string) => readFileSync(absoluto)

  it("lê o arquivo de arquivos/ ou imagens/ com o SHA-256 da exportação", () => {
    expect(lerArquivoDoPacote(pasta, "arquivos/manual.pdf", sha("conteudo-do-manual"), ler).toString()).toBe("conteudo-do-manual")
  })

  it("recusa caminho que sai do pacote, absoluto, na raiz ou com conteúdo trocado — sem ler nada fora", () => {
    const lidos: string[] = []
    const espiao = (absoluto: string) => {
      lidos.push(absoluto)
      return readFileSync(absoluto)
    }
    for (const caminho of ["../fora.txt", "arquivos/../fora.txt", "fora.txt", join(pasta, "fora.txt"), "imagens/../../etc/passwd", "arquivos"]) {
      expect(() => lerArquivoDoPacote(pasta, caminho, sha("segredo"), espiao), caminho).toThrow(/fora das pastas/)
    }
    expect(lidos).toEqual([])
    expect(() => lerArquivoDoPacote(pasta, "arquivos/manual.pdf", sha("outro"), ler)).toThrow(/SHA-256 diferente/)
  })

  it("a sessão do destino fica no perfil de quem importa, nunca dentro da pasta do pacote", () => {
    const arquivo = arquivoDaSessao(pasta, "/home/admin")
    expect(arquivo.startsWith(join("/home/admin", ".inia", "sessoes"))).toBe(true)
    expect(arquivo.startsWith(pasta)).toBe(false)
    expect(arquivoDaSessao(join(pasta, "."), "/home/admin")).toBe(arquivo)
    expect(arquivoDaSessao(join(pasta, "outro"), "/home/admin")).not.toBe(arquivo)
  })
})
