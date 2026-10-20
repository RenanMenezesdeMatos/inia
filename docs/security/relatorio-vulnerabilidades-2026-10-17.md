# Relatório de vulnerabilidades e soluções — auditoria de segurança da INIA (17/10/2026)

Resumo para leitura direta: o que foi encontrado, o risco, como foi resolvido e o que ainda depende de decisão. O detalhe técnico
(arquivos, testes e provas) está em [relatorio-de-achados.md](relatorio-de-achados.md) §"Segunda rodada"; os riscos que
continuam abertos, em [pendencias-e-riscos.md](pendencias-e-riscos.md); as mudanças de instalação e configuração, em
[configuracao-segura.md](configuracao-segura.md) §10.

## Em números

| | Quantidade |
|---|---|
| Itens revisados nesta rodada | 46 |
| Críticos / Altos | 0 / 0 |
| Médios | 14 — 13 tratados (2 deles em parte: PDF e serviços do Windows), 1 aguardando decisão de produto |
| Baixos | 28 — 24 corrigidos, 1 em parte, 3 sem correção com motivo (1 mantido por decisão, 2 pendentes) |
| Informativos | 4 |
| Testes automatizados depois das correções | backend 4.760 e frontend 1.894 passando; provas contra o banco de teste passando |

O sistema inteiro foi revisto em cinco frentes: autenticação e plataforma, acesso a dados de pessoas, Central de Dados e arquivos,
IA/voz/Workflows, e instalação/dependências. A primeira rodada (08/10/2026) já tinha corrigido 34 achados, entre eles 1 crítico e
8 altos (ver o início de `relatorio-de-achados.md`). Esta rodada não encontrou falha crítica nem alta. Os problemas estavam,
sobretudo, no código que entrou depois de 08/10: políticas de acompanhamento, reports, INIA para lideranças, pacote de
configuração e Central de Dados com bancos reais.

O sistema não é declarado "100% seguro". O que segue é o que foi encontrado e tratado.

---

## Médios

### 1. Senha testada em paralelo furava a trava de login (AUTH-1)
- **Problema**: a trava de 5 tentativas por e-mail só contava a falha depois de conferir a senha. Com 20 tentativas disparadas ao
  mesmo tempo, as 20 senhas eram testadas.
- **Risco**: adivinhar a senha de alguém, inclusive de um Administrador geral, muito mais rápido do que a trava permitia.
- **Solução**: cada tentativa é registrada como falha antes de a senha ser conferida. Tentativas simultâneas se enxergam: no
  máximo 5 chegam à conferência.
- **Situação**: corrigido. Provado no banco de teste (antes, 30 conferências; agora, até 5).

### 2. Rajada de logins derrubava a entrada de todos (AUTH-2)
- **Problema**: o limite de tentativas recusadas por endereço só contava depois da resposta, então uma rajada passava inteira. A
  fila de conferência de senha não tinha limite.
- **Risco**: qualquer pessoa na rede, sem conta, deixava a operação inteira sem conseguir entrar por minutos, inclusive na virada
  de turno. A ciência com senha também travava.
- **Solução**: a vaga do limite é reservada antes de atender e devolvida quando o login dá certo. A fila de conferência ganhou um
  teto e, quando cheia, responde "muitos acessos ao mesmo tempo" na hora.
- **Situação**: corrigido.

### 3. Qualquer pessoa conseguia bloquear o login de qualquer conta (AUTH-3)
- **Problema**: bastavam 5 senhas erradas para bloquear um e-mail por 15 minutos, e o bloqueio valia até para o próprio dono.
- **Risco**: travar de propósito supervisores e o Administrador geral, sem precisar de conta.
- **Solução**: "dispositivo conhecido". Depois de um login certo, o navegador recebe um cookie assinado. Com o e-mail travado por
  terceiros, o dono entra por esse navegador, que tem um contador de erros só dele. Quem não tem o cookie continua bloqueado.
- **Situação**: corrigido.

### 4. Conta pré-cadastrada "assumia" uma pessoa que ia chegar pela base (AUTH-13)
- **Problema**: um administrador de Grupo podia cadastrar à mão o e-mail de uma futura Supervisora de outro Grupo e definir a
  senha. Quando a base do cliente trazia essa pessoa, a INIA a ligava àquela conta. A senha continuava sendo a do administrador.
- **Risco**: tomar a conta de outra pessoa, com o acesso de liderança dela.
- **Solução**: o vínculo automático continua. Mas se a base colocar a pessoa em outro Grupo, ou num nível de liderança que o
  cadastro não tinha, a conta é desabilitada até quem administra o lugar novo liberar o acesso de novo, com uma senha nova.
