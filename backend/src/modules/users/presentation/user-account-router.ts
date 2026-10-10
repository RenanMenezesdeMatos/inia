import { Router, type Request } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { booleanParam, dateParam, listParam, respondList, searchParam, SqlFilter } from "../../../shared/presentation/list-query.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { env } from "../../../config/env.js"
import { temporaryPasswordExpiry } from "../../auth/domain/temporary-password.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { coversOrganization, getManageableScopes } from "../../auth/application/manageable-scopes.js"
import { PASSWORD_POLICY_MESSAGES, passwordPolicyViolations } from "../../auth/domain/password-policy.js"
import { wouldRemoveLastTenantAdmin } from "../../access/application/access-service.js"
import { assertCredentialChangeAllowed, type AccountAccessDeps } from "../../access/application/account-access-service.js"
import { createPostgresAccessRepository } from "../../access/infrastructure/postgres-access-repository.js"
import { createPostgresAccountAccessRepository } from "../../access/infrastructure/postgres-account-access-repository.js"
import { isHierarchyRole } from "../../performance-analytics/domain/hierarchy-levels.js"
import { applyEmployeeStatusSnapshot, loadEmploymentStatusHistory } from "../../people/application/employment-status-service.js"
import { EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_STATUSES, LEGACY_EMPLOYMENT_STATUSES, toCanonicalEmploymentStatus } from "../../people/domain/employment-status.js"
import { loadWorkScheduleSummary } from "../../people/application/work-schedule-service.js"
import { capitalLabel, findBrazilianCapital, isBrazilianCapitalCode } from "../../people/domain/brazilian-capitals.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { localDateOf } from "../../workflows/application/time-window.js"

/**
 * NÍVEL HIERÁRQUICO da pessoa (`people.role`) — dado ORGANIZACIONAL, não acesso (V1.5.7). "ADMIN" aqui é legado: marca uma
 * pessoa FORA da hierarquia operacional (ex.: conta de administração sem colaborador na base) e NÃO concede nenhuma permissão
 * — acesso ao INIA só por papel atribuído a uma conta (`/api/v1/admin/access`). Os antigos "papéis extras"
 * (`/:id/role-assignments`, tabela user_role_assignments) foram substituídos por esse modelo e removidos daqui.
 */
const ROLES = ["OPERATOR", "ADMIN", "COORDINATOR", "SUPERVISOR", "MANAGER", "SENIOR_MANAGER", "DIRECTOR"] as const

const listUsersSchema = z.object({
  search: searchParam,
  role: listParam(z.enum(ROLES)),
  active: booleanParam,
  teamId: z.string().uuid().optional(),
  hasAccount: booleanParam,
  lastLoginFrom: dateParam,
  lastLoginTo: dateParam,
})

const SELECT_USERS = `
  select
    p.id, p.name, p.role, p.job_title "jobTitle", p.active, p.team_id "teamId", t.name "teamName", p.subteam_id "subteamId",
    p.current_employment_status "employmentStatus",
    p.operational_capital_code "operationalCapitalCode",
    ua.id "accountId", ua.email, ua.last_login_at "lastLoginAt"
  from people p
  left join teams t on t.id = p.team_id
  left join user_accounts ua on ua.person_id = p.id
  where p.organization_id = $1
`

const createUserSchema = z.object({
  name: z.string().trim().min(2),
  role: z.enum(ROLES),
  teamId: z.string().uuid().optional(),
  email: z.string().trim().email(),
  // Provisória (troca obrigatória no primeiro login) — mas dentro da MESMA política de senha da plataforma (≤ 72 bytes).
  password: z.string().min(1).max(256),
})

const updateUserSchema = z.object({
  name: z.string().trim().min(2).optional(),
  email: z.string().trim().email().optional(),
  role: z.enum(ROLES).optional(),
  teamId: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
  /** Capital operacional (jurisdição de feriados) — só códigos do catálogo das 27; null limpa. */
  operationalCapitalCode: z.string().refine((value) => isBrazilianCapitalCode(value), "Capital operacional fora do catálogo das 27 capitais.").nullable().optional(),
})

