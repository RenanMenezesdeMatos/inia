-- LIMITES DE REQUISIÇÕES COMPARTILHADOS ENTRE PROCESSOS — shared/infrastructure/rate-limit/postgres-rate-limit-store.ts
--
-- Aditiva. Com N processos de API atrás do IIS, cada um contava sozinho em memória (o limite efetivo multiplicava por N). Aqui
-- fica um contador por balde × janela fixa (índice = instante do BANCO ÷ duração da janela, igual para todas as máquinas); o
-- limitador soma a janela atual com a anterior ponderada (janela deslizante aproximada). O balde é o nome da regra + um hash
-- da chave (IP, conta, IP+e-mail) — nenhum IP ou e-mail em claro. UNLOGGED: contador perdido numa queda do banco só zera os
-- limites. Linhas vencidas são apagadas pela tarefa periódica do processamento; apagar a tabela inteira só zera os limites.
create unlogged table rate_limit_hits (
  bucket text not null,
  window_index bigint not null,
  hits integer not null,
  expires_at timestamptz not null,
  primary key (bucket, window_index)
);

create index rate_limit_hits_expires_at_idx on rate_limit_hits (expires_at);
