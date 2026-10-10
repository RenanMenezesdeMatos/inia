-- No-op intencional. Esta migration carregava fechamentos de DEMONSTRAÇÃO (source = 'DEMO_SEED')
-- para os operadores de exemplo — dado de dev/teste, não evolução estrutural do banco. O
-- conteúdo foi movido para backend/seeds/demo/001_operator_performance.sql e passou a ser
-- carregado só de forma explícita (`npm run db:seed:demo`, recusado em NODE_ENV=production).
-- O arquivo permanece para preservar o histórico de schema_migrations dos bancos locais que já
-- a aplicaram; em qualquer ambiente novo ela não insere nada.
select 1;
