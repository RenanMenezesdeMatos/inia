// Radix (Select/Tooltip/Sheet) e Recharts dependem de APIs que o jsdom não implementa — stubs
// mínimos só pro componente montar; layout real é irrelevante nestes testes comportamentais.
export function installJsdomStubs() {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.scrollIntoView = () => {}
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  global.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
  if (!window.matchMedia) {
    window.matchMedia = (query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })
  }
}
