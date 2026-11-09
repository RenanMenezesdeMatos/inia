"use client"

import { useCallback, useEffect, useState } from "react"

import type { ConfigAccess } from "@/schemas/admin/data-hub.schema"

/** O que obriga o formulário a reler o servidor: a fonte mudou, ou a liberação mudou e, com ela, os valores ocultos de API Pull. */
export const formRevision = (entity: { updatedAt: string; configAccess?: ConfigAccess | null }): string => `${entity.updatedAt}:${entity.configAccess?.unlocked ?? false}`

/**
 * `key` de um formulário que nasce do que o servidor mandou. A página se atualiza sozinha, e remontar leva junto o que a pessoa
 * preencheu e o pedido de senha aberto. Enquanto o formulário estiver em uso, a chave espera.
 */
export function useHeldFormKey(revision: string) {
  const [key, setKey] = useState(revision)
  const [held, hold] = useState(false)
  if (!held && key !== revision) setKey(revision)
  return { key, hold }
}

/**
 * O lado do formulário: em uso é ter algo diferente do que nasceu ou uma ação em andamento (`active`). A função devolvida diz que o que
 * está na tela foi salvo, e assim a próxima revisão volta a valer.
 */
export function useFormInUse(hold: (inUse: boolean) => void, values: unknown, active: boolean): () => void {
  const text = JSON.stringify(values)
  const [seed, setSeed] = useState(text)
  const [saved, setSaved] = useState(false)
  if (saved) {
    setSaved(false)
    setSeed(text)
  }
  const inUse = text !== seed || active
  useEffect(() => hold(inUse), [hold, inUse])
  return useCallback(() => setSaved(true), [])
}
