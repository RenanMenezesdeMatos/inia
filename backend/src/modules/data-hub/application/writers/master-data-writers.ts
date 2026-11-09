import type pg from "pg"
import type { Database } from "../../../../infrastructure/database/pool.js"
import { applyEmployeeStatusSnapshot, cancelEmployeeStatusPeriod, type SnapshotOutcome } from "../../../people/application/employment-status-service.js"
import { BRAZILIAN_CAPITAL_CODES, normalizeCapitalCode } from "../../../people/domain/brazilian-capitals.js"
import { EMPLOYMENT_STATUS_LABELS, normalizeEmploymentStatus, type EmploymentStatus, type StatusPeriod } from "../../../people/domain/employment-status.js"
import { normalizeScheduleExceptionCode, SCHEDULE_EXCEPTION_EFFECT_BY_CODE, SCHEDULE_EXCEPTION_LABELS, type ScheduleExceptionCode } from "../../../people/domain/schedule-exception.js"
import { normalizeScheduleType, type ScheduleType } from "../../../people/domain/work-schedule.js"
import { recordAudit } from "../records.js"
import { resolveEmployees, resolveIndicators, resolveOperations, resolveSubteams, resolveTeams } from "../reference-resolver.js"
import { bool, countUpsert, dedupeByKey, emptyApply, reject, str, type ApplyResult, type ApplyWarning, type DomainWriter, type LineageEntry, type Rejection, type ValidRecord, type WriteContext } from "./domain-writer.js"
import { accessDisabledWarnings, credentialNeedsNewCustody, disableAccountsFromSource, enforceSourceCustody, linkByAccountEmail, linkedWarnings, markFirstApplicationCustody, pendingCustodyWarnings, placementBefore, possibleDuplicateWarnings, preRegisteredByMatricula } from "./person-identity.js"

/**
 * Writers de dado mestre. Regras compartilhadas:
 *  - identidade por código externo (matrícula, código do grupo) — nunca por nome;
 *  - campo opcional ausente = mantém o valor atual (upsert controlado);
 *  - ausência de um registro na carga NUNCA desativa ninguém.
 */
// ---------------------------------------------------------------------------------------------
// GROUPS → teams
// ---------------------------------------------------------------------------------------------
type PreparedGroup = ValidRecord & { externalCode: string; name: string; operationId: string }

export const groupsWriter: DomainWriter<PreparedGroup> = {
  contractKey: "GROUPS",
  async prepare(context, records) {
    const { unique, duplicates } = dedupeByKey(records, (record) => String(record.record.externalCode))
    const operations = await resolveOperations(context.ctx.db, context.organizationId)
    const ready: PreparedGroup[] = []
    const rejections: Rejection[] = [...duplicates]
    for (const record of unique) {
      const operationName = str(record.record, "operationName")
      const operation = operationName ? operations.byName.get(operationName) : operations.defaultOperation
      if (!operation) {
        rejections.push(reject(record, "DATA_REFERENCE_NOT_FOUND", "operationName", operationName ? `Operação "${operationName}" não existe.` : "A organização não tem nenhuma Operação cadastrada."))
        continue
      }
      ready.push({ ...record, externalCode: str(record.record, "externalCode")!, name: str(record.record, "name")!, operationId: operation.id })
    }
    return { ready, rejections }
  },
  async apply(context, client, batch) {
    if (batch.length === 0) return emptyApply()
    const result = await client.query<{ id: string; external_code: string; inserted: boolean }>(
      `insert into teams (organization_id, operation_id, name, external_code)
       select $1, operation_id, name, external_code from unnest($2::uuid[], $3::text[], $4::text[]) as t(operation_id, name, external_code)
       on conflict (organization_id, external_code) where external_code is not null do update set name = excluded.name, operation_id = excluded.operation_id
       where teams.name is distinct from excluded.name or teams.operation_id is distinct from excluded.operation_id
       returning id, external_code, (xmax = 0) inserted`,
      [context.organizationId, batch.map((row) => row.operationId), batch.map((row) => row.name), batch.map((row) => row.externalCode)],
    )
    return withLineage("teams", batch, (row) => row.externalCode, result.rows.map((row) => ({ key: row.external_code, id: row.id, inserted: row.inserted })))
  },
}

// ---------------------------------------------------------------------------------------------
// SUBGROUPS → subteams
// ---------------------------------------------------------------------------------------------
type PreparedSubgroup = ValidRecord & { externalCode: string; name: string; teamId: string }

export const subgroupsWriter: DomainWriter<PreparedSubgroup> = {
  contractKey: "SUBGROUPS",
  async prepare(context, records) {
    const { unique, duplicates } = dedupeByKey(records, (record) => String(record.record.externalCode))
    const teams = await resolveTeams(context.ctx.db, context.organizationId, unique.map((record) => str(record.record, "groupExternalCode")))
    const ready: PreparedSubgroup[] = []
    const rejections: Rejection[] = [...duplicates]
    for (const record of unique) {
      const groupCode = str(record.record, "groupExternalCode")!
      const team = teams.get(groupCode)
      if (!team) {
        rejections.push(reject(record, "DATA_GROUP_NOT_FOUND", "groupExternalCode", `Grupo "${groupCode}" não existe na INIA.`))
        continue
      }
      ready.push({ ...record, externalCode: str(record.record, "externalCode")!, name: str(record.record, "name")!, teamId: team.id })
    }
    return { ready, rejections }
  },
  async apply(context, client, batch) {
    if (batch.length === 0) return emptyApply()
    const result = await client.query<{ id: string; external_code: string; inserted: boolean }>(
      `insert into subteams (organization_id, team_id, name, external_code)
       select $1, team_id, name, external_code from unnest($2::uuid[], $3::text[], $4::text[]) as t(team_id, name, external_code)
       on conflict (organization_id, external_code) where external_code is not null do update set name = excluded.name, team_id = excluded.team_id
       where subteams.name is distinct from excluded.name or subteams.team_id is distinct from excluded.team_id
       returning id, external_code, (xmax = 0) inserted`,
      [context.organizationId, batch.map((row) => row.teamId), batch.map((row) => row.name), batch.map((row) => row.externalCode)],
    )
    return withLineage("subteams", batch, (row) => row.externalCode, result.rows.map((row) => ({ key: row.external_code, id: row.id, inserted: row.inserted })))
  },
}

// ---------------------------------------------------------------------------------------------
// EMPLOYEES → people (+ user_accounts.email quando a conta já existe)
// ---------------------------------------------------------------------------------------------
type PreparedEmployee = ValidRecord & {
  matricula: string
  name: string
  role: string
  jobTitle: string | null
  teamId: string | null
  subteamId: string | null
  reportsTo: string | null
  hiredAt: string | null
  active: boolean | null
  email: string | null
  employmentStatus: { status: EmploymentStatus; rawStatus: string; effectiveFrom: string | null; sourceUpdatedAt: string | null } | null
  /** Capital operacional (catálogo das 27); null = não informada (mantém a atual). */
  operationalCapitalCode: string | null
}

async function resolveStructureRefs(context: WriteContext, records: ValidRecord[]) {
  const [teams, subteams] = await Promise.all([
    resolveTeams(context.ctx.db, context.organizationId, records.map((record) => str(record.record, "groupExternalCode"))),
    resolveSubteams(context.ctx.db, context.organizationId, records.map((record) => str(record.record, "subgroupExternalCode"))),
  ])
  return { teams, subteams }
}

