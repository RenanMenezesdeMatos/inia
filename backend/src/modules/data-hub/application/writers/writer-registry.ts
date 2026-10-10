import { DataRunError } from "../../domain/error-codes.js"
import type { DomainWriter } from "./domain-writer.js"
import { interactionFlagsWriter, interactionsWriter, transcriptsWriter } from "./interaction-writers.js"
import { employeeAbsencesWriter, employeesWriter, goalsWriter, groupsWriter, organizationalStructureWriter, subgroupsWriter, workScheduleDaysWriter, workScheduleExceptionsWriter, workSchedulesWriter } from "./master-data-writers.js"
import { indicatorMeasurementsWriter, officialIndicatorPerformanceWriter, prvPerformanceWriter } from "./performance-writers.js"

/** Writer por contrato — um lugar só. Contrato sem writer é bug de registro, não de runtime. */
const WRITERS: readonly DomainWriter[] = [
  groupsWriter,
  subgroupsWriter,
  employeesWriter,
  organizationalStructureWriter,
  employeeAbsencesWriter,
  workSchedulesWriter,
  workScheduleDaysWriter,
  workScheduleExceptionsWriter,
  goalsWriter,
  indicatorMeasurementsWriter,
  officialIndicatorPerformanceWriter,
  prvPerformanceWriter,
  interactionsWriter,
  transcriptsWriter,
  interactionFlagsWriter,
] as DomainWriter[]

const byKey = new Map(WRITERS.map((writer) => [writer.contractKey, writer]))

export function requireWriter(contractKey: string): DomainWriter {
  const writer = byKey.get(contractKey)
  if (!writer) throw new DataRunError("DATA_CONTRACT_UNKNOWN", `Nenhum writer registrado para o contrato ${contractKey}.`)
  return writer
}

export const WRITER_CONTRACT_KEYS = WRITERS.map((writer) => writer.contractKey)
