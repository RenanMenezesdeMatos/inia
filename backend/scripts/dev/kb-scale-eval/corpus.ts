/**
 * Corpus da avaliação da busca em escala: as bases vigentes da cópia de medição (só leitura) e as distratoras sintéticas determinísticas
 * (assuntos fora dos gabaritos, vocabulário operacional parecido). Usado por `eval-recall.ts` e `eval-chat.ts`.
 */
import { createReadStream, existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadKnowledgeProducts } from "../../../src/modules/knowledge/application/knowledge-products.js"
import type { GlossaryAcronym } from "../../../src/modules/knowledge/domain/query-acronyms.js"
import { createInterface } from "node:readline"
import pg from "pg"
import type { CatalogSource } from "../../../src/modules/knowledge/domain/knowledge-catalog.js"
import { chunkKnowledgeDocument } from "../../../src/modules/knowledge/domain/knowledge-chunking.js"
import { liveKnowledgeVersion } from "../../../src/modules/knowledge/application/live-knowledge-version.js"

export type Corpus = { organizationId: string; sources: CatalogSource[]; glossary: { term: string; definition: string }[]; acronyms: GlossaryAcronym[]; products: Map<string, string> }

export async function loadRealCorpus(databaseUrl: string): Promise<Corpus> {
  if (/\/inia(\?|$)/.test(databaseUrl)) throw new Error("Recusado: a avaliação lê só a cópia de medição (inia_chatbench), nunca o banco de desenvolvimento compartilhado.")
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    const organizationId = (await client.query<{ organization_id: string }>(`select organization_id from knowledge_documents where deleted_at is null group by 1 order by count(*) desc limit 1`)).rows[0]!.organization_id
    const rows = (await client.query<{ id: string; title: string; document_type: string; version_id: string; content: string }>(
      `select kd.id, coalesce(kv.config->>'title', kd.title) title, kd.document_type, kv.id version_id, kv.content
         from knowledge_documents kd join lateral (${liveKnowledgeVersion("kd.id", "id, content, config")}) kv on true
        where kd.organization_id = $1 and kd.deleted_at is null and kv.status = 'PUBLISHED' order by kd.title`,
      [organizationId],
    )).rows
    const glossary = (await client.query<{ term: string; definition: string }>(`select term, definition from glossary_terms where organization_id = $1 and active order by term limit 80`, [organizationId])).rows
    const products = await loadKnowledgeProducts(client as never, organizationId, rows.map((row) => row.id))
    const acronyms = glossary.flatMap((row) => (/^[A-Z][A-Z0-9]{1,5}$/.test(row.term.trim()) ? [{ acronym: row.term.trim(), definition: row.definition.trim() }] : []))
    const taxonomy = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "taxonomy-fixtures.json"), "utf8")) as { bases: { id: string; family: string; product: string; title: string; content: string }[] }
    const fixtures = taxonomy.bases.map((base) => ({ documentId: base.id, documentTitle: base.title, versionId: `${base.id}-v1`, documentType: "PROCEDURE", chunks: chunkKnowledgeDocument({ id: base.id, title: base.title, content: base.content }) }))
    for (const base of taxonomy.bases) products.set(base.id, `${base.family} › ${base.product}`)
    return { organizationId, glossary, acronyms, products, sources: [...rows.map((row) => ({ documentId: row.id, documentTitle: row.title, versionId: row.version_id, documentType: row.document_type, chunks: chunkKnowledgeDocument({ id: row.id, title: row.title, content: row.content }) })), ...fixtures] }
  } finally {
    await client.end()
  }
}

// ---------- distratoras sintéticas (determinísticas; assuntos fora do gabarito) ----------
function prng(seed: number) {
  let state = seed >>> 0
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}
const SERVICES = ["Ativação de linha", "Cancelamento de serviço", "Portabilidade numérica", "Upgrade de plano", "Bloqueio por perda ou roubo", "Desbloqueio de aparelho", "Mudança de vencimento", "Débito automático", "Roaming internacional", "Recarga programada", "Pacote adicional de dados", "Fidelização e multa", "Transferência de pontos", "Cadastro de dependente", "Atualização cadastral", "Instalação de TV", "Configuração de e-mail corporativo", "Suspensão temporária", "Reativação de linha", "Venda de acessórios", "Seguro do aparelho", "Assinatura de streaming", "Chip eSIM", "Plano controle", "Atendimento a órgão público"]
const PRODUCTS = ["Ômega", "Vértice", "Aurora Plus", "Delta Empresas", "Fibra Max", "Nuvem Pro", "Conecta 5G", "Linha Rural", "Voz Total", "Dados Flex", "Família Mais", "Pré Turbo", "Pós Essencial", "Corporativo Gold", "IoT Frota", "Satélite Norte", "Rede Privada", "Hotspot Wi-Fi", "Central Virtual", "Tronco Digital"]
export function distractor(index: number): CatalogSource {
  const random = prng(index + 1)
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!
  const service = pick(SERVICES)
  const product = pick(PRODUCTS)
  const days = 1 + Math.floor(random() * 30)
  const hours = 1 + Math.floor(random() * 72)
  const fee = (5 + random() * 95).toFixed(2).replace(".", ",")
  const title = `Procedimento sintético ${String(index).padStart(4, "0")} — ${service} ${product}`
  const content = [
    `## 1. Quando se aplica\n${service} do produto ${product} solicitada pelo titular ou por representante com procuração.`,
    `## 2. Documentos necessários\nDocumento de identificação com foto do titular e, para empresas, contrato social atualizado. Confira o CPF ou CNPJ no cadastro.`,
    `## 3. Prazo\nA ${service.toLowerCase()} do ${product} é concluída em até ${days} dias úteis após o registro do protocolo.`,
    `## 4. Taxas\nTaxa de R$ ${fee} cobrada na próxima fatura, exceto quando o cliente estiver em período de fidelização vigente.`,
    `## 5. Validações\nValide o titular com data de nascimento e os quatro últimos dígitos do documento antes de seguir.`,
    `## 6. Exceções\nClientes do segmento governo seguem o contrato específico; não aplique a taxa sem consultar a gestão do contrato.`,
    `## 7. Registro no sistema\nRegistre a solicitação com o motivo "${service}" e anote o número do protocolo para o cliente.`,
    `## 8. Comunicação ao cliente\nInforme que a confirmação chega por SMS em até ${hours} horas.`,
    `## 9. Escalonamento\nSem retorno no prazo, abra um chamado para o time de ${product} com o protocolo original.`,
    `## 10. Encerramento\nConfirme se restou alguma dúvida e encerre o atendimento seguindo o roteiro padrão.`,
  ].join("\n\n")
  const documentId = `synthetic-${index}`
  return { documentId, documentTitle: title, versionId: `${documentId}-v1`, documentType: "PROCEDURE", chunks: chunkKnowledgeDocument({ id: documentId, title, content }) }
}
export function withDistractors(real: readonly CatalogSource[], count: number): CatalogSource[] {
  return [...real, ...Array.from({ length: count }, (_, index) => distractor(index))].sort((left, right) => left.documentTitle.localeCompare(right.documentTitle, "pt-BR"))
}


/** Cache de vetores (JSONL por hash) lido em fluxo: com 3072 posições o arquivo passa do tamanho máximo de uma string. */
export async function readVectorCache(file: string): Promise<Map<string, Float32Array>> {
  const vectors = new Map<string, Float32Array>()
  if (!existsSync(file)) return vectors
  for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    if (!line) continue
    const { h, v } = JSON.parse(line) as { h: string; v: number[] }
    vectors.set(h, new Float32Array(v))
  }
  return vectors
}
