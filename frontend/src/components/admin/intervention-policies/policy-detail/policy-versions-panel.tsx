"use client"

import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDateTime } from "@/lib/format/date"
import type { PolicyView } from "@/schemas/admin/intervention-policy.schema"

import { POLICY_VERSION_STATUS_LABELS, policyVersionStatus } from "../shared/helpers"
import { PolicyDefinitionForm } from "../policy-editor/policy-definition-form"

/**
 * Histórico completo de versões. Publicadas são imutáveis e têm vigência; "Em vigor" é a que vale agora, "Agendada" começa no
 * futuro, "Substituída" valeu até a seguinte entrar em vigor (avaliações daquela época continuam apontando para ela).
 */
export function PolicyVersionsPanel({ policy }: { policy: PolicyView }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const opened = policy.versions.find((version) => version.id === openId) ?? null
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Versão</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Vigência a partir de</TableHead>
              <TableHead>Publicada em</TableHead>
              <TableHead>Última alteração</TableHead>
              <TableHead>Regras</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {policy.versions.map((version) => {
              const status = policyVersionStatus(policy, version)
              return (
                <TableRow key={version.id} data-testid={`policy-version-${version.version}`}>
                  <TableCell className="font-medium">v{version.version}</TableCell>
                  <TableCell>
                    <Badge variant={status === "IN_FORCE" ? "secondary" : "outline"}>{POLICY_VERSION_STATUS_LABELS[status]}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{version.effectiveFrom ? formatDateTime(version.effectiveFrom) : "—"}</TableCell>
                  <TableCell className="text-sm">{version.publishedAt ? formatDateTime(version.publishedAt) : "—"}</TableCell>
                  <TableCell className="text-sm">{formatDateTime(version.updatedAt)}</TableCell>
                  <TableCell className="text-sm">{version.definition.rules.length}</TableCell>
                  <TableCell className="text-right">
                    {status === "DRAFT" ? (
                      <span className="text-xs text-muted-foreground">Edite na aba Regras</span>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setOpenId(openId === version.id ? null : version.id)}>
                        {openId === version.id ? "Fechar" : "Ver regras"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      {opened ? (
        <section className="space-y-2 rounded-xl border p-4" aria-label={`Versão ${opened.version}`}>
          <h3 className="text-sm font-semibold">Versão {opened.version} (somente leitura)</h3>
          <PolicyDefinitionForm key={opened.id} definition={opened.definition} readOnly />
        </section>
      ) : null}
    </div>
  )
}
