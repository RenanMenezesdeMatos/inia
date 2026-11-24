-- Cargo e nível da pessoa nunca se contradizem (auditoria run-11, ARQ-04): a tela mostra o cargo e as regras usam o nível. Quem escreve
-- só o nível (edição, seed, script) tira o cargo que deixou de combinar, em vez de deixar a pessoa com um cargo de outro perfil.
create function people_match_job_position() returns trigger language plpgsql as $$
begin
  if new.job_position_id is not null and not exists (select 1 from job_positions jp where jp.id = new.job_position_id and jp.level = new.role) then
    new.job_position_id := null;
  end if;
  return new;
end $$;
create trigger people_match_job_position before insert or update of role, job_position_id on people for each row execute function people_match_job_position();