- **Situação**: corrigido. Provado no banco de teste.

### 5. Concessão de papéis com permissões que quem concede não tem (AUTH-5)
- **Problema**: quem libera acessos pode habilitar uma conta, receber a senha temporária e dar a ela um papel delegável, inclusive
  com permissões que ele mesmo não tem (ler conversas, executar ou aprovar intervenções).
- **Risco**: alguém cria uma "conta-fantoche" e passa a ver ou fazer o que o papel dele não permite.
- **Solução**: não aplicada. O próprio desenho dos papéis prevê esse fluxo (por exemplo, "Conceder aos gestores"), e qualquer
  restrição muda o produto.
- **Situação**: pendente — decisão de produto. Três opções estão descritas em R-05: limitar ao que quem concede tem, separar quem
  libera a credencial de quem concede o papel, ou exigir aprovação de uma segunda pessoa para papéis sensíveis.

### 6. Monitoramento de conversas mostrava dados fora do escopo de quem lê (SCOPE-01 / AI-03)
- **Problema**: quem tem o papel "Leitor de conversas" num Grupo podia abrir a conversa de um gerente daquele Grupo e ver tabelas
  com nomes, resultados e situação funcional de pessoas de outros Grupos.
- **Risco**: ver dados pessoais que o próprio acesso não permite.
- **Solução**: as respostas com dados são conferidas contra o escopo de quem lê. Resposta com dado de fora não mostra o texto nem
  as tabelas, e a prévia da lista também não mostra.
- **Situação**: corrigido.

### 7. Simulação de política revelava quem teve intervenção, inclusive avaliação de continuidade (SCOPE-02)
- **Problema**: para simular uma política bastava "enxergar" a pessoa. Montando um rascunho que só perguntava "teve avaliação de
  continuidade?", um administrador sem acesso a intervenções descobria a resposta. O caso de supervisão também repetia o tipo e a
  justificativa.
- **Risco**: vazamento de informação sensível de RH.
- **Solução**: quem não pode ver as intervenções da pessoa simula sem o histórico delas. Avaliações gravadas e a reavaliação
  exigem esse acesso. O caso de supervisão passou a ter título e resumo neutros.
- **Situação**: corrigido.

### 8. Arquivo compactado podia derrubar a API — "zip bomb" (DATA-1)
- **Problema**: a proteção de planilhas e documentos confiava no tamanho que o próprio arquivo declarava. Uma planilha de 389 KB
  virava 400 MB na memória, e um documento com uma imagem preparada fazia isso a cada vez que alguém abria a prévia. PDF não
  tinha proteção nenhuma.
- **Risco**: derrubar a INIA para todos, repetidamente, com um único arquivo.
- **Solução**: cada parte do arquivo é descompactada de verdade, com teto, antes de qualquer leitura. Os PDFs têm os trechos
  compactados medidos antes da extração.
- **Situação**: corrigido para planilhas e documentos. Para PDF a proteção é parcial; isolar a leitura do PDF ficou em R-24, e uma
  sessão separada já está cuidando disso. Os manuais e planilhas reais continuam sendo aceitos.

### 9. MySQL "validando o certificado" não conferia o nome do servidor (DATA-4)
- **Problema**: no modo mais forte da tela, qualquer certificado válido era aceito para qualquer servidor.
- **Risco**: quem intercepta a rede entre a INIA e o banco do cliente se passa pelo banco e recebe a senha.
- **Solução**: a conferência do nome passou a ser feita.
- **Situação**: corrigido. Atenção: fonte MySQL antiga nesse modo, com certificado emitido para outro nome, vai parar de conectar.

### 10. Conexão nova com banco nascia sem validar o certificado (DATA-5)
- **Problema**: a fonte nova vinha com criptografia que aceita qualquer certificado (no SQL Server também).
- **Risco**: o mesmo do item 9 — interceptação e roubo da senha do banco do cliente.
- **Solução**: fonte nova nasce validando o certificado. Quem precisar de outro modo escolhe conscientemente. As fontes antigas
  não mudam sozinhas.
- **Situação**: corrigido para fontes novas. As antigas devem ser revistas uma a uma (R-08).

### 11. Uma pergunta à INIA podia disparar dezenas de consultas de IA (AI-01)
- **Problema**: o modelo podia pedir dezenas de ferramentas por rodada, e todas eram executadas em paralelo. A consulta de
  processos da liderança abria um Orquestrador inteiro para cada pedido.
- **Risco**: uma pessoa esgotava o orçamento de IA da organização e ocupava as vagas de IA de todos.
- **Solução**: no máximo 6 consultas por rodada e 12 por pergunta. A consulta de processos chama no máximo 2 Orquestradores por
  resposta.
