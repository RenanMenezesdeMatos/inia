"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

import { AuditTab } from "./audit/audit-tab"
import { CompetenciesTab } from "./competencies/competencies-tab"
import { PoliciesTab } from "./policies/policies-tab"
import { useInterventionCapabilities } from "./shared/use-intervention-capabilities"
import { TypesTab } from "./types/types-tab"

/**
 * Administração › Automação › Políticas de acompanhamento. Políticas (quando recomendar/abrir intervenções), o catálogo de
 * tipos de intervenção, o de competências e — com permissão — a auditoria. O backend é a autoridade de tudo; esta tela só
 * antecipa o que ele vai exigir. Políticas, tipos e competências ficam montados (escondidos quando inativos): trocar de aba
 * nunca perde uma edição ainda não salva.
 */
export function InterventionPoliciesPage() {
  const { canAudit } = useInterventionCapabilities()
  const keepMounted = "data-[state=inactive]:hidden"
  return (
    <Card>
      <CardHeader>
        <CardTitle>Políticas de acompanhamento</CardTitle>
        <CardDescription>Quando a INIA recomenda ou abre intervenções para um colaborador — com regras explícitas, evidência verificável e decisão humana onde ela é exigida.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="policies">
          <TabsList>
            <TabsTrigger value="policies">Políticas</TabsTrigger>
            <TabsTrigger value="types">Tipos de intervenção</TabsTrigger>
            <TabsTrigger value="competencies">Competências</TabsTrigger>
            {canAudit ? <TabsTrigger value="audit">Auditoria</TabsTrigger> : null}
          </TabsList>
          <TabsContent value="policies" forceMount className={cn("mt-4", keepMounted)}>
            <PoliciesTab />
          </TabsContent>
          <TabsContent value="types" forceMount className={cn("mt-4", keepMounted)}>
            <TypesTab />
          </TabsContent>
          <TabsContent value="competencies" forceMount className={cn("mt-4", keepMounted)}>
            <CompetenciesTab />
          </TabsContent>
          {canAudit ? (
            <TabsContent value="audit" className="mt-4">
              <AuditTab />
            </TabsContent>
          ) : null}
        </Tabs>
      </CardContent>
    </Card>
  )
}
