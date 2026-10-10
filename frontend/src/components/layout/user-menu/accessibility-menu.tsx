"use client"

import type { ReactNode } from "react"
import {
  Check,
  Contrast,
  Focus,
  RotateCcw,
  Type,
  Waves,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { useAccessibility } from "@/lib/accessibility/accessibility-context"
import { setAvOffsetMs } from "@/lib/avatar/audio/av-sync"
import { AvSyncSection } from "./av-sync-section"
import type { AccessibilityTextScale } from "@/lib/accessibility/accessibility-types"

type AccessibilityMenuProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type TextScaleOption = {
  value: AccessibilityTextScale
  label: string
  description: string
  previewClassName: string
}

const TEXT_SCALE_OPTIONS: TextScaleOption[] = [
  {
    value: "default",
    label: "Padrão",
    description: "Mantém o tamanho original da interface.",
    previewClassName: "text-sm",
  },
  {
    value: "large",
    label: "Grande",
    description: "Aumenta levemente textos principais.",
    previewClassName: "text-base",
  },
  {
    value: "extra-large",
    label: "Muito grande",
    description: "Melhora a leitura em telas com muitos dados.",
    previewClassName: "text-lg",
  },
  {
    value: "huge",
    label: "Extra grande",
    description: "Indicado para baixa visão.",
    previewClassName: "text-xl",
  },
]

type AccessibilityToggleRowProps = {
  icon: ReactNode
  title: string
  description: string
  checked: boolean
  onClick: () => void
}

function AccessibilityToggleRow({
  icon,
  title,
  description,
  checked,
  onClick,
}: AccessibilityToggleRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={checked}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-2xl border p-3 text-left transition-colors",
        checked
          ? "border-primary/40 bg-primary/10"
          : "border-border/60 bg-background hover:bg-muted/60",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border",
            checked
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border/70 bg-background text-muted-foreground",
          )}
        >
          {icon}
        </span>

        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
            {description}
          </p>
        </div>
      </div>

      <span
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
          checked
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-background",
        )}
      >
        {checked ? <Check className="h-3.5 w-3.5" /> : null}
      </span>
    </button>
  )
}

type TextScaleCardProps = {
  option: TextScaleOption
  selected: boolean
  onClick: () => void
}

function TextScaleCard({ option, selected, onClick }: TextScaleCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "rounded-2xl border p-3 text-left transition-colors",
        selected
          ? "border-primary/40 bg-primary/10"
          : "border-border/60 bg-background hover:bg-muted/60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("font-semibold text-foreground", option.previewClassName)}>
            {option.label}
          </p>

          <p className="mt-1 text-xs leading-snug text-muted-foreground">
            {option.description}
          </p>
        </div>

        <span
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background",
          )}
        >
          {selected ? <Check className="h-3.5 w-3.5" /> : null}
        </span>
      </div>
    </button>
  )
}

export function AccessibilityMenu({
  open,
  onOpenChange,
}: AccessibilityMenuProps) {
  const {
    preferences,
    setTextScale,
    toggleHighContrast,
    toggleReduceMotion,
    toggleEnhancedFocus,
    resetAccessibility,
  } = useAccessibility()

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="
          flex
          w-84
          max-w-[calc(100vw-1rem)]
          flex-col
          gap-0
          overflow-hidden
          rounded-l-3xl
          border-l
          border-border/70
          p-0
          sm:w-92
          sm:max-w-92
  "
>
        <SheetHeader className="border-b border-border/70 px-5 py-4 text-left">
          <SheetTitle className="text-base font-semibold">
            Acessibilidade
          </SheetTitle>

          <SheetDescription className="text-sm text-muted-foreground">
            Ajuste a interface e veja o resultado direto na tela.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="space-y-6">
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Type className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">
                  Tamanho do texto
                </h3>
              </div>

              <div className="grid gap-2">
                {TEXT_SCALE_OPTIONS.map((option) => (
                  <TextScaleCard
                    key={option.value}
                    option={option}
                    selected={preferences.textScale === option.value}
                    onClick={() => setTextScale(option.value)}
                  />
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Preferências visuais
                </h3>
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                  Essas opções ajudam na leitura, foco e conforto visual.
                </p>
              </div>

              <div className="space-y-2">
                <AccessibilityToggleRow
                  icon={<Contrast className="h-4 w-4" />}
                  title="Alto contraste"
                  description="Aumenta contraste entre textos, fundos e bordas."
                  checked={preferences.highContrast}
                  onClick={toggleHighContrast}
                />

                <AccessibilityToggleRow
                  icon={<Focus className="h-4 w-4" />}
                  title="Foco visível"
                  description="Destaca melhor o item ativo ao navegar pelo teclado."
                  checked={preferences.enhancedFocus}
                  onClick={toggleEnhancedFocus}
                />

                <AccessibilityToggleRow
                  icon={<Waves className="h-4 w-4" />}
                  title="Reduzir animações"
                  description="Diminui movimentos e transições da interface."
                  checked={preferences.reduceMotion}
                  onClick={toggleReduceMotion}
                />
              </div>
            </section>

            <AvSyncSection />
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border/70 bg-background px-5 py-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              resetAccessibility()
              setAvOffsetMs(0)
            }}
            className="gap-2 rounded-2xl text-muted-foreground"
          >
            <RotateCcw className="h-4 w-4" />
            Restaurar
          </Button>

          <Button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-2xl"
          >
            Fechar
          </Button>
        </footer>
      </SheetContent>
    </Sheet>
  )
}