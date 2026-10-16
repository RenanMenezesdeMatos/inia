/**
 * Plano da importação (lógica pura — o `importar.ts` busca o destino pela API e executa): para cada item do pacote decide
 * CRIAR, EXISTE (já está no destino e fica como está), BLOQUEADO (com o motivo) ou FORA (não marcado na seleção), e resolve
 * grupos, subgrupos e pessoas no destino pelo nome/matrícula ou pelo de-para. A importação nunca altera nem apaga o que já
 * existe no destino; a única exceção são os complementos de um indicador que já existe (glossário e estratégia de
 * diagnóstico), acrescentados só quando ele ainda não tem.
 */
import { AGENT_TEXT_LIMITS } from "../../src/modules/agents/domain/agent-field-limits.js"
import {
  ROTULO_TIPO,
  TIPOS,
  chaveDoItem,
  normalizar,
  origemDePessoa,
  origemDeSubgrupo,
  separarSubgrupo,
  type Alcance,
  type Item,
  type LinhaDePara,
  type RefPessoa,
  type TipoDePara,
  type TipoItem,
} from "./formato.js"

/** Nomes de workflow têm "·": os lugares de uma pendência do de-para são separados por " | ". */
const SEPARADOR_DE_LUGARES = " | "

export type Grupo = { id: string; nome: string; subgrupos: Map<string, { id: string; nome: string }> }
export type Pessoa = { id: string; nome: string; ativo: boolean; cargo: string }

/** O que já existe no destino (lido pela API). Chaves sempre por `chaveNoDestino`. */
export type Destino = {
  itens: Map<string, { id: string; nome: string }>
  grupos: Map<string, Grupo>
  pessoas: Map<string, Pessoa>
  /** Indicadores que já existem no destino e ainda não têm glossário / estratégia de diagnóstico. */
  indicadoresSemGlossario: Set<string>
  indicadoresSemEstrategia: Set<string>
  /** Orquestradores ATIVOS que atendem o chat/voz, por alcance (só um por alcance). */
  chatAtivoPorAlcance: Map<string, string>
  cenarios: { nome: string; inicio: string | null; fim: string | null }[]
  cenarioPadrao: string | null
}

/** Chave natural no destino: códigos em maiúsculas, flag por canal/nome, o resto pelo nome sem diferença de caixa/espaços. */
export function chaveNoDestino(tipo: TipoItem, chave: string): string {
  if (tipo === "DOMINIO" || tipo === "INDICADOR") return `${tipo}:${chave.trim().toUpperCase()}`
  if (tipo === "FLAG") {
    const [canal = "", nome = ""] = chave.split("/")
    return `${tipo}:${canal.trim().toUpperCase()}/${nome.trim().toLowerCase()}`
  }
  return `${tipo}:${normalizar(chave)}`
}

export type AlcanceResolvido = { scopeType: "ALL_TEAMS" } | { scopeType: "TEAM"; teamId: string } | { scopeType: "SUBTEAM"; teamId: string; subteamId: string }
export type Situacao = "CRIAR" | "EXISTE" | "BLOQUEADO" | "FORA"
export type LinhaDoPlano = {
  item: Item
  situacao: Situacao
  motivos: string[]
  avisos: string[]
  idDestino: string | null
  alcance: AlcanceResolvido | null
  /** Base/argumentário: alcances resolvidos (bases podem ter vários). */
  alcances: AlcanceResolvido[]
  /** Workflow: id na origem → id no destino (itens, pessoas, grupos). */
  trocas: Map<string, string>
  /** Indicador que já existe: complementos que serão acrescentados. */
  complementos: ("GLOSSARIO" | "ESTRATEGIA")[]
  /** Workflow: o grupo do filtro de população virou TODOS no de-para — entra sem filtro (todos do alcance). */
  removerFiltroPopulacional: boolean
}
export type Plano = { linhas: LinhaDoPlano[]; dePara: LinhaDePara[]; bloqueados: number; criar: number }

