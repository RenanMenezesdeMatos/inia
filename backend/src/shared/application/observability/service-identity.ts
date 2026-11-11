import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { env } from "../../../config/env.js"

/**
 * Identidade do processo nos registros: `service` (inia-api, inia-processamento, inia-api-processamento) e `release` (versão
 * implantada). Vai em toda linha de log, em toda ocorrência de erro e no "Copiar detalhes" da tela (via cabeçalho
 * `x-inia-release`) — o administrador sabe de qual versão veio cada falha.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
// src/shared/application/observability → raiz do backend (vale também para dist/…).
const backendRoot = path.resolve(here, "../../../..")

function readRelease(): string {
  if (env.INIA_RELEASE) return env.INIA_RELEASE
  for (const candidate of [path.join(backendRoot, "..", "RELEASE"), path.join(backendRoot, "RELEASE")]) {
    try {
      if (existsSync(candidate)) {
        const value = readFileSync(candidate, "utf8").trim()
        if (/^[A-Za-z0-9._+-]{1,64}$/.test(value)) return value
      }
    } catch {
      // Sem leitura: segue para o próximo candidato.
    }
  }
  try {
    const pkg = JSON.parse(readFileSync(path.join(backendRoot, "package.json"), "utf8")) as { version?: string }
    return pkg.version ?? "desconhecida"
  } catch {
    return "desconhecida"
  }
}

const release = readRelease()
let service = "inia-api"

export function serviceRelease(): string {
  return release
}

export function serviceName(): string {
  return service
}

/** Chamado na subida pelo server.ts, com o papel do processo, antes do primeiro log. */
export function configureServiceName(role: "all" | "api" | "worker"): void {
  service = role === "worker" ? "inia-processamento" : role === "api" ? "inia-api" : "inia-api-processamento"
}
