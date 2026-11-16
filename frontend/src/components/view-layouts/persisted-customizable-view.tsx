"use client"

import { CustomizableView } from "@/components/ui/customizable-grid/customizable-view"
import type { GridSection } from "@/components/ui/customizable-grid/layout"
import { useViewLayout } from "@/queries/view-layouts/use-view-layout"
import type { ViewLayoutKey } from "@/schemas/view-layouts/view-layout.schema"

/**
 * A visão personalizável ligada à disposição salva da pessoa no servidor (migration 192). Enquanto a disposição não chega — ou se a
 * leitura falhar —, a tela mostra o padrão do catálogo: nunca fica em branco por causa da preferência.
 */
export function PersistedCustomizableView({ viewKey, catalog, label }: { viewKey: ViewLayoutKey; catalog: readonly GridSection[]; label: string }) {
  const { query, save, reset } = useViewLayout(viewKey)
  return <CustomizableView catalog={catalog} saved={query.data?.layout ?? null} onSave={(layout) => save.mutateAsync(layout)} onReset={() => reset.mutateAsync()} label={label} />
}
