import { ApiError, apiGet } from "@/lib/api/api-client"
import { myProfileSchema, type CoverPreset, type MyProfile } from "@/schemas/profile/my-profile.schema"

const API_URL = process.env.INIA_API_URL ?? process.env.NEXT_PUBLIC_INIA_API_URL ?? "http://localhost:3333"

/** Preferências da PRÓPRIA pessoa da sessão — não existe leitura/edição por id de outra pessoa. */
export async function fetchMyProfile(): Promise<MyProfile> {
  return myProfileSchema.parse(await apiGet("/api/v1/me/profile"))
}

export type ProfileUpdateInput = {
  /** `undefined` = mantém; string vazia = volta ao nome cadastral. */
  preferredName?: string
  avatar: { action: "keep" } | { action: "remove" } | { action: "replace"; file: Blob }
  cover: { action: "keep" } | { action: "default" } | { action: "preset"; preset: CoverPreset } | { action: "custom"; file: Blob }
}

/** Um único envio (multipart) — o backend grava nome, foto e capa numa transação; nada fica pela metade. */
export async function updateMyProfile(input: ProfileUpdateInput): Promise<MyProfile> {
  const form = new FormData()
  if (input.preferredName !== undefined) form.set("preferredName", input.preferredName)
  form.set("avatar", input.avatar.action)
  form.set("cover", input.cover.action)
  if (input.cover.action === "preset") form.set("coverPreset", input.cover.preset)
  // Os arquivos vão DEPOIS dos campos de texto: o multer lê o corpo em ordem.
  if (input.avatar.action === "replace") form.append("avatar", input.avatar.file, "avatar.webp")
  if (input.cover.action === "custom") form.append("cover", input.cover.file, "cover.webp")
  const response = await fetch(`${API_URL}/api/v1/me/profile`, { method: "PUT", credentials: "include", cache: "no-store", body: form })
  if (!response.ok) {
    type ErrorPayload = { error?: { message?: string; code?: string; details?: unknown } }
    const payload = (await response.json().catch(() => null)) as ErrorPayload | null
    throw new ApiError(payload?.error?.message ?? `Erro ${response.status}`, response.status, payload?.error?.code ?? null, payload?.error?.details)
  }
  return myProfileSchema.parse(((await response.json()) as { data: unknown }).data)
}