// Jornada PREVISTA (horário de entrada + carga horária) — usada pelo Trigger "Por agenda"
// relativo ao expediente (ver workflows/application/shift-schedule.ts). Carga horária em
// minutos, nunca string livre — facilita percentual/soma/validação (Parte 5 do pedido).
const workShiftSchema = z.object({
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use o formato HH:mm."),
  workMinutes: z.number().int().min(1).max(1440),
})

/**
 * Situação FUNCIONAL (Ativo/Férias/Afastado/Inativo) — separada de `active` (conta/cadastro). A
 * INIA consome esse dado; o ajuste manual aqui existe pra corrigir/registrar quando a fonte de
 * colaboradores ainda não entrega (fonte "MANUAL"). Sem data efetiva, vale a partir de hoje
 * (data local da organização) e fica marcada como inferida — nunca retroage por suposição.
 */
const employmentStatusSchema = z.object({
  // Aceita os nove status reais; códigos legados (ACTIVE/VACATION/LEAVE/INACTIVE) continuam aceitos por compatibilidade e são canonizados pelo serviço.
  status: z.enum([...EMPLOYMENT_STATUSES, ...LEGACY_EMPLOYMENT_STATUSES]),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  note: z.string().trim().max(200).optional(),
})

/**
 * NÍVEL HIERÁRQUICO é organizacional, mas a regra operacional de quem LIDERA (visão da operação, métricas de gestão de
 * qualquer líder) vale para a organização inteira — então criar ou mudar um nível de liderança exige `people.manage` com
 * escopo de ORGANIZAÇÃO (achado U-F2). Operador ↔ ADMIN legado (fora da hierarquia) segue no escopo do administrador.
 */
const touchesLeadership = (from: string | null, to: string | undefined) => to !== undefined && to !== from && (isHierarchyRole(to) || (from !== null && isHierarchyRole(from)))

const LEADERSHIP_REQUIRES_ORGANIZATION = () => new DomainError("Definir ou mudar um nível de liderança (Supervisor, Coordenador, Gerente…) exige administrar pessoas na organização inteira.", "PEOPLE_ROLE_REQUIRES_ORGANIZATION_SCOPE", 403)

