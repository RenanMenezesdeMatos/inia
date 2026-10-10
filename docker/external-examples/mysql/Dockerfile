FROM mysql:8.4
COPY init.sql /docker-entrypoint-initdb.d/10-init.sql
COPY leitura.sh /docker-entrypoint-initdb.d/20-leitura.sh
