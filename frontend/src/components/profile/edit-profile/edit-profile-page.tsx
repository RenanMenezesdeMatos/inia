"use client"

import { useEffect, useId, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Camera, Check, ImagePlus, Loader2, RotateCcw, Trash2, TriangleAlert, Upload, UserRound } from "lucide-react"
import { toast } from "sonner"

import { CoverArt, CoverPresetArt, COVER_PRESET_LABELS } from "@/components/profile/cover-art"
import { ProfileHeader, type ProfileHeaderPerson } from "@/components/profile/profile-header"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { BackLink } from "@/components/ui/back-link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ErrorState, LoadingState } from "@/components/ui/states"
import { PageHeader } from "@/components/ui/surface"
import { ApiError } from "@/lib/api/api-client"
import { cn } from "@/lib/utils"
import { useMyProfileQuery, useUpdateMyProfileMutation } from "@/queries/profile/use-my-profile"
import { PROFILE_COVER_MIN, PROFILE_IMAGE_ACCEPT, PROFILE_PHOTO_MIN_SIDE, profileCoverFileSchema, profilePhotoFileSchema } from "@/schemas/profile/profile-cover.schema"
import { COVER_PRESETS, normalizePreferredName, PREFERRED_NAME_MAX_LENGTH, registeredFirstNameOf, type CoverPreset, type MyProfile } from "@/schemas/profile/my-profile.schema"
import type { ProfileUpdateInput } from "@/services/profile/profile-service"

import { AvatarCropper, loadImage, renderCover, renderCroppedAvatar, type CropState, type LoadedImage } from "./avatar-cropper"
import { clearLegacyLocalCover, readLegacyLocalCover, type LegacyLocalCover } from "./legacy-local-cover"
import type { ProfileEditorSection } from "./profile-editor-context"
import { useUnsavedChangesGuard } from "./use-unsaved-changes-guard"

type PhotoDraft = { kind: "keep" } | { kind: "remove" } | { kind: "new"; src: string; image: LoadedImage; crop: CropState }
type CoverDraft = { kind: "keep" } | { kind: "default" } | { kind: "preset"; preset: CoverPreset } | { kind: "custom"; src: string; image: LoadedImage }

type EditProfilePageProps = {
  initialProfile: MyProfile | null
  /** "Meu perfil" da pessoa AUTENTICADA — destino de "Voltar ao perfil", do Cancelar e do salvar. */
  profileHref: string
  initialSection: ProfileEditorSection
}

/**
 * "Editar perfil" em página própria (a pessoa da sessão, sempre): nome de tratamento, foto (com enquadramento na própria
 * página) e capa, com prévia que é o MESMO cabeçalho do perfil. Não é central de configurações — Aparência e
 * Acessibilidade continuam no menu pessoal.
 */
export function EditProfilePage({ initialProfile, profileHref, initialSection }: EditProfilePageProps) {
  const query = useMyProfileQuery(initialProfile)
  const profile = query.data ?? initialProfile
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-0 pt-4 sm:px-6 sm:pt-6 lg:px-8">
      {profile ? (
        <EditProfileForm profile={profile} profileHref={profileHref} initialSection={initialSection} />
      ) : query.isError ? (
        <ErrorState message="Não foi possível carregar seu perfil." onRetry={() => void query.refetch()} />
      ) : (
        <LoadingState label="Carregando perfil…" className="p-6" />
      )}
    </div>
  )
}

function useObjectUrls() {
  const urls = useRef<string[]>([])
  useEffect(() => () => urls.current.forEach((url) => URL.revokeObjectURL(url)), [])
  return (url: string) => {
    urls.current.push(url)
    return url
  }
}

/** Recorte ao vivo da foto para a prévia (pequeno, com espera curta para não recodificar a cada pixel arrastado). */
function useCroppedPreview(photo: PhotoDraft): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (photo.kind !== "new") return
    let current: string | null = null
    let cancelled = false
    const timer = window.setTimeout(() => {
      void renderCroppedAvatar(photo.image, photo.crop, 256).then((blob) => {
        if (cancelled) return
        current = URL.createObjectURL(blob)
        setUrl(current)
      })
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      if (current) URL.revokeObjectURL(current)
    }
  }, [photo])
  return photo.kind === "new" ? url : null
}