export function createUserAccountRouter(db: Database) {
  const router = Router()
  const accessRepository = createPostgresAccessRepository(db)
  // Custódia de credencial (e-mail de login, inativação) — a mesma do módulo de acessos.
  const accountDeps: AccountAccessDeps = { repository: accessRepository, now: () => new Date(), accounts: createPostgresAccountAccessRepository(db), hashPassword, temporaryPasswordTtlHours: env.TEMPORARY_PASSWORD_TTL_HOURS }
  const actorOf = (request: Request) => ({ organizationId: request.user!.organizationId, accountId: request.user!.sub, personId: request.user!.personId })
  // Escopo de `people.manage` (V1.5.7): administrador de um Grupo/Subgrupo só enxerga/edita pessoas de lá; fora = 404.
  const scopesOf = (request: Request) => getManageableScopes(db, request.user!, "people.manage")
  const personInScope = async (request: Request, personId: string) => {
    const scopes = await scopesOf(request)
    if (scopes.unrestricted || scopes.allTeams) return true
    const person = await db.query<{ team_id: string | null; subteam_id: string | null }>(`select team_id, subteam_id from people where id = $1 and organization_id = $2`, [personId, request.user!.organizationId])
    const row = person.rows[0]
    return Boolean(row && ((row.team_id && scopes.teamIds.has(row.team_id)) || (row.subteam_id && scopes.subteamIds.has(row.subteam_id))))
  }
  router.use("/:id", async (request, response, next) => {
    try {
      if (!(await personInScope(request, request.params.id!))) return response.status(404).json({ error: { code: "USER_NOT_FOUND", message: "Usuário não encontrado." } })
      return next()
    } catch (error) {
      return next(error)
    }
  })

  router.get("/:id/employment-status", async (request, response) => {
    const organizationId = request.user!.organizationId
    const person = await db.query<{ current_employment_status: string; operational_capital_code: string | null }>(`select current_employment_status, operational_capital_code from people where id = $1 and organization_id = $2`, [request.params.id, organizationId])
    if (!person.rows[0]) return response.status(404).json({ error: { code: "USER_NOT_FOUND", message: "Usuário não encontrado." } })
    const timeZone = await resolveOrganizationTimezone(db, organizationId)
    const now = new Date()
    const [history, schedule] = await Promise.all([loadEmploymentStatusHistory(db, request.params.id!), loadWorkScheduleSummary(db, organizationId, request.params.id!, localDateOf(now, timeZone), now, timeZone)])
    const status = toCanonicalEmploymentStatus(person.rows[0].current_employment_status) ?? "EM_PRODUCAO"
    const capital = findBrazilianCapital(person.rows[0].operational_capital_code)
    response.json({
      data: {
        current: { status, label: EMPLOYMENT_STATUS_LABELS[status] },
        history: history.map((period) => ({ ...period, label: EMPLOYMENT_STATUS_LABELS[period.status] })).reverse(),
        schedule,
        operationalCapital: capital ? { code: capital.code, name: capital.name, stateCode: capital.stateCode, label: capitalLabel(capital.code) } : null,
      },
    })
  })

  router.post("/:id/employment-status", async (request, response) => {
    const organizationId = request.user!.organizationId
    const input = employmentStatusSchema.parse(request.body)
    const person = await db.query(`select id from people where id = $1 and organization_id = $2`, [request.params.id, organizationId])
    if (!person.rows[0]) return response.status(404).json({ error: { code: "USER_NOT_FOUND", message: "Usuário não encontrado." } })
    const timeZone = await resolveOrganizationTimezone(db, organizationId)
    const outcome = await applyEmployeeStatusSnapshot(db, {
      organizationId,
      personId: request.params.id!,
      status: input.status,
      effectiveFrom: input.effectiveFrom ?? null,
      effectiveTo: input.effectiveTo ?? null,
      observedAt: new Date(),
      source: "MANUAL",
      sourceReference: input.note ? `${request.user?.email ?? "admin"}: ${input.note}` : (request.user?.email ?? "admin"),
      timeZone,
      // Ajuste deliberado do admin: vence empates de evidência, mas NÃO uma ausência explícita e
      // limitada informada pela fonte sem datas (o conflito volta como 409 para o admin decidir com datas).
      authoritative: true,
    })
    if (outcome.action === "CONFLICT") {
      return response.status(409).json({
        error: {
          code: "EMPLOYMENT_STATUS_CONFLICT",
          message: `Já existe um período ${EMPLOYMENT_STATUS_LABELS[outcome.conflict!.existing.status]} de ${outcome.conflict!.existing.effectiveFrom}${outcome.conflict!.existing.effectiveTo ? ` a ${outcome.conflict!.existing.effectiveTo}` : ""} informado pela fonte "${outcome.conflict!.existing.source}" com datas explícitas. Para sobrescrever, informe início e fim.`,
          details: outcome.conflict,
        },
      })
    }
    response.status(201).json({ data: { action: outcome.action, currentStatus: outcome.currentStatus, label: EMPLOYMENT_STATUS_LABELS[outcome.currentStatus], period: outcome.period, conflict: outcome.conflict ?? null } })
  })

  router.get("/", async (request, response) => {
    const organizationId = request.user!.organizationId
    const input = listUsersSchema.parse(request.query)
    const scopes = await scopesOf(request)
    const filter = new SqlFilter([organizationId])
      .search(input.search, ["q.name", "q.email"])
      .in("q.role", input.role)
      .equals("q.active", input.active)
      .equals('q."teamId"', input.teamId)
      .dateRange('q."lastLoginAt"', input.lastLoginFrom, input.lastLoginTo)
    if (input.hasAccount !== undefined) filter.add(`q."accountId" is ${input.hasAccount ? "not null" : "null"}`)
    if (!scopes.unrestricted && !scopes.allTeams) filter.add(`(q."teamId" = any(${filter.param([...scopes.teamIds])}::uuid[]) or q."subteamId" = any(${filter.param([...scopes.subteamIds])}::uuid[]))`)
    const data = await respondList(db, request.query, { select: SELECT_USERS, filter, orderBy: "q.name, q.id" })
    response.json({ data })
  })

  router.post("/", async (request, response) => {
    const organizationId = request.user!.organizationId
    const input = createUserSchema.parse(request.body)
    const scopes = await scopesOf(request)
    if (!scopes.unrestricted && !scopes.allTeams && !(input.teamId && scopes.teamIds.has(input.teamId))) {
      throw new DomainError("Você só pode cadastrar pessoas nos Grupos do seu escopo.", "FORBIDDEN", 403)
    }
    if (isHierarchyRole(input.role) && !coversOrganization(scopes)) throw LEADERSHIP_REQUIRES_ORGANIZATION()
    // Criar a conta com senha = custódia de credencial: exige também administrar acessos no escopo do Grupo.
    const accessScopes = await getManageableScopes(db, request.user!, "access.users.manage")
    if (!accessScopes.unrestricted && !accessScopes.allTeams && !(input.teamId && accessScopes.teamIds.has(input.teamId))) {
      throw new DomainError("Criar uma conta de acesso exige administrar acessos no Grupo da pessoa.", "FORBIDDEN", 403)
    }
    const violations = passwordPolicyViolations(input.password, { login: input.email })
    if (violations.length > 0) {
      throw new DomainError("A senha provisória não atende à política de segurança.", "PASSWORD_POLICY_VIOLATION", 422, { violations: violations.map((code) => ({ code, message: PASSWORD_POLICY_MESSAGES[code] })) })
    }
    const client = await db.connect()
    try {
      await client.query("begin")
      const person = await client.query<{ id: string }>(
        `insert into people(organization_id, team_id, name, role) values ($1,$2,$3,$4) returning id`,
        [organizationId, input.teamId ?? null, input.name, input.role],
      )
      const personId = person.rows[0]!.id
      const passwordHash = await hashPassword(input.password)
      // Senha definida por quem cadastra é PROVISÓRIA: no primeiro login a pessoa é obrigada a criar a própria (mesmo fluxo da
      // liberação de acesso), e ela vence como a senha temporária gerada pelo sistema.
      const issuedAt = new Date()
      const account = await client.query<{ id: string }>(
        `insert into user_accounts(organization_id, person_id, email, password_hash, password_change_required, temporary_password_issued_at, temporary_password_expires_at)
         values ($1,$2,$3,$4,true,$5,$6) returning id`,
        [organizationId, personId, input.email.trim().toLowerCase(), passwordHash, issuedAt, temporaryPasswordExpiry(issuedAt, env.TEMPORARY_PASSWORD_TTL_HOURS)],
      )
      // Auditoria (sem senha nem hash): quem criou a pessoa e a conta, com qual nível.
      await client.query(
        `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, 'ACCESS_ENABLED', 'user_account', $3, $4::jsonb)`,
        [organizationId, request.user!.personId, account.rows[0]!.id, JSON.stringify({ personId, email: input.email.trim().toLowerCase(), role: input.role, accountCreated: true, source: "PEOPLE_REGISTRY", actorAccountId: request.user!.sub })],
      )
      await client.query("commit")
      response.status(201).json({ data: { id: personId, name: input.name, role: input.role, email: input.email } })
    } catch (error) {
      await client.query("rollback")
      if (error instanceof Error && "code" in error && (error as { code?: string }).code === "23505") {
        throw new DomainError("Já existe uma conta com este e-mail.", "EMAIL_ALREADY_IN_USE", 409)
      }
      throw error
    } finally {
      client.release()
    }
  })

  router.patch("/:id", async (request, response) => {
    const organizationId = request.user!.organizationId
    const input = updateUserSchema.parse(request.body)
    const personId = request.params.id!
    const changesAccess = input.role !== undefined || input.active !== undefined || input.email !== undefined || input.teamId !== undefined
    // Ninguém altera o próprio nível, Grupo, e-mail de login ou situação de acesso — outra pessoa autorizada precisa fazer isso.
    if (changesAccess && personId === request.user!.personId) {
      throw new DomainError("Você não pode alterar o seu próprio nível, Grupo, e-mail ou situação — outra pessoa autorizada precisa fazer isso.", "PEOPLE_SELF_CHANGE_FORBIDDEN", 403)
    }
    const scopes = await scopesOf(request)
    if (input.role !== undefined) {
      const current = await db.query<{ role: string }>(`select role from people where id = $1 and organization_id = $2`, [personId, organizationId])
      if (touchesLeadership(current.rows[0]?.role ?? null, input.role) && !coversOrganization(scopes)) throw LEADERSHIP_REQUIRES_ORGANIZATION()
    }
    // Mover para outro Grupo: o destino também precisa estar no escopo (antes só a origem era conferida).
    if (input.teamId !== undefined && !scopes.unrestricted && !scopes.allTeams && !(input.teamId !== null && scopes.teamIds.has(input.teamId))) {
      throw new DomainError("Você só pode mover pessoas para Grupos do seu escopo.", "FORBIDDEN", 403)
    }
    // E-mail de login e inativação mexem na credencial: mesma custódia da tela de acessos (achado U-F3).
    if (input.email !== undefined || input.active === false) await assertCredentialChangeAllowed(accountDeps, actorOf(request), personId)
    // Proteção contra lockout: desativar a pessoa/conta do ÚLTIMO Administrador geral ativo deixaria o tenant sem ninguém
    // capaz de administrar acessos.
    if (input.active === false) {
      const account = await db.query<{ id: string }>(`select id from user_accounts where person_id = $1 and organization_id = $2`, [request.params.id, organizationId])
      if (account.rows[0] && (await wouldRemoveLastTenantAdmin(accessRepository, organizationId, account.rows[0].id))) {
        throw new DomainError("Esta pessoa é o último Administrador geral ativo — conceda o papel a outra pessoa antes de desativá-la.", "ACCESS_LAST_TENANT_ADMIN", 409)
      }
    }
    try {
      const person = await db.query(
        `update people set
           name = coalesce($1, name),
           role = coalesce($2, role),
           team_id = case when $3::boolean then $4 else team_id end,
           active = coalesce($5, active),
           operational_capital_code = case when $8::boolean then $9 else operational_capital_code end
         where id = $6 and organization_id = $7
         returning id, name, role, active, team_id "teamId", operational_capital_code "operationalCapitalCode"`,
        [input.name ?? null, input.role ?? null, "teamId" in request.body, input.teamId ?? null, input.active ?? null, request.params.id, organizationId, input.operationalCapitalCode !== undefined, input.operationalCapitalCode ?? null],
      )
      if (!person.rows[0]) return response.status(404).json({ error: { code: "USER_NOT_FOUND", message: "Usuário não encontrado." } })
      if (input.active !== undefined || input.email !== undefined) {
        // Inativar a pessoa DESABILITA o acesso (sessões revogadas, senha temporária pendente apagada, auditado). Reativar a
        // pessoa NÃO reabilita o login com a senha antiga: o acesso volta só por "Habilitar acesso" (nova senha temporária).
        await db.query(
          `with before as (
             select id, active from user_accounts where person_id = $3 and organization_id = $4
           ), changed as (
             update user_accounts ua set
               email = coalesce($1, ua.email),
               active = case when $2::boolean is false then false else ua.active end,
               access_disabled_at = case when $2::boolean is false and ua.active then now() else ua.access_disabled_at end,
               session_version = ua.session_version + case when $2::boolean is false and ua.active then 1 else 0 end,
               password_change_required = case when $2::boolean is false then false else ua.password_change_required end,
               temporary_password_issued_at = case when $2::boolean is false then null else ua.temporary_password_issued_at end,
               temporary_password_expires_at = case when $2::boolean is false then null else ua.temporary_password_expires_at end,
               updated_at = now()
             from before b where ua.id = b.id
             returning ua.id, ua.organization_id, b.active was_active
           )
           insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload)
           select organization_id, $5::uuid, 'ACCESS_DISABLED', 'user_account', id, $6::jsonb
           from changed where $2::boolean is false and was_active`,
          [input.email ?? null, input.active ?? null, request.params.id, organizationId, request.user!.personId, JSON.stringify({ personId: request.params.id, reason: "PERSON_DEACTIVATED", sessionsRevoked: true })],
        )
      }
      response.json({ data: person.rows[0] })
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new DomainError("Já existe uma conta com este e-mail.", "EMAIL_ALREADY_IN_USE", 409)
      }
      throw error
    }
  })

  // Jornada prevista do colaborador (evolução do Trigger "Por agenda" — agendamento relativo ao
  // expediente). GET devolve a jornada VIGENTE hoje (ou null — nunca inventa um horário padrão,
  // Parte 29 do pedido). PUT nunca faz UPDATE destrutivo: fecha a linha vigente (effective_to =
  // ontem) e insere uma nova a partir de hoje, preservando histórico — é isso que garante que
  // mudar a jornada de alguém nunca deixa uma ocorrência futura presa a um horário antigo (Parte
  // 28): o checador sempre lê a linha vigente de HOJE, fresca, a cada tick.
  router.get("/:id/shift", async (request, response) => {
    const organizationId = request.user!.organizationId
    const result = await db.query(
      `select start_time "startTime", work_minutes "workMinutes", effective_from "effectiveFrom"
       from employee_work_shifts
       where person_id = $1 and organization_id = $2 and effective_from <= current_date and (effective_to is null or effective_to >= current_date)
       order by effective_from desc limit 1`,
      [request.params.id, organizationId],
    )
    response.json({ data: result.rows[0] ?? null })
  })

  router.put("/:id/shift", async (request, response) => {
    const organizationId = request.user!.organizationId
    const input = workShiftSchema.parse(request.body)
    const person = await db.query(`select id from people where id = $1 and organization_id = $2`, [request.params.id, organizationId])
    if (!person.rows[0]) return response.status(404).json({ error: { code: "USER_NOT_FOUND", message: "Usuário não encontrado." } })

    // Fecha a jornada vigente anterior (criada antes de hoje) — nunca UPDATE destrutivo, só
    // encerra a vigência. Uma jornada já criada HOJE (edição repetida no mesmo dia) é removida
    // em vez de "fechada", porque effective_to nunca pode ficar antes de effective_from (mesma
    // checagem do banco) — nunca existiram de fato dois dias distintos pra ela.
    await db.query(
      `update employee_work_shifts set effective_to = current_date - 1, updated_at = now()
       where person_id = $1 and organization_id = $2 and effective_from < current_date and (effective_to is null or effective_to >= current_date)`,
      [request.params.id, organizationId],
    )
    await db.query(`delete from employee_work_shifts where person_id = $1 and organization_id = $2 and effective_from = current_date`, [
      request.params.id,
      organizationId,
    ])
    const result = await db.query<{ id: string }>(
      `insert into employee_work_shifts(organization_id, person_id, start_time, work_minutes)
       values ($1,$2,$3,$4) returning id`,
      [organizationId, request.params.id, input.startTime, input.workMinutes],
    )
    response.status(201).json({ data: { id: result.rows[0]!.id } })
  })

  return router
}
