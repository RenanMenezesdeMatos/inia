/**
 * Nome comparável de uma pessoa: sem espaços nas pontas nem repetidos, minúsculo e sem acento ("  Ána  SOUZA" → "ana souza").
 * Serve só para AVISAR de um possível cadastro duplicado (carga de Colaboradores × cadastro manual) — nunca para juntar duas
 * pessoas: duas "Ana Souza" são duas pessoas até alguém confirmar o contrário.
 */
export function normalizePersonName(name: string): string {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim()
}
