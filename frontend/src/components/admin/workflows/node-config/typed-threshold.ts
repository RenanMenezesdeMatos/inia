import type { TypedFieldKind, TypedValue } from "../typed-value-field"

/** Extrai um valor tipado (boolean|number|string) dos campos threshold* do config — mesma
 * "union" que Condition já usa há tempos, só nomeada pra reaproveitar TypedValueInput. */
export function currentTypedValue(config: { thresholdBoolean?: boolean | null; thresholdNumeric?: number | null; thresholdText?: string }): TypedValue | undefined {
  if (config.thresholdBoolean !== undefined && config.thresholdBoolean !== null) return config.thresholdBoolean
  if (config.thresholdNumeric !== undefined && config.thresholdNumeric !== null) return config.thresholdNumeric
  if (config.thresholdText !== undefined) return config.thresholdText
  return undefined
}

/** Grava um valor tipado no lugar certo (thresholdBoolean/thresholdNumeric/thresholdText),
 * sempre limpando os outros dois — nunca deixa mais de um "tipo" de valor setado ao mesmo tempo. */
export function applyTypedValue<T extends { thresholdBoolean?: boolean | null; thresholdNumeric?: number | null; thresholdText?: string }>(
  config: T,
  fieldType: TypedFieldKind,
  value: TypedValue,
): T {
  if (fieldType === "BOOLEAN") return { ...config, thresholdBoolean: Boolean(value), thresholdNumeric: null, thresholdText: undefined }
  if (fieldType === "NUMBER") return { ...config, thresholdNumeric: Number(value), thresholdBoolean: null, thresholdText: undefined }
  return { ...config, thresholdText: String(value), thresholdBoolean: null, thresholdNumeric: null }
}
