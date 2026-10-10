/**
 * Setup comum a todos os testes do frontend (ver `setupFiles` em vitest.config.ts).
 *
 * jsdom 26 + nwsapi 2.2.27: `element.matches(":modal")` entra em recursão até estourar a pilha (~160 ms por chamada) e só
 * então devolve `false`. O floating-ui — por baixo de Popover, Select, Tooltip e DropdownMenu do Radix — pergunta isso a
 * cada posicionamento, e um teste que abre um popup deixava o event loop ocupado por segundos (inclusive nos testes
 * seguintes do arquivo). O jsdom não tem "top layer", então a resposta é sempre `false`: aqui só tiramos a recursão.
 */
if (typeof Element !== "undefined") {
  const matches = Element.prototype.matches
  Element.prototype.matches = function (this: Element, selectors: string): boolean {
    if (selectors === ":modal") return false
    return matches.call(this, selectors)
  }
}
