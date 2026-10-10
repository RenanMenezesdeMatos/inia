-- Hoje não existe nenhum jeito de saber o subgrupo de um colaborador — subteam_id só era usado
-- como dimensão de ESCOPO de configuração (regras/agentes/workflows), nunca como atributo de
-- pessoa. Sem isso, nenhuma regra de performance por subgrupo (meta/peso/atingimento variando
-- por subgrupo, não só por time) consegue ser resolvida. Nullable, mesmo padrão de team_id —
-- nem toda organização precisa usar subgrupo.
alter table people add column subteam_id uuid references subteams(id);
create index idx_people_subteam on people (organization_id, subteam_id) where subteam_id is not null;
