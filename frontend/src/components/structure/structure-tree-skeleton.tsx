import { Skeleton } from "@/components/ui/skeleton"

/**
 * Organograma carregando. Arquivo próprio (sem React Flow): o perfil o usa enquanto o código da aba Estrutura chega sob demanda
 * (ver profile/profile-tab-views.tsx), e a própria aba enquanto a consulta da estrutura responde — o mesmo desenho nos dois.
 */
export function StructureTreeSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="space-y-2 px-1">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="flex h-[32rem] flex-col items-center gap-6 rounded-2xl bg-muted/50 p-6 sm:h-[36rem]">
        <Skeleton className="h-16 w-72 rounded-xl" />
        <Skeleton className="h-52 w-[25rem] max-w-full rounded-xl" />
        <div className="flex gap-3">
          <Skeleton className="h-20 w-64 rounded-xl" />
          <Skeleton className="h-20 w-64 rounded-xl" />
          <Skeleton className="h-20 w-64 rounded-xl" />
        </div>
      </div>
    </div>
  )
}
