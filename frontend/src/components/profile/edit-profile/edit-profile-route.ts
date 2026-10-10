/** Rota ÚNICA de edição do PRÓPRIO perfil (sem id: a API edita só a pessoa da sessão). Módulo comum a servidor e cliente. */
export type ProfileEditorSection = "photo" | "name" | "cover"

export const EDIT_PROFILE_PATH = "/perfil/editar"
const SECTION_PARAM: Record<ProfileEditorSection, string> = { photo: "foto", name: "nome", cover: "capa" }

export function editProfileHref(section: ProfileEditorSection = "name"): string {
  return section === "name" ? EDIT_PROFILE_PATH : `${EDIT_PROFILE_PATH}?secao=${SECTION_PARAM[section]}`
}

export function sectionFromParam(value: string | null | undefined): ProfileEditorSection {
  if (value === "foto") return "photo"
  if (value === "capa") return "cover"
  return "name"
}
