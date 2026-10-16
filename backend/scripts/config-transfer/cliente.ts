/**
 * Cliente da API da INIA de DESTINO para o `config:importar`: entra com a conta de um Administrador geral (a senha é digitada
 * no terminal e nunca aparece nem é gravada) e guarda só o cookie da sessão na pasta do pacote, para a simulação e a importação
 * não pedirem a senha de novo. `--sair` encerra a sessão no servidor e apaga o arquivo.
 *
 * As escritas não mandam o cabeçalho Origin: o guard de CSRF da API (shared/presentation/origin-guard.ts) só barra origem de
 * NAVEGADOR não autorizada — um script com o cookie passa, como o `curl`.
 */
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const COOKIE_DA_SESSAO = "inia_session"

export class ErroApi extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    message: string,
    readonly detalhes?: unknown,
  ) {
    super(message)
  }
}

export type Sessao = { destino: string; email: string; cookie: string; salvaEm: string }

export class ClienteInia {
  private constructor(
    readonly destino: string,
    private cookie: string,
  ) {}

  static normalizarDestino(endereco: string): string {
    const url = new URL(/^https?:\/\//i.test(endereco) ? endereco : `https://${endereco}`)
    return `${url.protocol}//${url.host}`
  }

  /** Reaproveita a sessão gravada na pasta do pacote, se ainda vale para este destino e e-mail. */
  static async retomar(pasta: string, destino: string, email: string | undefined): Promise<ClienteInia | null> {
    const caminho = arquivoDaSessao(pasta)
    if (!existsSync(caminho)) return null
    const sessao = JSON.parse(readFileSync(caminho, "utf8")) as Sessao
    if (sessao.destino !== destino || (email && sessao.email.toLowerCase() !== email.toLowerCase())) return null
    const cliente = new ClienteInia(destino, sessao.cookie)
    try {
      await cliente.get("/api/v1/auth/me")
      return cliente
    } catch {
      rmSync(caminho, { force: true })
      return null
    }
  }

  static async entrar(pasta: string, destino: string, email: string, senha: string): Promise<ClienteInia> {
    const resposta = await fetch(`${destino}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: senha }) })
    const corpo = await lerCorpo(resposta)
    if (!resposta.ok) throw erroDe(resposta.status, corpo)
    const cookie = resposta.headers.getSetCookie().map((linha) => linha.split(";")[0]!).find((par) => par.startsWith(`${COOKIE_DA_SESSAO}=`))
    if (!cookie) throw new ErroApi(resposta.status, "SEM_SESSAO", "O servidor aceitou o login mas não devolveu o cookie de sessão (confira se o endereço é o da INIA).")
    if ((corpo as { data?: { passwordChangeRequired?: boolean } }).data?.passwordChangeRequired) {
      throw new ErroApi(403, "PASSWORD_CHANGE_REQUIRED", "Esta conta ainda está com a senha provisória: entre uma vez pelo navegador, crie a senha definitiva e rode de novo.")
    }
    const caminho = arquivoDaSessao(pasta)
    writeFileSync(caminho, JSON.stringify({ destino, email, cookie, salvaEm: new Date().toISOString() } satisfies Sessao))
    chmodSync(caminho, 0o600)
    return new ClienteInia(destino, cookie)
  }

  static async sair(pasta: string): Promise<boolean> {
    const caminho = arquivoDaSessao(pasta)
    if (!existsSync(caminho)) return false
    const sessao = JSON.parse(readFileSync(caminho, "utf8")) as Sessao
    await fetch(`${sessao.destino}/api/v1/auth/logout`, { method: "POST", headers: { cookie: sessao.cookie } }).catch(() => undefined)
    rmSync(caminho, { force: true })
    return true
  }

  get<T = unknown>(caminho: string): Promise<T> {
    return this.enviar<T>("GET", caminho)
  }
  post<T = unknown>(caminho: string, corpo?: unknown): Promise<T> {
    return this.enviar<T>("POST", caminho, corpo)
  }
  patch<T = unknown>(caminho: string, corpo: unknown): Promise<T> {
    return this.enviar<T>("PATCH", caminho, corpo)
  }
  put<T = unknown>(caminho: string, corpo: unknown): Promise<T> {
    return this.enviar<T>("PUT", caminho, corpo)
  }
  excluir<T = unknown>(caminho: string): Promise<T> {
    return this.enviar<T>("DELETE", caminho)
  }
  /** Formulário multipart (arquivos de base e imagens do cenário). */
  postFormulario<T = unknown>(caminho: string, formulario: FormData): Promise<T> {
    return this.enviar<T>("POST", caminho, formulario)
  }

  private async enviar<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
    const formulario = corpo instanceof FormData
    const headers: Record<string, string> = { cookie: this.cookie, accept: "application/json" }
    if (corpo !== undefined && !formulario) headers["content-type"] = "application/json"
    const resposta = await fetch(`${this.destino}${caminho}`, { method: metodo, headers, body: corpo === undefined ? null : formulario ? (corpo as FormData) : JSON.stringify(corpo) })
    const conteudo = await lerCorpo(resposta)
    if (!resposta.ok) throw erroDe(resposta.status, conteudo)
    return ((conteudo as { data?: T } | null)?.data ?? conteudo) as T
  }
}

export function arquivoDaSessao(pasta: string): string {
  return join(pasta, ".sessao-destino.json")
}

async function lerCorpo(resposta: Response): Promise<unknown> {
  if (resposta.status === 204) return null
  const texto = await resposta.text()
  try {
    return texto ? JSON.parse(texto) : null
  } catch {
    return { error: { code: `HTTP_${resposta.status}`, message: texto.slice(0, 300) } }
  }
}

function erroDe(status: number, corpo: unknown): ErroApi {
  const erro = (corpo as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error
  return new ErroApi(status, erro?.code ?? `HTTP_${status}`, erro?.message ?? `O servidor respondeu ${status}.`, erro?.details)
}

/** Lê a senha sem ecoar no terminal (Backspace apaga, Ctrl+C cancela). Sem terminal interativo, recusa. */
export function perguntarSenha(pergunta: string): Promise<string> {
  const entrada = process.stdin
  if (!entrada.isTTY) return Promise.reject(new Error("Para digitar a senha, rode o comando num terminal (Prompt de Comando, PowerShell ou Terminal)."))
  process.stdout.write(pergunta)
  return new Promise((resolver, rejeitar) => {
    let senha = ""
    entrada.setRawMode(true)
    entrada.resume()
    entrada.setEncoding("utf8")
    const terminar = (erro?: Error) => {
      entrada.setRawMode(false)
      entrada.pause()
      entrada.removeListener("data", aoDigitar)
      process.stdout.write("\n")
      if (erro) rejeitar(erro)
      else resolver(senha)
    }
    const aoDigitar = (pedaco: string) => {
      for (const caractere of pedaco) {
        if (caractere === "\r" || caractere === "\n") return terminar()
        if (caractere === "\u0003") return terminar(new Error("Cancelado."))
        if (caractere === "\u007f" || caractere === "\b") senha = senha.slice(0, -1)
        else if (caractere >= " ") senha += caractere
      }
    }
    entrada.on("data", aoDigitar)
  })
}
