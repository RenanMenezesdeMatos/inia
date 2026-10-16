/**
 * `npm run config:exportar` — lê o catálogo da Administração no banco INTERNO desta instalação (só leitura) e grava a pasta do
 * pacote de configuração (formato.ts) com a planilha `selecao.csv` já sugerindo o que é teste. Passo a passo: IT-INIA-010.
 *
 *   npm run config:exportar                                   → ./pacote-configuracao-AAAA-MM-DD
 *   npm run config:exportar -- --pacote ../pacote-homologacao  → outra pasta (exportar de novo mantém as escolhas da planilha)
 */
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import pg from "pg"
import { env } from "../../src/config/env.js"
import { fail, say } from "../../src/infrastructure/installation/cli.js"
import {
  FORMATO_PACOTE,
  ROTULO_TIPO,
  TIPOS,
  chaveDe,
  gerarSelecao,
  horaDeMinuto,
  lerSelecao,
  propagarExclusoes,
  slug,
  sugerirInclusao,
  type Alcance,
  type Item,
  type Pacote,
  type RefWorkflow,
} from "./formato.js"

const { values } = parseArgs({ options: { pacote: { type: "string" }, organizacao: { type: "string" } } })
const pastaInicial = process.env.INIT_CWD ?? process.cwd()
const pasta = resolve(pastaInicial, values.pacote ?? `pacote-configuracao-${new Date().toISOString().slice(0, 10)}`)

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g

