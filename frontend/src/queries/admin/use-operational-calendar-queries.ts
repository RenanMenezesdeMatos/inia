import { useQuery } from "@tanstack/react-query"

import { useAdminMutation } from "@/lib/admin/use-admin-mutation"
import type { CalendarSettingsInput, CatalogFilter, HolidayInput } from "@/schemas/admin/operational-calendar.schema"
import { createHoliday, deleteHoliday, fetchCalendarSettings, fetchCapitals, fetchHolidayCatalog, fetchHolidayCatalogCoverage, fetchHolidays, updateCalendarSettings, updateHoliday } from "@/services/admin/operational-calendar-service"

import { adminQueryKeys } from "./admin-query-keys"

export function useHolidaysQuery() {
  return useQuery({ queryKey: adminQueryKeys.holidays(), queryFn: fetchHolidays })
}

export function useCreateHolidayMutation() {
  return useAdminMutation({ mutationFn: (input: HolidayInput) => createHoliday(input), invalidateKey: adminQueryKeys.holidays(), successMessage: "Feriado cadastrado." })
}

export function useUpdateHolidayMutation() {
  return useAdminMutation({ mutationFn: ({ id, input }: { id: string; input: Partial<HolidayInput> }) => updateHoliday(id, input), invalidateKey: adminQueryKeys.holidays(), successMessage: "Feriado atualizado." })
}

export function useDeleteHolidayMutation() {
  return useAdminMutation({ mutationFn: (id: string) => deleteHoliday(id), invalidateKey: adminQueryKeys.holidays(), successMessage: "Feriado removido." })
}

/** Reference data: 27 capitais — muda só por migration, cache longo. */
export function useCapitalsQuery() {
  return useQuery({ queryKey: adminQueryKeys.capitals(), queryFn: fetchCapitals, staleTime: 60 * 60 * 1000 })
}

export function useCalendarSettingsQuery() {
  return useQuery({ queryKey: adminQueryKeys.calendarSettings(), queryFn: fetchCalendarSettings })
}

export function useUpdateCalendarSettingsMutation() {
  return useAdminMutation({ mutationFn: (input: CalendarSettingsInput) => updateCalendarSettings(input), invalidateKey: adminQueryKeys.calendarSettings(), successMessage: "Configuração do calendário atualizada." })
}

export function useHolidayCatalogQuery(filter: CatalogFilter) {
  return useQuery({ queryKey: adminQueryKeys.holidayCatalog(filter), queryFn: () => fetchHolidayCatalog(filter) })
}

export function useHolidayCatalogCoverageQuery() {
  return useQuery({ queryKey: adminQueryKeys.holidayCatalogCoverage(), queryFn: fetchHolidayCatalogCoverage, staleTime: 10 * 60 * 1000 })
}
