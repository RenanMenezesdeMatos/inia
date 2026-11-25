/**
 * O resultado do termo anterior fica na tela (esmaecido) enquanto o novo chega; trocar de tipo, Grupo, universo ou tela recomeça vazio,
 * para nunca oferecer opção de outro recorte. `key` é a última parte da chave da consulta.
 */
export function keepSameList<K extends { search?: string | undefined }>(key: K) {
  return <D>(previous: D | undefined, previousQuery: { queryKey: readonly unknown[] } | undefined): D | undefined => {
    const before = previousQuery?.queryKey.at(-1) as K | undefined
    return before && JSON.stringify({ ...before, search: null }) === JSON.stringify({ ...key, search: null }) ? previous : undefined
  }
}
