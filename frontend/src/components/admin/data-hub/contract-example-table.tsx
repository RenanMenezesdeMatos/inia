"use client"

import { KeyRound, Link2 } from "lucide-react"

import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { ContractFieldReference, DataContract } from "@/schemas/admin/data-hub.schema"
import { cn } from "@/lib/utils"

/**
 * Exemplo de como o cliente monta a tabela na origem para um contrato: uma coluna por campo, uma linha por registro de
 * exemplo do próprio contrato. Chave primária (a chave natural, composta quando tem mais de um campo) e chave estrangeira
 * (campo cujo valor precisa existir em outro contrato ou num catálogo da INIA) ficam marcadas no cabeçalho e explicadas
 * na legenda. Só apresentação: quem aplica as chaves é o writer de cada contrato.
 */

const PRIMARY_CHIP = "bg-amber-100 text-amber-900 ring-amber-700/25 dark:bg-amber-500/25 dark:text-amber-100"
const FOREIGN_CHIP = "bg-sky-100 text-sky-900 ring-sky-700/25 dark:bg-sky-500/25 dark:text-sky-100"
const PRIMARY_CELL = "bg-amber-50/70 dark:bg-amber-500/10"

type KeyKind = "PK" | "FK"

function KeyChip({ kind }: { kind: KeyKind }) {
  const Icon = kind === "PK" ? KeyRound : Link2
  return (
    <span
      className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[0.625rem] leading-none font-bold ring-1 ring-inset", kind === "PK" ? PRIMARY_CHIP : FOREIGN_CHIP)}
      aria-label={kind === "PK" ? "Chave primária" : "Chave estrangeira"}
      title={kind === "PK" ? "Chave primária" : "Chave estrangeira"}
    >
      <Icon className="size-3" aria-hidden />
      <span aria-hidden>{kind}</span>
    </span>
  )
}

/** Marcas de chave de cada campo do contrato. */
export function contractKeyMarks(contract: DataContract): Map<string, KeyKind[]> {
  const marks = new Map<string, KeyKind[]>()
  for (const field of contract.fields) {
    const kinds: KeyKind[] = []
    if (contract.naturalKey.includes(field.key)) kinds.push("PK")
    if (contract.foreignKeys.some((foreignKey) => foreignKey.field === field.key)) kinds.push("FK")
    if (kinds.length > 0) marks.set(field.key, kinds)
  }
  return marks
}

export function ContractKeyChips({ kinds }: { kinds: readonly KeyKind[] | undefined }) {
  if (!kinds?.length) return null
  return (
    <span className="inline-flex gap-1">
      {kinds.map((kind) => (
        <KeyChip key={kind} kind={kind} />
      ))}
    </span>
  )
}

function describeReference(reference: ContractFieldReference, contracts: readonly DataContract[]): string {
  if ("catalog" in reference) return reference.catalog
  const label = contracts.find((contract) => contract.key === reference.contract)?.label ?? reference.contract
  return `${label} › ${reference.field}`
}

function formatExampleValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null
  return typeof value === "string" ? value : String(value)
}

export function ContractExampleTable({ contract, contracts }: { contract: DataContract; contracts: readonly DataContract[] }) {
  const marks = contractKeyMarks(contract)
  const primaryFields = contract.naturalKey.filter((key) => contract.fields.some((field) => field.key === key))
  return (
    <div className="space-y-3">
      <div className={cn(TABLE_FRAME, "overflow-x-auto")}>
        <Table aria-label={`Exemplo da tabela de origem — ${contract.label}`}>
          <TableHeader>
            <TableRow>
              {contract.fields.map((field) => (
                <TableHead key={field.key} scope="col">
                  <span className="inline-flex items-center gap-1.5">
                    <ContractKeyChips kinds={marks.get(field.key)} />
                    <span className="font-mono text-xs">{field.key}</span>
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {contract.examples.map((example, index) => (
              <TableRow key={index}>
                {contract.fields.map((field) => {
                  const value = formatExampleValue(example[field.key])
                  return (
                    <TableCell key={field.key} className={cn("max-w-64 truncate font-mono text-xs", marks.get(field.key)?.includes("PK") && PRIMARY_CELL)} title={value ?? undefined}>
                      {value ?? <span className="text-muted-foreground italic">vazio</span>}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="space-y-1.5 text-xs text-muted-foreground">
        {primaryFields.length > 0 ? (
          <li className="flex items-start gap-1.5">
            <KeyChip kind="PK" />
            <span className="min-w-0 flex-1 pt-px">
              Chave primária{primaryFields.length > 1 ? " composta" : ""}: <span className="font-mono text-foreground">{primaryFields.join(" + ")}</span>. Não pode se repetir na tabela; a mesma chave numa
              carga nova atualiza o registro.
            </span>
          </li>
        ) : null}
        {contract.foreignKeys.map((foreignKey) => (
          <li key={foreignKey.field} className="flex items-start gap-1.5">
            <KeyChip kind="FK" />
            <span className="min-w-0 flex-1 pt-px">
              <span className="font-mono text-foreground">{foreignKey.field}</span> precisa existir em{" "}
              {foreignKey.references.map((reference) => describeReference(reference, contracts)).join(foreignKey.references.length > 1 ? " ou " : "")}.
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