- **Situação**: corrigido.

### 12. Texto gerado pela IA virava "evidência" de feedback (AI-02)
- **Problema**: o feedback publicado a partir de um nó Orquestrador gravava a síntese da IA no campo "evidência encontrada". Esse
  feedback ainda contava como evidência verificável nas políticas de acompanhamento.
- **Risco**: quebra da regra do produto ("texto de IA nunca é evidência"). Um colaborador podia ser cobrado, ou ter uma avaliação
  iniciada, com base em algo sem fonte.
- **Solução**: a evidência passa a ser só a citação literal já conferida pelos especialistas. Sem citação, o feedback diz que não
  há trecho verificado e não conta como evidência nas políticas.
- **Situação**: corrigido.

### 13. Limites de uso contornáveis mudando maiúsculas na URL (INFRA-1)
- **Problema**: o limite de ações caras (testes de Agent e de conexão, simulações) e o de sessões de voz comparavam o endereço ao
  pé da letra. `/TEST` ou `/test/` chegavam à mesma função sem passar pelo limite.
- **Risco**: gasto de IA e sondagem de rede sem teto.
- **Solução**: o endereço é normalizado antes de cada limite.
- **Situação**: corrigido.

### 14. Serviços do Windows com privilégio máximo e arquivos de segredo abertos (INFRA-2)
- **Problema**: os serviços rodavam como LocalSystem, que controla a máquina inteira, e os arquivos `.env` (com as chaves) não
  tinham permissão restrita.
- **Risco**: qualquer falha na aplicação vira controle total do servidor.
- **Solução**: o instalador ganhou a opção de rodar com uma conta própria (`-ContaServico`) e passou a restringir os `.env` a
  administradores e ao serviço. O padrão continua LocalSystem por compatibilidade.
- **Situação**: corrigido parcialmente e **não testado em Windows** (R-32). Validar na homologação antes de usar em produção.

---

## Baixos

