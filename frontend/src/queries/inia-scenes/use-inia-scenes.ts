"use client"

import { useEffect } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { useAdminMutation } from "@/lib/admin/use-admin-mutation"
import type { CurrentIniaScene, CurrentIniaSceneState } from "@/schemas/inia-scenes/inia-scene.schema"
import { createIniaScene, deleteIniaScene, fetchCurrentIniaScene, fetchIniaScenesOverview, sceneImageSrc, setDefaultIniaScene, updateIniaScene } from "@/services/inia-scenes/inia-scene-service"

export const iniaSceneKeys = {
  current: ["inia-scene", "current"] as const,
  admin: ["admin", "inia-scenes"] as const,
}

/** Folga depois do instante da troca: quando a tela pergunta de novo, o servidor já resolve a imagem nova. */
const CHANGE_MARGIN_MS = 1_500
/** Sem troca próxima, relê ao voltar à aba depois de 5 min (o administrador pode ter trocado o cenário). */
const MAX_STALE_MS = 5 * 60_000
/** Timers longos estouram no navegador (> ~24 dias); com a página aberta, confere pelo menos a cada hora. */
const MAX_TIMER_MS = 60 * 60_000
const MIN_TIMER_MS = 1_000
/** A imagem seguinte é baixada pouco antes da troca (nunca todas as imagens de uma vez). */
const PRELOAD_LEAD_MS = 90_000

/**
 * Quanto falta (ms) para a próxima troca, pelo relógio do SERVIDOR: `nextChangeAt − now` da resposta, menos o tempo que passou
 * desde que ela chegou. Relógio local atrasado ou adiantado não muda nada. Sem troca prevista = null.
 */
export function msUntilSceneChange(state: CurrentIniaSceneState | undefined, fetchedAt: number, clientNow = Date.now()): number | null {
  if (!state?.nextChangeAt || !state.now) return null
  return Date.parse(state.nextChangeAt) - Date.parse(state.now) - (clientNow - fetchedAt)
}

/**
 * Velho = passou do instante da troca (ou 5 min, o que vier antes): voltar à aba ou à conexão relê só nesse caso. É contado a
 * partir de quando a resposta chegou (o React Query compara `dataUpdatedAt + staleTime` com agora).
 */
export function sceneStaleTime(state: CurrentIniaSceneState | undefined, fetchedAt: number): number {
  const untilAtFetch = msUntilSceneChange(state, fetchedAt, fetchedAt)
  if (untilAtFetch === null) return MAX_STALE_MS
  return Math.max(0, Math.min(MAX_STALE_MS, untilAtFetch + CHANGE_MARGIN_MS))
}

/** Com a página aberta, pergunta de novo logo depois da troca (relógio do servidor), no máximo a cada hora. */
export function sceneRefetchInterval(state: CurrentIniaSceneState | undefined, fetchedAt: number, clientNow = Date.now()): number | false {
  const until = msUntilSceneChange(state, fetchedAt, clientNow)
  if (until === null) return false
  return Math.max(MIN_TIMER_MS, Math.min(MAX_TIMER_MS, until + CHANGE_MARGIN_MS))
}

/**
 * O que a INIA tem atrás dela AGORA (cenário + imagem do horário, resolvidos no backend no fuso da organização). Troca sozinha
 * com a tela aberta: pede de novo no instante da próxima troca; ao voltar para a aba ou recuperar a conexão, relê se esse
 * instante já passou. A imagem seguinte é pré-carregada pouco antes, para a troca não piscar.
 */
