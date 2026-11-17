-- COMUNICADOS DA LIDERANÇA (16/11/2026). Antes o comunicado era só estado da tela de quem publicava: sumia ao recarregar e nunca
-- chegava a ninguém. Agora fica no servidor e aparece no Acompanhamento de quem o recebe (e de quem publicou).
-- Ver docs/dev/memoria/experiencia-do-colaborador.md › "Comunicados da liderança".
--
-- Público decidido pelo SERVIDOR na publicação (nunca ids vindos do navegador):
--   TEAM          = toda a estrutura abaixo de quem publica (reports_to, qualquer profundidade), pessoas ativas, gravada em
--                   `communication_recipients` no momento da publicação (quem entra depois na equipe não recebe o que já saiu);
--   ORGANIZATION  = toda a organização (sem linhas em `communication_recipients`: vale para todas as pessoas dela).
-- O universo de atuação (B2B/B2C/B2X) ainda não está no tronco: quando chegar, entra como um público novo nesta mesma tabela.
--
-- Conteúdo: HTML refeito pelo servidor a partir de uma lista fechada de marcas (sem atributo nenhum, salvo a cor do texto e a
-- imagem embutida em base64 com metadados removidos) e o texto puro derivado dele — o que o navegador manda nunca é gravado cru.
-- Só leitura (sem ciência, decisão de 16/11/2026). Exclusão sempre lógica (`deleted_at`), nunca `delete from`.

create table if not exists communications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  author_person_id uuid not null references people(id),
  author_account_id uuid not null references user_accounts(id),
  audience text not null check (audience in ('TEAM', 'ORGANIZATION')),
  title text not null check (char_length(title) between 3 and 120),
  content_html text not null check (octet_length(content_html) between 1 and 2200000),
  plain_text text not null check (char_length(plain_text) between 1 and 5000),
  tags text[] not null check (cardinality(tags) between 1 and 3 and tags <@ array['Aviso', 'Processos', 'Campanha']::text[]),
  recipient_count integer not null check (recipient_count >= 0),
  published_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references people(id)
);

-- Feed de quem publicou e ramo "toda a organização" do feed de quem recebe (keyset por instante + id, mais recente primeiro).
create index if not exists communications_author_feed on communications (organization_id, author_person_id, published_at desc, id desc) where deleted_at is null;
create index if not exists communications_organization_feed on communications (organization_id, published_at desc, id desc) where deleted_at is null and audience = 'ORGANIZATION';

create table if not exists communication_recipients (
  communication_id uuid not null references communications(id),
  person_id uuid not null references people(id),
  organization_id uuid not null references organizations(id),
  primary key (communication_id, person_id)
);

create index if not exists communication_recipients_person on communication_recipients (organization_id, person_id, communication_id);