/** Resolve grupo/subgrupo de um registro; `undefined` no campo = não informado (mantém). */
function resolveGroupPair(record: ValidRecord, refs: Awaited<ReturnType<typeof resolveStructureRefs>>): { teamId: string | null; subteamId: string | null; rejection: Rejection | null } {
  const groupCode = str(record.record, "groupExternalCode")
  const subgroupCode = str(record.record, "subgroupExternalCode")
  const team = groupCode ? refs.teams.get(groupCode) : undefined
  if (groupCode && !team) return { teamId: null, subteamId: null, rejection: reject(record, "DATA_GROUP_NOT_FOUND", "groupExternalCode", `Grupo "${groupCode}" não existe na INIA.`) }
  const subteam = subgroupCode ? refs.subteams.get(subgroupCode) : undefined
  if (subgroupCode && !subteam) return { teamId: null, subteamId: null, rejection: reject(record, "DATA_SUBGROUP_NOT_FOUND", "subgroupExternalCode", `Subgrupo "${subgroupCode}" não existe na INIA.`) }
  if (team && subteam && subteam.teamId !== team.id) return { teamId: null, subteamId: null, rejection: reject(record, "DATA_CONTRACT_VIOLATION", "subgroupExternalCode", `Subgrupo "${subgroupCode}" não pertence ao Grupo "${groupCode}".`) }
  return { teamId: team?.id ?? subteam?.teamId ?? null, subteamId: subteam?.id ?? null, rejection: null }
}

