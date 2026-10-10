import type { NextConfig } from "next";

import { originOf } from "./src/lib/security/content-security-policy";

/**
 * Cabeçalhos de segurança das páginas da interface (auditoria de segurança, docs/security/configuracao-segura.md).
 *
 * A Content-Security-Policy NÃO está aqui: ela leva um nonce novo a cada requisição e por isso é montada no proxy
 * (src/proxy.ts + src/lib/security/content-security-policy.ts), com `script-src` sem 'unsafe-inline'. O que fica aqui vale
 * para tudo, inclusive arquivos estáticos: nenhum site enquadra a INIA (clickjacking), nada de sniffing de tipo, referer
 * só com a origem para fora, microfone só na própria origem, janela isolada (COOP) e HSTS quando a instalação é HTTPS.
 */
const apiOrigin = originOf(process.env.NEXT_PUBLIC_INIA_API_URL ?? "http://localhost:3333");
const httpsDeployment = apiOrigin?.startsWith("https://") ?? false;

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Microfone só para a própria INIA (conversa por voz); o resto, desligado.
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // HSTS só quando a instalação é HTTPS (em HTTP de rede interna o cabeçalho trancaria o navegador num HTTPS inexistente).
  ...(httpsDeployment ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
