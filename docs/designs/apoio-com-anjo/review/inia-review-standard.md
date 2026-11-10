# Padrão de revisão — Apoio com Anjo (INIA)

Complementa o `feature-spec-standard` e o `implementation-readiness-standard` do EGM para esta especificação. O dono do produto pediu que a revisão cubra **seis eixos**. Um achado deve citar a seção ou as linhas do documento e, quando afirmar algo sobre o código, `caminho:linha`.

## 1. Clareza

* Cada conceito tem um nome só (ver o glossário) e é usado igual em todo o documento.
* Operador, Anjo, Coordenador e Administrador geral sabem, em cada momento, o que está acontecendo e o que podem fazer.
* Nenhuma regra depende de interpretação ("em geral", "quando fizer sentido").

## 2. Aderência ao código

* Toda afirmação sobre o código atual confere com o repositório.
* O desenho reaproveita o que existe (papéis por escopo, travas consultivas, posse com prazo, registro LGPD, catálogo de retenção) em vez de criar paralelos.
* Respeita a organização: backend em `src/modules/<domínio>/{domain,application,infrastructure,presentation,testing}`; frontend com `components/<f>`, `queries/<f>`, `services/<f>`, `schemas/<f>`, tipos por `z.infer`; nenhum módulo lê tabela privada de outro; migrations só aditivas; prompts e `*_VERSION` são contratos versionados.

## 3. Permissões e escopos

* Organização, pessoa e escopo sempre vêm da sessão; nunca de ids do corpo. Fora do escopo = 404.
* Ter o papel Anjo não dá acesso amplo a conversas.
* Quem concede cada papel, com qual escopo, e o que cada escopo alcança (pedido × pessoa do Anjo) está definido.
* Toda rota tem o dono e a checagem do recurso concreto, não só "tem a permissão em algum escopo".

## 4. Concorrência e várias instâncias

* Várias APIs atrás do IIS sem afinidade de sessão; M workers. Nada que precise valer para o conjunto fica só na memória de um processo.
* Disputa por pedido, cliques repetidos, aceite no limite do prazo, cancelamento × aceite, desligar × aceite, duas abas, reinício no meio de uma espera, desconexão de qualquer lado.
* Prazos medidos pelo relógio do banco; transições condicionais; garantias no banco (índices únicos), não só no código.
* A sessão expira com 30 min sem interação; leitura automática nunca renova a sessão.

## 5. Privacidade

* A IA nunca lê mensagens humanas do apoio — no servidor e no navegador (voz, microfone, contexto, resumos, ferramentas).
* O operador nunca recebe o motivo de pausa, nem em resposta de API.
* O que o Anjo vê é o mínimo e é exatamente o que o operador aprovou.
* Leituras de dado de outra pessoa ficam no registro LGPD; retenção e exportação do titular cobrem as tabelas novas sem vazar dados de uma pessoa para a exportação de outra.
* Conteúdo sensível não é duplicado em eventos analíticos; a Monitoria de usabilidade (desligada) não é religada.

## 6. Métricas

* Cada medida tem numerador, denominador, período, recorte e regra de dado ausente.
* Ausência de descurtida ou de pedido nunca conta como resolução ou acerto. Dado ausente nunca é resultado ruim nem zero.
* Percepção da resposta, necessidade de apoio, motivo do Anjo e resultado do atendimento ficam separados; as três avaliações (feedback do Acompanhamento, resposta da INIA, atendimento do Anjo) não se misturam.
* Nenhuma taxa é chamada de "assertividade" sem dizer o que mede.
