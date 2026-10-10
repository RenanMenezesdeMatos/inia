import { describe, expect, it } from "vitest"
import type { Database } from "../../infrastructure/database/pool.js"
import { escapeLike, isPaginatedRequest, listParam, queryPage, SqlFilter } from "./list-query.js"
import { z } from "zod"

describe("SqlFilter", () => {
  it("numbers placeholders after the initial params and joins clauses with AND", () => {
    const filter = new SqlFilter(["org-1"])
      .search("ab%c", ["q.name", 'q."fileName"'])
      .in("q.status", ["DRAFT", "PUBLISHED"])
      .equals("q.active", true)
      .dateRange('q."createdAt"', "2026-01-01", "2026-01-31")
    expect(filter.where()).toBe(
      ` where (q.name ilike $2 or q."fileName" ilike $2) and q.status = any($3::text[]) and q.active = $4 and q."createdAt" >= $5::date and q."createdAt" < ($6::date + interval '1 day')`,
    )
    expect(filter.params).toEqual(["org-1", "%ab\\%c%", ["DRAFT", "PUBLISHED"], true, "2026-01-01", "2026-01-31"])
  })

  it("skips undefined/empty filters entirely", () => {
    const filter = new SqlFilter(["org-1"]).search(undefined, ["q.name"]).in("q.status", []).equals("q.active", undefined).orgScope("q", {})
    expect(filter.where()).toBe("")
    expect(filter.params).toEqual(["org-1"])
  })

  it("maps the org scope filter: subteam wins over team, and ALL_TEAMS only matches global rows", () => {
    expect(new SqlFilter().orgScope("q", { teamId: "t", subteamId: "s" }).where()).toBe(` where q."subteamId" = $1::uuid`)
    expect(new SqlFilter().orgScope("q", { teamId: "t" }).where()).toBe(` where q."teamId" = $1::uuid`)
    expect(new SqlFilter().orgScope("q", { scopeType: "ALL_TEAMS" }).where()).toBe(` where q."scopeType" = 'ALL_TEAMS'`)
  })
})

describe("query param helpers", () => {
  it("accepts repeated keys and comma-separated lists", () => {
    const schema = listParam(z.enum(["A", "B"]))
    expect(schema.parse(["A", "B"])).toEqual(["A", "B"])
    expect(schema.parse("A,B")).toEqual(["A", "B"])
    expect(schema.parse("")).toBeUndefined()
    expect(() => schema.parse("C")).toThrow()
  })

  it("escapes LIKE wildcards", () => {
    expect(escapeLike("50%_x\\")).toBe("50\\%\\_x\\\\")
  })

  it("only paginates when page or pageSize is present", () => {
    expect(isPaginatedRequest({})).toBe(false)
    expect(isPaginatedRequest({ search: "x" })).toBe(false)
    expect(isPaginatedRequest({ page: "2" })).toBe(true)
    expect(isPaginatedRequest({ pageSize: "10" })).toBe(true)
  })
})

describe("queryPage", () => {
  it("runs a count and a limited page over the wrapped select", async () => {
    const calls: { sql: string; params: unknown[] }[] = []
    const db = {
      query: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params })
        if (sql.startsWith("select count(*)")) return { rows: [{ total: 42 }], rowCount: 1 }
        return { rows: [{ id: "a" }, { id: "b" }], rowCount: 2 }
      },
    } as unknown as Database
    const filter = new SqlFilter(["org-1"]).equals("q.active", true)
    const result = await queryPage(db, { select: "select * from things where org = $1", filter, orderBy: "q.name", page: 3, pageSize: 10 })
    expect(result).toEqual({ items: [{ id: "a" }, { id: "b" }], total: 42, page: 3, pageSize: 10 })
    expect(calls[0]!.sql).toBe("select count(*)::int total from (select * from things where org = $1) q where q.active = $2")
    expect(calls[0]!.params).toEqual(["org-1", true])
    expect(calls[1]!.sql).toBe("select q.* from (select * from things where org = $1) q where q.active = $2 order by q.name limit $3 offset $4")
    expect(calls[1]!.params).toEqual(["org-1", true, 10, 20])
  })
})
