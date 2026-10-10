import { apiGet } from "@/lib/api/api-client"
import { adminGet, adminSend, adminUpload } from "@/lib/admin/admin-api"
import { currentIniaSceneStateSchema, iniaScenesOverviewSchema, type CurrentIniaSceneState, type IniaScenesOverview } from "@/schemas/inia-scenes/inia-scene.schema"

const API_URL = process.env.INIA_API_URL ?? process.env.NEXT_PUBLIC_INIA_API_URL ?? "http://localhost:3333"

/** URL da imagem servida pela API (o backend devolve o caminho `/api/...`). */
export const sceneImageSrc = (url: string) => (url.startsWith("/api/") ? `${API_URL}${url}` : url)

/** Qualquer pessoa autenticada: o que vale AGORA na organização dela (cenário + imagem do horário) e quando isso muda. */
export async function fetchCurrentIniaScene(): Promise<CurrentIniaSceneState> {
  return currentIniaSceneStateSchema.parse(await apiGet("/api/v1/inia-scenes/current"))
}

// --- Administração (só o Administrador geral; o backend é a autoridade) ---------------------------------------------------

export async function fetchIniaScenesOverview(): Promise<IniaScenesOverview> {
  return iniaScenesOverviewSchema.parse(await adminGet("/api/v1/admin/inia-scenes"))
}

export type IniaScenePeriodInput = { start: string; end: string } | null
/**
 * Uma imagem do conjunto que vai ser salvo. `id` = imagem que já existe no cenário (sem `file` = mantém o arquivo; com `file`
 * = substitui); sem `id` = imagem nova (exige `file`). Faixa "HH:MM" opcional, no fuso da organização.
 */
export type IniaSceneImageInput = { id?: string | undefined; label: string; start: string | null; end: string | null; primary: boolean; file?: File | undefined }
export type IniaSceneInput = { name: string; period: IniaScenePeriodInput; blur: number; dim: number; images: IniaSceneImageInput[] }

/** Campos de texto + manifesto `images` + arquivos `file-N`. O conjunto inteiro vai numa requisição só (salvo numa transação). */
function sceneForm(input: IniaSceneInput, schedule?: "set" | "clear"): FormData {
  const form = new FormData()
  form.set("name", input.name)
  form.set("blur", String(input.blur))
  form.set("dim", String(input.dim))
  if (schedule) form.set("schedule", schedule)
  if (input.period) {
    form.set("scheduleStart", input.period.start)
    form.set("scheduleEnd", input.period.end)
  }
  const files: Array<[string, File]> = []
  const manifest = input.images.map((image) => {
    const field = image.file ? `file-${files.length}` : undefined
    if (image.file && field) files.push([field, image.file])
    return { ...(image.id ? { id: image.id } : {}), ...(field ? { file: field } : {}), label: image.label, start: image.start, end: image.end, primary: image.primary }
  })
  form.set("images", JSON.stringify(manifest))
  // Os arquivos vão DEPOIS dos campos de texto: o multer lê o corpo em ordem.
  for (const [field, file] of files) form.append(field, file, file.name)
  return form
}

export async function createIniaScene(input: IniaSceneInput): Promise<void> {
  await adminUpload("/api/v1/admin/inia-scenes", sceneForm(input))
}

/** `period: null` = tira o agendamento. As imagens que não vierem no conjunto são removidas. */
export async function updateIniaScene(input: IniaSceneInput & { id: string }): Promise<void> {
  await adminUpload(`/api/v1/admin/inia-scenes/${input.id}`, sceneForm(input, input.period ? "set" : "clear"), "PATCH")
}

export async function deleteIniaScene(id: string): Promise<void> {
  await adminSend(`/api/v1/admin/inia-scenes/${id}`, "DELETE")
}

export async function setDefaultIniaScene(sceneId: string | null): Promise<void> {
  await adminSend("/api/v1/admin/inia-scenes/default", "PUT", { sceneId })
}
