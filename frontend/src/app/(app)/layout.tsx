import type { ReactNode } from "react"

import { AuthenticatedAppShell } from "@/components/layout/authenticated-app-shell"

type AppLayoutProps = {
  children: ReactNode
}

export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <AuthenticatedAppShell>
      {children}
    </AuthenticatedAppShell>
  )
}