/**
 * Health check da INTERFACE para a web farm do IIS/ARR (deploy/windows/iis): responde sem sessão, sem chamar a API e sem
 * renderizar página — só diz que este processo `next start` está atendendo. Nunca em cache.
 */
export const dynamic = "force-dynamic"

export function GET() {
  return Response.json({ status: "ok", service: "inia-interface" }, { headers: { "Cache-Control": "no-store" } })
}
