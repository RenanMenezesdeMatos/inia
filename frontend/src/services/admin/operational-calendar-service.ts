import { z } from "zod"

import { adminGet, adminSend } from "@/lib/admin/admin-api"
import { calendarSettingsSchema, capitalsResponseSchema, catalogHolidaySchema, holidayCatalogCoverageSchema, holidaySchema, type BrazilianCapital, type CalendarSettings, type CalendarSettingsInput, type CatalogFilter, type CatalogHoliday, type Holiday, type HolidayCatalogCoverage, type HolidayInput } from "@/schemas/admin/operational-calendar.schema"

const BASE = "/api/v1/admin/operational-calendar"

export async function fetchHolidays(): Promise<Holiday[]> {
  return z.array(holidaySchema).parse(await adminGet(`${BASE}/holidays`))
}

export async function createHoliday(input: HolidayInput): Promise<Holiday> {
  return holidaySchema.parse(await adminSend(`${BASE}/holidays`, "POST", input))
}

export async function updateHoliday(id: string, input: Partial<HolidayInput>): Promise<Holiday> {
  return holidaySchema.parse(await adminSend(`${BASE}/holidays/${id}`, "PATCH", input))
}

export async function deleteHoliday(id: string): Promise<void> {
  await adminSend(`${BASE}/holidays/${id}`, "DELETE")
}

export async function fetchCapitals(): Promise<{ capitals: BrazilianCapital[]; states: string[] }> {
  return capitalsResponseSchema.parse(await adminGet(`${BASE}/capitals`))
}

export async function fetchCalendarSettings(): Promise<CalendarSettings> {
  return calendarSettingsSchema.parse(await adminGet(`${BASE}/settings`))
}

export async function updateCalendarSettings(input: CalendarSettingsInput): Promise<CalendarSettings> {
  return calendarSettingsSchema.parse(await adminSend(`${BASE}/settings`, "PATCH", input))
}

export async function fetchHolidayCatalog(filter: CatalogFilter): Promise<CatalogHoliday[]> {
  const params = new URLSearchParams()
  if (filter.year) params.set("year", String(filter.year))
  if (filter.capital) params.set("capital", filter.capital)
  if (filter.state) params.set("state", filter.state)
  if (filter.scope) params.set("scope", filter.scope)
  const query = params.toString()
  return z.array(catalogHolidaySchema).parse(await adminGet(`${BASE}/catalog${query ? `?${query}` : ""}`))
}

export async function fetchHolidayCatalogCoverage(): Promise<HolidayCatalogCoverage> {
  return holidayCatalogCoverageSchema.parse(await adminGet(`${BASE}/catalog/coverage`))
}
