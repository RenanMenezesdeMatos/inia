-- ALINHAMENTOS OPERACIONAIS — responsável e cargo (17/11/2026, integração com Publicações). Pedido original: "registre o responsável,
-- seu cargo ou função e quem publicou, quando forem pessoas diferentes". Ver docs/dev/memoria/alinhamentos-operacionais.md.
--
-- `responsible_person_id`: quem DEFINIU a orientação (padrão: quem cadastrou; pode ser outra liderança — ex.: a gestora que decidiu e o
-- analista que publicou). `responsible_job_title`: o cargo do cadastro (`people.job_title`, o mesmo da ficha) copiado ao salvar e de
-- novo ao publicar — a versão publicada guarda o cargo daquela data; trocar de cargo depois não reescreve o histórico.
-- Versões anteriores ficam nulas: o chat atribui a orientação a quem publicou, como antes.
alter table operational_alignment_versions
  add column if not exists responsible_person_id uuid references people(id),
  add column if not exists responsible_job_title text;
alter table operational_alignment_versions drop constraint if exists operational_alignment_versions_responsible_job_title_check;
alter table operational_alignment_versions add constraint operational_alignment_versions_responsible_job_title_check
  check (responsible_job_title is null or char_length(responsible_job_title) <= 200);
