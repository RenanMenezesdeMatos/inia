"use client"

import { createContext, useContext } from "react"

import type {
  AccessibilityPreferences,
  AccessibilityTextScale,
} from "./accessibility-types"

export type AccessibilityContextValue = {
  preferences: AccessibilityPreferences
  setTextScale: (textScale: AccessibilityTextScale) => void
  toggleHighContrast: () => void
  toggleReduceMotion: () => void
  toggleEnhancedFocus: () => void
  resetAccessibility: () => void
}

export const AccessibilityContext =
  createContext<AccessibilityContextValue | null>(null)

export function useAccessibility() {
  const context = useContext(AccessibilityContext)

  if (!context) {
    throw new Error(
      "useAccessibility deve ser usado dentro de AccessibilityProvider",
    )
  }

  return context
}