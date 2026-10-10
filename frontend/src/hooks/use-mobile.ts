import * as React from "react"

const MOBILE_BREAKPOINT = 768

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

const isMobileViewport = () => window.innerWidth < MOBILE_BREAKPOINT
// No servidor (e na hidratação) não existe tela: desktop, como antes de montar.
const isMobileOnServer = () => false

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, isMobileViewport, isMobileOnServer)
}