const client = new pg.Client({ connectionString: env.activeDatabaseUrl })
await client.connect()
try {
  const organizacao = await resolverOrganizacao()
  const q = async <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) => (await client.query<T>(sql, [organizacao.id, ...params])).rows

  say(`Exportando a configuração de "${organizacao.name}" (${redigir(env.activeDatabaseUrl)}) para ${pasta}`)
  mkdirSync(join(pasta, "arquivos"), { recursive: true })
  mkdirSync(join(pasta, "imagens"), { recursive: true })

  // Grupos, subgrupos e pessoas: só para descrever alcances e referências pelo nome/matrícula.
  const grupos = new Map((await q<{ id: string; name: string }>(`select id, name from teams where organization_id = $1`)).map((row) => [row.id, row.name]))
  const subgrupos = new Map((await q<{ id: string; name: string; team_id: string }>(`select id, name, team_id from subteams where organization_id = $1`)).map((row) => [row.id, row]))
  const alcanceDe = (row: { scope_type: string; team_id: string | null; subteam_id: string | null }): Alcance => {
    if (row.scope_type === "SUBTEAM" && row.subteam_id) {
      const subgrupo = subgrupos.get(row.subteam_id)!
      return { tipo: "SUBGRUPO", grupo: grupos.get(subgrupo.team_id) ?? "?", subgrupo: subgrupo.name }
    }
    if (row.scope_type === "TEAM" && row.team_id) return { tipo: "GRUPO", grupo: grupos.get(row.team_id) ?? "?" }
    return { tipo: "TODOS" }
  }
  const itens: Item[] = []

  // ── Assuntos das bases (catálogo `subjects`) ──
  for (const row of await q<{ id: string; name: string; description: string | null; active: boolean }>(`select id, name, description, active from subjects where organization_id = $1 order by name`)) {
    itens.push({ tipo: "ASSUNTO", chave: row.name, nome: row.name, idOrigem: row.id, dependencias: [], opcionais: [], sugestao: sugerirInclusao(row.name), dados: { name: row.name, description: row.description, active: row.active } })
  }

  // ── Domínios de negócio ──
  for (const row of await q<{ id: string; code: string; name: string; description: string | null; active: boolean }>(`select id, code, name, description, active from business_domains where organization_id = $1 order by code`)) {
    itens.push({ tipo: "DOMINIO", chave: row.code, nome: `${row.name} (${row.code})`, idOrigem: row.id, dependencias: [], opcionais: [], sugestao: sugerirInclusao(row.name), dados: { code: row.code, name: row.name, description: row.description, active: row.active } })
  }
  const codigoDoDominio = new Map(itens.filter((item) => item.tipo === "DOMINIO").map((item) => [item.idOrigem, item.chave]))

  // ── Indicadores (+ glossário vigente + estratégia de diagnóstico publicada) ──
  // O sinal da população da estratégia cita a flag pelo NOME: a flag precisa existir antes de publicar a estratégia.
  const flagsPorNome = new Map<string, string[]>()
  for (const flag of await q<{ channel: string; flag_name: string }>(`select channel, flag_name from channel_flags where organization_id = $1`)) {
    flagsPorNome.set(flag.flag_name, [...(flagsPorNome.get(flag.flag_name) ?? []), chaveDe("FLAG", `${flag.channel}/${flag.flag_name}`)])
  }
  const flagsDoSinal = (config: Record<string, unknown> | undefined) => {
    const nome = (config?.populationSignal as { flagName?: string } | undefined)?.flagName
    return nome ? (flagsPorNome.get(nome) ?? []) : []
  }
  const indicadores = await q<{
    id: string; code: string; name: string; unit: string; desired_direction: string; operational_aggregation: string; daily_supported: boolean; minimum_sample_size: number | null
    minimum_coverage: string | null; official_closure_supported: boolean; proves_work_activity: boolean; availability_policy: unknown; unjustified_absence_policy: string; icon_key: string | null; active: boolean
  }>(`select * from indicator_definitions where organization_id = $1 order by code`)
  for (const row of indicadores) {
    const glossario = (await client.query<{ description: string; interpretation: string; good_practices: string; feedback_guidance: string }>(
      `select description, interpretation, good_practices, feedback_guidance from indicator_glossary where indicator_definition_id = $1 and active order by version desc limit 1`,
      [row.id],
    )).rows[0]
    const estrategia = (await client.query<{ config: Record<string, unknown>; active: boolean }>(
      `select v.config, s.active from indicator_diagnostic_strategies s join indicator_diagnostic_strategy_versions v on v.strategy_id = s.id and v.status = 'PUBLISHED' where s.indicator_definition_id = $1`,
      [row.id],
    )).rows[0]
    const dominiosPermitidos = estrategia ? ((estrategia.config.allowedBusinessDomainIds as string[] | undefined) ?? []).map((id) => codigoDoDominio.get(id) ?? `?${id}`) : []
    itens.push({
      tipo: "INDICADOR",
      chave: row.code,
      nome: `${row.name} (${row.code})`,
      idOrigem: row.id,
      dependencias: [...dominiosPermitidos.map((codigo) => chaveDe("DOMINIO", codigo)), ...flagsDoSinal(estrategia?.config)],
      opcionais: [],
      sugestao: sugerirInclusao(row.name),
      dados: {
        definicao: {
          code: row.code, name: row.name, unit: row.unit, desiredDirection: row.desired_direction, operationalAggregation: row.operational_aggregation, dailySupported: row.daily_supported,
          minimumSampleSize: row.minimum_sample_size, minimumCoverage: row.minimum_coverage === null ? null : Number(row.minimum_coverage), officialClosureSupported: row.official_closure_supported,
          provesWorkActivity: row.proves_work_activity, availabilityPolicy: row.availability_policy, unjustifiedAbsencePolicy: row.unjustified_absence_policy, iconKey: row.icon_key, active: row.active,
        },
        glossario: glossario ? { description: glossario.description, interpretation: glossario.interpretation, goodPractices: glossario.good_practices, feedbackGuidance: glossario.feedback_guidance } : null,
        estrategia: estrategia ? { config: estrategia.config, dominiosPermitidos, ativa: estrategia.active } : null,
      },
    })
  }

  // ── Flags de canal ──
  for (const row of await q<{ id: string; channel: string; flag_name: string; value_type: string; description: string | null; label: string | null; icon_key: string | null; active: boolean }>(
    `select id, channel, flag_name, value_type, description, label, icon_key, active from channel_flags where organization_id = $1 order by channel, flag_name`,
  )) {
    const chave = `${row.channel}/${row.flag_name}`
    itens.push({
      tipo: "FLAG", chave, nome: `${row.label ?? row.flag_name} (${chave})`, idOrigem: row.id, dependencias: [], opcionais: [],
      sugestao: sugerirInclusao(row.flag_name, { motivoFixo: /^smoke/i.test(row.flag_name) ? "flag exclusiva de smoke (teste técnico)" : null }),
      dados: { channel: row.channel, flagName: row.flag_name, valueType: row.value_type, description: row.description, label: row.label, iconKey: row.icon_key, active: row.active },
    })
  }

  // ── Governança ──
  for (const row of await q<{ id: string; name: string; required_behavior: string; active: boolean }>(`select id, name, required_behavior, active from prohibited_topics where organization_id = $1 order by name`)) {
    itens.push({ tipo: "ASSUNTO_PROIBIDO", chave: row.name, nome: row.name, idOrigem: row.id, dependencias: [], opcionais: [], sugestao: sugerirInclusao(row.name), dados: { name: row.name, requiredBehavior: row.required_behavior, active: row.active } })
  }
  for (const row of await q<{ id: string; term: string; definition: string; feedback_application: string; active: boolean }>(`select id, term, definition, feedback_application, active from glossary_terms where organization_id = $1 order by term`)) {
    itens.push({ tipo: "GLOSSARIO", chave: row.term, nome: row.term, idOrigem: row.id, dependencias: [], opcionais: [], sugestao: sugerirInclusao(row.term), dados: { term: row.term, definition: row.definition, feedbackApplication: row.feedback_application, active: row.active } })
  }

  // ── Bases de conhecimento (nunca as apagadas) ──
  const assuntoPorId = new Map(itens.filter((item) => item.tipo === "ASSUNTO").map((item) => [item.idOrigem, item.chave]))
  const bases = await q<{ id: string; title: string; document_type: string; original_filename: string | null; source_type: string; governed: boolean }>(
    `select d.id, d.title, d.document_type, d.original_filename, d.source_type, exists (select 1 from checkpoint_governed_documents g where g.knowledge_document_id = d.id) governed
       from knowledge_documents d where d.organization_id = $1 and d.deleted_at is null order by d.created_at`,
  )
  const tituloDaBase = new Map<string, string>()
  const titulosUsados = new Set<string>()
  for (const row of bases) {
    const versoes = (await client.query<{ version: number; status: string; content: string }>(`select version, status, content from knowledge_versions where document_id = $1 order by version`, [row.id])).rows
    const publicada = [...versoes].reverse().find((versao) => versao.status === "PUBLISHED") ?? null
    const ultima = versoes[versoes.length - 1] ?? null
    const rascunho = ultima && ultima !== publicada && (!publicada || ultima.version > publicada.version) && ultima.status !== "ARCHIVED" ? ultima : null
    const escopos = (await client.query<{ scope_type: string; team_id: string | null; subteam_id: string | null }>(`select scope_type, team_id, subteam_id from knowledge_document_org_scopes where knowledge_document_id = $1`, [row.id])).rows
    const assuntos = (await client.query<{ scope_type: string; subject_id: string | null }>(`select scope_type, subject_id from knowledge_document_subject_scopes where knowledge_document_id = $1`, [row.id])).rows
    const porAssunto = assuntos.filter((assunto) => assunto.scope_type === "SUBJECT" && assunto.subject_id).map((assunto) => assuntoPorId.get(assunto.subject_id!) ?? "?")
    const arquivo = (await client.query<{ file_data: Buffer; checksum: string }>(`select file_data, checksum from knowledge_files where knowledge_document_id = $1 limit 1`, [row.id])).rows[0]
    const chave = titulosUsados.has(row.title) ? `${row.title} #${row.id.slice(0, 8)}` : row.title
    titulosUsados.add(chave)
    tituloDaBase.set(row.id, chave)
    let arquivoPacote: { caminho: string; nomeOriginal: string; sha256: string } | null = null
    if (arquivo) {
      const extensao = (row.original_filename?.split(".").pop() ?? row.source_type).toLowerCase()
      const caminho = `arquivos/${slug(row.title)}-${row.id.slice(0, 8)}.${extensao}`
      writeFileSync(join(pasta, caminho), arquivo.file_data)
      arquivoPacote = { caminho, nomeOriginal: row.original_filename ?? caminho.split("/").pop()!, sha256: createHash("sha256").update(arquivo.file_data).digest("hex") }
    }
    const alcances = escopos.map(alcanceDe)
    itens.push({
      tipo: "BASE", chave, nome: row.title, idOrigem: row.id,
      dependencias: porAssunto.map((assunto) => chaveDe("ASSUNTO", assunto)), opcionais: [],
      sugestao: sugerirInclusao(row.title, { alcances }),
      dados: {
        title: row.title, documentType: row.document_type, publicado: publicada?.content ?? null, rascunho: rascunho?.content ?? null, alcances,
        assuntos: porAssunto.length ? porAssunto : null, arquivo: arquivoPacote, governancaCheckpoints: row.governed,
      },
    })
  }

  // ── Argumentários ──
  const argumentarios = await q<{ id: string; name: string; business_domain_id: string | null; scope_type: string; team_id: string | null; subteam_id: string | null; status: string; conversion: string }>(
    `select id, name, business_domain_id, scope_type, team_id, subteam_id, status, conversion from argument_scripts where organization_id = $1 order by created_at`,
  )
  for (const row of argumentarios) {
    const versoes = (await client.query<{ status: string; content: unknown; source_document_id: string | null; source_reference: string | null }>(
      `select status, content, source_document_id, source_reference from argument_script_versions where script_id = $1 and status in ('PUBLISHED', 'DRAFT') order by version`,
      [row.id],
    )).rows
    const versao = (status: string) => {
      const encontrada = versoes.find((v) => v.status === status)
      return encontrada ? { content: encontrada.content, base: encontrada.source_document_id ? (tituloDaBase.get(encontrada.source_document_id) ?? null) : null, sourceReference: encontrada.source_reference } : null
    }
    const publicado = versao("PUBLISHED")
    const rascunho = versao("DRAFT")
    const dominio = row.business_domain_id ? (codigoDoDominio.get(row.business_domain_id) ?? "?") : ""
    const alcance = alcanceDe(row)
    const bases = [publicado?.base, rascunho?.base].filter((base): base is string => Boolean(base))
    itens.push({
      tipo: "ARGUMENTARIO", chave: row.name, nome: row.name, idOrigem: row.id,
      dependencias: dominio ? [chaveDe("DOMINIO", dominio)] : [], opcionais: [...new Set(bases)].map((base) => chaveDe("BASE", base)),
      sugestao: sugerirInclusao(row.name, { alcances: [alcance], motivoFixo: row.conversion === "LEGACY_UNSTRUCTURED" ? "convertido de uma regra antiga, sem estrutura" : !dominio ? "sem domínio de negócio" : null }),
      dados: { name: row.name, dominio, alcance, publicado, rascunho, arquivado: row.status === "ARCHIVED" },
    })
  }

  // ── Agentes ──
  const agentes = await q<{
    id: string; name: string; agent_type: string; objective: string; description: string; context_prompt: string; active: boolean; scope_type: string; team_id: string | null; subteam_id: string | null
    specialty: string | null; specialty_kind: string | null; domain: string | null; capability: string | null; consolidated_input: boolean; business_domain_id: string | null
    recommend_support_materials: boolean; investigation_capabilities: string[]; action_limits_enabled: boolean; action_limits: string | null
  }>(`select * from agents where organization_id = $1 order by created_at`)
  const nomeDoAgente = new Map(agentes.map((row) => [row.id, row.name]))
  for (const row of agentes) {
    const ligadas = (await client.query<{ knowledge_document_id: string }>(`select knowledge_document_id from agent_knowledge_documents where agent_id = $1`, [row.id])).rows
    const basesDoAgente = ligadas.map((ligada) => tituloDaBase.get(ligada.knowledge_document_id)).filter((titulo): titulo is string => Boolean(titulo))
    const dominio = row.business_domain_id ? (codigoDoDominio.get(row.business_domain_id) ?? row.domain) : row.domain
    const alcance = alcanceDe(row)
    itens.push({
      tipo: "AGENTE", chave: row.name, nome: row.name, idOrigem: row.id,
      dependencias: dominio ? [chaveDe("DOMINIO", dominio)] : [], opcionais: basesDoAgente.map((titulo) => chaveDe("BASE", titulo)),
      sugestao: sugerirInclusao(row.name, { alcances: [alcance] }),
      dados: {
        name: row.name, agentType: row.agent_type, objective: row.objective, description: row.description, contextPrompt: row.context_prompt, alcance, bases: basesDoAgente,
        specialtyKind: row.specialty_kind, dominio: dominio ?? null, capability: row.capability, consolidatedInput: row.consolidated_input, specialty: row.specialty,
        recommendSupportMaterials: row.recommend_support_materials, investigationCapabilities: row.investigation_capabilities ?? [], actionLimitsEnabled: row.action_limits_enabled,
        actionLimits: row.action_limits, active: row.active,
      },
    })
  }

  // ── Orquestradores ──
  const orquestradores = await q<{
    id: string; name: string; scope_type: string; team_id: string | null; subteam_id: string | null; orchestrator_agent_id: string; active: boolean; invocation_mode: string
    output_instructions: string | null; output_schema: unknown; policy_kind: string | null; policy_domains: string[]; routing_policy: string | null; routing_domains: string[]
    structured_output: unknown; recommend_support_materials: boolean
  }>(`select * from assistant_orchestrators where organization_id = $1 order by created_at`)
  for (const row of orquestradores) {
    const especialistas = (await client.query<{ agent_id: string }>(`select agent_id from assistant_orchestrator_specialists where orchestrator_id = $1 order by created_at, agent_id`, [row.id])).rows.map((especialista) => nomeDoAgente.get(especialista.agent_id)!)
    const agenteOrquestrador = nomeDoAgente.get(row.orchestrator_agent_id)!
    const dominios = [...new Set([...(row.routing_domains ?? []), ...(row.policy_domains ?? [])])]
    const alcance = alcanceDe(row)
    itens.push({
      tipo: "ORQUESTRADOR", chave: row.name, nome: row.name, idOrigem: row.id,
      dependencias: [chaveDe("AGENTE", agenteOrquestrador), ...especialistas.map((nome) => chaveDe("AGENTE", nome)), ...dominios.map((codigo) => chaveDe("DOMINIO", codigo))],
      opcionais: [],
      sugestao: sugerirInclusao(row.name, { alcances: [alcance] }),
      dados: {
        name: row.name, alcance, agenteOrquestrador, especialistas, invocationMode: row.invocation_mode, structuredOutput: row.structured_output, outputInstructions: row.output_instructions,
        outputSchema: row.output_schema, routingPolicy: row.routing_policy, routingDomains: row.routing_domains ?? [], policyKind: row.policy_kind, policyDomains: row.policy_domains ?? [],
        recommendSupportMaterials: row.recommend_support_materials, active: row.active,
      },
    })
  }

  // ── Workflows (rascunho do editor + gatilho + modo de avaliação; referências externas ao grafo pelo item/nome/matrícula) ──
  const workflows = await q<{
    id: string; name: string; description: string | null; scope_type: string; team_id: string | null; subteam_id: string | null; active: boolean; trigger_config: Record<string, unknown> | null
    draft_graph: { nodes?: { id: string }[]; edges?: { id: string }[] }; active_version_id: string | null; population_filter: unknown; consolidated_structure: unknown
  }>(`select * from workflows where organization_id = $1 order by created_at`)
  const itemPorId = new Map(itens.map((item) => [item.idOrigem, item]))
  for (const row of workflows) {
    const internos = new Set<string>([...(row.draft_graph.nodes ?? []).map((node) => node.id), ...(row.draft_graph.edges ?? []).map((edge) => edge.id)])
    for (const variavel of (await client.query<{ id: string }>(`select id from workflow_variables where workflow_id = $1`, [row.id])).rows) internos.add(variavel.id)
    const texto = JSON.stringify([row.draft_graph, row.trigger_config, row.population_filter, row.consolidated_structure])
    const ids = [...new Set(texto.match(UUID) ?? [])].filter((id) => !internos.has(id))
    const referencias: RefWorkflow[] = []
    for (const id of ids) referencias.push(await classificarReferencia(id, itemPorId))
    const codigos = [...new Set([...texto.matchAll(/"indicatorCode":\s*"([A-Z0-9_]+)"/g)].map((match) => match[1]!))]
    const flagGatilho = row.trigger_config?.kind === "channel_flag" ? (itemPorId.get(String(row.trigger_config.channelFlagId))?.chave ?? null) : null
    const alcance = alcanceDe(row)
    itens.push({
      tipo: "WORKFLOW", chave: row.name, nome: row.name, idOrigem: row.id,
      dependencias: [...referencias.flatMap((ref) => (ref.tipo === "ITEM" ? [ref.item] : [])), ...codigos.map((codigo) => chaveDe("INDICADOR", codigo))],
      opcionais: [],
      sugestao: sugerirInclusao(row.name, { alcances: [alcance], motivoFixo: referencias.find((ref) => ref.tipo === "NAO_TRANSFERIVEL") ? "usa algo que o pacote não leva" : null }),
      dados: {
        name: row.name, description: row.description, alcance, gatilho: row.trigger_config ?? {}, flagGatilho, grafo: row.draft_graph, populationFilter: row.population_filter,
        consolidatedStructure: row.consolidated_structure, referencias, active: row.active, publicadoNaOrigem: row.active_version_id !== null,
      },
    })
  }

  // ── Cenário da INIA ──
  const padrao = (await q<{ default_scene_id: string | null }>(`select default_scene_id from inia_scene_settings where organization_id = $1`))[0]?.default_scene_id ?? null
  for (const row of await q<{ id: string; name: string; schedule_start: string | null; schedule_end: string | null; background_blur: string; background_dim: number }>(
    `select id, name, to_char(schedule_start, 'YYYY-MM-DD') schedule_start, to_char(schedule_end, 'YYYY-MM-DD') schedule_end, background_blur, background_dim from inia_scenes where organization_id = $1 order by schedule_start nulls first, name`,
  )) {
    const imagens = (await client.query<{ id: string; label: string; is_primary: boolean; start_minute: number | null; end_minute: number | null; mime_type: string; sha256: string; data: Buffer }>(
      `select id, label, is_primary, start_minute, end_minute, mime_type, sha256, data from inia_scene_images where scene_id = $1 order by is_primary desc, start_minute nulls first, label`,
      [row.id],
    )).rows
    itens.push({
      tipo: "CENARIO", chave: row.name, nome: row.name, idOrigem: row.id, dependencias: [], opcionais: [], sugestao: sugerirInclusao(row.name),
      dados: {
        name: row.name, scheduleStart: row.schedule_start, scheduleEnd: row.schedule_end, blur: Number(row.background_blur), dim: row.background_dim, padrao: row.id === padrao,
        imagens: imagens.map((imagem) => {
          const caminho = `imagens/${slug(row.name)}-${slug(imagem.label)}.${imagem.mime_type.split("/")[1] === "jpeg" ? "jpg" : imagem.mime_type.split("/")[1]}`
          writeFileSync(join(pasta, caminho), imagem.data)
          return { label: imagem.label, start: horaDeMinuto(imagem.start_minute), end: horaDeMinuto(imagem.end_minute), primary: imagem.is_primary, caminho, sha256: imagem.sha256 }
        }),
      },
    })
  }

  propagarExclusoes(itens)
  const pacote: Pacote = { formato: FORMATO_PACOTE, geradoEm: new Date().toISOString(), origem: { organizacao: organizacao.name, banco: redigir(env.activeDatabaseUrl) }, itens }
  writeFileSync(join(pasta, "pacote.json"), JSON.stringify(pacote, null, 2))
  const caminhoSelecao = join(pasta, "selecao.csv")
  const anteriores = existsSync(caminhoSelecao) ? lerSelecao(readFileSync(caminhoSelecao, "utf8")) : new Map<string, boolean>()
  writeFileSync(caminhoSelecao, gerarSelecao(itens, anteriores))

  say("\nItens exportados (sim = sugerido para levar; não = parece teste ou depende de algo que ficou de fora):")
  for (const tipo of TIPOS) {
    const doTipo = itens.filter((item) => item.tipo === tipo)
    if (!doTipo.length) continue
    const incluidos = doTipo.filter((item) => anteriores.get(chaveDe(item.tipo, item.chave)) ?? item.sugestao.incluir).length
    say(`  ${ROTULO_TIPO[tipo].padEnd(22)} ${String(doTipo.length).padStart(4)}   sim ${String(incluidos).padStart(4)}   não ${String(doTipo.length - incluidos).padStart(4)}`)
  }
  say(`\n✓ Pacote gravado em ${pasta}`)
  say(`  Próximo passo: revise ${join(pasta, "selecao.csv")} (coluna "incluir") e rode a simulação: npm run config:importar -- --pacote "${pasta}" --destino <endereço da INIA>`)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
} finally {
  await client.end().catch(() => {})
}

