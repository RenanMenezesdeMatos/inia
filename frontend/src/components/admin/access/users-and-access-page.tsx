"use client"

import { KeyRound, ShieldCheck, UsersRound } from "lucide-react"

import { UsersPage } from "@/components/admin/users/users-page"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { AccessCapabilities } from "@/schemas/auth/auth.schema"

import { AccessUsersView } from "./access-users-view"
import { AccessRolesView } from "./access-roles-view"

/**
 * Administração › Usuários e acessos (V1.5.7). Três conceitos separados: ACESSOS (pessoas identificadas × situação do login ×
 * papéis × escopo — habilitar, senha temporária, desabilitar), PESSOAS (cadastro
 * organizacional: cargo, nível hierárquico, grupo — não concede acesso) e PAPÉIS (pacotes de permissões). Cada aba aparece só
 * com a capability correspondente; o backend autoriza cada chamada.
 */
export function UsersAndAccessPage({ capabilities }: { capabilities: AccessCapabilities }) {
  const tabs = [
    capabilities.canViewUsers ? { value: "access", label: "Acessos", icon: KeyRound } : null,
    capabilities.canManagePeople ? { value: "people", label: "Pessoas", icon: UsersRound } : null,
    capabilities.canViewRoles ? { value: "roles", label: "Papéis", icon: ShieldCheck } : null,
  ].filter((tab) => tab !== null)
  if (tabs.length === 0) return <p className="text-sm text-muted-foreground">Você não tem permissão para ver usuários, pessoas ou papéis.</p>
  return (
    <Card>
      <CardHeader>
        <CardTitle>Usuários e acessos</CardTitle>
        <CardDescription>Cargo e nível hierárquico vêm da estrutura organizacional e não dão acesso. Acesso ao INIA = papel atribuído a uma conta, com escopo.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue={tabs[0]!.value} className="space-y-4">
          <TabsList>
            {tabs.map((tab) => <TabsTrigger key={tab.value} value={tab.value} className="gap-1"><tab.icon className="size-4" aria-hidden />{tab.label}</TabsTrigger>)}
          </TabsList>
          {capabilities.canViewUsers ? <TabsContent value="access"><AccessUsersView canManageUsers={capabilities.canManageUsers} canAssignRoles={capabilities.canAssignRoles} /></TabsContent> : null}
          {capabilities.canManagePeople ? <TabsContent value="people"><UsersPage /></TabsContent> : null}
          {capabilities.canViewRoles ? <TabsContent value="roles"><AccessRolesView /></TabsContent> : null}
        </Tabs>
      </CardContent>
    </Card>
  )
}
