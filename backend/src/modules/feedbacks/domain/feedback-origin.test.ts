import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { DISPLAY_ICON_KEYS } from "../../../shared/domain/display-icon.js"
import { humanizeFlagName, resolveFeedbackOrigin } from "./feedback-origin.js"

describe("motivo do feedback no Acompanhamento", () => {
  it("monitoria por flag: nome e ícone configurados pelo administrador", () => {
    expect(
      resolveFeedbackOrigin({ family: "MONITORING", trigger: { kind: "FLAG", flagName: "rechamada", flagLabel: "Rechamada", flagIconKey: "phone-incoming", flagValueType: "BOOLEAN" }, indicator: null }),
    ).toEqual({ family: "MONITORING", reason: "FLAG", label: "Rechamada", iconKey: "phone-incoming" })
  })

  it("flag sem configuração: nome técnico legível e ícone pelo tipo de valor; ícone fora do catálogo é ignorado", () => {
    expect(resolveFeedbackOrigin({ family: "MONITORING", trigger: { kind: "FLAG", flagName: "nota_ura", flagLabel: null, flagIconKey: null, flagValueType: "NUMERIC" }, indicator: null })).toMatchObject({
      label: "Nota ura",
      iconKey: "gauge",
    })
    expect(resolveFeedbackOrigin({ family: "MONITORING", trigger: { kind: "FLAG", flagName: "transferencia", flagLabel: "  ", flagIconKey: "rocket-ship", flagValueType: "BOOLEAN" }, indicator: null })).toMatchObject({
      label: "Transferencia",
      iconKey: "flag",
    })
  })

  it("monitoria de rotina, avulsa e sem Workflow conhecido têm motivos e ícones distintos", () => {
    expect(resolveFeedbackOrigin({ family: "MONITORING", trigger: { kind: "SCHEDULE" }, indicator: null })).toEqual({ family: "MONITORING", reason: "SCHEDULE", label: "Rotina", iconKey: "calendar-check" })
    expect(resolveFeedbackOrigin({ family: "MONITORING", trigger: { kind: "MANUAL" }, indicator: null })).toEqual({ family: "MONITORING", reason: "MANUAL", label: "Avulsa", iconKey: "clipboard-check" })
    expect(resolveFeedbackOrigin({ family: "MONITORING", trigger: null, indicator: null })).toEqual({ family: "MONITORING", reason: "UNKNOWN", label: null, iconKey: "headset" })
  })

  it("indicador: ícone configurado, senão pela UNIDADE (nunca pelo código); o título já é o nome do indicador", () => {
    expect(resolveFeedbackOrigin({ family: "INDICATOR", trigger: { kind: "MANUAL" }, indicator: { unit: "SECONDS", iconKey: null } })).toEqual({ family: "INDICATOR", reason: "INDICATOR", label: null, iconKey: "timer" })
    expect(resolveFeedbackOrigin({ family: "INDICATOR", trigger: null, indicator: { unit: "PERCENT", iconKey: "repeat" } })).toMatchObject({ iconKey: "repeat" })
    expect(resolveFeedbackOrigin({ family: "INDICATOR", trigger: null, indicator: { unit: "STARS", iconKey: null } })).toMatchObject({ iconKey: "star" })
    expect(resolveFeedbackOrigin({ family: "INDICATOR", trigger: null, indicator: null })).toEqual({ family: "INDICATOR", reason: "UNKNOWN", label: null, iconKey: "chart-line" })
  })

  it("nome técnico legível", () => {
    expect(humanizeFlagName("tempo_silencio")).toBe("Tempo silencio")
    expect(humanizeFlagName("detrator")).toBe("Detrator")
  })

  it("catálogo de ícones igual no backend e no frontend", () => {
    const frontend = readFileSync(new URL("../../../../../frontend/src/lib/display-icons.tsx", import.meta.url), "utf8")
    const keys = [...frontend.matchAll(/^\s+"([a-z][a-z0-9-]+)": \{ icon:/gm)].map((match) => match[1])
    expect(keys).toEqual([...DISPLAY_ICON_KEYS])
  })
})
