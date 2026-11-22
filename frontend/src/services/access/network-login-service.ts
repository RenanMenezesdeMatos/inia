import { adminGet, adminSend } from "@/lib/admin/admin-api"
import { networkLoginStatusSchema, networkProbeResultSchema } from "@/schemas/access/network-login.schema"

const BASE = "/api/v1/admin/network-login"

export const fetchNetworkLoginStatus = async () => networkLoginStatusSchema.parse(await adminGet(BASE))
/** Conecta a cada servidor do AD por TLS (sem senha): responde? a cadeia confere? qual o tamanho da chave? */
export const probeNetworkLoginServers = async () => networkProbeResultSchema.parse(await adminSend(`${BASE}/probe`, "POST"))
/** Liga/desliga o login pela rede da organização (o backend recusa ligar sem AD, sem HTTPS ou sem conta de emergência). */
export const setNetworkLoginEnabled = async (enabled: boolean) => networkLoginStatusSchema.parse(await adminSend(BASE, "PUT", { enabled }))
