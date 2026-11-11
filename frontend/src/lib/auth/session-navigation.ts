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

/**
 * Caminho com que ESTE documento foi carregado (a entrada de navegação do navegador — não muda com navegação do roteador), ou
 * null quando o navegador não informa.
 */
export function documentEntryPath(): string | null {
  try {
    const entry = performance.getEntriesByType?.("navigation")[0]
    return entry?.name ? new URL(entry.name).pathname : null
  } catch {
    return null
  }
}

const isAuthPath = (pathname: string) => pathname === "/auth" || pathname.startsWith("/auth/")

/**
 * Chegou às telas de acesso (login, criar senha, esqueci a senha) por navegação do ROTEADOR, vindo de um documento aberto
 * em outra área? É o caso da sessão encerrada no SERVIDOR (sair de todos os aparelhos em outro lugar, senha provisória nova,
 * conta desativada, cookie ausente): o `redirect("/auth/login")` das páginas e o do `proxy.ts` são seguidos dentro do mesmo
 * documento, e o Voltar restauraria do cache do roteador as páginas da conta anterior. Um documento que já nasceu em /auth não
 * conta — por isso o recarregamento acontece no máximo uma vez.
 */
export function arrivedAtAuthBySoftNavigation(): boolean {
  const entry = documentEntryPath()
  return entry !== null && !isAuthPath(entry)
}
