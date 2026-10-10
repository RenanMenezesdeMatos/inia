import bcrypt from "bcryptjs"

const SALT_ROUNDS = 10

export async function hashPassword(plainPassword: string) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS)
}

export async function verifyPassword(plainPassword: string, passwordHash: string) {
  return bcrypt.compare(plainPassword, passwordHash)
}
