import type { ComponentProps } from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { profileImageSrc } from "@/lib/profile/profile-image-src"
import { initialsOf } from "@/schemas/profile/my-profile.schema"

type PersonAvatarProps = Omit<ComponentProps<typeof Avatar>, "children"> & {
  /** Nome que a tela mostra ao lado — dele saem as iniciais. */
  name: string
  /** Foto que a API devolveu (já resolvida pela apresentação: personalizada > corporativa); null = iniciais. */
  avatarUrl: string | null | undefined
  /** Texto alternativo da foto; padrão = o nome. */
  alt?: string
  fallbackClassName?: string
}

/**
 * Foto de uma pessoa em qualquer tela: o Avatar do kit com a foto servida pela origem certa (`profileImageSrc` — a foto do
 * perfil vem da API, não do Next) e, sem foto ou se ela falhar, as iniciais do nome.
 */
export function PersonAvatar({ name, avatarUrl, alt = name, fallbackClassName, ...props }: PersonAvatarProps) {
  const src = profileImageSrc(avatarUrl)
  return (
    <Avatar {...props}>
      {src ? <AvatarImage src={src} alt={alt} /> : null}
      <AvatarFallback className={fallbackClassName}>{initialsOf(name)}</AvatarFallback>
    </Avatar>
  )
}
