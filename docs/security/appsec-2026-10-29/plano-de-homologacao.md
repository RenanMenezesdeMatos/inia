# Plano de testes para a homologação (pendente de autorização)

Nesta rodada **nenhum endereço remoto foi testado**. O que segue é o plano para repetir os testes dinâmicos num ambiente de
homologação, quando houver alvo autorizado por escrito. Até lá, nada aqui deve ser executado.

## O que precisa ser fornecido antes

| Item | Quem decide | Por quê |
|---|---|---|
| URL(s) exata(s) do alvo e janela de execução | responsável pela homologação (Vivo/INIA) | teste ativo só no alvo autorizado |
| Confirmação de que o ambiente usa **só dados sintéticos** e banco próprio | idem | o ZAP ativo grava dados de teste |
| Contas de teste: 1 administrador geral; 1 ADMINISTRADOR de Grupo; 1 ADMINISTRADOR de Subgrupo; 1 Gerente com `GESTOR_DE_POLITICAS_DE_ACOMPANHAMENTO`; 1 Supervisor; 2 operadores do mesmo Grupo; 1 operador de outro Grupo; 1 conta com `LEITOR_DE_CONVERSAS_INIA` de Grupo | idem | escalonamento vertical, horizontal e entre Grupos |
| Se houver mais de uma organização: 1 administrador geral de cada | idem | isolamento entre organizações (R-01) |
| Limites: requisições por segundo, horário, contato de parada | idem | não degradar o ambiente |
| IA: provedor desligado ou chave de teste com orçamento ≤ US$ 1 | responsável pela IA | rotas `costly` chamam modelo pago |
| TLS: certificado real no IIS | infraestrutura | V12 (TLS) e HSTS só valem com TLS |

## Testes previstos (na ordem)

1. **Configuração e TLS (passivo):** cabeçalhos em `/`, `/auth/login` e `/api/v1/auth/me` (HSTS nas páginas — hoje ausente no
   IIS, ver V3.4.1), versões de TLS e suítes aceitas, certificado, redirecionamento HTTP→HTTPS, `TRACE`, listagem de diretório
   no IIS, `X-Powered-By`/`Server`.
2. **Sessão e autenticação:** `anexos/session.mjs` apontado para o alvo (exige trocar a trava de alvo de `lib.mjs` por uma
   variável com a URL autorizada); bloqueio após 4 erros só na conta de teste própria; inatividade (30 min) e validade (12 h).
3. **Autorização:** `anexos/sweeps.mjs` (S1–S4) com o inventário de rotas da versão implantada (`anexos/route-inventory.mts`
   contra a mesma revisão) e as contas acima — inclusive o par ADMINISTRADOR de Grupo × objetos de outro Grupo.
4. **Fluxos sensíveis:** APPSEC-01 (simulação de política — deve mostrar "motivo protegido"), upload de imagem com EXIF
   (deve sair sem GPS), exportações CSV (fórmulas neutralizadas), API Push (token, IP de origem, idempotência).
5. **ZAP:** passiva na interface; ativa só na API, autenticada pelo cabeçalho de sessão, com `requestor` de verificação no
   início **e no fim** (a sessão expira em 30 min só com leituras — mantenha uma escrita periódica ou peça a inatividade
   ampliada só para a janela do teste), 2–4 threads, até 40 min, `/auth/*` e `/data-ingestion/*` fora.

## Critérios de parada

Qualquer um destes interrompe a execução e avisa o responsável: resposta 5xx em sequência (> 5 por minuto), latência p95 da
API acima de 2 s, uso de IA real detectado, dado que pareça real (não `DEMO_SEED`/sintético), qualquer acesso fora do alvo
autorizado.

## Lacunas que a homologação precisa resolver

- V12 (TLS) e HSTS só podem ser verificados com o IIS real.
- R-32/R-35: conta de serviço e ACL dos `.env`/backups no Windows (`icacls`, só leitura).
- N03 da auditoria Cloudflare: ACL efetiva de `C:\inia\backups`.
- Antivírus e cofre de segredos (V5.4.3, V13.3.1) dependem do padrão da Vivo.
- MFA/SSO (V6.3.3): decisão de integração com o IdP corporativo.
