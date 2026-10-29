/**
 * FRONTEIRA DE SESSÃO = documento novo. Sair, sair de todos os aparelhos, inatividade, sessão perdida, entrar e criar a senha
 * carregam a página de novo (nunca `router.push`/`replace`): só isso descarta de uma vez o cache do roteador do Next — que o
 * botão Voltar restaurava sem ir ao servidor, mostrando páginas da conta anterior numa estação compartilhada —, o estado do
 * React e o React Query (achado C08 da 4ª auditoria). `replace` tira do histórico a página de onde se saiu.
 */
export function loadSessionDocument(url: string, options: { replace?: boolean } = {}): void {
  if (options.replace) window.location.replace(url)
  else window.location.assign(url)
}
