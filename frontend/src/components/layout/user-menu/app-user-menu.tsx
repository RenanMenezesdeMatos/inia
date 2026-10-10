"use client"

import { useState } from "react"
import Link from "next/link"
import { useTheme } from "next-themes"
import { Accessibility, ChevronDown, LogOut, Palette, PencilLine, UserRound } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { AccessibilityMenu } from "@/components/layout/user-menu/accessibility-menu"
import type { AppShellProfile } from "@/components/layout/app-shell-profile"
import { profileImageSrc } from "@/lib/profile/profile-image-src"
import { initialsOf } from "@/schemas/profile/my-profile.schema"

type AppUserMenuProps = {
  profile: AppShellProfile
  profileHref?: string
  onSignOut?: () => void
  /** Abre o editor do PRÓPRIO perfil. Ausente = ação não oferecida. */
  onEditProfile?: () => void
}

/** Identificação de quem está logado + menu pessoal (sempre a pessoa autenticada, nunca o perfil visitado). */
export function AppUserMenu({ profile, profileHref, onSignOut, onEditProfile }: AppUserMenuProps) {
  const [accessibilityOpen, setAccessibilityOpen] = useState(false)
  const { theme, setTheme } = useTheme()
  const avatarSrc = profileImageSrc(profile.avatarSrc)
  const showsRegistered = profile.registeredName && profile.registeredName !== profile.name

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-10 min-w-0 gap-2 rounded-full py-1 pl-1 pr-1.5 text-topbar-foreground hover:bg-topbar-foreground/10 hover:text-topbar-foreground focus-visible:ring-topbar-foreground/60 aria-expanded:bg-topbar-foreground/10 dark:hover:bg-topbar-foreground/10 sm:pr-2.5" aria-label={`Menu de ${profile.name}`}>
            <Avatar className="size-8 ring-2 ring-topbar-foreground/40">
              {avatarSrc ? <AvatarImage src={avatarSrc} alt="" className="object-cover" /> : null}
              <AvatarFallback className="bg-topbar-foreground text-xs font-semibold text-topbar">{initialsOf(profile.name)}</AvatarFallback>
            </Avatar>
            <span className="hidden max-w-[11rem] truncate text-sm font-semibold md:inline">{profile.name}</span>
            <ChevronDown className="hidden size-4 text-topbar-foreground/75 sm:block" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={8} className="w-72">
          <DropdownMenuLabel className="flex items-center gap-3 py-2 font-normal">
            <Avatar className="size-10">
              {avatarSrc ? <AvatarImage src={avatarSrc} alt="" className="object-cover" /> : null}
              <AvatarFallback className="bg-primary text-sm font-semibold text-primary-foreground">{initialsOf(profile.name)}</AvatarFallback>
            </Avatar>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold text-foreground" title={profile.name}>{profile.name}</span>
              <span className="truncate text-xs text-muted-foreground" title={profile.role}>{profile.role}</span>
              {showsRegistered ? <span className="truncate text-xs text-muted-foreground" title={profile.registeredName}>Cadastro: {profile.registeredName}</span> : null}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {profileHref ? (
              <DropdownMenuItem asChild>
                <Link href={profileHref}><UserRound aria-hidden /> Meu perfil</Link>
              </DropdownMenuItem>
            ) : null}
            {onEditProfile ? <DropdownMenuItem onSelect={() => onEditProfile()}><PencilLine aria-hidden /> Editar perfil</DropdownMenuItem> : null}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><Palette aria-hidden /> Aparência</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
                  <DropdownMenuRadioItem value="light">Claro</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark">Escuro</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="system">Automático</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={() => setAccessibilityOpen(true)}><Accessibility aria-hidden /> Acessibilidade</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => onSignOut?.()}><LogOut aria-hidden /> Sair</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AccessibilityMenu open={accessibilityOpen} onOpenChange={setAccessibilityOpen} />
    </>
  )
}
