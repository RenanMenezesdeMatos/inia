# Matriz OWASP ASVS 5.0.0 — INIA (29/10/2026)

Fonte dos requisitos: `OWASP_Application_Security_Verification_Standard_5.0.0_en.csv` da release oficial `v5.0.0_release`
(github.com/OWASP/ASVS), sha256 `6124dba176dc563f66363a11ae0c47f9b86b8a4a84c66a793670bd196ed86cd5`. Os identificadores e textos
vêm do arquivo (texto encurtado na tabela); nenhum foi criado. **Não é declaração de conformidade**: só os requisitos marcados
como "verificado" têm evidência, e ela vale para o recorte testado (código da revisão registrada, ambiente local isolado).

Legenda das evidências: **D** = teste dinâmico no ambiente local isolado; **C** = análise de código; **T** = teste automatizado;
**S** = scanner; **P** = auditoria anterior (`docs/security/`, não reexecutada). IDs como SESS-01, ATHN-02, S1–S4 e APPSEC-0n
estão em `registro-de-testes.md` e `relatorio-tecnico.md`.

| Status | Requisitos |
|---|---|
| verificado | 120 |
| falhou | 13 |
| não aplicável | 69 |
| não testado | 143 |
| **total** | **345** |

### V1 — Encoding and Sanitization

