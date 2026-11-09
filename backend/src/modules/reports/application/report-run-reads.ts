import type { Database } from "../../../infrastructure/database/pool.js"
import type { VisibilityFilter } from "../../access/application/access-repository.js"
import { visibilityOf } from "../../access/application/access-service.js"
import type { Permission } from "../../access/domain/permissions.js"
import { loadAccessContexts } from "../../access/infrastructure/postgres-access-repository.js"
import { PgAnalyticsReadRepository, type AnalyticsReadRepository, type IndicatorDefinitionRow, type IndicatorPerformanceRow, type PrvPerformanceRow } from "../../performance-analytics/application/analytics-read-repository.js"
import { PinnedPeopleGraphCache } from "../../performance-analytics/infrastructure/organization-people-graph.js"

/** O que a cobertura de um report lê do fechamento oficial. */
export type CoverageReads = Pick<AnalyticsReadRepository, "loadIndicatorDefinitions" | "loadIndicatorPerformance" | "loadPrvPerformance">

type OfficialRead<T> = { organizationId: string; personIds: ReadonlySet<string>; periods: ReadonlySet<string>; rows: Promise<T[]> }

function covers<T>(read: OfficialRead<T> | null, organizationId: string, personIds: readonly string[], periods: readonly string[]): read is OfficialRead<T> {
  return read !== null && read.organizationId === organizationId && periods.every((period) => read.periods.has(period)) && personIds.every((personId) => read.personIds.has(personId))
}

/** As linhas que a consulta devolveria para o pedido: o mesmo filtro (pessoa ∈ pedido e competência ∈ pedido) sobre um superconjunto. */
function subset<T extends { personId: string; referencePeriod: string }>(rows: Promise<T[]>, personIds: readonly string[], periods: readonly string[]): Promise<T[]> {
  const people = new Set(personIds)
  const wanted = new Set(periods)
  return rows.then((all) => all.filter((row) => people.has(row.personId) && wanted.has(row.referencePeriod)))
}

/**
 * Leituras do analytics de UMA execução de report — todos os destinatários dela:
 *  - grafo de pessoas fixado no lote (`PinnedPeopleGraphCache`): uma conferência de versão, não uma por pessoa;
 *  - onde cada conta tem `indicators.view`, carregado em lote (`loadAccessContexts`) antes de montar as sessões;
 *  - a ÚLTIMA leitura do fechamento oficial (catálogo, indicadores, PRV) que a ferramenta fez, para a cobertura do mesmo grupo
 *    reaproveitar (`coverageReads`). As consultas da ferramenta não mudam; só a cobertura lê da memória, e só quando o que a
 *    ferramenta leu cobre o pedido (mesma organização, todas as pessoas e competências) — senão, consulta como antes.
 * Uma instância por execução; descartada no fim dela (guarda só a última leitura de cada tipo).
 */
export class ReportRunReads extends PgAnalyticsReadRepository {
  private definitionsRead: { organizationId: string; rows: Promise<IndicatorDefinitionRow[]> } | null = null
  private indicatorRead: OfficialRead<IndicatorPerformanceRow> | null = null
  private prvRead: OfficialRead<PrvPerformanceRow> | null = null

  private constructor(
    db: Database,
    private readonly organizationId: string,
    private readonly visibilities: ReadonlyMap<string, VisibilityFilter>,
  ) {
    super(db, { peopleGraphCache: new PinnedPeopleGraphCache() })
  }

  static async forAccounts(db: Database, organizationId: string, accountIds: readonly string[]): Promise<ReportRunReads> {
    const contexts = await loadAccessContexts(db, organizationId, accountIds)
    return new ReportRunReads(db, organizationId, new Map([...contexts].map(([accountId, context]) => [accountId, visibilityOf(context, "indicators.view")])))
  }

  override async loadAccessVisibility(organizationId: string, accountId: string, permission: Permission): Promise<VisibilityFilter> {
    const prefetched = organizationId === this.organizationId && permission === "indicators.view" ? this.visibilities.get(accountId) : undefined
    return prefetched ?? super.loadAccessVisibility(organizationId, accountId, permission)
  }

  override loadIndicatorDefinitions(organizationId: string): Promise<IndicatorDefinitionRow[]> {
    const rows = super.loadIndicatorDefinitions(organizationId)
    const read = { organizationId, rows }
    this.definitionsRead = read
    rows.catch(() => {
      if (this.definitionsRead === read) this.definitionsRead = null
    })
    return rows
  }

  override loadIndicatorPerformance(organizationId: string, personIds: string[], periods: string[]): Promise<IndicatorPerformanceRow[]> {
    const rows = super.loadIndicatorPerformance(organizationId, personIds, periods)
    const read = { organizationId, personIds: new Set(personIds), periods: new Set(periods), rows }
    this.indicatorRead = read
    rows.catch(() => {
      if (this.indicatorRead === read) this.indicatorRead = null
    })
    return rows
  }

  override loadPrvPerformance(organizationId: string, personIds: string[], periods: string[]): Promise<PrvPerformanceRow[]> {
    const rows = super.loadPrvPerformance(organizationId, personIds, periods)
    const read = { organizationId, personIds: new Set(personIds), periods: new Set(periods), rows }
    this.prvRead = read
    rows.catch(() => {
      if (this.prvRead === read) this.prvRead = null
    })
    return rows
  }

  /** Leituras da cobertura (e da direção do indicador na comparação): o que a ferramenta acabou de ler, quando cobre o pedido. */
  coverageReads(): CoverageReads {
    return {
      loadIndicatorDefinitions: (organizationId) => (this.definitionsRead?.organizationId === organizationId ? this.definitionsRead.rows : super.loadIndicatorDefinitions(organizationId)),
      loadIndicatorPerformance: (organizationId, personIds, periods) => {
        const read = this.indicatorRead
        return covers(read, organizationId, personIds, periods) ? subset(read.rows, personIds, periods) : super.loadIndicatorPerformance(organizationId, personIds, periods)
      },
      loadPrvPerformance: (organizationId, personIds, periods) => {
        const read = this.prvRead
        return covers(read, organizationId, personIds, periods) ? subset(read.rows, personIds, periods) : super.loadPrvPerformance(organizationId, personIds, periods)
      },
    }
  }
}
