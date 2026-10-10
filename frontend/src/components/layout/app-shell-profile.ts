/** Quem está AUTENTICADO, como o cabeçalho global mostra (nunca o perfil que está sendo visitado). */
export type AppShellProfile = {
  /** Nome de exibição: o escolhido pela pessoa; senão o cadastral. */
  name: string
  /** Cargo (ou nível) — informação profissional, secundária. */
  role: string
  avatarSrc?: string
  /** Nome cadastral, mostrado no menu quando difere do escolhido. */
  registeredName?: string
}
