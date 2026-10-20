"use client"

import { useState } from "react"
import { KeyRound, ShieldCheck, UsersRound } from "lucide-react"

import { UsersPage } from "@/components/admin/users/users-page"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { AccessCapabilities } from "@/schemas/auth/auth.schema"

import { AccessUsersView, type AccessFocus } from "./access-users-view"
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
  const [tab, setTab] = useState<string | null>(null)
  // Pessoas → Acessos já na pessoa (ex.: matrícula que já existe no "Novo usuário"); a chave remonta a lista com o foco novo.
  const [accessFocus, setAccessFocus] = useState<(AccessFocus & { key: number }) | null>(null)
  if (tabs.length === 0) return <p className="text-sm text-muted-foreground">Você não tem permissão para ver usuários, pessoas ou papéis.</p>
  const openAccess = capabilities.canViewUsers
    ? (focus: AccessFocus) => {
        setAccessFocus({ ...focus, key: (accessFocus?.key ?? 0) + 1 })
        setTab("access")
      }
    : undefined
  return (
    <Card>
      <CardHeader>
        <CardTitle>Usuários e acessos</CardTitle>
        <CardDescription>Cargo e nível hierárquico vêm da estrutura organizacional e não dão acesso. Acesso ao INIA = papel atribuído a uma conta, com escopo.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={tab ?? tabs[0]!.value} onValueChange={setTab} className="space-y-4">
          <TabsList>
            {tabs.map((tab) => <TabsTrigger key={tab.value} value={tab.value} className="gap-1"><tab.icon className="size-4" aria-hidden />{tab.label}</TabsTrigger>)}
          </TabsList>
          {capabilities.canViewUsers ? <TabsContent value="access"><AccessUsersView key={accessFocus?.key ?? 0} canManageUsers={capabilities.canManageUsers} canAssignRoles={capabilities.canAssignRoles} focus={accessFocus} /></TabsContent> : null}
          {capabilities.canManagePeople ? <TabsContent value="people"><UsersPage canViewAccess={capabilities.canViewUsers} canAssignRoles={capabilities.canAssignRoles} canManageAccess={capabilities.canManageUsers} canExportSubjectData={capabilities.canExportSubjectData} onOpenAccess={openAccess} /></TabsContent> : null}
          {capabilities.canViewRoles ? <TabsContent value="roles"><AccessRolesView /></TabsContent> : null}
        </Tabs>
      </CardContent>
    </Card>
  )
}