export const employeesWriter: DomainWriter<PreparedEmployee> = {
  contractKey: "EMPLOYEES",
  async prepare(context, records) {
    const { unique, duplicates } = dedupeByKey(records, (record) => String(record.record.externalEmployeeId))
    const refs = await resolveStructureRefs(context, unique)
    const managers = await resolveEmployees(context.ctx.db, context.organizationId, unique.map((record) => str(record.record, "reportsToExternalId")))
    const inBatch = new Set(unique.map((record) => str(record.record, "externalEmployeeId")!))
    const ready: PreparedEmployee[] = []
    const rejections: Rejection[] = [...duplicates]
    for (const record of unique) {
      const matricula = str(record.record, "externalEmployeeId")!
      const pair = resolveGroupPair(record, refs)
      if (pair.rejection) {
        rejections.push(pair.rejection)
        continue
      }
      const reportsTo = str(record.record, "reportsToExternalId")
      if (reportsTo === matricula) {
        rejections.push(reject(record, "DATA_CONTRACT_VIOLATION", "reportsToExternalId", "Um colaborador não pode reportar a si mesmo."))
        continue
      }
      // Gestor precisa existir na INIA OU vir nesta mesma carga (segunda passagem resolve).
      if (reportsTo && !managers.has(reportsTo) && !inBatch.has(reportsTo)) {
        rejections.push(reject(record, "DATA_EMPLOYEE_NOT_FOUND", "reportsToExternalId", `Gestor "${reportsTo}" não existe na INIA nem nesta carga.`))
        continue
      }
      // Situação funcional: texto bruto da fonte normalizado pela camada canônica; desconhecido
      // vai para a quarentena — nunca "ativo por palpite".
      const rawStatus = str(record.record, "currentStatus")
      const normalizedStatus = rawStatus ? normalizeEmploymentStatus(rawStatus) : null
      if (rawStatus && !normalizedStatus) {
        rejections.push(reject(record, "DATA_EMPLOYMENT_STATUS_UNKNOWN", "currentStatus", `Situação funcional "${rawStatus}" não é reconhecida. Situações reais: ${Object.values(EMPLOYMENT_STATUS_LABELS).join(", ")} — mapeie o valor da fonte com "Mapear códigos"; a INIA nunca chuta "em produção".`))
        continue
      }
      // Capital operacional: precisa existir no catálogo das 27 capitais (código ou nome oficial);
      // abreviação da empresa entra por "Mapear códigos" — nunca por heurística.
      const rawCapital = str(record.record, "operationalCapitalCode")
      const capital = rawCapital ? normalizeCapitalCode(rawCapital) : null
      if (rawCapital && !capital) {
        rejections.push(reject(record, "DATA_INVALID_ENUM", "operationalCapitalCode", `Capital operacional "${rawCapital}" não está no catálogo (${BRAZILIAN_CAPITAL_CODES.join(", ")}) — mapeie o valor da fonte com "Mapear códigos".`))
        continue
      }
      ready.push({
        ...record,
        matricula,
        name: str(record.record, "name")!,
        role: str(record.record, "role")!,
        jobTitle: str(record.record, "jobTitle"),
        teamId: pair.teamId,
        subteamId: pair.subteamId,
        reportsTo,
        hiredAt: str(record.record, "hiredAt"),
        active: bool(record.record, "active"),
        email: str(record.record, "email"),
        employmentStatus: rawStatus && normalizedStatus ? { status: normalizedStatus, rawStatus, effectiveFrom: str(record.record, "statusEffectiveFrom"), sourceUpdatedAt: str(record.record, "sourceUpdatedAt") } : null,
        operationalCapitalCode: capital,
      })
    }
    return { ready, rejections }
  },
  async apply(context, client, batch) {
    if (batch.length === 0) return emptyApply()
    const org = context.organizationId
    // Passo 0: identidade — matrícula nova com o e-mail da conta de uma pessoa cadastrada à mão (sem matrícula) é gravada nela,
    // e o upsert abaixo passa a ATUALIZAR essa pessoa em vez de criar outra (ver person-identity.ts).
    const linked = await linkByAccountEmail(context, client, batch)
    // Pessoa cadastrada à mão já com a matrícula (e conta) que a base assume agora pela primeira vez: mesma custódia do vínculo acima.
    const preRegistered = await preRegisteredByMatricula(context, client, batch, new Set(linked.map((entry) => entry.personId)))
    // Lugar de cada pessoa ANTES desta carga: quem estava ativo (para saber quem ela desativa — passo 1b) e Grupo/nível/gestor (custódia, passo 2b).
    const before = await placementBefore(context, client, batch.map((row) => row.matricula))
    // Primeira aplicação da base a quem foi cadastrado à mão (ligado agora, pré-cadastrado ou citado como gestor): custódia pendente (h19).
    await markFirstApplicationCustody(context, client, [...batch.map((row) => row.matricula), ...batch.flatMap((row) => (row.reportsTo ? [row.reportsTo] : []))])
    const activeBefore = new Set([...before].filter(([, placement]) => placement.active).map(([id]) => id))
    // Passo 1: dados do próprio colaborador (grupo/subgrupo/cargo/admissão só sobrescrevem quando informados).
    const upsert = await client.query<{ id: string; matricula: string; inserted: boolean }>(
      `with input as (
         select * from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::uuid[], $7::uuid[], $8::date[], $9::boolean[], $10::text[])
           as t(matricula, name, role, job_title, team_id, subteam_id, hired_at, active, operational_capital_code)
       )
       insert into people (organization_id, matricula, name, role, job_title, team_id, subteam_id, hired_at, active, operational_capital_code)
       select $1, matricula, name, role, job_title, team_id, subteam_id, hired_at, coalesce(active, true), operational_capital_code from input
       on conflict (organization_id, matricula) do update set
         name = excluded.name,
         role = excluded.role,
         job_title = coalesce(excluded.job_title, people.job_title),
         team_id = coalesce(excluded.team_id, people.team_id),
         subteam_id = case when excluded.team_id is not null then excluded.subteam_id else coalesce(excluded.subteam_id, people.subteam_id) end,
         hired_at = coalesce(excluded.hired_at, people.hired_at),
         active = coalesce((select i.active from input i where i.matricula = excluded.matricula), people.active),
         operational_capital_code = coalesce(excluded.operational_capital_code, people.operational_capital_code)
       where people.name is distinct from excluded.name
          or people.role is distinct from excluded.role
          or people.job_title is distinct from coalesce(excluded.job_title, people.job_title)
          or people.team_id is distinct from coalesce(excluded.team_id, people.team_id)
          or people.subteam_id is distinct from (case when excluded.team_id is not null then excluded.subteam_id else coalesce(excluded.subteam_id, people.subteam_id) end)
          or people.hired_at is distinct from coalesce(excluded.hired_at, people.hired_at)
          or people.active is distinct from coalesce((select i.active from input i where i.matricula = excluded.matricula), people.active)
          or people.operational_capital_code is distinct from coalesce(excluded.operational_capital_code, people.operational_capital_code)
       returning id, matricula, (xmax = 0) inserted`,
      [org, batch.map((r) => r.matricula), batch.map((r) => r.name), batch.map((r) => r.role), batch.map((r) => r.jobTitle), batch.map((r) => r.teamId), batch.map((r) => r.subteamId), batch.map((r) => r.hiredAt), batch.map((r) => r.active), batch.map((r) => r.operationalCapitalCode)],
    )
    // Passo 1b: credencial. Desligada pela base = conta desabilitada (reativar não devolve a senha nem os tokens antigos — achado
    // AUTH-7); pessoa cadastrada à mão (ligada pelo e-mail ou pré-cadastrada com a matrícula) que a base pôs em outro Grupo/nível
    // de liderança = conta desabilitada até quem tem custódia do lugar novo liberar (AUTH-13; C09 da 4ª auditoria).
    const incoming = new Map(batch.map((row) => [row.matricula, row]))
    const deactivatedNow = upsert.rows.filter((row) => !row.inserted && activeBefore.has(row.id) && incoming.get(row.matricula)?.active === false).map((row) => row.id)
    await disableAccountsFromSource(context, client, deactivatedNow, "PERSON_DEACTIVATED_BY_SOURCE")
    const needsCustody = [...linked, ...preRegistered].filter((entry) => !deactivatedNow.includes(entry.personId) && credentialNeedsNewCustody(entry.prior, { teamId: entry.row.teamId, role: entry.row.role })).map((entry) => entry.personId)
    const linkAccessDisabled = new Set((await disableAccountsFromSource(context, client, needsCustody, "LINKED_BY_SOURCE_NEW_PLACEMENT")).filter((entry) => entry.disabled).map((entry) => entry.personId))
    // Passo 2: gestor direto (matrícula → id), só quando informado e diferente do atual.
    const withManager = batch.filter((row) => row.reportsTo)
    const managerUpdates = withManager.length
      ? await client.query<{ id: string; matricula: string }>(
          `update people p set reports_to_id = m.id
           from unnest($2::text[], $3::text[]) as t(matricula, manager_matricula)
           join people m on m.organization_id = $1 and m.matricula = t.manager_matricula
           where p.organization_id = $1 and p.matricula = t.matricula and p.reports_to_id is distinct from m.id
           returning p.id, p.matricula`,
          [org, withManager.map((r) => r.matricula), withManager.map((r) => r.reportsTo)],
        )
      : { rows: [] as { id: string; matricula: string }[] }
    // Passo 2b: custódia depois de mexer no lugar (Grupo, nível, gestor) — pendente do cadastro manual e senha temporária ainda não usada.
    const custody = await enforceSourceCustody(context, client, { matriculas: batch.map((row) => row.matricula), groupDefined: new Set(batch.filter((row) => row.teamId).map((row) => row.matricula)), before })
    // Passo 3: e-mail da conta, só se a conta já existe (a Central nunca cria senha).
    const withEmail = batch.filter((row) => row.email)
    if (withEmail.length) {
      await client.query(
        `update user_accounts ua set email = t.email, updated_at = now()
         from unnest($2::text[], $3::text[]) as t(matricula, email)
         join people p on p.organization_id = $1 and p.matricula = t.matricula
         where ua.person_id = p.id and lower(ua.email) is distinct from lower(t.email)
           and not exists (select 1 from user_accounts o where lower(o.email) = lower(t.email) and o.id <> ua.id)`,
        [org, withEmail.map((r) => r.matricula), withEmail.map((r) => r.email)],
      )
    }
    const touched = new Map(upsert.rows.map((row) => [row.matricula, { id: row.id, inserted: row.inserted }]))
    for (const row of managerUpdates.rows) if (!touched.has(row.matricula)) touched.set(row.matricula, { id: row.id, inserted: false })
    // Pessoa ligada pela conta (ou pré-cadastrada com a matrícula) foi assumida por esta carga mesmo que os dados já batessem:
    // linhagem de alteração — daqui em diante a base já aplicou a pessoa.
    for (const { personId, row } of [...linked, ...preRegistered]) if (!touched.has(row.matricula)) touched.set(row.matricula, { id: personId, inserted: false })
    const byMatricula = new Map(batch.map((row) => [row.matricula, row]))
    const duplicateWarnings = await possibleDuplicateWarnings(context, client, upsert.rows.filter((row) => row.inserted).map((row) => ({ personId: row.id, row: byMatricula.get(row.matricula)! })))
    // Passo 4: situação funcional — SEMPRE pelo serviço canônico (único que escreve em
    // employee_status_periods); snapshot repetido não cria período novo. O snapshot de EMPLOYEES
    // é evidência "a partir de uma data": uma ausência explícita e limitada já registrada vence
    // (CONFLICT), e o conflito vai para a quarentena como AVISO rastreável — nunca em silêncio.
    const statusLineage: LineageEntry[] = []
    const warnings: ApplyWarning[] = [...linkedWarnings(linked, linkAccessDisabled), ...accessDisabledWarnings(preRegistered, linkAccessDisabled), ...pendingCustodyWarnings(batch, custody), ...duplicateWarnings]
    const withStatus = batch.filter((row) => row.employmentStatus)
    if (withStatus.length > 0) {
      const ids = await client.query<{ id: string; matricula: string }>(`select id, matricula from people where organization_id = $1 and matricula = any($2::text[])`, [org, withStatus.map((row) => row.matricula)])
      const idByMatricula = new Map(ids.rows.map((row) => [row.matricula, row.id]))
      const observedAt = context.ctx.clock.now()
      for (const row of withStatus) {
        const personId = idByMatricula.get(row.matricula)
        if (!personId) continue
        const outcome = await applyEmployeeStatusSnapshot(client as unknown as Database, {
          organizationId: org,
          personId,
          status: row.employmentStatus!.status,
          rawStatus: row.employmentStatus!.rawStatus,
          effectiveFrom: row.employmentStatus!.effectiveFrom,
          sourceUpdatedAt: row.employmentStatus!.sourceUpdatedAt,
          observedAt,
          source: context.sourceNamespace,
          sourceReference: row.sourceRecordKey,
          timeZone: context.timeZone,
          authoritative: context.feed.authoritative,
        })
        if (outcome.action !== "REFRESHED" && outcome.action !== "CONFLICT" && !touched.has(row.matricula)) touched.set(row.matricula, { id: personId, inserted: false })
        collectStatusOutcome(outcome, row, statusLineage, warnings)
      }
    }
    const result = withLineage("people", batch, (row) => row.matricula, [...touched.entries()].map(([key, value]) => ({ key, id: value.id, inserted: value.inserted })))
    result.lineage.push(...statusLineage)
    result.warnings.push(...warnings)
    return result
  },
}

