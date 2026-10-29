# Política de dependências — prazos de correção (proposta, 29/10/2026)

Atende ao ASVS 5.0.0 V15.1.1 ("prazos de correção por risco para vulnerabilidades de componentes de terceiros") e ao V15.2.1.
**Proposta para a INIA aprovar** — os prazos abaixo são um ponto de partida e podem ser ajustados ao acordo de nível de serviço
com a Vivo; enquanto não houver aprovação formal, valem como referência interna.

## Onde as vulnerabilidades aparecem

| Fonte | Quando | O que olhar |
|---|---|---|
| `npm run security:scan` (OSV-Scanner offline, `scripts/security/varredura-appsec.mjs`) | antes de cada entrega e de cada publicação | item novo em relação a `scripts/security/appsec-baseline.json`; dependência de produção barra a entrega |
| `npm run security:check` (`npm audit --omit=dev`) | antes de cada entrega | crítica/alta em produção barra a entrega |
| Avisos publicados (GitHub Advisories/OSV) para `next`, `express`, `pg`, `zod`, `mssql`, `mysql2`, `exceljs`, `mammoth`, `pdf-parse`, `multer`, `jsonwebtoken`, `bcryptjs` | semanal | componentes que recebem entrada externa ou rodam antes da autenticação |

## Classificação antes do prazo

1. **Escopo:** dependência de produção (`dev: false` no lockfile) ou só de desenvolvimento. Só desenvolvimento não vai para o
   processo em execução, mas o servidor recebe essas dependências se a implantação usar `npm ci` sem `--omit=dev`.
2. **Alcance:** o caminho vulnerável é usado pela INIA? (ex.: `multer` com `fileFilter` assíncrono, `next` com `use cache` ou
   Server Actions, `uuid` v3/v5/v6 com buffer). Registrar a evidência (arquivo e linha, ou a ausência do uso).
3. **Exposição:** antes da autenticação, só usuário autenticado ou só administrador.

## Prazos

| Gravidade do aviso (CVSS/GHSA) | Produção, caminho alcançável | Produção, caminho não alcançável demonstrado | Só desenvolvimento |
|---|---|---|---|
| Crítica | 72 horas (mitigação em 24 h se exposta antes da autenticação) | 7 dias | próxima manutenção (até 30 dias) |
| Alta | 7 dias | 30 dias | próxima manutenção (até 30 dias) |
| Média | 30 dias | 90 dias | próxima manutenção |
| Baixa | 90 dias | próxima manutenção | próxima manutenção |

Sem versão corrigida publicada: aplicar a mitigação do próprio aviso (configuração, desligar o recurso) dentro do mesmo prazo e
registrar o risco em `pendencias-e-riscos.md` até sair a correção.

## Como atualizar

- Atualização pontual (`npm --prefix <projeto> install <pacote>@<versão>` ou `npm update <pacote>`), nunca `npm audit fix
  --force` nem atualização em massa.
- Versão publicada há **pelo menos 14 dias**, salvo correção de segurança dentro do prazo acima. Nesse caso, conferir a
  procedência (`npm view <pacote>@<versão> dist.attestations`, mantenedores) e rodar `npm audit signatures`.
- Conferir no lockfile as dependências transitivas que vieram junto (em 29/10/2026, `npm update body-parser` trouxe `qs` publicado
  na véspera; o lock foi fixado na versão anterior).
- Validar: tipos, lint, testes do backend e do frontend, `next build`, `npm run security:scan` — e só então regravar a linha de base
  do OSV (`npm run security:scan -- --so=osv --atualizar-base`), conferindo o diff.
- Exceção (não corrigir no prazo): registro em `pendencias-e-riscos.md` com o motivo, a evidência de não alcance e a data de
  revisão.
