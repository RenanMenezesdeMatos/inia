/**
 * Parâmetros posicionais ($1, $2…) para compor SQL a partir de FRAGMENTOS de módulos diferentes sem colidir numeração: cada
 * fragmento recebe o mesmo acumulador e pede um marcador por valor. Nunca interpola valor no texto.
 */
export class SqlParams {
  readonly values: unknown[] = []

  constructor(initial: readonly unknown[] = []) {
    this.values.push(...initial)
  }

  add(value: unknown): string {
    this.values.push(value)
    return `$${this.values.length}`
  }

  /** Marcador tipado (ex.: `::uuid[]`, `::timestamptz`). */
  typed(value: unknown, type: string): string {
    return `${this.add(value)}::${type}`
  }
}