| # | Problema | Risco | Solução | Situação |
|---|---|---|---|---|
| AUTH-4 | Trocar a pessoa de Grupo mantinha o Subgrupo antigo | O administrador do Grupo antigo continuava mexendo nela | O Subgrupo é zerado na troca | Corrigido |
| AUTH-6 | Senha provisória escolhida por quem cadastra | Senha previsível ("Mudar123") e repetida para todos | A INIA gera a senha e mostra uma vez | Corrigido |
| AUTH-7 | Pessoa desligada pela base mantinha a conta | Reativada, voltava com a senha e as sessões antigas | Desligamento desabilita a conta (Administrador geral: só derruba as sessões) | Corrigido |
| AUTH-8 | Produção aceitava a chave de sessão de exemplo | Qualquer um forjaria a sessão de um administrador | A API não sobe com chave de exemplo ou fraca; a chave de cifra fraca gera aviso | Corrigido |
| AUTH-9 | Importação do pacote de configuração lia qualquer arquivo da máquina | Pacote adulterado enviava arquivos do servidor para o destino | Só lê dentro do pacote e confere a assinatura de cada arquivo | Corrigido |
| AUTH-10 | Sessão de Administrador geral salva dentro do pacote, que circula entre máquinas | Quem recebe a pasta opera como Administrador geral | A sessão fica no perfil de quem importa | Corrigido |
| AUTH-11 | Foto de capa servida com GPS e aparelho | Localização da casa da pessoa visível para a organização | Metadados removidos (perfil e cenário), pixels iguais | Corrigido |
| AUTH-12 | Senhas comuns aceitas | "Senha123", "Vivo2026" | Senhas previsíveis recusadas | Corrigido |
| AUTH-14 | Criação de senha do primeiro acesso limitada por endereço | No dia da liberação, só 20 pessoas por 15 min atrás do mesmo IP | Limite por pessoa | Corrigido |
| AUTH-15 | Histórico de tentativas de login sem limpeza | Crescimento sem fim e dado pessoal sem retenção | Limpeza depois de 30 dias | Corrigido |
| AUTH-16 | Proteção contra requisição forjada (CSRF) dependia de cabeçalhos do navegador | Só navegador antigo, que não roda a INIA | Mantido; documentado | Não alterado (R-26) |
| SCOPE-03 | Ex-responsável de uma intervenção continua com acesso | Ex-líder segue vendo e agindo após transferência | Reatribuir o responsável quando a estrutura muda | Pendente (R-27), sessão separada cuidando |
| SCOPE-04 | Nova tentativa da análise de report sem limite | Gasto de IA em laço | Entrou no limite de ações caras | Corrigido |
| DATA-2 | Bloqueio do banco interno conferia só o nome | Apontar a Central para o banco da própria INIA pelo IP | Bloqueio pelo IP e pelas placas de rede da máquina | Corrigido |
| DATA-3 | Serviços internos da nuvem (Azure, Alibaba) liberados | Sondar a infraestrutura da nuvem | Adicionados ao bloqueio fixo | Corrigido |
| DATA-6 | Trocar o certificado do banco ou a chave do SFTP não pedia a senha | Desviar a senha guardada para um servidor falso | Passou a pedir a senha de novo | Corrigido |
| DATA-7 | DNS rebinding (o nome resolve diferente na hora de conectar) | Contornar o bloqueio de destinos | Recomendado o modo lista de destinos permitidos | Pendente (R-03) |
| DATA-8 | Carga de Colaboradores liga e altera contas administrativas pelo e-mail | A base do cliente controla administradores | Desligar e mudar de lugar desabilitam a conta; o vínculo continua por desenho | Parcial (R-28) |
| DATA-9 | Amostras e listagem do SFTP fora do limite de ações caras | Sondar a rede interna em laço | Entraram no limite | Corrigido |
| DATA-10 | Importação por API sem teto total | Paginação sem fim derrubava o processamento | Teto de 200 MB por carga | Corrigido |
| DATA-11 | Padrão de arquivo do SFTP travava a API (64 s) | Paralisar a INIA com um nome de arquivo | Casamento sem expressão regular | Corrigido |
| AI-04 | Lista + contagem revelavam o motivo de afastamento (INSS, maternidade) | Dado de saúde exposto ao líder | O tipo só aparece quando não aponta ninguém | Corrigido |
| AI-05 | Base restrita a outro Grupo continuava no Agent | Procedimento confidencial vazava para outro Grupo | Alcance conferido a cada consulta | Corrigido |
| AI-06 | "Testar diagnóstico" aceitava Agent de outro Grupo | Ler a base de outro Grupo | Só Agent compatível com quem testa e com o colaborador | Corrigido |
| AI-07 | Evidência "literal" de 1 caractere aceita | Feedback sem fonte real | Mínimo de 12 caracteres e duas palavras | Corrigido |
| AI-08 | Link externo escrito pela IA virava link clicável | Phishing induzido por uma transcrição ou documento | Só domínios configurados ficam clicáveis | Corrigido |
| AI-09 | Voz sem teto de sessões; consulta continuava após sair | Gasto de IA sem controle | Teto por meia hora e cancelamento | Corrigido (falta medir o uso, R-30) |
| INFRA-3 | Banco interno usado com superusuário sem aviso | Falha na aplicação vira controle do servidor de banco | Aviso na instalação | Corrigido |

## Informativos

- **AUTH-17 — Endurecimentos**: recusa de `TRUST_PROXY` aberto e teto de envio de fotos foram feitos. Ficaram para depois o
  prefixo `__Host-` no cookie, a exigência de `CORS_ORIGIN` em produção e o "sair de todos os aparelhos" (R-33).
- **DATA-12/13 — Integrações**: o escape de Markdown nos nomes vindos da base e o nome de arquivo no download foram corrigidos.
  Ficaram para depois: autenticar o token do API Push antes de ler o corpo, chave de idempotência sem conferência do conteúdo, e
  API com `http://` e credencial (R-29).
- **AI-10 — Dados pessoais enviados ao provedor de IA**: CPF e telefone do cliente que aparecem na transcrição do próprio operador
  vão ao provedor. Depende de decisão de privacidade (R-31).
- **DEP-1 — Dependências**: a interface em produção não tem alerta. O backend tem 6 alertas moderados sem caminho de exploração.
  Os alertas críticos estão só em ferramentas de desenvolvimento. Atualizar o `tedious` depois de 24/10 (R-14).

## O que precisa de ação de alguém

1. **Decisão de produto**: AUTH-5, conta-fantoche (R-05).
2. **Antes de atualizar a produção**: revisar fontes MySQL em "validando o certificado" (item 9) e conferir `JWT_SECRET` (AUTH-8).
3. **Na homologação Windows**: validar `instalar-servicos.ps1 -ContaServico` e a restrição dos `.env` (R-32).
4. **Manuais**: atualizar os pontos que mudaram nos manuais IT-INIA-002, 003, 007, 008 e 010 (R-11).
5. **Fontes de banco antigas**: passar para "validando o certificado" (R-08).
6. **Em andamento em sessões separadas**: reatribuição do responsável das intervenções (R-27) e leitura de PDF isolada (R-24).