/** Lineage do PERÍODO de situação (não só da pessoa) + aviso de conflito — "por que a INIA acha que esta pessoa está de férias?" chega até o Run. */
function collectStatusOutcome(outcome: SnapshotOutcome, row: ValidRecord, lineage: LineageEntry[], warnings: ApplyWarning[]): void {
  if (outcome.action === "CREATED" || outcome.action === "ADJUSTED") {
    lineage.push({ entityType: "employee_status_periods", entityId: outcome.period.id, action: outcome.action === "CREATED" ? "INSERTED" : "UPDATED", recordNumber: row.recordNumber, sourceRecordKey: row.sourceRecordKey })
  }
  if (outcome.conflict) {
    const { conflict } = outcome
    const kept = conflict.kept === "EXISTING" ? "mantido o período existente" : "aplicado o período recebido"
    const reason = { EXPLICIT_PERIOD_WINS: "período explícito e limitado vence snapshot sem intervalo", AUTHORITATIVE_SOURCE_WINS: "feed autoritativo vence", NEWER_EVIDENCE_WINS: "evidência mais nova vence" }[conflict.reason]
    warnings.push({
      recordNumber: row.recordNumber,
      sourceRecordKey: row.sourceRecordKey,
      error: {
        code: "DATA_EMPLOYMENT_STATUS_CONFLICT",
        field: "currentStatus",
        message: `Recebido ${conflict.incoming.status} desde ${conflict.incoming.effectiveFrom}${conflict.incoming.effectiveTo ? ` até ${conflict.incoming.effectiveTo}` : ""}${conflict.incoming.inferred ? " (data inferida da carga)" : ""}; já existia ${conflict.existing.status} ${conflict.existing.effectiveFrom}${conflict.existing.effectiveTo ? `–${conflict.existing.effectiveTo}` : " em aberto"} de ${conflict.existing.source}. Decisão: ${kept} (${reason}).`,
      },
    })
  }
}

// ---------------------------------------------------------------------------------------------
// EMPLOYEE_ABSENCES → employee_status_periods (pelo serviço canônico, com datas explícitas)
// "Vigente? = não" (versão 2) CANCELA a ausência daquela identidade: o período sai pelo mesmo
// serviço, a remoção fica em `audit_logs` e conta como "desativado" na carga. Cancelar o que não
// existe (ou já foi cancelado) não muda nada; período de outra origem fica e vira aviso.
// ---------------------------------------------------------------------------------------------
/** Situações que uma AUSÊNCIA pode representar (temporais). EM_PRODUCAO nunca; TRANSFERIDO/PILOTO/APOSENTADO vêm pelo cadastro. */
const ABSENCE_STATUSES: ReadonlySet<EmploymentStatus> = new Set<EmploymentStatus>(["FERIAS", "INSS", "MATERNIDADE", "PATERNIDADE", "ATIVIDADE_OFF"])

type PreparedAbsence = ValidRecord & { personId: string; matricula: string; status: EmploymentStatus; rawType: string; startDate: string; endDate: string | null; active: boolean; sourceUpdatedAt: string | null }

export const employeeAbsencesWriter: DomainWriter<PreparedAbsence> = {
  contractKey: "EMPLOYEE_ABSENCES",
  async prepare(context, records) {
    const { unique, duplicates } = dedupeByKey(records, (record) => `${record.record.externalEmployeeId}|${String(record.record.type).toUpperCase()}|${record.record.startDate}`)
    const people = await resolveEmployees(context.ctx.db, context.organizationId, unique.map((record) => str(record.record, "externalEmployeeId")))
    const ready: PreparedAbsence[] = []
    const rejections: Rejection[] = [...duplicates]
    for (const record of unique) {
      const matricula = str(record.record, "externalEmployeeId")!
      const person = people.get(matricula)
      if (!person) {
        rejections.push(reject(record, "DATA_EMPLOYEE_NOT_FOUND", "externalEmployeeId", `Colaborador "${matricula}" não existe na INIA.`))
        continue
      }
      const rawType = str(record.record, "type")!
      const status = normalizeEmploymentStatus(rawType)
      if (!status) {
        rejections.push(reject(record, "DATA_EMPLOYMENT_STATUS_UNKNOWN", "type", `Tipo de ausência "${rawType}" não é reconhecido — mapeie para FÉRIAS, INSS, MATERNIDADE, PATERNIDADE ou ATIVIDADE OFF com "Mapear códigos".`))
        continue
      }
      if (!ABSENCE_STATUSES.has(status)) {
        rejections.push(reject(record, "DATA_CONTRACT_VIOLATION", "type", `"${EMPLOYMENT_STATUS_LABELS[status]}" não é uma ausência temporal — situações como TRANSFERIDO, PILOTO e APOSENTADO entram pelo cadastro de Colaboradores (situação funcional).`))
        continue
      }
      ready.push({ ...record, personId: person.id, matricula, status, rawType, startDate: str(record.record, "startDate")!, endDate: str(record.record, "endDate"), active: bool(record.record, "active") ?? true, sourceUpdatedAt: str(record.record, "sourceUpdatedAt") })
    }
    return { ready, rejections }
  },
  async apply(context, client, batch) {
    if (batch.length === 0) return emptyApply()
    const result = emptyApply()
    const observedAt = context.ctx.clock.now()
    for (const row of batch) {
      const start = `${row.startDate}T00:00:00.000Z`
      if (!result.businessMaxEventTime || start > result.businessMaxEventTime) result.businessMaxEventTime = start
      if (!row.active) {
        await cancelAbsence(context, client, row, result)
        continue
      }
      const outcome = await applyEmployeeStatusSnapshot(client as unknown as Database, {
        organizationId: context.organizationId,
        personId: row.personId,
        status: row.status,
        rawStatus: row.rawType,
        effectiveFrom: row.startDate,
        effectiveTo: row.endDate,
        sourceUpdatedAt: row.sourceUpdatedAt,
        observedAt,
        source: context.sourceNamespace,
        sourceReference: row.sourceRecordKey,
        timeZone: context.timeZone,
        authoritative: context.feed.authoritative,
      })
      if (outcome.action === "CREATED") result.inserted += 1
      else if (outcome.action === "ADJUSTED") result.updated += 1
      else result.unchanged += 1
      collectStatusOutcome(outcome, row, result.lineage, result.warnings)
    }
    return result
  },
}

