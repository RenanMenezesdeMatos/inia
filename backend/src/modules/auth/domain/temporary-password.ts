import { randomInt } from "node:crypto"

/**
 * SENHA TEMPORÁRIA — gerada pelo servidor (nunca escolhida por quem administra) com gerador criptográfico, mostrada UMA vez
 * ao administrador e guardada só como hash. Alfabeto sem caracteres ambíguos (0/O, 1/l/I) porque ela é ditada ou copiada
 * à mão; 12 símbolos de 56 ≈ 69 bits, em três blocos para facilitar a leitura ("Kq7m-Pz4x-Wn9r").
 */
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
const LOWER = "abcdefghijkmnpqrstuvwxyz"
const DIGITS = "23456789"
const ALPHABET = `${UPPER}${LOWER}${DIGITS}`
const GROUPS = 3
const GROUP_LENGTH = 4

export function generateTemporaryPassword(random: (max: number) => number = randomInt): string {
  for (;;) {
    const symbols = Array.from({ length: GROUPS * GROUP_LENGTH }, () => ALPHABET[random(ALPHABET.length)]!)
    const text = symbols.join("")
    // Sempre com maiúscula, minúscula e número: a senha temporária também passa em qualquer política de composição.
    if (![UPPER, LOWER, DIGITS].every((set) => [...text].some((symbol) => set.includes(symbol)))) continue
    return Array.from({ length: GROUPS }, (_, index) => text.slice(index * GROUP_LENGTH, (index + 1) * GROUP_LENGTH)).join("-")
  }
}

export function temporaryPasswordExpiry(issuedAt: Date, ttlHours: number): Date {
  return new Date(issuedAt.getTime() + ttlHours * 3_600_000)
}
