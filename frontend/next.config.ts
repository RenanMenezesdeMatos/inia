import path from "node:path";
import type { NextConfig } from "next";

import { computePublicAssetVersions } from "./src/lib/assets/public-asset-versions";
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

/**
 * Cache dos estáticos de `public/` (o Next manda `max-age=0` neles: a cada tela o navegador revalidava o modelo 3D de 6,6 MB e as
 * imagens). Os endereços que a interface monta com `publicAsset()` levam `?v=<hash do conteúdo>` (calculado aqui, no build):
 * esses saem IMUTÁVEIS por 1 ano — trocar o arquivo muda o hash, logo o endereço. Sem `?v` (endereço digitado, laboratório do
 * avatar), cache curto com revalidação.
 */
const assetVersions = computePublicAssetVersions(path.join(process.cwd(), "public"));
const IMMUTABLE = "public, max-age=31536000, immutable";
const SHORT = "public, max-age=3600, stale-while-revalidate=86400";
const STATIC_SOURCES = ["/models/:path*", "/:file([^/]+\\.(?:png|jpe?g|webp|svg))"];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  env: { NEXT_PUBLIC_INIA_ASSET_VERSIONS: JSON.stringify(assetVersions) },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // O último cabeçalho que casa vale: sem versão = curto; com `?v` = imutável.
      ...STATIC_SOURCES.map((source) => ({ source, headers: [{ key: "Cache-Control", value: SHORT }] })),
      ...STATIC_SOURCES.map((source) => ({ source, has: [{ type: "query" as const, key: "v" }], headers: [{ key: "Cache-Control", value: IMMUTABLE }] })),
    ];
  },
};

export default nextConfig;