async function cancelAbsence(context: WriteContext, client: pg.PoolClient, row: PreparedAbsence, result: ApplyResult): Promise<void> {
  const outcome = await cancelEmployeeStatusPeriod(client as unknown as Database, {
    personId: row.personId,
    status: row.status,
    effectiveFrom: row.startDate,
    source: context.sourceNamespace,
    timeZone: context.timeZone,
  })
  if (outcome.action === "NOT_FOUND") {
    result.unchanged += 1
    return
  }
  if (outcome.action === "CONFLICT") {
    result.unchanged += 1
    const { period } = outcome
    result.warnings.push({
      recordNumber: row.recordNumber,
      sourceRecordKey: row.sourceRecordKey,
      error: {
        code: "DATA_EMPLOYMENT_STATUS_CONFLICT",
        field: "active",
        message: `Recebido o cancelamento de ${EMPLOYMENT_STATUS_LABELS[row.status]} desde ${row.startDate} para ${row.matricula}; o período ${period.effectiveFrom}${period.effectiveTo ? `–${period.effectiveTo}` : " em aberto"} foi informado por ${period.source}. Decisão: mantido o período existente (a carga só cancela o que a própria fonte informou).`,
      },
    })
    return
  }
  result.deactivated += 1
  const { removed, restored, mergedWith } = outcome
  const periodOf = (period: StatusPeriod) => ({ id: period.id, status: period.status, rawStatus: period.rawStatus, effectiveFrom: period.effectiveFrom, effectiveTo: period.effectiveTo, effectiveToExplicit: period.effectiveToExplicit, source: period.source, sourceReference: period.sourceReference, observedAt: period.observedAt, sourceUpdatedAt: period.sourceUpdatedAt })
  // O período removido só sobrevive aqui: o audit trail guarda o registro inteiro e o que voltou a valer.
  await recordAudit(client, {
    organizationId: context.organizationId,
    actorId: null,
    action: "DATA_HUB_EMPLOYEE_ABSENCE_CANCELLED",
    entityType: "employee_status_periods",
    entityId: removed.id,
    payload: {
      runId: context.runId,
      feedId: context.feed.id,
      contract: `${context.feed.contractKey}@${context.feed.contractVersion}`,
      recordNumber: row.recordNumber,
      sourceRecordKey: row.sourceRecordKey,
      personId: row.personId,
      matricula: row.matricula,
      removed: periodOf(removed),
      mergedWith: mergedWith ? periodOf(mergedWith) : null,
      restored: restored ? { id: restored.id, status: restored.status, effectiveFrom: restored.effectiveFrom, effectiveTo: restored.effectiveTo } : null,
      currentStatus: outcome.currentStatus,
    },
  })
  if (restored) result.lineage.push({ entityType: "employee_status_periods", entityId: restored.id, action: "UPDATED", recordNumber: row.recordNumber, sourceRecordKey: row.sourceRecordKey })
}

// ---------------------------------------------------------------------------------------------
// ORGANIZATIONAL_STRUCTURE → people (só vínculos; contrato ATÔMICO)
// ---------------------------------------------------------------------------------------------
type PreparedStructure = ValidRecord & { matricula: string; reportsTo: string | null; teamId: string | null; subteamId: string | null; hasGroupInfo: boolean }

export const organizationalStructureWriter: DomainWriter<PreparedStructure> = {
  contractKey: "ORGANIZATIONAL_STRUCTURE",
  async prepare(context, records) {
    const { unique, duplicates } = dedupeByKey(records, (record) => String(record.record.externalEmployeeId))
    const refs = await resolveStructureRefs(context, unique)
    const people = await resolveEmployees(context.ctx.db, context.organizationId, [...unique.map((record) => str(record.record, "externalEmployeeId")), ...unique.map((record) => str(record.record, "reportsToExternalId"))])
    const ready: PreparedStructure[] = []
    const rejections: Rejection[] = [...duplicates]
    for (const record of unique) {
      const matricula = str(record.record, "externalEmployeeId")!
      if (!people.has(matricula)) {
        rejections.push(reject(record, "DATA_EMPLOYEE_NOT_FOUND", "externalEmployeeId", `Colaborador "${matricula}" não existe na INIA.`))
        continue
      }
      const reportsTo = str(record.record, "reportsToExternalId")
      if (reportsTo === matricula) {
        rejections.push(reject(record, "DATA_CONTRACT_VIOLATION", "reportsToExternalId", "Um colaborador não pode reportar a si mesmo."))
        continue
      }
      if (reportsTo && !people.has(reportsTo)) {
        rejections.push(reject(record, "DATA_EMPLOYEE_NOT_FOUND", "reportsToExternalId", `Gestor "${reportsTo}" não existe na INIA.`))
        continue
      }
      const pair = resolveGroupPair(record, refs)
      if (pair.rejection) {
        rejections.push(pair.rejection)
        continue
      }
      ready.push({ ...record, matricula, reportsTo, teamId: pair.teamId, subteamId: pair.subteamId, hasGroupInfo: Boolean(str(record.record, "groupExternalCode") || str(record.record, "subgroupExternalCode")) })
    }
    return { ready, rejections }
  },
  async apply(context, client, batch) {
    if (batch.length === 0) return emptyApply()
    const org = context.organizationId
    const before = await placementBefore(context, client, batch.map((row) => row.matricula))
    // A Estrutura também pode ser a PRIMEIRA carga sobre quem foi cadastrado à mão (h19): custódia pendente antes de escrever.
    await markFirstApplicationCustody(context, client, [...batch.map((row) => row.matricula), ...batch.flatMap((row) => (row.reportsTo ? [row.reportsTo] : []))])
    const result = await client.query<{ id: string; matricula: string }>(
      `update people p set
         reports_to_id = m.id,
         team_id = case when t.has_group then t.team_id else p.team_id end,
         subteam_id = case when t.has_group then t.subteam_id else p.subteam_id end
       from unnest($2::text[], $3::text[], $4::uuid[], $5::uuid[], $6::boolean[]) as t(matricula, manager_matricula, team_id, subteam_id, has_group)
       left join people m on m.organization_id = $1 and m.matricula = t.manager_matricula
       where p.organization_id = $1 and p.matricula = t.matricula
         and (p.reports_to_id is distinct from m.id
              or (t.has_group and (p.team_id is distinct from t.team_id or p.subteam_id is distinct from t.subteam_id)))
       returning p.id, p.matricula`,
      [org, batch.map((r) => r.matricula), batch.map((r) => r.reportsTo), batch.map((r) => r.teamId), batch.map((r) => r.subteamId), batch.map((r) => r.hasGroupInfo)],
    )
    // A Estrutura também define o lugar: mesma custódia da carga de Colaboradores (h19 da 4ª auditoria).
    const custody = await enforceSourceCustody(context, client, { matriculas: batch.map((row) => row.matricula), groupDefined: new Set(batch.filter((row) => row.hasGroupInfo).map((row) => row.matricula)), before })
    const applied = withLineage("people", batch, (row) => row.matricula, result.rows.map((row) => ({ key: row.matricula, id: row.id, inserted: false })))
    applied.warnings.push(...pendingCustodyWarnings(batch, custody))
    return applied
  },
}

