"use client"

import { useState } from "react"
import { FileJson } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ListErrorState } from "@/components/admin/shared/list/list-states"
import { useDataContractsQuery } from "@/queries/admin/use-data-hub-queries"
import { CONTRACT_CATEGORY_LABELS, FIELD_TYPE_LABELS, WRITE_POLICY_LABELS, WRITE_SEMANTICS_LABELS, type DataContract } from "@/schemas/admin/data-hub.schema"
import { cn } from "@/lib/utils"

export function ContractFieldsTable({ contract }: { contract: DataContract }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Campo INIA</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Obrigatório</TableHead>
            <TableHead>Descrição</TableHead>
            <TableHead>Exemplo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contract.fields.map((field) => (
            <TableRow key={field.key}>
              <TableCell className="font-mono text-xs">
                {field.key}
                {field.identity ? <span className="ml-1 text-muted-foreground">(identidade)</span> : null}
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs">
                {FIELD_TYPE_LABELS[field.type] ?? field.type}
                {field.enumValues ? <p className="text-muted-foreground">{field.enumValues.join(" · ")}</p> : null}
              </TableCell>
              <TableCell className="text-xs">{field.required ? "Sim" : contract.atLeastOne?.some((group) => group.includes(field.key)) ? "Um do grupo" : "Não"}</TableCell>
              <TableCell className="max-w-md whitespace-normal text-xs text-muted-foreground">{field.description}</TableCell>
              <TableCell className="font-mono text-xs">{String(field.example)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function ContractPayloadExample({ contract }: { contract: DataContract }) {
  return (
    <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-muted p-3 text-xs">
      {JSON.stringify({ records: contract.examples }, null, 2)}
    </pre>
  )
}

export function ContractsTab() {
  const query = useDataContractsQuery()
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  if (query.isLoading) return <Skeleton className="h-96 rounded-xl" aria-hidden />
  if (query.isError || !query.data) return <ListErrorState message="Não foi possível carregar os contratos de dados." onRetry={() => query.refetch()} />
  const { contracts, dependencies } = query.data
  const selected = contracts.find((contract) => contract.key === selectedKey) ?? contracts[0]!

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <div className="space-y-1">
        <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contratos suportados</p>
        {contracts.map((contract) => (
          <button
            key={contract.key}
            type="button"
            onClick={() => setSelectedKey(contract.key)}
            className={cn("flex w-full flex-col items-start rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted", selected.key === contract.key && "bg-primary/10 text-primary")}
            aria-current={selected.key === contract.key ? "true" : undefined}
          >
            <span className="font-medium">{contract.label}</span>
            <span className="text-xs text-muted-foreground">
              {contract.key}@{contract.version} · {CONTRACT_CATEGORY_LABELS[contract.category]}
            </span>
          </button>
        ))}
      </div>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileJson className="size-4 text-primary" aria-hidden />
                {selected.label}
                <Badge variant="outline" className="font-mono">
                  {selected.key}@{selected.version}
                </Badge>
              </CardTitle>
              <CardDescription className="mt-1">{selected.description}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Destino no domínio</dt>
              <dd className="font-mono text-xs">{selected.targetEntity}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Chave natural</dt>
              <dd className="font-mono text-xs">{selected.naturalKey.join(" + ")}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Semântica de escrita</dt>
              <dd>{WRITE_SEMANTICS_LABELS[selected.writeSemantics]}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Política de aplicação</dt>
              <dd>{WRITE_POLICY_LABELS[selected.writePolicy]}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Depende de</dt>
              <dd>{(dependencies.find((entry) => entry.key === selected.key)?.dependsOn ?? []).join(", ") || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Tempo de negócio</dt>
              <dd className="font-mono text-xs">{selected.businessTimeField ?? "—"}</dd>
            </div>
          </dl>
          <div className="space-y-2">
            <p className="text-sm font-medium">Campos</p>
            <ContractFieldsTable contract={selected} />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Payload de exemplo (API Push)</p>
            <ContractPayloadExample contract={selected} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
