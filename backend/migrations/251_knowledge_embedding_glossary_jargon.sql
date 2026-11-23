-- Busca nas bases em escala: gíria do Glossário no texto que vira vetor (opção 4 medida em 23/11/2026, docs/dev/busca-em-escala).
-- Com `INIA_KB_GLOSSARY_JARGON_VECTORS=on`, o trecho que cita o termo oficial (1ª oração da definição) ganha "Também chamado: <termo>"
-- só no texto do vetor — o índice de texto e o trecho lido pela IA não mudam. A coluna guarda o Glossário com que a versão foi indexada:
-- mudou o Glossário, ou ligou/desligou o interruptor, a indexação refaz a versão (só os textos que mudaram geram chamada).
-- Desligado (padrão), a coluna fica nula e nada muda.
alter table knowledge_embedding_index add column jargon_key text;