// ---------------------------------------------------------------------------------------------
// WORK_SCHEDULES → employee_work_shifts
// ---------------------------------------------------------------------------------------------
type PreparedShift = ValidRecord & { personId: string; matricula: string; startTime: string; workMinutes: number; effectiveFrom: string; effectiveTo: string | null; scheduleType: ScheduleType | null }

export const workSchedulesWriter: DomainWriter<PreparedShift> = {
  contractKey: "WORK_SCHEDULES",
  async prepare(context, records) {
    const { unique, duplicates } = dedupeByKey(records, (record) => `${record.record.externalEmployeeId}|${record.record.effectiveFrom}`)
    const people = await resolveEmployees(context.ctx.db, context.organizationId, unique.map((record) => str(record.record, "externalEmployeeId")))
    const ready: PreparedShift[] = []
    const rejections: Rejection[] = [...duplicates]
    for (const record of unique) {
      const matricula = str(record.record, "externalEmployeeId")!
      const person = people.get(matricula)
      if (!person) {
        rejections.push(reject(record, "DATA_EMPLOYEE_NOT_FOUND", "externalEmployeeId", `Colaborador "${matricula}" não existe na INIA.`))
        continue
      }
      ready.push({ ...record, personId: person.id, matricula, startTime: str(record.record, "startTime")!, workMinutes: Number(record.record.workMinutes), effectiveFrom: str(record.record, "effectiveFrom")!, effectiveTo: str(record.record, "effectiveTo"), scheduleType: normalizeScheduleType(str(record.record, "scheduleType")) })
    }
    return { ready, rejections }
  },
  async apply(context, client, batch) {
    if (batch.length === 0) return emptyApply()
    const result = await client.query<{ id: string; person_id: string; effective_from: string; inserted: boolean }>(
      `insert into employee_work_shifts (organization_id, person_id, start_time, work_minutes, effective_from, effective_to, schedule_type)
       select $1, person_id, start_time::time, work_minutes, effective_from::date, effective_to::date, schedule_type
       from unnest($2::uuid[], $3::text[], $4::int[], $5::text[], $6::text[], $7::text[]) as t(person_id, start_time, work_minutes, effective_from, effective_to, schedule_type)
       on conflict (person_id, effective_from) do update set start_time = excluded.start_time, work_minutes = excluded.work_minutes, effective_to = excluded.effective_to, schedule_type = coalesce(excluded.schedule_type, employee_work_shifts.schedule_type), updated_at = now()
       where employee_work_shifts.start_time is distinct from excluded.start_time or employee_work_shifts.work_minutes is distinct from excluded.work_minutes or employee_work_shifts.effective_to is distinct from excluded.effective_to
          or (excluded.schedule_type is not null and employee_work_shifts.schedule_type is distinct from excluded.schedule_type)
       returning id, person_id, to_char(effective_from, 'YYYY-MM-DD') effective_from, (xmax = 0) inserted`,
      [context.organizationId, batch.map((r) => r.personId), batch.map((r) => r.startTime), batch.map((r) => r.workMinutes), batch.map((r) => r.effectiveFrom), batch.map((r) => r.effectiveTo), batch.map((r) => r.scheduleType)],
    )
    return withLineage("employee_work_shifts", batch, (row) => `${row.personId}|${row.effectiveFrom}`, result.rows.map((row) => ({ key: `${row.person_id}|${row.effective_from}`, id: row.id, inserted: row.inserted })))
  },
}

// ---------------------------------------------------------------------------------------------
// WORK_SCHEDULE_DAYS → employee_schedule_days (calendário programado: trabalha/folga por data)
// ---------------------------------------------------------------------------------------------
type PreparedScheduleDay = ValidRecord & { personId: string; matricula: string; scheduleDate: string; scheduledToWork: boolean; shiftStart: string | null; shiftEnd: string | null; scheduleType: ScheduleType | null; sourceUpdatedAt: string | null; externalScheduleId: string | null }

export const workScheduleDaysWriter: DomainWriter<PreparedScheduleDay> = {
  contractKey: "WORK_SCHEDULE_DAYS",
  async prepare(context, records) {
    const { unique, duplicates } = dedupeByKey(records, (record) => `${record.record.externalEmployeeId}|${record.record.scheduleDate}`)
    const people = await resolveEmployees(context.ctx.db, context.organizationId, unique.map((record) => str(record.record, "externalEmployeeId")))
    const ready: PreparedScheduleDay[] = []
    const rejections: Rejection[] = [...duplicates]
    for (const record of unique) {
      const matricula = str(record.record, "externalEmployeeId")!
      const person = people.get(matricula)
      if (!person) {
        rejections.push(reject(record, "DATA_EMPLOYEE_NOT_FOUND", "externalEmployeeId", `Colaborador "${matricula}" não existe na INIA.`))
        continue
      }
      const scheduledToWork = bool(record.record, "scheduledToWork")
      if (scheduledToWork === null) {
        rejections.push(reject(record, "DATA_REQUIRED_FIELD_MISSING", "scheduledToWork", "Informe se o colaborador trabalha (true) ou folga (false) nesta data — ausência de valor não é folga."))
        continue
      }
      ready.push({
        ...record,
        personId: person.id,
        matricula,
        scheduleDate: str(record.record, "scheduleDate")!,
        scheduledToWork,
        shiftStart: scheduledToWork ? str(record.record, "shiftStart") : null,
        shiftEnd: scheduledToWork ? str(record.record, "shiftEnd") : null,
        scheduleType: normalizeScheduleType(str(record.record, "scheduleType")),
        sourceUpdatedAt: str(record.record, "sourceUpdatedAt"),
        externalScheduleId: str(record.record, "externalScheduleId"),
      })
    }
    return { ready, rejections }
  },
  async apply(context, client, batch) {
    if (batch.length === 0) return emptyApply()
    const observedAt = context.ctx.clock.now().toISOString()
    // Correção posterior (quarta trabalha → quarta folga) sobrescreve a data — os cálculos históricos
    // passam a refletir a escala corrigida; medições NUNCA são apagadas por causa disso.
    const result = await client.query<{ id: string; person_id: string; schedule_date: string; inserted: boolean }>(
      `insert into employee_schedule_days (organization_id, person_id, schedule_date, scheduled_to_work, shift_start, shift_end, schedule_type, source, source_reference, source_updated_at, observed_at)
       select $1, person_id, schedule_date::date, scheduled_to_work, shift_start::time, shift_end::time, schedule_type, $10, source_reference, source_updated_at::timestamptz, $11::timestamptz
       from unnest($2::uuid[], $3::text[], $4::boolean[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[]) as t(person_id, schedule_date, scheduled_to_work, shift_start, shift_end, schedule_type, source_reference, source_updated_at)
       on conflict (person_id, schedule_date) do update
         set scheduled_to_work = excluded.scheduled_to_work, shift_start = excluded.shift_start, shift_end = excluded.shift_end,
             schedule_type = coalesce(excluded.schedule_type, employee_schedule_days.schedule_type), source = excluded.source, source_reference = excluded.source_reference,
             source_updated_at = excluded.source_updated_at, observed_at = excluded.observed_at, updated_at = now()
       where employee_schedule_days.scheduled_to_work is distinct from excluded.scheduled_to_work or employee_schedule_days.shift_start is distinct from excluded.shift_start
          or employee_schedule_days.shift_end is distinct from excluded.shift_end or (excluded.schedule_type is not null and employee_schedule_days.schedule_type is distinct from excluded.schedule_type)
          or employee_schedule_days.source_reference is distinct from excluded.source_reference
       returning id, person_id, to_char(schedule_date, 'YYYY-MM-DD') schedule_date, (xmax = 0) inserted`,
      [context.organizationId, batch.map((r) => r.personId), batch.map((r) => r.scheduleDate), batch.map((r) => r.scheduledToWork), batch.map((r) => r.shiftStart), batch.map((r) => r.shiftEnd), batch.map((r) => r.scheduleType), batch.map((r) => r.externalScheduleId), batch.map((r) => r.sourceUpdatedAt), context.sourceNamespace, observedAt],
    )
    const applied = withLineage("employee_schedule_days", batch, (row) => `${row.personId}|${row.scheduleDate}`, result.rows.map((row) => ({ key: `${row.person_id}|${row.schedule_date}`, id: row.id, inserted: row.inserted })))
    applied.businessMaxEventTime = batch.reduce<string | null>((max, row) => (!max || row.scheduleDate > max ? row.scheduleDate : max), null)
    return applied
  },
}

