-- CAPITAL OPERACIONAL — a capital brasileira cuja JURISDIÇÃO DE FERIADOS vale para o colaborador.
-- Não é endereço, residência, lotação geográfica nem local físico: a INIA só precisa saber quais
-- feriados (nacional + estadual da UF derivada + municipal da capital) se aplicam a cada pessoa.
--
--   brazilian_capitals             → reference data: exatamente 27 (26 capitais estaduais + Brasília/DF),
--                                    código estável, nome, UF e código IBGE do município. Sem CRUD:
--                                    ninguém inventa capital nova; a UF é DERIVADA daqui.
--   people.operational_capital_code → referência aditiva e opcional (pessoas existentes continuam sem;
--                                    o contrato EMPLOYEES passa a aceitar `operationalCapitalCode`).
-- Fonte dos códigos IBGE: API de localidades do IBGE (servicodados.ibge.gov.br/api/v1/localidades/municipios).

create table if not exists brazilian_capitals (
  code text primary key check (code ~ '^[A-Z][A-Z_]{2,39}$'),
  name text not null,
  state_code char(2) not null,
  ibge_code char(7) not null unique,
  created_at timestamptz not null default now()
);

insert into brazilian_capitals (code, name, state_code, ibge_code) values
  ('RIO_BRANCO',     'Rio Branco',     'AC', '1200401'),
  ('MACEIO',         'Maceió',         'AL', '2704302'),
  ('MACAPA',         'Macapá',         'AP', '1600303'),
  ('MANAUS',         'Manaus',         'AM', '1302603'),
  ('SALVADOR',       'Salvador',       'BA', '2927408'),
  ('FORTALEZA',      'Fortaleza',      'CE', '2304400'),
  ('BRASILIA',       'Brasília',       'DF', '5300108'),
  ('VITORIA',        'Vitória',        'ES', '3205309'),
  ('GOIANIA',        'Goiânia',        'GO', '5208707'),
  ('SAO_LUIS',       'São Luís',       'MA', '2111300'),
  ('CUIABA',         'Cuiabá',         'MT', '5103403'),
  ('CAMPO_GRANDE',   'Campo Grande',   'MS', '5002704'),
  ('BELO_HORIZONTE', 'Belo Horizonte', 'MG', '3106200'),
  ('BELEM',          'Belém',          'PA', '1501402'),
  ('JOAO_PESSOA',    'João Pessoa',    'PB', '2507507'),
  ('CURITIBA',       'Curitiba',       'PR', '4106902'),
  ('RECIFE',         'Recife',         'PE', '2611606'),
  ('TERESINA',       'Teresina',       'PI', '2211001'),
  ('RIO_DE_JANEIRO', 'Rio de Janeiro', 'RJ', '3304557'),
  ('NATAL',          'Natal',          'RN', '2408102'),
  ('PORTO_ALEGRE',   'Porto Alegre',   'RS', '4314902'),
  ('PORTO_VELHO',    'Porto Velho',    'RO', '1100205'),
  ('BOA_VISTA',      'Boa Vista',      'RR', '1400100'),
  ('FLORIANOPOLIS',  'Florianópolis',  'SC', '4205407'),
  ('SAO_PAULO',      'São Paulo',      'SP', '3550308'),
  ('ARACAJU',        'Aracaju',        'SE', '2800308'),
  ('PALMAS',         'Palmas',         'TO', '1721000')
on conflict (code) do update set name = excluded.name, state_code = excluded.state_code, ibge_code = excluded.ibge_code;

alter table people
  add column if not exists operational_capital_code text references brazilian_capitals(code);
create index if not exists idx_people_operational_capital on people (organization_id, operational_capital_code) where operational_capital_code is not null;