async function resolverOrganizacao(): Promise<{ id: string; name: string }> {
  const rows = (await client.query<{ id: string; name: string }>(`select id, name from organizations order by created_at`)).rows
  if (values.organizacao) {
    const escolhida = rows.find((row) => row.id === values.organizacao || row.name === values.organizacao)
    if (!escolhida) fail(`Organização "${values.organizacao}" não encontrada. Existentes: ${rows.map((row) => row.name).join(", ")}`)
    return escolhida
  }
  if (rows.length !== 1) fail(`O banco tem ${rows.length} organizações — informe qual exportar com --organizacao "<nome>" (${rows.map((row) => row.name).join(", ")}).`)
  return rows[0]!
}

async function classificarReferencia(id: string, itemPorId: Map<string, Item>): Promise<RefWorkflow> {
  const item = itemPorId.get(id)
  if (item) return { idOrigem: id, tipo: "ITEM", item: chaveDe(item.tipo, item.chave) }
  const pessoa = (await client.query<{ name: string; matricula: string | null; role: string }>(`select name, matricula, role from people where id = $1`, [id])).rows[0]
  if (pessoa) return { idOrigem: id, tipo: "PESSOA", pessoa: { matricula: pessoa.matricula, nome: pessoa.name, cargo: pessoa.role } }
  const grupo = (await client.query<{ name: string }>(`select name from teams where id = $1`, [id])).rows[0]
  if (grupo) return { idOrigem: id, tipo: "GRUPO", grupo: grupo.name }
  const subgrupo = (await client.query<{ name: string; team: string }>(`select s.name, t.name team from subteams s join teams t on t.id = s.team_id where s.id = $1`, [id])).rows[0]
  if (subgrupo) return { idOrigem: id, tipo: "SUBGRUPO", grupo: subgrupo.team, subgrupo: subgrupo.name }
  const politica = (await client.query<{ name: string }>(`select name from intervention_policies where id = $1`, [id])).rows[0]
  if (politica) return { idOrigem: id, tipo: "NAO_TRANSFERIVEL", descricao: `política de acompanhamento "${politica.name}" (o pacote não leva políticas)` }
  return { idOrigem: id, tipo: "NAO_TRANSFERIVEL", descricao: `registro que não existe mais na origem (${id})` }
}

function redigir(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`
  } catch {
    return "(DATABASE_URL inválida)"
  }
}