export function montarPlano(itens: Item[], selecao: Map<string, boolean>, destino: Destino, dePara: LinhaDePara[]): Plano {
  const linhas = new Map<string, LinhaDoPlano>()
  const pendentes = new Map<string, LinhaDePara>()
  const dePara_ = (tipo: TipoDePara, origem: string) => dePara.find((linha) => linha.tipo === tipo && normalizar(linha.origem) === normalizar(origem))
  /** Onde cada grupo/subgrupo/pessoa do de-para é usado (coluna "onde aparece" da planilha). */
  const usos = new Map<string, Set<string>>()
  const usar = (tipo: TipoDePara, origem: string, onde: string) => {
    const chave = `${tipo}:${normalizar(origem)}`
    usos.set(chave, (usos.get(chave) ?? new Set()).add(onde))
  }
  const pendencia = (tipo: TipoDePara, origem: string, onde: string) => {
    usar(tipo, origem, onde)
    const chave = `${tipo}:${normalizar(origem)}`
    if (!pendentes.has(chave)) pendentes.set(chave, { tipo, origem, destino: "", ondeAparece: "" })
  }

  /** Grupo/subgrupo do destino pelo nome (ou pelo de-para). `TODOS` no de-para = todos os grupos. */
  const resolverAlcance = (alcance: Alcance, onde: string, motivos: string[], aceitaTodos = true): AlcanceResolvido | null => {
    if (alcance.tipo === "TODOS") return { scopeType: "ALL_TEAMS" }
    const tipo: TipoDePara = alcance.tipo === "GRUPO" ? "GRUPO" : "SUBGRUPO"
    const origem = alcance.tipo === "GRUPO" ? alcance.grupo : origemDeSubgrupo(alcance.grupo, alcance.subgrupo)
    const regra = dePara_(tipo, origem)
    if (regra) usar(tipo, origem, onde)
    const alvo = regra?.destino.trim() || origem
    if (/^todos( os grupos)?$/i.test(alvo)) {
      if (aceitaTodos) return { scopeType: "ALL_TEAMS" }
      motivos.push(`${tipo === "GRUPO" ? "o grupo" : "o subgrupo"} "${origem}" precisa virar um grupo ou subgrupo do destino (aqui "TODOS" não vale)`)
      return null
    }
    const partes = separarSubgrupo(alvo)
    const grupo = destino.grupos.get(normalizar(partes ? partes.grupo : alvo))
    const subgrupo = partes && grupo ? grupo.subgrupos.get(normalizar(partes.subgrupo)) : undefined
    if (grupo && (!partes || subgrupo)) return subgrupo ? { scopeType: "SUBTEAM", teamId: grupo.id, subteamId: subgrupo.id } : { scopeType: "TEAM", teamId: grupo.id }
    if (regra?.destino.trim()) motivos.push(`o de-para leva "${origem}" para "${alvo}", que não existe no destino`)
    else motivos.push(`${tipo === "GRUPO" ? "o grupo" : "o subgrupo"} "${origem}" não existe no destino — preencha a coluna "destino" do de-para.csv (ou TODOS)`)
    pendencia(tipo, origem, onde)
    return null
  }

  const resolverPessoa = (pessoa: RefPessoa, onde: string, motivos: string[]): string | null => {
    const origem = origemDePessoa(pessoa)
    const regra = dePara_("PESSOA", origem)
    if (regra) usar("PESSOA", origem, onde)
    const alvo = regra?.destino.trim() || origem
    const encontrada = destino.pessoas.get(normalizar(alvo))
    if (encontrada?.ativo) return encontrada.id
    const descricao = `${pessoa.nome} (${origem})`
    if (regra?.destino.trim()) motivos.push(`o de-para leva ${descricao} para "${alvo}", que ${encontrada ? "está inativa" : "não existe"} no destino`)
    else motivos.push(`a pessoa ${descricao} ${encontrada ? "está inativa" : "não existe"} no destino — preencha a coluna "destino" do de-para.csv com a matrícula de quem a substitui`)
    pendencia("PESSOA", origem, onde)
    return null
  }

  /** Vai junto (CRIAR/EXISTE) ou já está no destino, mesmo fora da seleção. */
  const disponivel = (chave: string): { ok: boolean; nome: string } => {
    const [tipo, ...resto] = chave.split(":")
    const natural = resto.join(":")
    const linha = linhas.get(chave)
    const noDestino = destino.itens.has(chaveNoDestino(tipo as TipoItem, natural))
    return { ok: noDestino || linha?.situacao === "CRIAR" || linha?.situacao === "EXISTE", nome: linha?.item.nome ?? natural }
  }

  const ordenados = [...itens].sort((a, b) => TIPOS.indexOf(a.tipo) - TIPOS.indexOf(b.tipo))
  const chatsDoPacote = new Map<string, string>()
  for (const item of ordenados) {
    const chave = chaveDoItem(item)
    const linha: LinhaDoPlano = { item, situacao: "CRIAR", motivos: [], avisos: [], idDestino: null, alcance: null, alcances: [], trocas: new Map(), complementos: [], removerFiltroPopulacional: false }
    linhas.set(chave, linha)
    const existente = destino.itens.get(chaveNoDestino(item.tipo, item.chave))
    if (!(selecao.get(chave) ?? false)) {
      linha.situacao = "FORA"
      if (existente) linha.idDestino = existente.id
      continue
    }
    const onde = `${ROTULO_TIPO[item.tipo]} "${item.nome}"`
    if (existente) {
      linha.situacao = "EXISTE"
      linha.idDestino = existente.id
      if (item.tipo === "INDICADOR") {
        const codigo = item.dados.definicao.code.toUpperCase()
        if (item.dados.glossario && destino.indicadoresSemGlossario.has(codigo)) linha.complementos.push("GLOSSARIO")
        if (item.dados.estrategia && destino.indicadoresSemEstrategia.has(codigo)) linha.complementos.push("ESTRATEGIA")
      }
      continue
    }

    for (const dependencia of item.dependencias) {
      const situacao = disponivel(dependencia)
      if (!situacao.ok) linha.motivos.push(`precisa de ${descreverChave(dependencia, situacao.nome)}, que não vai junto nem existe no destino`)
    }
    for (const opcional of item.opcionais) {
      const situacao = disponivel(opcional)
      if (!situacao.ok) linha.avisos.push(`${descreverChave(opcional, situacao.nome)} não vai junto nem existe no destino — a ligação fica de fora`)
    }

    switch (item.tipo) {
      case "BASE":
        linha.alcances = item.dados.alcances.map((alcance) => resolverAlcance(alcance, onde, linha.motivos)).filter((alcance): alcance is AlcanceResolvido => alcance !== null)
        if (item.dados.publicado === null) linha.avisos.push("na origem nunca foi publicada: vai como rascunho")
        if (item.dados.rascunho !== null && item.dados.publicado !== null) linha.avisos.push("tem um rascunho mais novo que a publicação: vai publicada + o rascunho")
        break
      case "ARGUMENTARIO":
        linha.alcance = resolverAlcance(item.dados.alcance, onde, linha.motivos)
        if (!item.dados.publicado) linha.avisos.push("na origem nunca foi publicado: vai como rascunho")
        break
      case "AGENTE": {
        linha.alcance = resolverAlcance(item.dados.alcance, onde, linha.motivos)
        for (const campo of ["name", "objective", "description", "contextPrompt", "capability", "actionLimits"] as const) {
          const texto = (item.dados[campo] ?? "").trim()
          const limite = AGENT_TEXT_LIMITS[campo]
          if (texto.length > limite.max || (texto.length < limite.min && (campo !== "capability" && campo !== "actionLimits"))) {
            linha.motivos.push(`${limite.label} com ${texto.length} caracteres (a INIA aceita de ${limite.min} a ${limite.max})`)
          }
        }
        break
      }
      case "ORQUESTRADOR": {
        linha.alcance = resolverAlcance(item.dados.alcance, onde, linha.motivos)
        const atendeChat = item.dados.active && item.dados.invocationMode !== "WORKFLOW"
        if (atendeChat && linha.alcance) {
          const chaveAlcance = chaveDeAlcance(linha.alcance)
          const ocupado = destino.chatAtivoPorAlcance.get(chaveAlcance) ?? chatsDoPacote.get(chaveAlcance)
          if (ocupado) linha.motivos.push(`já existe um orquestrador ativo atendendo o chat/voz neste alcance ("${ocupado}") — só pode haver um; desative um dos dois`)
          else chatsDoPacote.set(chaveAlcance, item.nome)
        }
        break
      }
      case "WORKFLOW": {
        linha.alcance = resolverAlcance(item.dados.alcance, onde, linha.motivos)
        for (const ref of item.dados.referencias) {
          if (ref.tipo === "NAO_TRANSFERIVEL") linha.motivos.push(`usa ${ref.descricao}`)
          if (ref.tipo === "PESSOA") {
            const id = resolverPessoa(ref.pessoa, onde, linha.motivos)
            if (id) linha.trocas.set(ref.idOrigem, id)
          }
          if (ref.tipo === "GRUPO" || ref.tipo === "SUBGRUPO") {
            // Só o filtro de população aceita TODOS (= sem filtro); âncora de estrutura e grafo precisam de um grupo de verdade.
            const soNoFiltro = JSON.stringify(item.dados.populationFilter ?? null).includes(ref.idOrigem) && !JSON.stringify([item.dados.grafo, item.dados.consolidatedStructure]).includes(ref.idOrigem)
            const resolvido = resolverAlcance(ref.tipo === "GRUPO" ? { tipo: "GRUPO", grupo: ref.grupo } : { tipo: "SUBGRUPO", grupo: ref.grupo, subgrupo: ref.subgrupo }, onde, linha.motivos, soNoFiltro)
            // Dentro do workflow o id troca no lugar: subgrupo só vira subgrupo e grupo só vira grupo (o "kind" ao lado não muda).
            const mesmoNivel = !resolvido || resolvido.scopeType === "ALL_TEAMS" || (ref.tipo === "GRUPO" ? resolvido.scopeType === "TEAM" : resolvido.scopeType === "SUBTEAM")
            if (!mesmoNivel) linha.motivos.push(`no filtro/âncora deste workflow, ${ref.tipo === "GRUPO" ? `o grupo "${ref.grupo}" precisa virar outro grupo` : `o subgrupo "${ref.grupo} / ${ref.subgrupo}" precisa virar outro subgrupo ("Grupo / Subgrupo")`}${soNoFiltro ? " ou TODOS" : ""}`)
            else if (resolvido?.scopeType === "ALL_TEAMS") linha.removerFiltroPopulacional = true
            else if (resolvido?.scopeType === "TEAM") linha.trocas.set(ref.idOrigem, resolvido.teamId)
            else if (resolvido?.scopeType === "SUBTEAM") linha.trocas.set(ref.idOrigem, resolvido.subteamId)
          }
        }
        if (linha.removerFiltroPopulacional) linha.avisos.push("o de-para levou o grupo do filtro de população para TODOS: entra sem filtro (todos do alcance)")
        if (item.dados.publicadoNaOrigem) linha.avisos.push("na origem está publicado; aqui vai como rascunho — publique no editor quando quiser que rode")
        break
      }
      case "CENARIO": {
        const { scheduleStart: inicio, scheduleEnd: fim } = item.dados
        if (inicio && fim) {
          const conflito = destino.cenarios.find((cenario) => cenario.inicio && cenario.fim && cenario.inicio <= fim && inicio <= cenario.fim)
          if (conflito) linha.motivos.push(`o período ${inicio} a ${fim} encontra o do cenário "${conflito.nome}" do destino (${conflito.inicio} a ${conflito.fim})`)
        }
        if (item.dados.padrao && destino.cenarioPadrao) linha.avisos.push(`o destino já tem um cenário padrão ("${destino.cenarioPadrao}"): este entra sem ser o padrão`)
        break
      }
      default:
        break
    }
    linha.motivos = [...new Set(linha.motivos)]
    linha.avisos = [...new Set(linha.avisos)]
    if (linha.motivos.length) linha.situacao = "BLOQUEADO"
  }

  const resultado = [...linhas.values()]
  // De-para final: as linhas do administrador (com o "onde aparece" atualizado) + as pendências novas, destino em branco.
  const chaveDePara = (linha: LinhaDePara) => `${linha.tipo}:${normalizar(linha.origem)}`
  const ondeAparece = (linha: LinhaDePara) => [...(usos.get(chaveDePara(linha)) ?? [])].join(SEPARADOR_DE_LUGARES) || "(não é usado pelos itens marcados)"
  const dePara_final = dePara.map((linha) => ({ ...linha, ondeAparece: ondeAparece(linha) }))
  for (const pendente of pendentes.values()) if (!dePara.some((linha) => chaveDePara(linha) === chaveDePara(pendente))) dePara_final.push({ ...pendente, ondeAparece: ondeAparece(pendente) })
  return {
    linhas: resultado,
    dePara: dePara_final,
    bloqueados: resultado.filter((linha) => linha.situacao === "BLOQUEADO").length,
    criar: resultado.filter((linha) => linha.situacao === "CRIAR").length,
  }
}

