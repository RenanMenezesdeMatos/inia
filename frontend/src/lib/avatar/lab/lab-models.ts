/**
 * Modelos que o laboratório oferece. O da mentora (`inia-mentora.glb`) ainda está sendo produzido:
 * é o padrão QUANDO existe (HEAD na URL pública), senão cai no POC.
 */

export const MENTORA_MODEL_URL = "/models/inia-mentora.glb"
export const POC_MODEL_URL = "/models/inia-avatar-poc.glb"

export const LAB_MODEL_URLS = [
  { url: MENTORA_MODEL_URL, label: "Mentora (inia-mentora.glb)" },
  { url: POC_MODEL_URL, label: "POC (inia-avatar-poc.glb)" },
] as const

export type LabModelUrl = (typeof LAB_MODEL_URLS)[number]["url"]

/** `true` se o GLB responde 2xx a um HEAD; rede/404 = `false` (nunca lança). */
export async function modelExists(url: string, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): Promise<boolean> {
  try {
    const response = await fetchImpl(url, { method: "HEAD", cache: "no-store" })
    // Um GLB nunca é text/html: uma página de erro servida com 200 não conta como modelo.
    return response.ok && !(response.headers.get("content-type") ?? "").includes("text/html")
  } catch {
    return false
  }
}

export async function resolveDefaultModelUrl(fetchImpl?: typeof fetch): Promise<LabModelUrl> {
  return (await modelExists(MENTORA_MODEL_URL, fetchImpl)) ? MENTORA_MODEL_URL : POC_MODEL_URL
}
