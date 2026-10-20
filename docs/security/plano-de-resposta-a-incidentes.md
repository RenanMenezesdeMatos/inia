# Plano de resposta a incidentes — parte da INIA (20/10/2026)

Este documento cobre **o que a INIA oferece e o que o time da INIA faz** num incidente de segurança ou de dados pessoais. Ele não
substitui o processo da Vivo: quem decide se houve incidente, quem comunica a ANPD e as pessoas afetadas e quem fala com a
imprensa é a Vivo (SOC, Segurança Digital, Privacy/DPO e Jurídico). A INIA entra como sistema afetado e como fonte de evidência.

> **Pendente de validar com a Vivo:** contatos e canal do SOC e do Privacy, quem aciona o time da INIA, e se o prazo interno de
> comunicação deles é mais curto que o da ANPD. Os campos marcados com ⚠️ ficam para preencher quando a Vivo responder.

## 1. O que conta como incidente

- Acesso indevido a dados pessoais guardados na INIA (transcrições, conversas com a INIA, feedbacks, indicadores, cadastro de
  pessoas), por pessoa de fora ou por quem não deveria ver aquele escopo.
- Vazamento de segredo: `JWT_SECRET`, `DATA_HUB_SECRET_KEY`, chave do provedor de IA, senha do banco, token da API Push,
  credencial de fonte da Central de Dados.
- Indisponibilidade ou perda de dados (banco corrompido, servidor perdido, backup ausente).
- Uso anormal de IA (custo disparando, chamadas fora do horário, conteúdo indevido nas respostas).
- Envio de dados para destino não autorizado (provedor de IA não contratado, fonte de dados desconhecida).

Na dúvida, trate como incidente e avise: é mais barato descartar um alarme do que perder o prazo.

## 2. Prazos que importam (LGPD art. 48 e Resolução CD/ANPD nº 15/2024)

| Quando | O quê | Quem |
|---|---|---|
| Imediato | Avisar o ponto de contato da Vivo (⚠️ SOC/Privacy) e começar a conter | Quem percebeu + time da INIA |
| Até **3 dias úteis** depois de a Vivo ter conhecimento de que o incidente afetou dados pessoais com risco ou dano relevante | Comunicação à ANPD e às pessoas afetadas | Vivo (controladora) |
| Até 20 dias úteis depois da comunicação | Complementar a comunicação à ANPD, se faltou informação | Vivo, com dados da INIA |
| Por 5 anos | Guardar o registro do incidente, mesmo sem comunicação | Vivo; a INIA entrega o relatório (seção 6) |

O papel da INIA é fazer a Vivo chegar a esse prazo com **fatos**: o que foi exposto, de quem, desde quando e o que já foi feito.

## 3. Primeiros 60 minutos — conter sem destruir evidência

Ordem sugerida. Cada passo usa um controle que existe hoje no produto ou na instalação.

1. **Preservar evidência antes de mexer.** Fazer um backup do banco naquele momento (`npm run db:backup`) e copiar a pasta
   `logs` do servidor. Não apagar contas, conversas nem registros: desabilitar, não excluir.
2. **Cortar o acesso de quem não deveria ter.**
   - Conta específica: *Administração → Usuários e acessos → Desabilitar acesso*. A conta para de entrar e **todas as sessões
     dela caem na próxima requisição** (a versão da sessão muda).
   - A própria pessoa, se suspeitar do aparelho: menu do usuário → **Sair de todos os aparelhos**.
   - Todo mundo de uma vez (suspeita de `JWT_SECRET` vazado): trocar o `JWT_SECRET` no `backend/.env` e reiniciar. Todas as
     sessões de todas as pessoas caem; ninguém perde dado.
3. **Cortar integrações.**
   - Token da API Push vazado: *Central de Dados → fonte → Tokens de push → Revogar* (ou Rotacionar e entregar o novo ao
     integrador por canal seguro). Tokens novos podem ter validade e lista de IPs autorizados.
   - Credencial de fonte (API Pull, SFTP, banco) vazada: pausar a fonte, trocar a senha **na origem** e depois na tela da fonte.
4. **Cortar a IA, se o problema estiver nela.**
   - *Administração → IA → Conexões*: desligar a conexão afetada (ou remover a chave dela). Workflows e chat passam a falhar
     de forma controlada, sem chamar o provedor.
   - Chamadas antigas que ainda usam `GEMINI_API_KEY` do `backend/.env`: apagar a variável e reiniciar.
   - Custo disparando: orçamento com **limite rígido** em *IA → Orçamentos* bloqueia novas chamadas ao atingir o teto.
