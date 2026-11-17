-- Busca nas bases em escala: o produto cadastrado da base (família › produto, do catálogo de produtos) passa a fazer parte do texto que
-- vira vetor — quem pergunta pela família ("Dados Avançados") chega à base que só fala do produto ("LP de Dados") pelo CADASTRO, nunca
-- por lista de palavras. A coluna guarda os produtos com que a versão foi indexada: mudou o vínculo, o nome ou a família, a indexação
-- refaz a versão (só os textos que mudaram geram chamada).
alter table knowledge_embedding_index add column products_key text;
