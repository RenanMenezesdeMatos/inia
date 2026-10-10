const API_URL = process.env.NEXT_PUBLIC_INIA_API_URL ?? process.env.INIA_API_URL ?? "http://localhost:3333"

/**
 * Foto/capa servidas pela API (`/api/v1/profile-images/<id>`) precisam da origem da API; imagens corporativas antigas
 * (`/ANA_LIMA.png`, em `public/`) continuam relativas à interface.
 */
export function profileImageSrc(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  return url.startsWith("/api/") ? `${API_URL}${url}` : url
}
