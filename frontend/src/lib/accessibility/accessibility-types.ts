export type AccessibilityTextScale =
  | "default"
  | "large"
  | "extra-large"
  | "huge"

export type AccessibilityPreferences = {
  textScale: AccessibilityTextScale
  highContrast: boolean
  reduceMotion: boolean
  enhancedFocus: boolean
}