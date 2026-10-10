"use client"

import { useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"

import { editProfileHref, type ProfileEditorSection } from "./edit-profile-route"

export { EDIT_PROFILE_PATH, editProfileHref, sectionFromParam, type ProfileEditorSection } from "./edit-profile-route"

/**
 * "Editar perfil" em qualquer lugar (menu pessoal, botão do perfil, câmera da foto, "Alterar capa") abre a MESMA página,
 * posicionada na seção pedida.
 */
export function useProfileEditor() {
  const router = useRouter()
  const open = useCallback((section: ProfileEditorSection = "name") => router.push(editProfileHref(section)), [router])
  return useMemo(() => ({ open }), [open])
}