export function chaveDeAlcance(alcance: AlcanceResolvido): string {
  return alcance.scopeType === "ALL_TEAMS" ? "ALL_TEAMS" : alcance.scopeType === "TEAM" ? `TEAM:${alcance.teamId}` : `SUBTEAM:${alcance.subteamId}`
}

function descreverChave(chave: string, nome: string): string {
  const tipo = chave.split(":")[0] as TipoItem
  return `${(ROTULO_TIPO[tipo] ?? tipo).toLowerCase()} "${nome}"`
}

/** Relatório legível (terminal e arquivo): contagem por tipo, bloqueios, avisos e o que já existe. */
export function descreverPlano(plano: Plano, titulo: string): string {
  const linhas: string[] = [titulo, ""]
  linhas.push(`${"".padEnd(22)}  criar  já existe  bloqueado  fora`)
  for (const tipo of TIPOS) {
    const doTipo = plano.linhas.filter((linha) => linha.item.tipo === tipo)
    if (!doTipo.length) continue
    const conta = (situacao: Situacao) => String(doTipo.filter((linha) => linha.situacao === situacao).length)
    linhas.push(`${ROTULO_TIPO[tipo].padEnd(22)}  ${conta("CRIAR").padStart(5)}  ${conta("EXISTE").padStart(9)}  ${conta("BLOQUEADO").padStart(9)}  ${conta("FORA").padStart(4)}`)
  }
  const secao = (cabecalho: string, entradas: string[]) => {
    if (!entradas.length) return
    linhas.push("", cabecalho)
    for (const entrada of entradas) linhas.push(`  • ${entrada}`)
  }
  const rotulo = (linha: LinhaDoPlano) => `${ROTULO_TIPO[linha.item.tipo]} "${linha.item.nome}"`
  secao(
    "BLOQUEADOS — corrija antes de importar (de-para.csv, selecao.csv ou no destino):",
    plano.linhas.filter((linha) => linha.situacao === "BLOQUEADO").map((linha) => `${rotulo(linha)}: ${linha.motivos.join("; ")}`),
  )
  secao("Avisos (não impedem a importação):", plano.linhas.filter((linha) => linha.situacao === "CRIAR").flatMap((linha) => linha.avisos.map((aviso) => `${rotulo(linha)}: ${aviso}`)))
  secao(
    "Já existem no destino — ficam como estão (nada é alterado):",
    plano.linhas
      .filter((linha) => linha.situacao === "EXISTE")
      .map((linha) => `${rotulo(linha)}${linha.complementos.length ? ` — acrescenta ${linha.complementos.map((c) => (c === "GLOSSARIO" ? "o glossário" : "a estratégia de diagnóstico")).join(" e ")}, que ele ainda não tem` : ""}`),
  )
  const pendentes = plano.dePara.filter((linha) => !linha.destino.trim())
  secao("De-para pendente (de-para.csv, coluna \"destino\"):", pendentes.map((linha) => `${linha.tipo} ${linha.origem} — usado em ${linha.ondeAparece}`))
  linhas.push("", `Resumo: ${plano.criar} item(ns) a criar · ${plano.bloqueados} bloqueado(s).`)
  return linhas.join("\n")
}

