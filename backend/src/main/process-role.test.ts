import { describe, expect, it } from "vitest"
import { componentsOf, resolveProcessRole } from "./process-role.js"

describe("papel do processo", () => {
  it("linha de comando > ambiente > `all` (padrão = comportamento de sempre)", () => {
    expect(resolveProcessRole([], undefined)).toBe("all")
    expect(resolveProcessRole([], "worker")).toBe("worker")
    expect(resolveProcessRole(["--role=api"], "worker")).toBe("api")
    expect(resolveProcessRole(["--inspect", "--role", "Worker"], "all")).toBe("worker")
    expect(() => resolveProcessRole(["--role=tudo"])).toThrow(/Papel de processo inválido/)
    expect(() => resolveProcessRole(["--role"])).toThrow(/Papel de processo inválido/)
  })

  it("o que cada papel liga: `api` nunca roda o motor nem as tarefas; `worker` nunca abre a API (só o /health)", () => {
    expect(componentsOf("all")).toEqual({ http: true, processing: true, workerHealth: false })
    expect(componentsOf("api")).toEqual({ http: true, processing: false, workerHealth: false })
    expect(componentsOf("worker")).toEqual({ http: false, processing: true, workerHealth: true })
  })
})