function EditProfileForm({ profile, profileHref, initialSection }: { profile: MyProfile; profileHref: string; initialSection: ProfileEditorSection }) {
  const ids = { name: useId(), nameHelp: useId(), nameError: useId(), photo: useId(), cover: useId() }
  const router = useRouter()
  const mutation = useUpdateMyProfileMutation()
  const track = useObjectUrls()
  // Rascunho parte do valor SALVO quando a página abre (o `profile` pode ser atualizado depois por outras telas).
  const [base] = useState(profile)
  const [nameInput, setNameInput] = useState(base.preferredName ?? "")
  const [photo, setPhoto] = useState<PhotoDraft>({ kind: "keep" })
  const [cover, setCover] = useState<CoverDraft>({ kind: "keep" })
  const [photoError, setPhotoError] = useState("")
  const [coverError, setCoverError] = useState("")
  const [saveError, setSaveError] = useState("")
  const [preparing, setPreparing] = useState(false)
  // Capa antiga salva só neste navegador (sem dono): oferecida à pessoa, nunca aplicada sozinha.
  const [legacy, setLegacy] = useState<LegacyLocalCover | null>(() => (base.cover.kind === "DEFAULT" && typeof window !== "undefined" ? readLegacyLocalCover() : null))
  const [legacyAccepted, setLegacyAccepted] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const photoSectionRef = useRef<HTMLElement>(null)
  const photoButtonRef = useRef<HTMLButtonElement>(null)
  const coverSectionRef = useRef<HTMLElement>(null)
  const coverGroupRef = useRef<HTMLDivElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)
  const croppedPreview = useCroppedPreview(photo)

  // Atalhos (câmera, "Alterar capa") chegam posicionados na seção, com o foco num controle dela.
  useEffect(() => {
    const section = initialSection === "photo" ? photoSectionRef.current : initialSection === "cover" ? coverSectionRef.current : null
    const target = initialSection === "photo" ? photoButtonRef.current : initialSection === "cover" ? coverGroupRef.current?.querySelector<HTMLElement>("[aria-pressed='true']") ?? coverGroupRef.current : nameRef.current
    section?.scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior })
    target?.focus({ preventScroll: section !== null })
  }, [initialSection])

  const normalizedName = normalizePreferredName(nameInput)
  const nameError = normalizedName.ok ? "" : normalizedName.message
  const nameChanged = normalizedName.ok && normalizedName.value !== base.preferredName
  const coverChanged = cover.kind !== "keep" && !(cover.kind === "preset" && base.cover.kind === "PRESET" && base.cover.preset === cover.preset) && !(cover.kind === "default" && base.cover.kind === "DEFAULT")
  // Texto inválido também conta como alteração pendente (sair perderia o que foi digitado).
  const dirty = !normalizedName.ok || nameChanged || photo.kind !== "keep" || coverChanged
  const busy = preparing || mutation.isPending
  const guard = useUnsavedChangesGuard(dirty)

  // Prévia = o MESMO cabeçalho do perfil, com o rascunho aplicado.
  const previewPerson: ProfileHeaderPerson = {
    displayName: (normalizedName.ok ? normalizedName.value : null) ?? base.registeredName,
    registeredName: base.registeredName,
    avatarUrl: photo.kind === "new" ? croppedPreview : photo.kind === "remove" ? null : base.avatarUrl,
    cover: cover.kind === "custom" ? { kind: "CUSTOM", preset: "inia", imageUrl: cover.src } : cover.kind === "preset" ? { kind: "PRESET", preset: cover.preset, imageUrl: null } : cover.kind === "default" ? { kind: "DEFAULT", preset: "inia", imageUrl: null } : base.cover,
    jobTitle: base.professional.jobTitle,
    teamName: base.professional.teamName,
  }
  const selectedPreset: CoverPreset | "custom" = cover.kind === "custom" ? "custom" : cover.kind === "preset" ? cover.preset : cover.kind === "default" ? "inia" : base.cover.kind === "CUSTOM" ? "custom" : base.cover.kind === "PRESET" ? base.cover.preset : "inia"
  const hasCustomCover = cover.kind === "custom" || (cover.kind === "keep" && base.cover.kind === "CUSTOM")

  async function pickPhoto(file: File | undefined) {
    setPhotoError("")
    if (!file) return
    const parsed = profilePhotoFileSchema.safeParse(file)
    if (!parsed.success) return setPhotoError(parsed.error.issues[0]?.message ?? "Imagem inválida.")
    try {
      const src = track(URL.createObjectURL(file))
      const image = await loadImage(src)
      if (Math.min(image.width, image.height) < PROFILE_PHOTO_MIN_SIDE) return setPhotoError(`A foto precisa ter pelo menos ${PROFILE_PHOTO_MIN_SIDE} × ${PROFILE_PHOTO_MIN_SIDE} px.`)
      setPhoto({ kind: "new", src, image, crop: { zoom: 1, x: 0, y: 0 } })
    } catch {
      setPhotoError("Não foi possível ler esta imagem. Tente outro arquivo.")
    }
  }

  async function pickCover(file: File | Blob | undefined) {
    setCoverError("")
    if (!file) return
    if (file instanceof File) {
      const parsed = profileCoverFileSchema.safeParse(file)
      if (!parsed.success) return setCoverError(parsed.error.issues[0]?.message ?? "Imagem inválida.")
    }
    try {
      const src = track(URL.createObjectURL(file))
      const image = await loadImage(src)
      if (image.width < PROFILE_COVER_MIN.width || image.height < PROFILE_COVER_MIN.height) return setCoverError(`A capa precisa ter pelo menos ${PROFILE_COVER_MIN.width} × ${PROFILE_COVER_MIN.height} px.`)
      setCover({ kind: "custom", src, image })
    } catch {
      setCoverError("Não foi possível ler esta imagem. Tente outro arquivo.")
    }
  }

  async function acceptLegacy() {
    if (!legacy) return
    if (legacy.kind === "preset") setCover({ kind: "preset", preset: legacy.preset })
    else await pickCover(await (await fetch(legacy.dataUrl)).blob())
    setLegacyAccepted(true)
  }

  function dismissLegacy() {
    clearLegacyLocalCover()
    setLegacy(null)
    if (legacyAccepted) {
      setCover({ kind: "keep" })
      setLegacyAccepted(false)
    }
  }

  async function save() {
    if (!dirty || nameError || busy) return
    setSaveError("")
    setPreparing(true)
    try {
      const input: ProfileUpdateInput = {
        ...(nameChanged ? { preferredName: normalizedName.ok ? (normalizedName.value ?? "") : "" } : {}),
        avatar: photo.kind === "new" ? { action: "replace", file: await renderCroppedAvatar(photo.image, photo.crop) } : photo.kind === "remove" ? { action: "remove" } : { action: "keep" },
        cover: !coverChanged ? { action: "keep" } : cover.kind === "custom" ? { action: "custom", file: await renderCover(cover.image) } : cover.kind === "preset" ? { action: "preset", preset: cover.preset } : cover.kind === "default" ? { action: "default" } : { action: "keep" },
      }
      setPreparing(false)
      await mutation.mutateAsync(input)
      // Capa antiga do navegador: agora salva na conta — as chaves sem dono saem.
      if (legacyAccepted) clearLegacyLocalCover()
      guard.release()
      toast.success("Perfil atualizado.")
      router.replace(profileHref)
    } catch (error) {
      // Rascunho preservado: a pessoa corrige ou tenta de novo.
      setPreparing(false)
      setSaveError(error instanceof ApiError || error instanceof Error ? error.message : "Não foi possível salvar. Tente novamente.")
    }
  }

  const leaveToProfile = () => guard.request(() => router.push(profileHref))

  return (
    <>
      <PageHeader
        className="mb-4 sm:mb-6"
        icon={UserRound}
        title="Editar perfil"
        description="Personalize como você aparece na INIA. Matrícula, cargo e equipe continuam sendo mantidos pela empresa."
        back={<BackLink onClick={leaveToProfile} label="Perfil" />}
      />

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
        aria-busy={busy}
        aria-label="Editar perfil"
      >
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:gap-6">
          {/* Prévia: o mesmo cabeçalho do perfil. Mobile: primeiro e compacta; desktop: ao lado, fixa ao rolar. */}
          <aside className="lg:sticky lg:top-[4.5rem] lg:order-2" aria-label="Prévia">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Prévia</p>
            <ProfileHeader person={previewPerson} isOwn variant="preview" />
            <p className="mt-2 hidden text-xs text-muted-foreground lg:block">É assim que seu perfil aparece para você e para quem consulta.</p>
          </aside>

          <div className="space-y-4 lg:order-1">
            {/* Nome de tratamento */}
            <section className="scroll-mt-20 space-y-2 rounded-2xl bg-card p-4 ring-1 ring-border/60 sm:p-5">
              <Label htmlFor={ids.name} className="text-base font-semibold">Como você quer ser chamado?</Label>
              <Input
                ref={nameRef}
                id={ids.name}
                value={nameInput}
                onChange={(event) => setNameInput(event.target.value)}
                placeholder={registeredFirstNameOf(base.registeredName)}
                maxLength={PREFERRED_NAME_MAX_LENGTH + 20}
                autoComplete="nickname"
                aria-invalid={nameError ? true : undefined}
                aria-describedby={`${ids.nameHelp}${nameError ? ` ${ids.nameError}` : ""}`}
                disabled={busy}
                className="h-10 text-base sm:text-sm"
              />
              <div className="flex items-start justify-between gap-3">
                <p id={ids.nameHelp} className="text-xs text-muted-foreground">
                  Esse nome será usado pela INIA e na interface. Seu nome cadastrado pela empresa não será alterado.
                  <span className="mt-1 block">Nome cadastrado: <span className="font-medium text-foreground">{base.registeredName}</span>{nameInput.trim() ? null : " — sem preferência, a INIA usa esse nome."}</span>
                </p>
                <span className={cn("shrink-0 text-xs tabular-nums text-muted-foreground", [...nameInput.trim()].length > PREFERRED_NAME_MAX_LENGTH && "text-destructive")} aria-hidden>
                  {[...nameInput.trim()].length}/{PREFERRED_NAME_MAX_LENGTH}
                </span>
              </div>
              {nameError ? <p id={ids.nameError} role="alert" className="text-sm text-destructive">{nameError}</p> : null}
            </section>

            {/* Foto */}
            <section ref={photoSectionRef} aria-labelledby={ids.photo} className="scroll-mt-20 space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border/60 sm:p-5">
              <h2 id={ids.photo} className="text-base font-semibold">Foto de perfil</h2>
              {photo.kind === "new" ? (
                <div className="space-y-3">
                  <AvatarCropper image={photo.image} src={photo.src} crop={photo.crop} onCropChange={(crop) => setPhoto((current) => (current.kind === "new" ? { ...current, crop } : current))} />
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button ref={photoButtonRef} type="button" variant="outline" size="sm" onClick={() => photoInputRef.current?.click()} disabled={busy}><Upload /> Escolher outra</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setPhoto({ kind: "keep" })} disabled={busy}>Descartar nova foto</Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <Button ref={photoButtonRef} type="button" variant="outline" onClick={() => photoInputRef.current?.click()} disabled={busy}>
                    <Camera /> {base.avatarSource === "CUSTOM" && photo.kind === "keep" ? "Substituir foto" : "Enviar foto"}
                  </Button>
                  {base.avatarSource === "CUSTOM" && photo.kind === "keep" ? (
                    <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setPhoto({ kind: "remove" })} disabled={busy}><Trash2 /> Remover foto</Button>
                  ) : null}
                  {photo.kind === "remove" ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setPhoto({ kind: "keep" })} disabled={busy}><RotateCcw /> Manter foto atual</Button>
                  ) : null}
                  <p className="w-full text-xs text-muted-foreground">
                    {photo.kind === "remove"
                      ? "Sua foto personalizada será removida ao salvar. Se houver uma imagem no seu cadastro da empresa, ela volta a aparecer."
                      : base.avatarSource === "CORPORATE"
                        ? "Hoje aparece a imagem do seu cadastro da empresa. Envie uma foto sua (JPG, PNG ou WebP) e ajuste o enquadramento."
                        : "JPG, PNG ou WebP. Você ajusta o enquadramento aqui mesmo antes de salvar."}
                  </p>
                </div>
              )}
              <input ref={photoInputRef} type="file" accept={PROFILE_IMAGE_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => { void pickPhoto(event.target.files?.[0]); event.target.value = "" }} />
              {photoError ? <p role="alert" className="text-sm text-destructive">{photoError}</p> : null}
            </section>

            {/* Capa */}
            <section ref={coverSectionRef} aria-labelledby={ids.cover} className="scroll-mt-20 space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border/60 sm:p-5">
              <h2 id={ids.cover} className="text-base font-semibold">Capa</h2>
              {legacy ? (
                <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/50 p-3 text-sm sm:flex-row sm:items-center">
                  <div className="relative h-12 w-full shrink-0 overflow-hidden rounded-md sm:w-24">
                    {legacy.kind === "preset" ? <CoverPresetArt preset={legacy.preset} /> : <img src={legacy.dataUrl} alt="" className="absolute inset-0 size-full object-cover" /> /* eslint-disable-line @next/next/no-img-element */}
                  </div>
                  <p className="flex-1 text-muted-foreground">Encontramos uma capa salva só neste navegador, sem vínculo com a sua conta. Quer usá-la como sua capa?</p>
                  <div className="flex gap-2">
                    {legacyAccepted ? <span className="inline-flex items-center gap-1 text-xs font-medium text-primary"><Check className="size-4" aria-hidden /> Selecionada</span> : <Button type="button" size="sm" onClick={() => void acceptLegacy()} disabled={busy}>Usar esta capa</Button>}
                    <Button type="button" size="sm" variant="ghost" onClick={dismissLegacy} disabled={busy}>Descartar</Button>
                  </div>
                </div>
              ) : null}
              <div ref={coverGroupRef} role="group" aria-label="Opções de capa" tabIndex={-1} className="grid grid-cols-2 gap-2 outline-none sm:grid-cols-3">
                {COVER_PRESETS.map((preset) => (
                  <CoverOption key={preset} label={`${COVER_PRESET_LABELS[preset]}${preset === "inia" ? " (padrão)" : ""}`} selected={selectedPreset === preset} disabled={busy} onSelect={() => setCover(preset === "inia" ? { kind: "default" } : { kind: "preset", preset })}>
                    <CoverPresetArt preset={preset} />
                  </CoverOption>
                ))}
                <CoverOption label={hasCustomCover ? "Imagem personalizada" : "Enviar imagem"} selected={selectedPreset === "custom"} disabled={busy} onSelect={() => (hasCustomCover && selectedPreset !== "custom" && base.cover.kind === "CUSTOM" ? setCover({ kind: "keep" }) : coverInputRef.current?.click())}>
                  {cover.kind === "custom" ? <CoverArt cover={{ kind: "CUSTOM", preset: "inia", imageUrl: null }} previewUrl={cover.src} /> : base.cover.kind === "CUSTOM" ? <CoverArt cover={base.cover} /> : <span className="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground"><ImagePlus className="size-5" aria-hidden /></span>}
                </CoverOption>
              </div>
              {hasCustomCover ? (
                <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={() => coverInputRef.current?.click()} disabled={busy}><Upload /> Enviar outra imagem de capa</Button>
              ) : null}
              <p className="text-xs text-muted-foreground">Imagem de capa: JPG, PNG ou WebP, com pelo menos {PROFILE_COVER_MIN.width} × {PROFILE_COVER_MIN.height} px (formato horizontal).</p>
              <input ref={coverInputRef} type="file" accept={PROFILE_IMAGE_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => { void pickCover(event.target.files?.[0]); event.target.value = "" }} />
              {coverError ? <p role="alert" className="text-sm text-destructive">{coverError}</p> : null}
            </section>
          </div>
        </div>

        {/* Barra de ações fixa na base: sempre à mão, inclusive no mobile. */}
        <div className="sticky bottom-0 z-10 -mx-4 mt-4 border-t border-border bg-card/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/85 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {saveError ? (
              <p role="alert" className="flex flex-1 items-start gap-2 text-sm text-destructive"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {saveError}</p>
            ) : (
              <p className="flex-1 text-xs text-muted-foreground" aria-live="polite">{busy ? "Salvando alterações…" : dirty ? "Alterações não salvas." : "Nenhuma alteração."}</p>
            )}
            <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
              <Button type="button" variant="outline" onClick={leaveToProfile} disabled={mutation.isPending}>Cancelar</Button>
              <Button type="submit" disabled={!dirty || Boolean(nameError) || busy}>
                {busy ? <><Loader2 className="animate-spin" aria-hidden /> Salvando…</> : "Salvar alterações"}
              </Button>
            </div>
          </div>
        </div>
      </form>

      <AlertDialog open={guard.open} onOpenChange={(open) => (open ? undefined : guard.cancel())}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar alterações?</AlertDialogTitle>
            <AlertDialogDescription>As mudanças no seu nome, foto ou capa ainda não foram salvas.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={guard.confirm}>Descartar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function CoverOption({ label, selected, disabled, onSelect, children }: { label: string; selected: boolean; disabled: boolean; onSelect: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn("group relative flex h-16 flex-col justify-end overflow-hidden rounded-lg border-2 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60 sm:h-20", selected ? "border-primary" : "border-transparent hover:border-border")}
    >
      {children}
      <span className="relative z-10 flex items-center justify-between gap-1 bg-gradient-to-t from-black/65 to-transparent px-2 pb-1 pt-4 text-xs font-medium text-white">
        <span className="truncate">{label}</span>
        {selected ? <Check className="size-3.5 shrink-0" aria-hidden /> : null}
      </span>
    </button>
  )
}