| Requisito | Nível | Status | Evidência / limitação |
|---|---|---|---|
| **V1.1.1** — Verify that input is decoded or unescaped into a canonical form only once, it is only decoded when encoded data in that form is expected, and that … | L2 | não testado | Fora do recorte desta passada. |
| **V1.1.2** — Verify that the application performs output encoding and escaping either as a final step before being used by the interpreter for which it is inten… | L2 | verificado | C: React escapa por padrão; texto de IA só por `rich-content.tsx` (react-markdown, `skipHtml`). S: Semgrep sem XSS no frontend. |
| **V1.2.1** — Verify that output encoding for an HTTP response, HTML document, or XML document is relevant for the context required, such as encoding the relevan… | L1 | verificado | D: toda resposta da API é JSON com `Content-Type` correto (varredura de 475 rotas). C: interface React. |
| **V1.2.2** — Verify that when dynamically building URLs, untrusted data is encoded according to its context (e.g., URL encoding or base64url encoding for query … | L1 | falhou | C (revisão A5): ids vindos da URL interpolados em caminhos da API sem `encodeURIComponent` em serviços do frontend. Sem exploração demonstrada (escritas usam o id devolvido pelo servidor) — endurecimento. |
| **V1.2.3** — Verify that output encoding or escaping is used when dynamically building JavaScript content (including JSON), to avoid changing the message or doc… | L1 | verificado | C: nenhum JavaScript montado dinamicamente; CSP com nonce e `strict-dynamic` (D: cabeçalho observado). |
| **V1.2.4** — Verify that data selection or database queries (e.g., SQL, HQL, NoSQL, Cypher) use parameterized queries, ORMs, entity frameworks, or are otherwise… | L1 | verificado | C+S: 10 alertas `tainted-sql-string` e 3 `node-mysql/mssql-sqli` do Semgrep conferidos: todos usam `filter.param()`/parâmetros posicionais ou números internos. D: ZAP ativo (2ª passada, autenticada) — ver registro de testes. |
| **V1.2.5** — Verify that the application protects against OS command injection and that operating system calls use parameterized OS queries or use contextual co… | L1 | verificado | C+S: `spawn` só em scripts de instalação com argumentos fixos (`shell` só no Windows para `npm.cmd`). |
| **V1.2.6** — Verify that the application protects against LDAP injection vulnerabilities, or that specific security controls to prevent LDAP injection have been… | L2 | não aplicável | Sem LDAP. |
| **V1.2.7** — Verify that the application is protected against XPath injection attacks by using query parameterization or precompiled queries. | L2 | não aplicável | Sem XPath. |
| **V1.2.8** — Verify that LaTeX processors are configured securely (such as not using the "--shell-escape" flag) and an allowlist of commands is used to prevent … | L2 | não aplicável | Sem LaTeX. |
| **V1.2.9** — Verify that the application escapes special characters in regular expressions (typically using a backslash) to prevent them from being misinterpret… | L2 | verificado | C+S: 32 `detect-non-literal-regexp` conferidos — entrada externa é escapada (`query-acronyms.ts`) ou o padrão vem de constantes internas. |
| **V1.2.10** — Verify that the application is protected against CSV and Formula Injection. The application must follow the escaping rules defined in RFC 4180 sect… | L3 | verificado | C+T: CSV de exportação neutraliza fórmulas (`=`,`+`,`-`,`@`, tab, CR), inclusive o preâmbulo (C12, 4ª rodada). |
| **V1.3.1** — Verify that all untrusted HTML input from WYSIWYG editors or similar is sanitized using a well-known and secure HTML sanitization library or framew… | L1 | verificado | C: Markdown sem HTML (`skipHtml`); sanitizador de DOCX testado com 27 cargas mXSS (P: 4ª rodada). |
| **V1.3.2** — Verify that the application avoids the use of eval() or other dynamic code execution features such as Spring Expression Language (SpEL). Where ther… | L1 | verificado | S: nenhum `eval`/`Function`/`vm` com dado externo (Semgrep CE, regras javascript/typescript). |
| **V1.3.3** — Verify that data being passed to a potentially dangerous context is sanitized beforehand to enforce safety measures, such as only allowing characte… | L2 | não testado | Fora do recorte desta passada. |
| **V1.3.4** — Verify that user-supplied Scalable Vector Graphics (SVG) scriptable content is validated or sanitized to contain only tags and attributes (such as … | L2 | verificado | C+T: imagens aceitas só por assinatura binária JPEG/PNG/WebP (SVG recusado); servidas com `CSP default-src 'none'` e `nosniff`. |
| **V1.3.5** — Verify that the application sanitizes or disables user-supplied scriptable or expression template language content, such as Markdown, CSS or XSL st… | L2 | não aplicável | Sem linguagem de template executável fornecida pelo usuário (prompts de Agent são texto). |
| **V1.3.6** — Verify that the application protects against Server-side Request Forgery (SSRF) attacks, by validating untrusted data against an allowlist of proto… | L2 | verificado | C+T: política de destinos de saída com DNS resolvido, metadados de nuvem e banco interno negados, redirect manual (P: rodadas 1–2; R-03 DNS rebinding residual). D: API isolada com `INIA_OUTBOUND_MODE=ALLOWLIST`. |
| **V1.3.7** — Verify that the application protects against template injection attacks by not allowing templates to be built based on untrusted input. Where there… | L2 | não aplicável | Sem templates no servidor. |
| **V1.3.8** — Verify that the application appropriately sanitizes untrusted input before use in Java Naming and Directory Interface (JNDI) queries and that JNDI … | L2 | não aplicável | Sem JNDI. |
| **V1.3.9** — Verify that the application sanitizes content before it is sent to memcache to prevent injection attacks. | L2 | não aplicável | Sem memcache. |
| **V1.3.10** — Verify that format strings which might resolve in an unexpected or malicious way when used are sanitized before being processed. | L2 | verificado | C+S: 6 `unsafe-formatstring` são logs com valores internos. |
| **V1.3.11** — Verify that the application sanitizes user input before passing to mail systems to protect against SMTP or IMAP injection. | L2 | não aplicável | Sem envio de e-mail. |
| **V1.3.12** — Verify that regular expressions are free from elements causing exponential backtracking, and ensure untrusted input is sanitized to mitigate ReDoS … | L3 | não testado | 13 alertas `detect-redos` em padrões limitados por tamanho (nome preferido ≤ N caracteres, texto de modelo); sem fuzzing de ReDoS (regra de não-DoS). |
| **V1.4.1** — Verify that the application uses memory-safe string, safer memory copy and pointer arithmetic to detect or prevent stack, buffer, or heap overflows. | L2 | não aplicável | TypeScript/Node (memória gerenciada). |
| **V1.4.2** — Verify that sign, range, and input validation techniques are used to prevent integer overflows. | L2 | não aplicável | Idem. |
| **V1.4.3** — Verify that dynamically allocated memory and resources are released, and that references or pointers to freed memory are removed or set to null to … | L2 | não aplicável | Idem. |
| **V1.5.1** — Verify that the application configures XML parsers to use a restrictive configuration and that unsafe features such as resolving external entities … | L1 | não testado | Fora do recorte desta passada. |
| **V1.5.2** — Verify that deserialization of untrusted data enforces safe input handling, such as using an allowlist of object types or restricting client-define… | L2 | verificado | C: só JSON; todo corpo validado por zod (D: 400 `VALIDATION_ERROR` com chaves desconhecidas recusadas). |
| **V1.5.3** — Verify that different parsers used in the application for the same data type (e.g., JSON parsers, XML parsers, URL parsers), perform parsing in a c… | L3 | não testado | Fora do recorte desta passada. |

### V2 — Validation and Business Logic

| Requisito | Nível | Status | Evidência / limitação |
|---|---|---|---|
| **V2.1.1** — Verify that the application's documentation defines input validation rules for how to check the validity of data items against an expected structur… | L1 | não testado | Fora do recorte desta passada. |
| **V2.1.2** — Verify that the application's documentation defines how to validate the logical and contextual consistency of combined data items, such as checking… | L2 | não testado | Fora do recorte desta passada. |
| **V2.1.3** — Verify that expectations for business logic limits and validations are documented, including both per-user and globally across the application. | L2 | não testado | Fora do recorte desta passada. |
| **V2.2.1** — Verify that input is validated to enforce business or functional expectations for that input. This should either use positive validation against an… | L1 | verificado | C+D: zod em todas as rotas revistas; a varredura vertical mostrou validação + permissão no servidor. |
| **V2.2.2** — Verify that the application is designed to enforce input validation at a trusted service layer. While client-side validation improves usability and… | L1 | verificado | C: validação no backend; o frontend só repete para a experiência. |
| **V2.2.3** — Verify that the application ensures that combinations of related data items are reasonable according to the pre-defined rules. | L2 | não testado | Fora do recorte desta passada. |
| **V2.3.1** — Verify that the application will only process business logic flows for the same user in the expected sequential step order and without skipping steps. | L1 | não testado | Fora do recorte desta passada. |
| **V2.3.2** — Verify that business logic limits are implemented per the application's documentation to avoid business logic flaws being exploited. | L2 | verificado | C+T: teto de execuções pagas por nó/matrícula (C06), orçamento de IA, limites por conta. |
| **V2.3.3** — Verify that transactions are being used at the business logic level such that either a business logic operation succeeds in its entirety or it is r… | L2 | não testado | Fora do recorte desta passada. |
| **V2.3.4** — Verify that business logic level locking mechanisms are used to ensure that limited quantity resources (such as theater seats or delivery slots) ca… | L2 | não testado | Fora do recorte desta passada. |
| **V2.3.5** — Verify that high-value business logic flows require multi-user approval to prevent unauthorized or accidental actions. This could include but is no… | L3 | não testado | Fora do recorte desta passada. |
| **V2.4.1** — Verify that anti-automation controls are in place to protect against excessive calls to application functions that could lead to data exfiltration,… | L2 | verificado | D: ATHN-02 (bloqueio após 4 erros, 429 também para a senha certa durante o bloqueio); C: limites por IP/conta para IA, voz, ciência, API Push. |
| **V2.4.2** — Verify that business logic flows require realistic human timing, preventing excessively rapid transaction submissions. | L3 | não testado | Fora do recorte desta passada. |

### V3 — Web Frontend Security

| Requisito | Nível | Status | Evidência / limitação |
|---|---|---|---|
| **V3.1.1** — Verify that application documentation states the expected security features that browsers using the application must support (such as HTTPS, HTTP S… | L3 | não testado | Fora do recorte desta passada. |
| **V3.2.1** — Verify that security controls are in place to prevent browsers from rendering content or functionality in HTTP responses in an incorrect context (e… | L1 | verificado | D: `X-Content-Type-Options: nosniff` na API e na interface; imagens com `CSP default-src 'none'` e CORP. |
| **V3.2.2** — Verify that content intended to be displayed as text, rather than rendered as HTML, is handled using safe rendering functions (such as createTextNo… | L1 | verificado | C: React renderiza texto; transcrições sem Markdown. |
| **V3.2.3** — Verify that the application avoids DOM clobbering when using client-side JavaScript by employing explicit variable declarations, performing strict … | L3 | não testado | Fora do recorte desta passada. |
| **V3.3.1** — Verify that cookies have the 'Secure' attribute set, and if the '\__Host-' prefix is not used for the cookie name, the '__Secure-' prefix must be u… | L1 | verificado | D: SESS-01 — `__Host-inia_session`, `Secure`. |
| **V3.3.2** — Verify that each cookie's 'SameSite' attribute value is set according to the purpose of the cookie, to limit exposure to user interface redress att… | L2 | verificado | D: SESS-01 — `SameSite=Lax`. |
| **V3.3.3** — Verify that cookies have the '__Host-' prefix for the cookie name unless they are explicitly designed to be shared with other hosts. | L2 | verificado | D: SESS-01/SESS-09 — prefixo `__Host-`; o mesmo token sem o prefixo é recusado (401). |
| **V3.3.4** — Verify that if the value of a cookie is not meant to be accessible to client-side scripts (such as a session token), the cookie must have the 'Http… | L2 | verificado | D: SESS-01 — `HttpOnly` (sessão e `inia_device`). |
| **V3.3.5** — Verify that when the application writes a cookie, the cookie name and value length combined are not over 4096 bytes. Overly large cookies will not … | L3 | verificado | D: cookie de sessão ≈ 650 bytes. |
| **V3.4.1** — Verify that a Strict-Transport-Security header field is included on all responses to enforce an HTTP Strict Transport Security (HSTS) policy. A max… | L1 | verificado | C+T: a API envia HSTS (helmet) e as páginas também quando a instalação é HTTPS (`next.config.ts`, `httpsDeployment`; conferido carregando a configuração com URL `https://` e `http://`). Em HTTP local não aparece, como deve. Ressalva: `includeSubDomains` só na API. Confirmar com TLS na homologação. |
| **V3.4.2** — Verify that the Cross-Origin Resource Sharing (CORS) Access-Control-Allow-Origin header field is a fixed value by the application, or if the Origin… | L1 | verificado | D: CORS-01..03 — origem fixa da interface; `null` e outras origens sem ACAO. |
| **V3.4.3** — Verify that HTTP responses include a Content-Security-Policy response header field which defines directives to ensure the browser only loads and ex… | L2 | verificado | D: CSP na API e na interface (nonce por requisição). R-07 isolado em 29/10: `style-src-elem` só com nonce ou hash fixo; `'unsafe-inline'` restrito a `style-src-attr` (atributos `style`). D: todas as telas no navegador sem `<style>` bloqueado. |
| **V3.4.4** — Verify that all HTTP responses contain an 'X-Content-Type-Options: nosniff' header field. This instructs browsers not to use content sniffing and M… | L2 | verificado | D: `nosniff` em todas as respostas observadas. |
| **V3.4.5** — Verify that the application sets a referrer policy to prevent leakage of technically sensitive data to third-party services via the 'Referer' HTTP … | L2 | verificado | D: `Referrer-Policy` (API `no-referrer`; interface `strict-origin-when-cross-origin`). |
| **V3.4.6** — Verify that the web application uses the frame-ancestors directive of the Content-Security-Policy header field for every HTTP response to ensure th… | L2 | verificado | D: `frame-ancestors 'none'` (interface) e `'self'` (API) + `X-Frame-Options`. |
| **V3.4.7** — Verify that the Content-Security-Policy header field specifies a location to report violations. | L3 | falhou | D: CSP sem `report-uri`/`report-to` (L3) — recomendação. |
| **V3.4.8** — Verify that all HTTP responses that initiate a document rendering (such as responses with Content-Type text/html), include the Cross‑Origin‑Opener‑… | L3 | verificado | D: `Cross-Origin-Opener-Policy: same-origin` nas duas camadas. |
| **V3.5.1** — Verify that, if the application does not rely on the CORS preflight mechanism to prevent disallowed cross-origin requests to use sensitive function… | L1 | verificado | D: CSRF-01/02/04 — escrita com cookie e `Origin` ou `Sec-Fetch-Site` de outro site → 403. Ressalva aceita R-26 (sem nenhum dos dois cabeçalhos passa — CSRF-03). |
| **V3.5.2** — Verify that, if the application relies on the CORS preflight mechanism to prevent disallowed cross-origin use of sensitive functionality, it is not… | L1 | não aplicável | A proteção não depende do preflight (guarda de origem). |
| **V3.5.3** — Verify that HTTP requests to sensitive functionality use appropriate HTTP methods such as POST, PUT, PATCH, or DELETE, and not methods defined by t… | L1 | não testado | Pendente: a auditoria Cloudflare aponta `GET /reports/proposals/:id` com efeito colateral (não revalidado aqui). |
| **V3.5.4** — Verify that separate applications are hosted on different hostnames to leverage the restrictions provided by same-origin policy, including how docu… | L2 | não testado | Fora do recorte desta passada. |
| **V3.5.5** — Verify that messages received by the postMessage interface are discarded if the origin of the message is not trusted, or if the syntax of the messa… | L2 | não testado | Fora do recorte desta passada. |
| **V3.5.6** — Verify that JSONP functionality is not enabled anywhere across the application to avoid Cross-Site Script Inclusion (XSSI) attacks. | L3 | verificado | C: sem JSONP. |
| **V3.5.7** — Verify that data requiring authorization is not included in script resource responses, like JavaScript files, to prevent Cross-Site Script Inclusio… | L3 | não testado | Fora do recorte desta passada. |
| **V3.5.8** — Verify that authenticated resources (such as images, videos, scripts, and other documents) can be loaded or embedded on behalf of the user only whe… | L3 | verificado | C+D: imagens de perfil exigem sessão e saem com CORP `same-site`. |
| **V3.6.1** — Verify that client-side assets, such as JavaScript libraries, CSS, or web fonts, are only hosted externally (e.g., on a Content Delivery Network) i… | L3 | verificado | C: fontes do `next/font` são embutidas no build; nenhum script de CDN. |
| **V3.7.1** — Verify that the application only uses client-side technologies which are still supported and considered secure. Examples of technologies which do n… | L2 | verificado | C: React 19 / Next 16.4.1 suportados (atualizado em 29/10; ver V15.2.1). |
| **V3.7.2** — Verify that the application will only automatically redirect the user to a different hostname or domain (which is not controlled by the application… | L2 | verificado | C+S: só navegação interna (`session-navigation.ts` — alerta de open redirect do Semgrep rejeitado: URLs fixas). |
| **V3.7.3** — Verify that the application shows a notification when the user is being redirected to a URL outside of the application's control, with an option to… | L3 | não testado | Fora do recorte desta passada. |
| **V3.7.4** — Verify that the application's top-level domain (e.g., site.tld) is added to the public preload list for HTTP Strict Transport Security (HSTS). This… | L3 | não testado | Fora do recorte desta passada. |
| **V3.7.5** — Verify that the application behaves as documented (such as warning the user or blocking access) if the browser used to access the application does … | L3 | não testado | Fora do recorte desta passada. |

### V4 — API and Web Service

| Requisito | Nível | Status | Evidência / limitação |
|---|---|---|---|
| **V4.1.1** — Verify that every HTTP response with a message body contains a Content-Type header field that matches the actual content of the response, including… | L1 | verificado | D: `Content-Type` coerente em todas as respostas da varredura. |
| **V4.1.2** — Verify that only user-facing endpoints (intended for manual web-browser access) automatically redirect from HTTP to HTTPS, while other services or … | L2 | não testado | Fora do recorte desta passada. |
| **V4.1.3** — Verify that any HTTP header field used by the application and set by an intermediary layer, such as a load balancer, a web proxy, or a backend-for-… | L2 | verificado | C+D: `TRUST_PROXY` explícito; CONF-02 — `X-Forwarded-For` forjado não abre `/internal/metrics`. |
| **V4.1.4** — Verify that only HTTP methods that are explicitly supported by the application or its API (including OPTIONS during preflight requests) can be used… | L3 | não testado | Fora do recorte desta passada. |
| **V4.1.5** — Verify that per-message digital signatures are used to provide additional assurance on top of transport protections for requests or transactions wh… | L3 | não testado | Fora do recorte desta passada. |
| **V4.2.1** — Verify that all application components (including load balancers, firewalls, and application servers) determine boundaries of incoming HTTP message… | L2 | não testado | Fora do recorte desta passada. |
| **V4.2.2** — Verify that when generating HTTP messages, the Content-Length header field does not conflict with the length of the content as determined by the fr… | L3 | não testado | Fora do recorte desta passada. |
| **V4.2.3** — Verify that the application does not send nor accept HTTP/2 or HTTP/3 messages with connection-specific header fields such as Transfer-Encoding to … | L3 | não testado | Fora do recorte desta passada. |
| **V4.2.4** — Verify that the application only accepts HTTP/2 and HTTP/3 requests where the header fields and values do not contain any CR (\r), LF (\n), or CRLF… | L3 | não testado | Fora do recorte desta passada. |
| **V4.2.5** — Verify that, if the application (backend or frontend) builds and sends requests, it uses validation, sanitization, or other mechanisms to avoid cre… | L3 | não testado | Fora do recorte desta passada. |
| **V4.3.1** — Verify that a query allowlist, depth limiting, amount limiting, or query cost analysis is used to prevent GraphQL or data layer expression Denial o… | L2 | não aplicável | Sem GraphQL. |
| **V4.3.2** — Verify that GraphQL introspection queries are disabled in the production environment unless the GraphQL API is meant to be used by other parties. | L2 | não aplicável | Sem GraphQL. |
| **V4.4.1** — Verify that WebSocket over TLS (WSS) is used for all WebSocket connections. | L1 | verificado | C+D: voz usa `wss://generativelanguage.googleapis.com` (CSP `connect-src`). |
| **V4.4.2** — Verify that, during the initial HTTP WebSocket handshake, the Origin header field is checked against a list of origins allowed for the application. | L2 | não aplicável | A INIA não hospeda WebSocket; o navegador fala com o provedor com token efêmero emitido pela API. |
| **V4.4.3** — Verify that, if the application's standard session management cannot be used, dedicated tokens are being used for this, which comply with the relev… | L2 | não aplicável | Idem. |
| **V4.4.4** — Verify that dedicated WebSocket session management tokens are initially obtained or validated through the previously authenticated HTTPS session wh… | L2 | não aplicável | Idem. |

### V5 — File Handling

| Requisito | Nível | Status | Evidência / limitação |
|---|---|---|---|
| **V5.1.1** — Verify that the documentation defines the permitted file types, expected file extensions, and maximum size (including unpacked size) for each uploa… | L2 | verificado | C: tipos e tamanhos documentados em `docs/security/mapa-de-superficies.md`. |
| **V5.2.1** — Verify that the application will only accept files of a size which it can process without causing a loss of performance or a denial of service attack. | L1 | verificado | C+D: JSON 1 MB (ERRH-02: 413), Push 10 MB, base 15 MB, Central 50 MB, imagem 8 MB. Ressalva: custo de parse (revisão A1/A2, pendente). |
| **V5.2.2** — Verify that when the application accepts a file, either on its own or within an archive such as a zip file, it checks if the file extension matches… | L1 | verificado | C+T: tipo pela assinatura binária (imagem, PDF, DOCX, ZIP). |
| **V5.2.3** — Verify that the application checks compressed files (e.g., zip, gz, docx, odt) against maximum allowed uncompressed size and against maximum number… | L2 | verificado | C+T: trava de ZIP por entrada (N04 corrigido em 1ea944cf pela sessão Cloudflare; revisão A3 sem desvio novo). |
| **V5.2.4** — Verify that a file size quota and maximum number of files per user are enforced to ensure that a single user cannot fill up the storage with too ma… | L3 | não testado | Fora do recorte desta passada. |
| **V5.2.5** — Verify that the application does not allow uploading compressed files containing symlinks unless this is specifically required (in which case it wi… | L3 | não testado | Fora do recorte desta passada. |
| **V5.2.6** — Verify that the application rejects uploaded images with a pixel size larger than the maximum allowed, to prevent pixel flood attacks. | L3 | verificado | C: largura/altura máximas na validação de imagem. |
| **V5.3.1** — Verify that files uploaded or generated by untrusted input and stored in a public folder, are not executed as server-side program code when accesse… | L1 | verificado | C: arquivos guardados no banco (bytea), nunca em pasta pública. |
| **V5.3.2** — Verify that when the application creates file paths for file operations, instead of user-submitted filenames, it uses internally generated or trust… | L1 | verificado | C: nenhum caminho de arquivo derivado do nome enviado. |
| **V5.3.3** — Verify that server-side file processing, such as file decompression, ignores user-provided path information to prevent vulnerabilities such as zip … | L3 | não testado | Fora do recorte desta passada. |
| **V5.4.1** — Verify that the application validates or ignores user-submitted filenames, including in a JSON, JSONP, or URL parameter and specifies a filename in… | L2 | não testado | Fora do recorte desta passada. |
| **V5.4.2** — Verify that file names served (e.g., in HTTP response header fields or email attachments) are encoded or sanitized (e.g., following RFC 6266) to pr… | L2 | verificado | C: `Content-Disposition` com ids/datas validados (`DATE` regex no CSV de diagnóstico). |
| **V5.4.3** — Verify that files obtained from untrusted sources are scanned by antivirus scanners to prevent serving of known malicious content. | L2 | falhou | C: sem antivírus nos uploads (bases de conhecimento, Central de Dados). Depende do ambiente da Vivo — recomendação. |

### V6 — Authentication

| Requisito | Nível | Status | Evidência / limitação |
|---|---|---|---|
| **V6.1.1** — Verify that application documentation defines how controls such as rate limiting, anti-automation, and adaptive response, are used to defend agains… | L1 | verificado | C: limites documentados em `docs/security/configuracao-segura.md`. |
| **V6.1.2** — Verify that a list of context-specific words is documented in order to prevent their use in passwords. The list could include permutations of organ… | L2 | verificado | C: lista de palavras previsíveis em `password-policy.ts` (curta — R-22). |
| **V6.1.3** — Verify that, if the application includes multiple authentication pathways, these are all documented together with the security controls and authent… | L2 | verificado | C+D: um caminho (e-mail + senha); API Push com token próprio, sem sessão (PUSH-01/02). |
| **V6.2.1** — Verify that user set passwords are at least 8 characters in length although a minimum of 15 characters is strongly recommended. | L1 | verificado | C: mínimo 8 (`PASSWORD_POLICY`). |
| **V6.2.2** — Verify that users can change their password. | L1 | verificado | C: `POST /auth/password`. |
| **V6.2.3** — Verify that password change functionality requires the user's current and new password. | L1 | verificado | C+D: exige a senha atual (ATHN-03). |
| **V6.2.4** — Verify that passwords submitted during account registration or password change are checked against an available set of, at least, the top 3000 pass… | L1 | falhou | C: lista local curta, não as 3.000 senhas mais comuns (R-22). |
| **V6.2.5** — Verify that passwords of any composition can be used, without rules limiting the type of characters permitted. There must be no requirement for a m… | L1 | não testado | Fora do recorte desta passada. |
| **V6.2.6** — Verify that password input fields use type=password to mask the entry. Applications may allow the user to temporarily view the entire masked passwo… | L1 | verificado | C: `type=password` com opção de mostrar (`password-input.tsx`). |
| **V6.2.7** — Verify that "paste" functionality, browser password helpers, and external password managers are permitted. | L1 | não testado | Fora do recorte desta passada. |
| **V6.2.8** — Verify that the application verifies the user's password exactly as received from the user, without any modifications such as truncation or case tr… | L1 | verificado | C: teto de 72 bytes RECUSA senha maior em vez de truncar (bcrypt). |
| **V6.2.9** — Verify that passwords of at least 64 characters are permitted. | L2 | verificado | C: 72 bytes cobre 64 caracteres ASCII (multibyte pode ficar abaixo de 64 — ressalva). |
| **V6.2.10** — Verify that a user's password stays valid until it is discovered to be compromised or the user rotates it. The application must not require periodi… | L2 | não testado | Fora do recorte desta passada. |
| **V6.2.11** — Verify that the documented list of context specific words is used to prevent easy to guess passwords being created. | L2 | verificado | C: palavras de contexto aplicadas (`COMMON_PASSWORD`). |
| **V6.2.12** — Verify that passwords submitted during account registration or password changes are checked against a set of breached passwords. | L2 | falhou | C: sem verificação contra senhas vazadas (R-22) — recomendação (lista local, sem serviço externo). |
| **V6.3.1** — Verify that controls to prevent attacks such as credential stuffing and password brute force are implemented according to the application's securit… | L1 | verificado | D: ATHN-02; C: reserva antes do bcrypt, teto por IP e por e-mail, fila do bcrypt limitada. |
| **V6.3.2** — Verify that default user accounts (e.g., "root", "admin", or "sa") are not present in the application or are disabled. | L1 | verificado | C: massa demo recusada em produção; administrador criado por `admin:create` com senha forte. |
| **V6.3.3** — Verify that either a multi-factor authentication mechanism or a combination of single-factor authentication mechanisms, must be used in order to ac… | L2 | falhou | C: sem MFA nem SSO corporativo (L2) — principal lacuna de autenticação. Adiado por decisão da INIA (29/10/2026) para uma próxima etapa. |
| **V6.3.4** — Verify that, if the application includes multiple authentication pathways, there are no undocumented pathways and that security controls and authen… | L2 | verificado | C+D: nenhuma rota de autenticação além das documentadas (inventário de 475 rotas). |
| **V6.3.5** — Verify that users are notified of suspicious authentication attempts (successful or unsuccessful). This may include authentication attempts from an… | L3 | não testado | Fora do recorte desta passada. |
| **V6.3.6** — Verify that email is not used as either a single-factor or multi-factor authentication mechanism. | L3 | não testado | Fora do recorte desta passada. |
| **V6.3.7** — Verify that users are notified after updates to authentication details, such as credential resets or modification of the username or email address. | L3 | não testado | Fora do recorte desta passada. |
| **V6.3.8** — Verify that valid users cannot be deduced from failed authentication challenges, such as by basing on error messages, HTTP response codes, or diffe… | L3 | verificado | D: ATHN-01 — mesma mensagem e mesmo tempo (68 × 64 ms, 12 amostras) para e-mail inexistente e senha errada. |
| **V6.4.1** — Verify that system generated initial passwords or activation codes are securely randomly generated, follow the existing password policy, and expire… | L1 | verificado | C: senha temporária gerada pelo servidor e troca obrigatória no 1º acesso (migration 118). |
| **V6.4.2** — Verify that password hints or knowledge-based authentication (so-called "secret questions") are not present. | L1 | verificado | C: sem dicas nem perguntas secretas. |
| **V6.4.3** — Verify that a secure process for resetting a forgotten password is implemented, that does not bypass any enabled multi-factor authentication mechan… | L2 | verificado | C: redefinição só pela liberação de acesso do administrador (senha temporária, validade, troca obrigatória). |
| **V6.4.4** — Verify that if a multi-factor authentication factor is lost, evidence of identity proofing is performed at the same level as during enrollment. | L2 | não testado | Fora do recorte desta passada. |
| **V6.4.5** — Verify that renewal instructions for authentication mechanisms which expire are sent with enough time to be carried out before the old authenticati… | L3 | não testado | Fora do recorte desta passada. |
| **V6.4.6** — Verify that administrative users can initiate the password reset process for the user, but that this does not allow them to change or choose the us… | L3 | verificado | C: o administrador inicia a redefinição sem ver nem escolher a senha final. |
| **V6.5.1** — Verify that lookup secrets, out-of-band authentication requests or codes, and time-based one-time passwords (TOTPs) are only successfully usable once. | L2 | não testado | Fora do recorte desta passada. |
| **V6.5.2** — Verify that, when being stored in the application's backend, lookup secrets with less than 112 bits of entropy (19 random alphanumeric characters o… | L2 | não testado | Fora do recorte desta passada. |
| **V6.5.3** — Verify that lookup secrets, out-of-band authentication code, and time-based one-time password seeds, are generated using a Cryptographically Secure… | L2 | não testado | Fora do recorte desta passada. |
| **V6.5.4** — Verify that lookup secrets and out-of-band authentication codes have a minimum of 20 bits of entropy (typically 4 random alphanumeric characters or… | L2 | não testado | Fora do recorte desta passada. |
| **V6.5.5** — Verify that out-of-band authentication requests, codes, or tokens, as well as time-based one-time passwords (TOTPs) have a defined lifetime. Out of… | L2 | não testado | Fora do recorte desta passada. |
| **V6.5.6** — Verify that any authentication factor (including physical devices) can be revoked in case of theft or other loss. | L3 | não testado | Fora do recorte desta passada. |
| **V6.5.7** — Verify that biometric authentication mechanisms are only used as secondary factors together with either something you have or something you know. | L3 | não testado | Fora do recorte desta passada. |
| **V6.5.8** — Verify that time-based one-time passwords (TOTPs) are checked based on a time source from a trusted service and not from an untrusted or client pro… | L3 | não testado | Fora do recorte desta passada. |
| **V6.6.1** — Verify that authentication mechanisms using the Public Switched Telephone Network (PSTN) to deliver One-time Passwords (OTPs) via phone or SMS are … | L2 | não testado | Fora do recorte desta passada. |
| **V6.6.2** — Verify that out-of-band authentication requests, codes, or tokens are bound to the original authentication request for which they were generated an… | L2 | não testado | Fora do recorte desta passada. |
| **V6.6.3** — Verify that a code based out-of-band authentication mechanism is protected against brute force attacks by using rate limiting. Consider also using … | L2 | não testado | Fora do recorte desta passada. |
| **V6.6.4** — Verify that, where push notifications are used for multi-factor authentication, rate limiting is used to prevent push bombing attacks. Number match… | L3 | não testado | Fora do recorte desta passada. |
| **V6.7.1** — Verify that the certificates used to verify cryptographic authentication assertions are stored in a way protects them from modification. | L3 | não testado | Fora do recorte desta passada. |
| **V6.7.2** — Verify that the challenge nonce is at least 64 bits in length, and statistically unique or unique over the lifetime of the cryptographic device. | L3 | não testado | Fora do recorte desta passada. |
| **V6.8.1** — Verify that, if the application supports multiple identity providers (IdPs), the user's identity cannot be spoofed via another supported identity p… | L2 | não testado | Fora do recorte desta passada. |
| **V6.8.2** — Verify that the presence and integrity of digital signatures on authentication assertions (for example on JWTs or SAML assertions) are always valid… | L2 | não testado | Fora do recorte desta passada. |
| **V6.8.3** — Verify that SAML assertions are uniquely processed and used only once within the validity period to prevent replay attacks. | L2 | não testado | Fora do recorte desta passada. |
| **V6.8.4** — Verify that, if an application uses a separate Identity Provider (IdP) and expects specific authentication strength, methods, or recentness for spe… | L2 | não testado | Fora do recorte desta passada. |

### V7 — Session Management

| Requisito | Nível | Status | Evidência / limitação |
|---|---|---|---|
| **V7.1.1** — Verify that the user's session inactivity timeout and absolute maximum session lifetime are documented, are appropriate in combination with other c… | L2 | verificado | C: inatividade 30 min e validade absoluta 12 h documentadas (`configuracao-segura.md`). |
| **V7.1.2** — Verify that the documentation defines how many concurrent (parallel) sessions are allowed for one account as well as the intended behaviors and act… | L2 | não testado | Fora do recorte desta passada. |
| **V7.1.3** — Verify that all systems that create and manage user sessions as part of a federated identity management ecosystem (such as SSO systems) are documen… | L2 | não testado | Fora do recorte desta passada. |
| **V7.2.1** — Verify that the application performs all session token verification using a trusted, backend service. | L1 | verificado | C+D: JWT conferido no servidor e estado da conta/jti no banco a cada requisição. |
| **V7.2.2** — Verify that the application uses either self-contained or reference tokens that are dynamically generated for session management, i.e. not using st… | L1 | verificado | D: JWT HS256 com `jti` (SESS-02). |
| **V7.2.3** — Verify that if reference tokens are used to represent user sessions, they are unique and generated using a cryptographically secure pseudo-random n… | L1 | não aplicável | Token autocontido. |
| **V7.2.4** — Verify that the application generates a new session token on user authentication, including re-authentication, and terminates the current session t… | L1 | verificado | D: cada login emite token novo (jti distinto). |
| **V7.3.1** — Verify that there is an inactivity timeout such that re-authentication is enforced according to risk analysis and documented security decisions. | L2 | verificado | D: o token usado pelo ZAP caiu com `SESSION_IDLE` depois de 30 min só com leituras. |
| **V7.3.2** — Verify that there is an absolute maximum session lifetime such that re-authentication is enforced according to risk analysis and documented securit… | L2 | verificado | D: `Max-Age=43200` / `exp` de 12 h. |
| **V7.4.1** — Verify that when session termination is triggered (such as logout or expiration), the application disallows any further use of the session. For ref… | L1 | verificado | D: SESS-03 — token reaproveitado depois do logout → 401. |
| **V7.4.2** — Verify that the application terminates all active sessions when a user account is disabled or deleted (such as an employee leaving the company). | L1 | verificado | C+T: conta desativada derruba a sessão (`session_version`; provas de banco anteriores). |
| **V7.4.3** — Verify that the application gives the option to terminate all other active sessions after a successful change or removal of any authentication fact… | L2 | verificado | D: SESS-04 — 'sair de todos' invalida as outras sessões; troca de senha incrementa `session_version`. |
| **V7.4.4** — Verify that all pages that require authentication have easy and visible access to logout functionality. | L2 | não testado | Fora do recorte desta passada. |
| **V7.4.5** — Verify that application administrators are able to terminate active sessions for an individual user or for all users. | L2 | não testado | Fora do recorte desta passada. |
| **V7.5.1** — Verify that the application requires full re-authentication before allowing modifications to sensitive account attributes which may affect authenti… | L2 | verificado | C: troca de senha exige a senha atual. |
| **V7.5.2** — Verify that users are able to view and (having authenticated again with at least one factor) terminate any or all currently active sessions. | L2 | falhou | C: 'sair de todos os aparelhos' existe, mas não há lista das sessões ativas (L2). |
| **V7.5.3** — Verify that the application requires further authentication with at least one factor or secondary verification before performing highly sensitive t… | L3 | não testado | Fora do recorte desta passada. |
| **V7.6.1** — Verify that session lifetime and termination between Relying Parties (RPs) and Identity Providers (IdPs) behave as documented, requiring re-authent… | L2 | não aplicável | Sem IdP federado. |
| **V7.6.2** — Verify that creation of a session requires either the user's consent or an explicit action, preventing the creation of new application sessions wit… | L2 | não aplicável | Idem. |

### V8 — Authorization

| Requisito | Nível | Status | Evidência / limitação |
|---|---|---|---|
| **V8.1.1** — Verify that authorization documentation defines rules for restricting function-level and data-specific access based on consumer permissions and res… | L1 | verificado | C: `docs/dev/memoria/acesso.md` (papéis, permissões, escopos). |
| **V8.1.2** — Verify that authorization documentation defines rules for field-level access restrictions (both read and write) based on consumer permissions and r… | L2 | não testado | Fora do recorte desta passada. |
| **V8.1.3** — Verify that the application's documentation defines the environmental and contextual attributes (including but not limited to, time of day, user lo… | L3 | não testado | Fora do recorte desta passada. |
| **V8.1.4** — Verify that authentication and authorization documentation defines how environmental and contextual factors are used in decision-making, in additio… | L3 | não testado | Fora do recorte desta passada. |
| **V8.2.1** — Verify that the application ensures that function-level access is restricted to consumers with explicit permissions. | L1 | verificado | D: S1 — 471/472 rotas → 401 sem sessão; S2 — operador em 322 rotas `/admin`: 318 → 403 e as 4 restantes explicadas (validação antes da permissão sem efeito; com corpo válido → 403; `/admin/ai/me` devolve só as permissões da própria pessoa). |
| **V8.2.2** — Verify that the application ensures that data-specific access is restricted to consumers with explicit permissions to specific data items to mitiga… | L1 | falhou | D+T: APPSEC-02 (C-N1 = h19) — carga de Estrutura dá a uma conta sob custódia de admin de outro Grupo acesso às fichas do Grupo B (prova de banco). CORRIGIDO pela sessão da auditoria Cloudflare (4859d40f + 77c5adcd) e retestado (prova 3/3). |
| **V8.2.3** — Verify that the application ensures that field-level access is restricted to consumers with explicit permissions to specific fields to mitigate bro… | L2 | falhou | D: APPSEC-01 (B1) — tipo exato de afastamento de líder exposto na simulação de política. CORRIGIDO e retestado nesta rodada. |
| **V8.2.4** — Verify that adaptive security controls based on a consumer's environmental and contextual attributes (such as time of day, location, IP address, or… | L3 | não testado | Fora do recorte desta passada. |
| **V8.3.1** — Verify that the application enforces authorization rules at a trusted service layer and doesn't rely on controls that an untrusted consumer could m… | L1 | verificado | C+D: autorização no servidor; a interface não decide acesso. |
| **V8.3.2** — Verify that changes to values on which authorization decisions are made are applied immediately. Where changes cannot be applied immediately, (such… | L3 | verificado | C: nível ao vivo do cadastro a cada requisição (`require-auth.ts`). |
| **V8.3.3** — Verify that access to an object is based on the originating subject's (e.g. consumer's) permissions, not on the permissions of any intermediary or … | L3 | não testado | Fora do recorte desta passada. |
| **V8.4.1** — Verify that multi-tenant applications use cross-tenant controls to ensure consumer operations will never affect tenants with which they do not have… | L2 | verificado | D: S3 — admin geral da org B em 37 rotas de detalhe × 34 ids reais da org A: nenhum dado (404/403 ou vazio); S4 — 133 listas sem id da org A. Ressalva R-01 (organização fixa em módulos legados, latente). |
| **V8.4.2** — Verify that access to administrative interfaces incorporates multiple layers of security, including continuous consumer identity verification, devi… | L3 | não testado | Fora do recorte desta passada. |

### V9 — Self-contained Tokens

| Requisito | Nível | Status | Evidência / limitação |
|---|---|---|---|
| **V9.1.1** — Verify that self-contained tokens are validated using their digital signature or MAC to protect against tampering before accepting the token's cont… | L1 | verificado | D: SESS-05 — payload alterado com assinatura antiga → 401. |
| **V9.1.2** — Verify that only algorithms on an allowlist can be used to create and verify self-contained tokens, for a given context. The allowlist must include… | L1 | verificado | D: SESS-06/08 — `alg=none` e HS512 → 401 (HS256 fixo). |
| **V9.1.3** — Verify that key material that is used to validate self-contained tokens is from trusted pre-configured sources for the token issuer, preventing att… | L1 | verificado | C+D: chave só do ambiente; produção recusa o segredo publicado (SESS-07: token assinado com o valor de exemplo → 401). |
| **V9.2.1** — Verify that, if a validity time span is present in the token data, the token and its content are accepted only if the verification time is within t… | L1 | verificado | C+D: `exp` conferido; sessão de 12 h. |
| **V9.2.2** — Verify that the service receiving a token validates the token to be the correct type and is meant for the intended purpose before accepting the tok… | L2 | não testado | Fora do recorte desta passada. |
| **V9.2.3** — Verify that the service only accepts tokens which are intended for use with that service (audience). For JWTs, this can be achieved by validating t… | L2 | não testado | Fora do recorte desta passada. |
| **V9.2.4** — Verify that, if a token issuer uses the same private key for issuing tokens to different audiences, the issued tokens contain an audience restricti… | L2 | não testado | Fora do recorte desta passada. |

### V10 — OAuth and OIDC

Capítulo inteiro **não aplicável** (36 requisitos): Sem OAuth/OIDC (autenticação local).


### V11 — Cryptography

| Requisito | Nível | Status | Evidência / limitação |
|---|---|---|---|
| **V11.1.1** — Verify that there is a documented policy for management of cryptographic keys and a cryptographic key lifecycle that follows a key management stand… | L2 | verificado | C: rotação documentada (`secrets:rotate`, `DATA_HUB_SECRET_KEY_PREVIOUS`). |
| **V11.1.2** — Verify that a cryptographic inventory is performed, maintained, regularly updated, and includes all cryptographic keys, algorithms, and certificate… | L2 | não testado | Fora do recorte desta passada. |
| **V11.1.3** — Verify that cryptographic discovery mechanisms are employed to identify all instances of cryptography in the system, including encryption, hashing,… | L3 | não testado | Fora do recorte desta passada. |
| **V11.1.4** — Verify that a cryptographic inventory is maintained. This must include a documented plan that outlines the migration path to new cryptographic stan… | L3 | não testado | Fora do recorte desta passada. |
| **V11.2.1** — Verify that industry-validated implementations (including libraries and hardware-accelerated implementations) are used for cryptographic operations. | L2 | verificado | C: `node:crypto`, `bcryptjs`. |
| **V11.2.2** — Verify that the application is designed with crypto agility such that random number, authenticated encryption, MAC, or hashing algorithms, key leng… | L2 | verificado | C: `key_version` nos segredos (v1 → v2 com AAD). |
| **V11.2.3** — Verify that all cryptographic primitives utilize a minimum of 128-bits of security based on the algorithm, key size, and configuration. For example… | L2 | verificado | C: AES-256-GCM, HMAC-SHA256, HKDF. |
| **V11.2.4** — Verify that all cryptographic operations are constant-time, with no 'short-circuit' operations in comparisons, calculations, or returns, to avoid l… | L3 | não testado | Fora do recorte desta passada. |
| **V11.2.5** — Verify that all cryptographic modules fail securely, and errors are handled in a way that does not enable vulnerabilities, such as Padding Oracle a… | L3 | não testado | Fora do recorte desta passada. |
| **V11.3.1** — Verify that insecure block modes (e.g., ECB) and weak padding schemes (e.g., PKCS#1 v1.5) are not used. | L1 | verificado | C: sem ECB/PKCS#1 v1.5. |
| **V11.3.2** — Verify that only approved ciphers and modes such as AES with GCM are used. | L1 | verificado | C: AES-GCM. |
| **V11.3.3** — Verify that encrypted data is protected against unauthorized modification preferably by using an approved authenticated encryption method or by com… | L2 | verificado | C+T: GCM com AAD por dono; tag agora fixada em 16 bytes (APPSEC-05 — antes uma tag truncada era aceita na decifragem: teste falhava no código anterior). |
| **V11.3.4** — Verify that nonces, initialization vectors, and other single-use numbers are not used for more than one encryption key and data-element pair. The m… | L3 | verificado | C: IV aleatório de 12 bytes por cifragem. |
| **V11.3.5** — Verify that any combination of an encryption algorithm and a MAC algorithm is operating in encrypt-then-MAC mode. | L3 | não aplicável | Cifra autenticada (AEAD). |
| **V11.4.1** — Verify that only approved hash functions are used for general cryptographic use cases, including digital signatures, HMAC, KDF, and random bit gene… | L1 | verificado | C: SHA-256. |
| **V11.4.2** — Verify that passwords are stored using an approved, computationally intensive, key derivation function (also known as a "password hashing function"… | L2 | verificado | C: bcrypt custo 10 (todas as contas da massa: `$2b$10$`). |
| **V11.4.3** — Verify that hash functions used in digital signatures, as part of data authentication or data integrity are collision resistant and have appropriat… | L2 | verificado | C: SHA-256 em HMAC/idempotência. |
| **V11.4.4** — Verify that the application uses approved key derivation functions with key stretching parameters when deriving secret keys from passwords. The par… | L2 | verificado | C: HKDF por rótulo (`derived-keys.ts`). |
| **V11.5.1** — Verify that all random numbers and strings which are intended to be non-guessable must be generated using a cryptographically secure pseudo-random … | L2 | verificado | C: `randomBytes`/`randomUUID`. |
| **V11.5.2** — Verify that the random number generation mechanism in use is designed to work securely, even under heavy demand. | L3 | não testado | Fora do recorte desta passada. |
| **V11.6.1** — Verify that only approved cryptographic algorithms and modes of operation are used for key generation and seeding, and digital signature generation… | L2 | não testado | Fora do recorte desta passada. |
| **V11.6.2** — Verify that approved cryptographic algorithms are used for key exchange (such as Diffie-Hellman) with a focus on ensuring that key exchange mechani… | L3 | não testado | Fora do recorte desta passada. |
| **V11.7.1** — Verify that full memory encryption is in use that protects sensitive data while it is in use, preventing access by unauthorized users or processes. | L3 | não testado | Fora do recorte desta passada. |
| **V11.7.2** — Verify that data minimization ensures the minimal amount of data is exposed during processing, and ensure that data is encrypted immediately after … | L3 | não testado | Fora do recorte desta passada. |

### V12 — Secure Communication

| Requisito | Nível | Status | Evidência / limitação |
|---|---|---|---|
| **V12.1.1** — Verify that only the latest recommended versions of the TLS protocol are enabled, such as TLS 1.2 and TLS 1.3. The latest version of the TLS protoc… | L1 | não testado | TLS termina no IIS — validar na homologação. |
| **V12.1.2** — Verify that only recommended cipher suites are enabled, with the strongest cipher suites set as preferred. L3 applications must only support cipher… | L2 | não testado | Idem. |
| **V12.1.3** — Verify that the application validates that mTLS client certificates are trusted before using the certificate identity for authentication or authori… | L2 | não testado | Fora do recorte desta passada. |
| **V12.1.4** — Verify that proper certification revocation, such as Online Certificate Status Protocol (OCSP) Stapling, is enabled and configured. | L3 | não testado | Fora do recorte desta passada. |
| **V12.1.5** — Verify that Encrypted Client Hello (ECH) is enabled in the application's TLS settings to prevent exposure of sensitive metadata, such as the Server… | L3 | não testado | Fora do recorte desta passada. |
| **V12.2.1** — Verify that TLS is used for all connectivity between a client and external facing, HTTP-based services, and does not fall back to insecure or unenc… | L1 | não testado | Idem. |
| **V12.2.2** — Verify that external facing services use publicly trusted TLS certificates. | L1 | não testado | Idem. |
| **V12.3.1** — Verify that an encrypted protocol such as TLS is used for all inbound and outbound connections to and from the application, including monitoring sy… | L2 | não testado | Fora do recorte desta passada. |
| **V12.3.2** — Verify that TLS clients validate certificates received before communicating with a TLS server. | L2 | verificado | C: bancos externos novos em `VERIFY_FULL`; MySQL com `verifyIdentity` (R-08: fontes antigas). |
| **V12.3.3** — Verify that TLS or another appropriate transport encryption mechanism used for all connectivity between internal, HTTP-based services within the ap… | L2 | não testado | Fora do recorte desta passada. |
| **V12.3.4** — Verify that TLS connections between internal services use trusted certificates. Where internally generated or self-signed certificates are used, th… | L2 | não testado | Fora do recorte desta passada. |
| **V12.3.5** — Verify that services communicating internally within a system (intra-service communications) use strong authentication to ensure that each endpoint… | L3 | não testado | Fora do recorte desta passada. |

### V13 — Configuration

| Requisito | Nível | Status | Evidência / limitação |
|---|---|---|---|
| **V13.1.1** — Verify that all communication needs for the application are documented. This must include external services which the application relies upon and c… | L2 | verificado | C: integrações listadas em `mapa-de-superficies.md`. |
| **V13.1.2** — Verify that for each service the application uses, the documentation defines the maximum number of concurrent connections (e.g., connection pool li… | L3 | não testado | Fora do recorte desta passada. |
| **V13.1.3** — Verify that the application documentation defines resource‑management strategies for every external system or service it uses (e.g., databases, fil… | L3 | não testado | Fora do recorte desta passada. |
| **V13.1.4** — Verify that the application's documentation defines the secrets that are critical for the security of the application and a schedule for rotating t… | L3 | não testado | Fora do recorte desta passada. |
| **V13.2.1** — Verify that communications between backend application components that don't support the application's standard user session mechanism, including A… | L2 | não testado | Fora do recorte desta passada. |
| **V13.2.2** — Verify that communications between backend application components, including local or operating system services, APIs, middleware, and data layers,… | L2 | não testado | Fora do recorte desta passada. |
| **V13.2.3** — Verify that if a credential has to be used for service authentication, the credential being used by the consumer is not a default credential (e.g.,… | L2 | não testado | Fora do recorte desta passada. |
| **V13.2.4** — Verify that an allowlist is used to define the external resources or systems with which the application is permitted to communicate (e.g., for outb… | L2 | verificado | C+D: `INIA_OUTBOUND_MODE=ALLOWLIST` (usado na API isolada). |
| **V13.2.5** — Verify that the web or application server is configured with an allowlist of resources or systems to which the server can send requests or load dat… | L2 | verificado | Idem. |
| **V13.2.6** — Verify that where the application connects to separate services, it follows the documented configuration for each connection, such as maximum paral… | L3 | não testado | Fora do recorte desta passada. |
| **V13.3.1** — Verify that a secrets management solution, such as a key vault, is used to securely create, store, control access to, and destroy backend secrets. … | L2 | falhou | C: segredos em `.env` + cifra de aplicação com `DATA_HUB_SECRET_KEY`; sem cofre (DPAPI/Key Vault). Recomendação para produção na Vivo. |
| **V13.3.2** — Verify that access to secret assets adheres to the principle of least privilege. | L2 | não testado | Fora do recorte desta passada. |
| **V13.3.3** — Verify that all cryptographic operations are performed using an isolated security module (such as a vault or hardware security module) to securely … | L3 | não testado | Fora do recorte desta passada. |
| **V13.3.4** — Verify that secrets are configured to expire and be rotated based on the application's documentation. | L3 | não testado | Fora do recorte desta passada. |
| **V13.4.1** — Verify that the application is deployed either without any source control metadata, including the .git or .svn folders, or in a way that these fold… | L1 | não testado | Fora do recorte desta passada. |
| **V13.4.2** — Verify that debug modes are disabled for all components in production environments to prevent exposure of debugging features and information leakage. | L2 | verificado | D: `NODE_ENV=production`; erros genéricos sem stack (ERRH-01..04); 0 respostas 5xx em 528.930 requisições do ZAP. |
| **V13.4.3** — Verify that web servers do not expose directory listings to clients unless explicitly intended. | L2 | não testado | Fora do recorte desta passada. |
| **V13.4.4** — Verify that using the HTTP TRACE method is not supported in production environments, to avoid potential information leakage. | L2 | verificado | D: `TRACE` → 404. |
| **V13.4.5** — Verify that documentation (such as for internal APIs) and monitoring endpoints are not exposed unless explicitly intended. | L2 | verificado | D: CONF-01/02 — `/internal/metrics` só com token, IP local e sem cabeçalho de proxy; `/health` do worker protegido (C10). |
| **V13.4.6** — Verify that the application does not expose detailed version information of backend components. | L3 | verificado | D: sem `X-Powered-By` (helmet; Next sem o cabeçalho). |
| **V13.4.7** — Verify that the web tier is configured to only serve files with specific file extensions to prevent unintentional information, configuration, and s… | L3 | não testado | Fora do recorte desta passada. |

### V14 — Data Protection

| Requisito | Nível | Status | Evidência / limitação |
|---|---|---|---|
| **V14.1.1** — Verify that all sensitive data created and processed by the application has been identified and classified into protection levels. This includes da… | L2 | não testado | Fora do recorte desta passada. |
| **V14.1.2** — Verify that all sensitive data protection levels have a documented set of protection requirements. This must include (but not be limited to) requir… | L2 | não testado | Fora do recorte desta passada. |
| **V14.2.1** — Verify that sensitive data is only sent to the server in the HTTP message body or header fields, and that the URL and query string do not contain s… | L1 | verificado | C: credenciais só no corpo; nenhuma senha/token em URL. |
| **V14.2.2** — Verify that the application prevents sensitive data from being cached in server components, such as load balancers and application caches, or ensur… | L2 | verificado | D: API com `Cache-Control: no-store`; páginas `private, no-store`. |
| **V14.2.3** — Verify that defined sensitive data is not sent to untrusted parties (e.g., user trackers) to prevent unwanted collection of data outside of the app… | L2 | verificado | C: sem rastreadores de terceiros (coleta de uso é interna). |
| **V14.2.4** — Verify that controls around sensitive data related to encryption, integrity verification, retention, how the data is to be logged, access controls … | L2 | não testado | Fora do recorte desta passada. |
| **V14.2.5** — Verify that caching mechanisms are configured to only cache responses which have the expected content type for that resource and do not contain sen… | L3 | não testado | Fora do recorte desta passada. |
| **V14.2.6** — Verify that the application only returns the minimum required sensitive data for the application's functionality. For example, only returning some … | L3 | falhou | D: SESS-02 — o JWT (cookie) carrega nome, e-mail, cargo, foto e Grupo (dado pessoal desnecessário para a sessão) — endurecimento. B1 (excesso de dado sensível) corrigido. |
| **V14.2.7** — Verify that sensitive information is subject to data retention classification, ensuring that outdated or unnecessary data is deleted automatically,… | L3 | não testado | Fora do recorte desta passada. |
| **V14.2.8** — Verify that sensitive information is removed from the metadata of user-submitted files unless storage is consented to by the user. | L3 | falhou | T: APPSEC-04 — JPEG com marcador RST/TEM antes do SOF mantinha EXIF/GPS. CORRIGIDO e retestado. |
| **V14.3.1** — Verify that authenticated data is cleared from client storage, such as the browser DOM, after the client or session is terminated. The 'Clear-Site-… | L1 | verificado | C+T: fronteira de sessão recarrega o documento (C08). |
| **V14.3.2** — Verify that the application sets sufficient anti-caching HTTP response header fields (i.e., Cache-Control: no-store) so that sensitive data is not … | L2 | verificado | D: `no-store`. |
| **V14.3.3** — Verify that data stored in browser storage (such as localStorage, sessionStorage, IndexedDB, or cookies) does not contain sensitive data, with the … | L2 | não testado | Fora do recorte desta passada. |

### V15 — Secure Coding and Architecture

| Requisito | Nível | Status | Evidência / limitação |
|---|---|---|---|
| **V15.1.1** — Verify that application documentation defines risk based remediation time frames for 3rd party component versions with vulnerabilities and for upda… | L1 | verificado | C: prazos de correção por gravidade, escopo e alcance em `docs/security/politica-de-dependencias.md` (proposta de 29/10/2026; aprovação formal pendente). |
| **V15.1.2** — Verify that an inventory catalog, such as software bill of materials (SBOM), is maintained of all third-party libraries in use, including verifying… | L2 | verificado | S: SBOM CycloneDX/SPDX gerado nesta rodada (Syft), anexado. |
| **V15.1.3** — Verify that the application documentation identifies functionality which is time-consuming or resource-demanding. This must include how to prevent … | L2 | não testado | Fora do recorte desta passada. |
| **V15.1.4** — Verify that application documentation highlights third-party libraries which are considered to be "risky components". | L3 | não testado | Fora do recorte desta passada. |
| **V15.1.5** — Verify that application documentation highlights parts of the application where "dangerous functionality" is being used. | L3 | não testado | Fora do recorte desta passada. |
| **V15.2.1** — Verify that the application only contains components which have not breached the documented update and remediation time frames. | L1 | falhou | S: em produção havia `next@16.3.8` (2 avisos críticos, 1 alto), `body-parser@2.3.0`, `zod@4.5.4`, `multer@2.4.0` — ATUALIZADOS em 29/10 (16.4.1, 2.4.0, 4.6.7, 2.5.0) e verificados. O `zod` do frontend também foi para 4.6.7. Restam avisos sem caminho alcançável (`@azure/msal-node`, `uuid`). |
| **V15.2.2** — Verify that the application has implemented defenses against loss of availability due to functionality which is time-consuming or resource-demandin… | L2 | não testado | Fora do recorte desta passada. |
| **V15.2.3** — Verify that the production environment only includes functionality that is required for the application to function, and does not expose extraneous… | L2 | não testado | Fora do recorte desta passada. |
| **V15.2.4** — Verify that third-party components and all of their transitive dependencies are included from the expected repository, whether internally owned or … | L3 | não testado | Fora do recorte desta passada. |
| **V15.2.5** — Verify that the application implements additional protections around parts of the application which are documented as containing "dangerous functio… | L3 | não testado | Fora do recorte desta passada. |
| **V15.3.1** — Verify that the application only returns the required subset of fields from a data object. For example, it should not return an entire data object,… | L1 | não testado | Fora do recorte desta passada. |
| **V15.3.2** — Verify that where the application backend makes calls to external URLs, it is configured to not follow redirects unless it is intended functionality. | L2 | verificado | C: saída de rede com redirect manual. |
| **V15.3.3** — Verify that the application has countermeasures to protect against mass assignment attacks by limiting allowed fields per controller and action, e.… | L2 | verificado | C+D: schemas zod `strict` (`unrecognized_keys` recusado). |
| **V15.3.4** — Verify that all proxying and middleware components transfer the user's original IP address correctly using trusted data fields that cannot be manip… | L2 | verificado | C: IP do cliente só de proxy confiável (`TRUST_PROXY`). |
| **V15.3.5** — Verify that the application explicitly ensures that variables are of the correct type and performs strict equality and comparator operations. This … | L2 | não testado | Fora do recorte desta passada. |
| **V15.3.6** — Verify that JavaScript code is written in a way that prevents prototype pollution, for example, by using Set() or Map() instead of object literals. | L2 | verificado | S+C: 7 `prototype-pollution-loop` são leituras de caminho, sem escrita de chave controlada. |
| **V15.3.7** — Verify that the application has defenses against HTTP parameter pollution attacks, particularly if the application framework makes no distinction a… | L2 | não testado | Fora do recorte desta passada. |
| **V15.4.1** — Verify that shared objects in multi-threaded code (such as caches, files, or in-memory objects accessed by multiple threads) are accessed safely by… | L3 | não testado | Fora do recorte desta passada. |
| **V15.4.2** — Verify that checks on a resource's state, such as its existence or permissions, and the actions that depend on them are performed as a single atomi… | L3 | não testado | Fora do recorte desta passada. |
| **V15.4.3** — Verify that locks are used consistently to avoid threads getting stuck, whether by waiting on each other or retrying endlessly, and that locking lo… | L3 | não testado | Fora do recorte desta passada. |
| **V15.4.4** — Verify that resource allocation policies prevent thread starvation by ensuring fair access to resources, such as by leveraging thread pools, allowi… | L3 | não testado | Fora do recorte desta passada. |

### V16 — Security Logging and Error Handling

| Requisito | Nível | Status | Evidência / limitação |
|---|---|---|---|
| **V16.1.1** — Verify that an inventory exists documenting the logging performed at each layer of the application's technology stack, what events are being logged… | L2 | não testado | Fora do recorte desta passada. |
| **V16.2.1** — Verify that each log entry includes necessary metadata (such as when, where, who, what) that would allow for a detailed investigation of the timeli… | L2 | não testado | Fora do recorte desta passada. |
| **V16.2.2** — Verify that time sources for all logging components are synchronized, and that timestamps in security event metadata use UTC or include an explicit… | L2 | não testado | Fora do recorte desta passada. |
| **V16.2.3** — Verify that the application only stores or broadcasts logs to the files and services that are documented in the log inventory. | L2 | não testado | Fora do recorte desta passada. |
| **V16.2.4** — Verify that logs can be read and correlated by the log processor that is in use, preferably by using a common logging format. | L2 | não testado | Fora do recorte desta passada. |
| **V16.2.5** — Verify that when logging sensitive data, the application enforces logging based on the data's protection level. For example, it may not be allowed … | L2 | não testado | Fora do recorte desta passada. |
| **V16.3.1** — Verify that all authentication operations are logged, including successful and unsuccessful attempts. Additional metadata, such as the type of auth… | L2 | não testado | Fora do recorte desta passada. |
| **V16.3.2** — Verify that failed authorization attempts are logged. For L3, this must include logging all authorization decisions, including logging when sensiti… | L2 | não testado | Fora do recorte desta passada. |
| **V16.3.3** — Verify that the application logs the security events that are defined in the documentation and also logs attempts to bypass the security controls, … | L2 | não testado | Fora do recorte desta passada. |
| **V16.3.4** — Verify that the application logs unexpected errors and security control failures such as backend TLS failures. | L2 | não testado | Fora do recorte desta passada. |
| **V16.4.1** — Verify that all logging components appropriately encode data to prevent log injection. | L2 | não testado | Fora do recorte desta passada. |
| **V16.4.2** — Verify that logs are protected from unauthorized access and cannot be modified. | L2 | não testado | Fora do recorte desta passada. |
| **V16.4.3** — Verify that logs are securely transmitted to a logically separate system for analysis, detection, alerting, and escalation. The aim is to ensure th… | L2 | não testado | Fora do recorte desta passada. |
| **V16.5.1** — Verify that a generic message is returned to the consumer when an unexpected or security-sensitive error occurs, ensuring no exposure of sensitive … | L2 | verificado | D: ERRH-01..04; os 632 erros 500 genéricos do ZAP (nome repetido, byte NUL, corpo ausente) passaram a 409/400 (testes em `http-security.test.ts`). |
| **V16.5.2** — Verify that the application continues to operate securely when external resource access fails, for example, by using patterns such as circuit break… | L2 | não testado | Fora do recorte desta passada. |
| **V16.5.3** — Verify that the application fails gracefully and securely, including when an exception occurs, preventing fail-open conditions such as processing a… | L2 | verificado | C: exceção não capturada encerra o processo (fail-closed) e o serviço reinicia. |
| **V16.5.4** — Verify that a "last resort" error handler is defined which will catch all unhandled exceptions. This is both to avoid losing error details that mus… | L3 | verificado | C: tratador final em `app.ts` + `process-lifecycle.ts`. |

### V17 — WebRTC

Capítulo inteiro **não aplicável** (12 requisitos): A INIA não opera TURN/mídia WebRTC; a voz vai do navegador ao provedor.