5. **Segredo de cifra vazado (`DATA_HUB_SECRET_KEY`).** Gerar uma chave nova, guardar a antiga em
   `DATA_HUB_SECRET_KEY_PREVIOUS`, reiniciar e rodar `npm run secrets:rotate -- --aplicar` (recifra tudo com a nova). Depois,
   trocar na origem as credenciais que a chave antiga protegia: quem tinha a chave antiga e uma cópia do banco consegue lê-las.
   Passo a passo em [configuracao-segura.md](configuracao-segura.md).
6. **Servidor comprometido.** Tirar da rede, subir outro a partir do backup verificado (`npm run db:restore-check` confere se o
   backup restaura) e trocar todos os segredos do `.env`.

## 4. Onde está a evidência

| Pergunta | Onde olhar |
|---|---|
| Quem fez o quê na administração (contas, papéis, fontes, tokens, IA, exportações) | Tabela `audit_logs` (ação, quem, quando, sobre o quê) |
| Quem abriu transcrição, conversa com a INIA ou ficha de outra pessoa | Tabela `personal_data_access_log` (quem viu, de quem, qual dado, quando) |
| Quem entrou, de onde, e quem errou a senha | `auth_login_attempts` e a atividade de sessão (`auth_session_activity`) |
| O que foi para o provedor de IA e quanto custou | `ai_usage_events` (caso de uso, modelo, tokens, custo, quem pediu). O texto enviado não fica guardado; os dados de cliente nas transcrições vão mascarados (CPF, telefone, e-mail, protocolo) |
| O que entrou pela Central de Dados | Cargas (`data_ingestion_runs`), quarentena e lineage na tela da Central |
| Erros e acessos HTTP | `logs` do servidor (sem corpo de requisição, cookie nem query, de propósito) |

Exportar só o necessário, e tratar o próprio material de investigação como dado pessoal.

## 5. Avaliar o alcance

Responder, nesta ordem, com consultas no banco e na auditoria:

1. **Que dado?** Tipo (transcrição, conversa, feedback, indicador, cadastro, credencial) e se tem dado de cliente da Vivo.
2. **De quem?** Lista de pessoas (colaboradores) e, se houver, de clientes citados nas transcrições.
3. **Desde quando e até quando?** Primeira e última ação suspeita na auditoria.
4. **Saiu do ambiente?** Exportações (`PERSONAL_DATA_EXPORTED`), downloads, chamadas a destinos externos, uso de IA.
5. **Já foi contido?** Quais passos da seção 3 foram feitos e a que horas.

Para atender uma pessoa afetada que pede os próprios dados, o Administrador geral (ou quem tiver a permissão
`privacy.subject_data.export`) usa *Usuários e acessos → pessoa → Exportar dados (LGPD)*. O arquivo vai primeiro para o
Privacy conferir.

## 6. Relatório para a Vivo

Entregar ao Privacy/SOC, em até 24 horas depois da contenção (ou antes, se pedirem), um relatório com:

- Linha do tempo: quando começou, quando foi percebido, quando foi contido.
- Dados e pessoas afetadas (seção 5), com a consulta usada para chegar nos números.
- O que foi feito (seção 3), quem fez e a que horas.
- Riscos que continuam e o que falta fazer.
- Medidas para não repetir (correção, configuração, treinamento).

O relatório não deve conter os dados pessoais em si: só contagens, identificadores internos e onde estão.

## 7. Depois do incidente

- Registrar o incidente e a correção em `docs/security/pendencias-e-riscos.md`.
- Revisar se algum controle faltou e abrir o item no backlog.
- Conferir se os backups continuaram rodando e se o último restaura.
- Revisar este plano com a Vivo uma vez por ano ou depois de cada incidente.

## 8. Contatos

| Papel | Nome | Contato |
|---|---|---|
| Ponto de contato da Vivo (SOC) | ⚠️ | ⚠️ |
| Privacy / DPO da Vivo | ⚠️ | ⚠️ |
| Responsável técnico da INIA | Renan Menezes | ⚠️ |
| Infraestrutura do servidor (Vivo) | ⚠️ | ⚠️ |
