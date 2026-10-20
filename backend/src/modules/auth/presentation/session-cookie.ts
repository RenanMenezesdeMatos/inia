import { env } from "../../../config/env.js"

/**
 * Nome do cookie de sessão. Com o atributo Secure (HTTPS), o prefixo `__Host-` (R-33) obriga o navegador a só aceitar o cookie
 * vindo do próprio endereço, com `Path=/` e sem `Domain`: um subdomínio ou uma página em HTTP não consegue plantar nem
 * sobrescrever a sessão. Em HTTP de rede interna (SESSION_COOKIE_SECURE=false) o prefixo não é aceito pelo navegador e o nome
 * continua o de sempre. Trocar de um para o outro encerra as sessões abertas (as pessoas entram de novo).
 */
export const SESSION_COOKIE_NAME = env.sessionCookieSecure ? "__Host-inia_session" : "inia_session"