// ---------------------------------------------------------------------------------------------
// WORK_SCHEDULE_EXCEPTIONS → employee_schedule_exceptions (banco de horas, day off, folga extraordinária)
// ---------------------------------------------------------------------------------------------
type PreparedScheduleException = ValidRecord & { personId: string; matricula: string; date: string; code: ScheduleExceptionCode; effect: "NON_WORKING"; rawReason: string | null; active: boolean; sourceUpdatedAt: string | null; externalExceptionId: string | null }

export const workScheduleExceptionsWriter: DomainWriter<PreparedScheduleException> = {
  contractKey: "WORK_SCHEDULE_EXCEPTIONS",
  async prepare(context, records) {
    const { unique, duplicates } = dedupeByKey(records, (record) => `${record.record.externalEmployeeId}|${record.record.date}|${normalizeScheduleExceptionCode(str(record.record, "exceptionCode")) ?? record.record.exceptionCode}`)
    const people = await resolveEmployees(context.ctx.db, context.organizationId, unique.map((record) => str(record.record, "externalEmployeeId")))
    const ready: PreparedScheduleException[] = []
    const rejections: Rejection[] = [...duplicates]
    for (const record of unique) {
      const matricula = str(record.record, "externalEmployeeId")!
      const person = people.get(matricula)
      if (!person) {
        rejections.push(reject(record, "DATA_EMPLOYEE_NOT_FOUND", "externalEmployeeId", `Colaborador "${matricula}" não existe na INIA.`))
        continue
      }
      const code = normalizeScheduleExceptionCode(str(record.record, "exceptionCode"))
      if (!code) {
        rejections.push(reject(record, "DATA_INVALID_ENUM", "exceptionCode", `Tipo de exceção "${str(record.record, "exceptionCode")}" não é reconhecido.`))
        continue
      }
      ready.push({
        ...record,
        personId: person.id,
        matricula,
        date: str(record.record, "date")!,
        code,
        // Efeito definido pelo catálogo (o motor decide por efeito; o código explica o porquê).
        effect: SCHEDULE_EXCEPTION_EFFECT_BY_CODE[code],
        rawReason: str(record.record, "reason"),
        active: bool(record.record, "active") ?? true,
        sourceUpdatedAt: str(record.record, "sourceUpdatedAt"),
        externalExceptionId: str(record.record, "externalExceptionId"),
      })
    }
    return { ready, rejections }
  },
  async apply(context, client, batch) {
    if (batch.length === 0) return emptyApply()
    const observedAt = context.ctx.clock.now().toISOString()
    // AUTORIDADE POR ORIGEM: a Central manda nas exceções que ela criou; o Supervisor manda nas que ele
    // registrou/alterou (origin SUPERVISOR_MANUAL ou manual_override). Quando a Central diz uma coisa
    // (ex.: DAY_OFF vigente) e o Supervisor já disse outra (cancelou / registrou), a linha NÃO é
    // sobrescrita: vira aviso DATA_SCHEDULE_EXCEPTION_CONFLICT na quarentena (registro aplicado com
    // aviso, nunca rejeição silenciosa). Se as duas origens concordam (mesmo `active`), a linha passa a
    // ser da Central de novo (manual_override volta a false). A escala original NÃO é tocada.
    const existing = await client.query<{ id: string; person_id: string; exception_date: string; code: string; active: boolean; origin: string; manual_override: boolean; cancelled_at: string | null }>(
      `select id, person_id, to_char(exception_date, 'YYYY-MM-DD') exception_date, code, active, origin, manual_override, to_char(cancelled_at at time zone 'UTC', 'YYYY-MM-DD') cancelled_at from employee_schedule_exceptions
        where person_id = any($1::uuid[]) and exception_date = any($2::date[]) and code = any($3::text[]) and (origin <> 'CENTRAL_DATA' or manual_override)`,
      [batch.map((r) => r.personId), batch.map((r) => r.date), batch.map((r) => r.code)],
    )
    const manualByKey = new Map(existing.rows.map((row) => [`${row.person_id}|${row.exception_date}|${row.code}`, row]))
    const warnings: ApplyWarning[] = []
    const writable = batch.filter((row) => {
      const manual = manualByKey.get(`${row.personId}|${row.date}|${row.code}`)
      if (!manual || manual.active === row.active) return true
      warnings.push({
        recordNumber: row.recordNumber,
        sourceRecordKey: row.sourceRecordKey,
        error: {
          code: "DATA_SCHEDULE_EXCEPTION_CONFLICT",
          field: "active",
          message: `Central diz ${SCHEDULE_EXCEPTION_LABELS[row.code]} ${row.active ? "vigente" : "cancelado"} em ${row.date} para ${row.matricula}; o Supervisor ${manual.active ? "registrou a exceção como vigente" : `cancelou a exceção${manual.cancelled_at ? ` em ${manual.cancelled_at.slice(0, 10)}` : ""}`}. Decisão: mantido o registro do Supervisor (autoridade de quem alterou por último; conflito auditável no Calendário da equipe).`,
        },
      })
      return false
    })
    const result = writable.length > 0
      ? await client.query<{ id: string; person_id: string; exception_date: string; code: string; inserted: boolean }>(
          `insert into employee_schedule_exceptions (organization_id, person_id, exception_date, code, effect, raw_reason, active, source, source_reference, source_updated_at, observed_at, origin)
           select $1, person_id, exception_date::date, code, effect, raw_reason, active, $9, source_reference, source_updated_at::timestamptz, $10::timestamptz, 'CENTRAL_DATA'
           from unnest($2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[], $7::boolean[], $8::text[], $11::text[]) as t(person_id, exception_date, code, effect, raw_reason, active, source_reference, source_updated_at)
           on conflict (person_id, exception_date, code) do update
             set effect = excluded.effect, raw_reason = excluded.raw_reason, active = excluded.active, source = excluded.source, source_reference = excluded.source_reference,
                 source_updated_at = excluded.source_updated_at, observed_at = excluded.observed_at, origin = 'CENTRAL_DATA', manual_override = false,
                 cancelled_at = case when excluded.active then null else coalesce(employee_schedule_exceptions.cancelled_at, now()) end, updated_at = now()
           where employee_schedule_exceptions.active is distinct from excluded.active or employee_schedule_exceptions.raw_reason is distinct from excluded.raw_reason
              or employee_schedule_exceptions.source_reference is distinct from excluded.source_reference or employee_schedule_exceptions.effect is distinct from excluded.effect
              or employee_schedule_exceptions.origin <> 'CENTRAL_DATA' or employee_schedule_exceptions.manual_override
           returning id, person_id, to_char(exception_date, 'YYYY-MM-DD') exception_date, code, (xmax = 0) inserted`,
          [context.organizationId, writable.map((r) => r.personId), writable.map((r) => r.date), writable.map((r) => r.code), writable.map((r) => r.effect), writable.map((r) => r.rawReason), writable.map((r) => r.active), writable.map((r) => r.externalExceptionId), context.sourceNamespace, observedAt, writable.map((r) => r.sourceUpdatedAt)],
        )
      : { rows: [] as { id: string; person_id: string; exception_date: string; code: string; inserted: boolean }[] }
    const applied = withLineage("employee_schedule_exceptions", writable, (row) => `${row.personId}|${row.date}|${row.code}`, result.rows.map((row) => ({ key: `${row.person_id}|${row.exception_date}|${row.code}`, id: row.id, inserted: row.inserted })))
    applied.unchanged += batch.length - writable.length
    applied.warnings.push(...warnings)
    applied.businessMaxEventTime = batch.reduce<string | null>((max, row) => (!max || row.date > max ? row.date : max), null)
    return applied
  },
}

