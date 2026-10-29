# Preparação AppSec para a avaliação do Conviso — 29/10/2026

Rodada de preparação para a avaliação corporativa obrigatória de AppSec. Não substitui o Conviso e não é certificação: o que está
aqui foi analisado e testado no recorte descrito; "nenhum achado" significa "nenhum achado nos testes executados".

## Resumo executivo

**Postura.** Nenhum achado crítico ou alto confirmado. A base já passou por quatro auditorias (08/10, 17/10, 20/10 e a da skill
Cloudflare em 28–29/10) e os controles centrais resistiram aos testes desta rodada: sem sessão, 471 de 472 rotas responderam 401;
um operador recebeu 403 em 318 das 322 operações administrativas (as outras 4 sem efeito); a administradora de uma 2ª organização
não leu nenhum dado da 1ª em 37 rotas de detalhe e 133 listas; JWT adulterado, `alg=none`, segredo publicado e cookie sem
`__Host-` foram recusados; CSRF, CORS, bloqueio de login, inatividade, logout e "sair de todos" funcionaram. O ZAP (passada sem
sessão: 528.930 requisições; autenticada: 532.737) não apontou injeção, XSS refletido, SSRF nem travessia de caminho; a passada
autenticada provocou 632 erros 5xx genéricos (sem stack) de robustez — nome repetido, byte NUL e corpo inesperado (Q-01…Q-03).

**Riscos principais e situação**

| # | Risco | Gravidade | Situação |
|---|---|---|---|
| 1 | `next@16.3.8` com 2 avisos críticos (RCE) e 1 alto publicados em 22/10 — caminhos não usados aqui, mas o SCA vai marcar | crítico no scanner / não explorável demonstrado | **aplicado em 29/10** (`next ~16.4.1`); verificado na árvore real: tipos, lint, 2.049 testes e build |
| 2 | APPSEC-02 (= h19 da auditoria Cloudflare): carga de Estrutura dá a uma conta sob custódia de admin de outro Grupo acesso às fichas do Grupo B e desarma a correção do C09 | média | **corrigido** pela sessão da auditoria Cloudflare em `4859d40f` + `77c5adcd` (os 2 cenários que o reteste desta rodada achou depois do 1º commit) e **retestado** aqui com a prova independente (3/3) |
| 3 | APPSEC-01: simulação de política mostrava o tipo exato de afastamento (INSS/maternidade) de líderes | média | **corrigido e retestado** |
| 4 | `body-parser@2.3.0` (derrubar a API sem login) e `zod@4.5.4` (memória) | alto/médio no scanner; crash não reproduzido | **aplicado em 29/10** (`body-parser 2.4.0`, `qs 6.16.1`, `zod 4.6.7`, `multer 2.5.0`); 5.246 testes do backend passaram. Resta `zod 4.4.3` no frontend (validação no navegador, recomendação) |
| 5 | Sem MFA/SSO corporativo (ASVS V6.3.3) | lacuna de controle | decisão de produto/integração |
| 6 | APPSEC-03: consultas de liderança gravadas em conversa de treino somem da monitoria (código não commitado) | baixa | aberto (frente suspensa) |
| 7 | APPSEC-04 (EXIF/GPS em foto) e APPSEC-05 (tag GCM truncada) | baixa / endurecimento | **corrigidos e retestados** |

Segredos: nenhuma credencial real no código nem no histórico Git (Gitleaks, 515 commits); 5 senhas antigas de bancos de exemplo
locais só no histórico, sem uso atual.

## Documentos

| Arquivo | Conteúdo |
|---|---|
| [relatorio-tecnico.md](relatorio-tecnico.md) | Escopo, revisão Git, ferramentas e versões, resultado de cada ferramenta, achados confirmados/pendentes/rejeitados, endurecimento, mudanças no código |
| [registro-de-testes.md](registro-de-testes.md) | Todos os testes dinâmicos, provas antes da correção e retestes; ZAP; verificações nativas |
| [matriz-asvs-5.0.0.md](matriz-asvs-5.0.0.md) | 345 requisitos do ASVS 5.0.0 com status (verificado/falhou/não aplicável/não testado) e evidência |
| [plano-de-homologacao.md](plano-de-homologacao.md) | O que testar na homologação, contas e limites necessários, critérios de parada, lacunas |
| [sbom/](sbom/) | SBOM CycloneDX 1.7 e SPDX 2.3 do backend e da interface (Syft 1.54.1) |
| [anexos/](anexos/) | Scripts dos testes dinâmicos, inventário das 475 rotas, prova de banco do APPSEC-02 |

Fora do Git (contém dados do ambiente descartável): `output/appsec-2026-10-29/` — saídas brutas de Semgrep, Gitleaks (redigido),
OSV, Syft e ZAP, logs, cópias isoladas do código e o arquivo de segredos aleatórios do ambiente local.

## Pendências para homologação, responsáveis externos e Conviso

1. Atualizações de `next`, `body-parser`, `zod` e `multer` aplicadas em 29/10 (sem commit). Recomendação restante: `zod` do
   frontend (4.4.3 → 4.6.x) e definir prazos de correção de dependências por gravidade.
2. Registrar como risco aceito o C-N3 (revalidar custódia em toda promoção/transferência), descartado pelo usuário segundo a
   sessão da auditoria Cloudflare.
3. MFA/SSO, cofre de segredos, antivírus nos uploads e HSTS no IIS — dependem do padrão da Vivo.
4. Testes dinâmicos na homologação só com alvo e contas autorizados (ver plano).
5. Informar ao Conviso os riscos aceitos já documentados (R-01…R-38 em `../pendencias-e-riscos.md`).

## Como repetir

Pré-requisitos: Docker (Colima/Docker Desktop) e Node 24.

```bash
npm run security:scan
```

Roda Semgrep, Gitleaks, OSV-Scanner e Syft com as mesmas imagens (digest fixado), regras e opções desta rodada; saída em
`output/appsec-<data>/`; falha só com achado **novo** em relação a `scripts/security/appsec-baseline.json`. Depois de triar
cada item novo, `npm run security:scan -- --atualizar-base` regrava a linha de base (o diff mostra o que entrou). Critério
recomendado para barrar entrega: segredo novo, Semgrep ERROR/WARNING novo, vulnerabilidade nova em dependência de produção;
dependência só de desenvolvimento gera aviso. Sem pipeline de CI no projeto: rodar antes de cada entrega, junto com
`npm run security:check`; num CI futuro, o mesmo comando com Docker disponível.

Pentest local (ambiente isolado): ver `relatorio-tecnico.md` §2 e os scripts em `anexos/` — `route-inventory.mts` gera o
inventário, `sweeps.mjs`/`session.mjs`/`b1-policy-simulate.mjs` exigem `INIA_DEMO_PASSWORD` do ambiente descartável e só
aceitam alvo `http://127.0.0.1:`.

Atualizações de dependência aplicadas em 29/10/2026 (registro dos comandos; o `package.json` do frontend manteve a fixação `~`):

```bash
npm --prefix frontend install next@16.4.1 eslint-config-next@16.4.1
```

```bash
npm --prefix backend install zod@4.6.7 multer@2.5.0
```

```bash
npm --prefix backend update body-parser
```

O `update` puxou `qs` 6.17.1, publicado na véspera; o lockfile foi fixado em 6.16.1 (15 dias). Depois: `npm audit signatures`
(490 + 983 assinaturas e 313 atestações verificadas), testes e build da árvore real — todos OK.
