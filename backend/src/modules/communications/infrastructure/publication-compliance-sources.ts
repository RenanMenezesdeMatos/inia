import type { Database } from "../../../infrastructure/database/pool.js"
import type { ComplianceSource } from "../../governance/domain/response-compliance.js"
import { alignmentReferenceOf, audienceLabelOf, type AlignmentLink } from "../../operational-alignments/domain/operational-alignment.js"
import { alignmentLinksSql } from "../../operational-alignments/infrastructure/operational-alignment-loaders.js"

/** Cada publicação entra com até este tanto de texto: a conferência tem teto total, e uma fonte que não cabe fica de fora inteira. */
const PUBLICATION_SOURCE_MAX_CHARS = 12_000

const formatCivil = (date: string) => date.slice(0, 10).split("-").reverse().join("/")
const personLabel = (name: string | null, jobTitle: string | null) => (name ? (jobTitle?.trim() ? `${name} (${jobTitle.trim()})` : name) : null)

/**
 * Fontes `PUBLICATION` da conferência da resposta (`RESPONSE_COMPLIANCE_V6`, 18/11/2026): o texto do REGISTRO publicado dos comunicados e das
 * versões de alinhamento que entraram nas instruções da resposta, carregado pelo id (o rastro da resposta guarda só id e título). Nunca texto
 * de IA. Do alinhamento vai tudo o que a INIA deve dizer ao citá-lo (referência, público, vigência, quem definiu, motivo) — sem isso, a
 * atribuição "definida pela supervisora X, para o Subgrupo Y" foi barrada como contexto inventado (caso real do diretor). Da organização da
 * conversa; comunicado retirado depois continua valendo como fonte do que foi dito naquele turno.
 */
export async function loadPublicationComplianceSources(db: Pick<Database, "query">, organizationId: string, refs: { communicationIds: readonly string[]; alignmentVersionIds: readonly string[] }): Promise<ComplianceSource[]> {
  const [communications, alignments] = await Promise.all([
    refs.communicationIds.length === 0
      ? []
      : (await db.query<{ title: string; plain_text: string; summary: string | null; published_at: Date | null; author: string | null }>(
          `select n.title, n.plain_text, n.summary, n.published_at, p.name author
           from communications n left join people p on p.id = n.author_person_id
           where n.organization_id = $1 and n.id = any($2::uuid[])`,
          [organizationId, [...refs.communicationIds]],
        )).rows,
    refs.alignmentVersionIds.length === 0
      ? []
      : (await db.query<{ alignment_id: string; version: number; title: string; guidance: string; affected_topic: string | null; justification: string | null; starts_on: string; ends_on: string; operating_universe: string; scope_type: "UNIVERSE" | "GROUPS"; links: AlignmentLink[] | null; product_name: string | null; responsible_name: string | null; responsible_job_title: string | null; published_by_name: string | null; published_by_job_title: string | null }>(
          `select v.alignment_id, v.version, v.title, v.guidance, v.affected_topic, v.justification, v.starts_on::text starts_on, v.ends_on::text ends_on,
                  v.operating_universe, v.scope_type, ${alignmentLinksSql("v")} links, pn.name product_name,
                  pr.name responsible_name, v.responsible_job_title, pp.name published_by_name, pp.job_title published_by_job_title
           from operational_alignment_versions v
           left join product_catalog_nodes_all pn on pn.id = v.product_id
           left join people pr on pr.id = v.responsible_person_id
           left join people pp on pp.id = v.published_by
           where v.organization_id = $1 and v.id = any($2::uuid[])`,
          [organizationId, [...refs.alignmentVersionIds]],
        )).rows,
  ])
  return [
    ...communications.map((row) => ({
      origin: "PUBLICATION" as const,
      title: `Comunicado: ${row.title}`,
      text: [
        `Publicado por ${row.author ?? "liderança"}${row.published_at ? ` em ${new Date(row.published_at).toISOString().slice(0, 10).split("-").reverse().join("/")}` : ""}.`,
        row.summary ? `Resumo: ${row.summary}` : null,
        row.plain_text,
      ].filter(Boolean).join("\n").slice(0, PUBLICATION_SOURCE_MAX_CHARS),
    })),
    ...alignments.map((row) => {
      const definedBy = personLabel(row.responsible_name, row.responsible_job_title)
      const publishedBy = personLabel(row.published_by_name, row.published_by_job_title)
      return {
        origin: "PUBLICATION" as const,
        title: `Alinhamento operacional: ${row.title}`,
        text: [
          `Referência: ${alignmentReferenceOf(row.alignment_id, row.version)}.`,
          `Público: ${audienceLabelOf({ operatingUniverse: row.operating_universe as never, scopeType: row.scope_type, links: row.links ?? [], productName: row.product_name })}.`,
          `Vigência: ${formatCivil(row.starts_on)} a ${formatCivil(row.ends_on)} (orientação temporária).`,
          definedBy ? `Definido por: ${definedBy}.` : publishedBy ? `Publicado por: ${publishedBy}.` : null,
          row.affected_topic ? `Trecho que muda: ${row.affected_topic}` : null,
          `Orientação: ${row.guidance}`,
          row.justification ? `Motivo: ${row.justification}` : null,
        ].filter(Boolean).join("\n").slice(0, PUBLICATION_SOURCE_MAX_CHARS),
      }
    }),
  ]
}
