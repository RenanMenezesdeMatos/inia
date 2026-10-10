"use client"

import { useEffect, useMemo, useSyncExternalStore } from "react"

import { AccessibilityContext } from "./accessibility-context"
import type {
  AccessibilityPreferences,
  AccessibilityTextScale,
} from "./accessibility-types"

export const ACCESSIBILITY_STORAGE_KEY = "inia:accessibility-preferences"
const STORAGE_KEY = ACCESSIBILITY_STORAGE_KEY

const DEFAULT_PREFERENCES: AccessibilityPreferences = {
  textScale: "default",
  highContrast: false,
  reduceMotion: false,
  enhancedFocus: false,
}

type AccessibilityProviderProps = {
  children: React.ReactNode
}

function getStoredPreferences(): AccessibilityPreferences {
  if (typeof window === "undefined") {
    return DEFAULT_PREFERENCES
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)

    if (!stored) {
      return DEFAULT_PREFERENCES
    }

    return {
      ...DEFAULT_PREFERENCES,
      ...JSON.parse(stored),
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

function applyAccessibilityClasses(preferences: AccessibilityPreferences) {
  const root = document.documentElement

  root.classList.remove(
    "a11y-text-large",
    "a11y-text-extra-large",
    "a11y-text-huge",
    "a11y-high-contrast",
    "a11y-reduce-motion",
    "a11y-enhanced-focus",
  )

  if (preferences.textScale === "large") {
    root.classList.add("a11y-text-large")
  }

  if (preferences.textScale === "extra-large") {
    root.classList.add("a11y-text-extra-large")
  }

  if (preferences.textScale === "huge") {
    root.classList.add("a11y-text-huge")
  }

  if (preferences.highContrast) {
    root.classList.add("a11y-high-contrast")
  }

  if (preferences.reduceMotion) {
    root.classList.add("a11y-reduce-motion")
  }

  if (preferences.enhancedFocus) {
    root.classList.add("a11y-enhanced-focus")
  }
}

/**
 * As preferências vivem no localStorage; este armazenamento é a única porta de leitura e escrita. Toda instância do
 * provider lê a mesma coisa, e nada grava o padrão por cima do que está salvo: só os comandos da pessoa gravam.
 * No servidor (e na hidratação) vale o padrão — o HTML do servidor e o do cliente batem.
 */
const preferenceListeners = new Set<() => void>()
let cachedStoredRaw: string | null | undefined
let cachedStoredPreferences = DEFAULT_PREFERENCES

function readPreferences(): AccessibilityPreferences {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return DEFAULT_PREFERENCES
  }
  // Mesma gravação → mesmo objeto (o React compara o retrato por referência).
  if (raw !== cachedStoredRaw) {
    cachedStoredRaw = raw
    cachedStoredPreferences = getStoredPreferences()
  }
  return cachedStoredPreferences
}

function subscribeToPreferences(listener: () => void) {
  preferenceListeners.add(listener)
  return () => {
    preferenceListeners.delete(listener)
  }
}

function writePreferences(update: (current: AccessibilityPreferences) => AccessibilityPreferences) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(update(readPreferences())))
  for (const listener of preferenceListeners) listener()
}

export function AccessibilityProvider({
  children,
}: AccessibilityProviderProps) {
  const preferences = useSyncExternalStore(subscribeToPreferences, readPreferences, () => DEFAULT_PREFERENCES)

  useEffect(() => {
    applyAccessibilityClasses(preferences)
  }, [preferences])

  const value = useMemo(
    () => ({
      preferences,

      setTextScale: (textScale: AccessibilityTextScale) => {
        writePreferences((current) => ({
          ...current,
          textScale,
        }))
      },

      toggleHighContrast: () => {
        writePreferences((current) => ({
          ...current,
          highContrast: !current.highContrast,
        }))
      },

      toggleReduceMotion: () => {
        writePreferences((current) => ({
          ...current,
          reduceMotion: !current.reduceMotion,
        }))
      },

      toggleEnhancedFocus: () => {
        writePreferences((current) => ({
          ...current,
          enhancedFocus: !current.enhancedFocus,
        }))
      },

      resetAccessibility: () => {
        writePreferences(() => DEFAULT_PREFERENCES)
      },
    }),
    [preferences],
  )

  return (
    <AccessibilityContext.Provider value={value}>
      {children}
    </AccessibilityContext.Provider>
  )
}