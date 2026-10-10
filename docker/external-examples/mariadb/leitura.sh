# Usuário SOMENTE LEITURA `inia_leitura` do banco de exemplo. Rodado (source) pelo entrypoint da imagem depois do
# 10-init.sql; a senha vem do ambiente do contêiner (INIA_EXAMPLES_READER_PASSWORD, do .env da raiz) — nunca do código.
: "${INIA_EXAMPLES_READER_PASSWORD:?Defina INIA_EXAMPLES_READER_PASSWORD no .env da raiz (npm run env:init gera)}"
docker_process_sql <<-EOSQL
	create user 'inia_leitura'@'%' identified by '${INIA_EXAMPLES_READER_PASSWORD}';
	grant select on inia_exemplo.* to 'inia_leitura'@'%';
EOSQL