export function useCurrentIniaScene(enabled = true): CurrentIniaScene | null {
  const query = useQuery({
    queryKey: iniaSceneKeys.current,
    queryFn: fetchCurrentIniaScene,
    enabled,
    retry: 1,
    staleTime: (current) => sceneStaleTime(current.state.data, current.state.dataUpdatedAt),
    refetchInterval: (current) => sceneRefetchInterval(current.state.data, current.state.dataUpdatedAt),
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
  const state = query.data
  const upcomingUrl = state?.upcoming?.imageUrl ?? null
  const fetchedAt = query.dataUpdatedAt
  useEffect(() => {
    if (!upcomingUrl) return
    const until = msUntilSceneChange(state, fetchedAt)
    if (until === null || until > MAX_TIMER_MS) return
    const timer = window.setTimeout(() => {
      const image = new Image()
      image.decoding = "async"
      image.src = sceneImageSrc(upcomingUrl)
    }, Math.max(0, until - PRELOAD_LEAD_MS))
    return () => window.clearTimeout(timer)
  }, [state, upcomingUrl, fetchedAt])
  return state?.scene ?? null
}

/** Administração: relê no instante da próxima troca (o "No ar agora" acompanha a troca de imagem/cenário com a tela aberta). */
export function useIniaScenesOverviewQuery() {
  return useQuery({
    queryKey: iniaSceneKeys.admin,
    queryFn: fetchIniaScenesOverview,
    refetchInterval: (current) => {
      const data = current.state.data
      return sceneRefetchInterval(data?.nextChange ? { scene: null, now: data.now, nextChangeAt: data.nextChange.at, upcoming: null } : undefined, current.state.dataUpdatedAt)
    },
  })
}

/** Toda escrita relê a lista da administração E o cenário atual (quem administra também vê o palco). */
function useSceneMutation<TVariables>(mutationFn: (variables: TVariables) => Promise<void>, successMessage: string, silentErrorCodes?: string[]) {
  const queryClient = useQueryClient()
  return useAdminMutation({
    mutationFn,
    invalidateKey: iniaSceneKeys.admin,
    successMessage,
    ...(silentErrorCodes ? { silentErrorCodes } : {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: iniaSceneKeys.current })
    },
  })
}

// Conflitos e imagem inválida aparecem no próprio formulário (sem toast duplicado).
const FORM_ERRORS = [
  "INIA_SCENE_PERIOD_OVERLAP", "INIA_SCENE_NAME_TAKEN", "INIA_SCENE_NAME_INVALID", "SCENE_PERIOD_INCOMPLETE", "SCENE_PERIOD_INVALID", "SCENE_PERIOD_INVERTED",
  "SCENE_IMAGE_EMPTY", "SCENE_IMAGE_TOO_LARGE", "SCENE_IMAGE_UNSUPPORTED_TYPE", "SCENE_IMAGE_UNREADABLE", "SCENE_IMAGE_TOO_SMALL", "SCENE_IMAGE_DIMENSIONS_TOO_LARGE", "SCENE_IMAGE_NOT_LANDSCAPE", "INIA_SCENE_IMAGE_REQUIRED",
  "INIA_SCENE_IMAGE_SLOT_OVERLAP", "INIA_SCENE_PRIMARY_IMAGE_REQUIRED", "INIA_SCENE_IMAGE_LABEL_INVALID", "INIA_SCENE_IMAGE_LABEL_TAKEN", "INIA_SCENE_IMAGES_COUNT", "INIA_SCENE_IMAGES_INVALID", "INIA_SCENE_IMAGES_CHANGED",
  "SCENE_SLOT_INCOMPLETE", "SCENE_SLOT_INVALID", "SCENE_SLOT_EMPTY", "INIA_SCENE_DIM_INVALID", "INIA_SCENE_BLUR_INVALID",
]

export const useCreateIniaSceneMutation = () => useSceneMutation(createIniaScene, "Cenário criado.", FORM_ERRORS)
export const useUpdateIniaSceneMutation = () => useSceneMutation(updateIniaScene, "Cenário atualizado.", FORM_ERRORS)
export const useDeleteIniaSceneMutation = () => useSceneMutation(deleteIniaScene, "Cenário excluído.")
export const useSetDefaultIniaSceneMutation = () => useSceneMutation(setDefaultIniaScene, "Cenário padrão atualizado.")