// ---------------------------------------------------------------------------------------------
// GOALS → goals
// ---------------------------------------------------------------------------------------------
type PreparedGoal = ValidRecord & { indicatorId: string; subjectType: "TEAM" | "SUBTEAM" | "PERSON"; subjectId: string; targetValue: number; validFrom: string; validUntil: string | null }
const GOAL_SUBJECT_TO_DB = { GROUP: "TEAM", SUBGROUP: "SUBTEAM", EMPLOYEE: "PERSON" } as const

export const goalsWriter: DomainWriter<PreparedGoal> = {
  contractKey: "GOALS",
  async prepare(context, records) {
    const { unique, duplicates } = dedupeByKey(records, (record) => `${record.record.indicatorCode}|${record.record.subjectType}|${record.record.subjectExternalCode}|${record.record.validFrom}`)
    const db = context.ctx.db
    const org = context.organizationId
    const [indicators, teams, subteams, people] = await Promise.all([
      resolveIndicators(db, org, unique.map((record) => str(record.record, "indicatorCode"))),
      resolveTeams(db, org, unique.filter((record) => record.record.subjectType === "GROUP").map((record) => str(record.record, "subjectExternalCode"))),
      resolveSubteams(db, org, unique.filter((record) => record.record.subjectType === "SUBGROUP").map((record) => str(record.record, "subjectExternalCode"))),
      resolveEmployees(db, org, unique.filter((record) => record.record.subjectType === "EMPLOYEE").map((record) => str(record.record, "subjectExternalCode"))),
    ])
    const ready: PreparedGoal[] = []
    const rejections: Rejection[] = [...duplicates]
    for (const record of unique) {
      const code = str(record.record, "indicatorCode")!.toUpperCase()
      const indicator = indicators.get(code)
      if (!indicator || !indicator.active) {
        rejections.push(reject(record, "DATA_INDICATOR_NOT_FOUND", "indicatorCode", `Indicador "${code}" não existe ou está inativo.`))
        continue
      }
      const subjectType = str(record.record, "subjectType") as keyof typeof GOAL_SUBJECT_TO_DB
      const subjectCode = str(record.record, "subjectExternalCode")!
      const subjectId = subjectType === "GROUP" ? teams.get(subjectCode)?.id : subjectType === "SUBGROUP" ? subteams.get(subjectCode)?.id : people.get(subjectCode)?.id
      if (!subjectId) {
        const code = subjectType === "GROUP" ? "DATA_GROUP_NOT_FOUND" : subjectType === "SUBGROUP" ? "DATA_SUBGROUP_NOT_FOUND" : "DATA_EMPLOYEE_NOT_FOUND"
        rejections.push(reject(record, code, "subjectExternalCode", `Sujeito "${subjectCode}" (${subjectType}) não existe na INIA.`))
        continue
      }
      ready.push({ ...record, indicatorId: indicator.id, subjectType: GOAL_SUBJECT_TO_DB[subjectType], subjectId, targetValue: Number(record.record.targetValue), validFrom: str(record.record, "validFrom")!, validUntil: str(record.record, "validUntil") })
    }
    return { ready, rejections }
  },
  async apply(context, client, batch) {
    if (batch.length === 0) return emptyApply()
    const result = await client.query<{ id: string; key: string; inserted: boolean }>(
      `insert into goals_all (organization_id, indicator_definition_id, subject_type, subject_id, target_value, valid_from, valid_until)
       select $1, indicator_id, subject_type, subject_id, target_value, valid_from::date, valid_until::date
       from unnest($2::uuid[], $3::text[], $4::uuid[], $5::numeric[], $6::text[], $7::text[]) as t(indicator_id, subject_type, subject_id, target_value, valid_from, valid_until)
       on conflict (organization_id, indicator_definition_id, subject_type, subject_id, valid_from) do update set target_value = excluded.target_value, valid_until = excluded.valid_until, cancelled_at = null, cancellation_id = null
       where goals_all.cancelled_at is not null or goals_all.target_value is distinct from excluded.target_value or goals_all.valid_until is distinct from excluded.valid_until
       returning id, indicator_definition_id || '|' || subject_type || '|' || subject_id || '|' || to_char(valid_from, 'YYYY-MM-DD') key, (xmax = 0) inserted`,
      [context.organizationId, batch.map((r) => r.indicatorId), batch.map((r) => r.subjectType), batch.map((r) => r.subjectId), batch.map((r) => r.targetValue), batch.map((r) => r.validFrom), batch.map((r) => r.validUntil)],
    )
    return withLineage("goals", batch, (row) => `${row.indicatorId}|${row.subjectType}|${row.subjectId}|${row.validFrom}`, result.rows.map((row) => ({ key: row.key, id: row.id, inserted: row.inserted })))
  },
}

// ---------------------------------------------------------------------------------------------
/** Contagens + lineage a partir das linhas devolvidas pelo upsert (não devolvida = inalterada). */
export function withLineage<T extends ValidRecord>(entityType: string, batch: T[], keyOf: (row: T) => string, touched: { key: string; id: string; inserted: boolean }[]): ApplyResult {
  const byKey = new Map(touched.map((row) => [row.key, row]))
  const result = emptyApply()
  const counts = countUpsert(touched, batch.length)
  result.inserted = counts.inserted
  result.updated = counts.updated
  result.unchanged = counts.unchanged
  for (const row of batch) {
    const hit = byKey.get(keyOf(row))
    if (!hit) continue
    result.lineage.push({ entityType, entityId: hit.id, action: hit.inserted ? "INSERTED" : "UPDATED", recordNumber: row.recordNumber, sourceRecordKey: row.sourceRecordKey })
  }
  return result
}
