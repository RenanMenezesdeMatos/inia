/**
 * Modelos que o laboratório oferece. O da mentora (`inia-mentora.glb`) ainda está sendo produzido:
 * é o padrão QUANDO existe (HEAD na URL pública), senão cai no POC.
 */

export const MENTORA_MODEL_URL = "/models/inia-mentora.glb"
export const POC_MODEL_URL = "/models/inia-avatar-poc.glb"
/**
 * Evolução visual da Mentora (pele com detalhe, cachos em fita, osso de balanço do cabelo), gerada por
 * `tools/avatar/inia-realista-v02/build.sh`. Só o laboratório a oferece — o produto continua na Mentora.
 */
export const MENTORA_V02_MODEL_URL = "/models/inia-mentora-v02.glb"

export const LAB_MODEL_URLS = [
  { url: MENTORA_MODEL_URL, label: "Mentora (inia-mentora.glb)" },
  { url: MENTORA_V02_MODEL_URL, label: "Mentora v02 — em avaliação (inia-mentora-v02.glb)" },
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

/** Atalhos de `?model=` na URL do laboratório (comparações reproduzíveis: mesma página, só o modelo muda). */
export const LAB_MODEL_SHORTCUTS: Readonly<Record<string, LabModelUrl>> = { mentora: MENTORA_MODEL_URL, v02: MENTORA_V02_MODEL_URL, poc: POC_MODEL_URL }

/** Perfil de movimento no laboratório: "auto" = o que o GLB pede (como no produto). */
export const LAB_MOTION_PROFILES = [
  { value: "auto", label: "Automático (o que o modelo pede)" },
  { value: "classic", label: "Clássico (Mentora original)" },
  { value: "natural", label: "Natural (v02: movimento secundário)" },
] as const

export type LabMotionProfile = (typeof LAB_MOTION_PROFILES)[number]["value"]

export function parseLabQuery(search: string): { modelUrl: LabModelUrl | null; motion: LabMotionProfile | null; view: string | null } {
  const params = new URLSearchParams(search)
  const motion = params.get("motion")
  return {
    modelUrl: LAB_MODEL_SHORTCUTS[params.get("model") ?? ""] ?? null,
    motion: LAB_MOTION_PROFILES.some((option) => option.value === motion) ? (motion as LabMotionProfile) : null,
    view: params.get("view"),
  }
}

export async function resolveDefaultModelUrl(fetchImpl?: typeof fetch): Promise<LabModelUrl> {
  return (await modelExists(MENTORA_MODEL_URL, fetchImpl)) ? MENTORA_MODEL_URL : POC_MODEL_URL
}
