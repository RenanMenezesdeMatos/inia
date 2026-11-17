-- UNIVERSO DE ATUAÇÃO — etapa 3 de 3: obrigatório no BANCO. NÃO fica em migrations/ de propósito: só é movida para lá (e aplicada)
-- depois que a prontidão (Administração › Dados › Universo de atuação, `GET /api/v1/admin/operating-universe/readiness`) mostrar ZERO
-- pendentes (operadores ativos, bases, workflows, produtos e demais recursos).
-- Recusa a aplicação se ainda houver pendente, em vez de criar uma restrição que derrubaria escritas do legado.
-- Pessoa: só o OPERADOR precisa de universo (revisão de 16/11, migration 204) — liderança sem universo vê a própria estrutura e fica
-- nula de propósito; a contagem é a mesma da prontidão (`loadReadiness`). Era a 198; renumerada (auditoria run-4, UB-07) para vir
-- depois da última migration aplicada quando for movida para migrations/.
do $$
declare pending bigint;
begin
  select (select count(*) from people where active and role = 'OPERATOR' and operating_universe is null)
       + (select count(*) from knowledge_documents where deleted_at is null and operating_universe is null)
       + (select count(*) from workflows where operating_universe is null)
       + (select count(*) from product_catalog_nodes where kind = 'PRODUCT' and operating_universe is null)
       + (select count(*) from indicator_definitions where operating_universe is null)
       + (select count(*) from business_domains where operating_universe is null)
       + (select count(*) from agents where operating_universe is null)
       + (select count(*) from assistant_orchestrators where operating_universe is null)
       + (select count(*) from argument_scripts where operating_universe is null)
    into pending;
  if pending > 0 then
    raise exception 'Ainda há % registros sem universo de atuação. Classifique-os antes desta migration.', pending;
  end if;
end $$;

-- Operador inativo pode continuar sem universo (histórico); operador ativo precisa ter. Liderança e "fora da hierarquia" não.
alter table people add constraint people_active_operator_requires_universe check (not active or role <> 'OPERATOR' or operating_universe is not null);
alter table knowledge_documents add constraint knowledge_documents_universe_required check (deleted_at is not null or operating_universe is not null);
alter table workflows_all add constraint workflows_universe_required check (deleted_at is not null or (operating_universe is not null and draft_operating_universe is not null));
alter table product_catalog_nodes_all add constraint product_nodes_universe_required check (kind <> 'PRODUCT' or deleted_at is not null or operating_universe is not null);
alter table indicator_definitions_all add constraint indicator_definitions_universe_required check (deleted_at is not null or operating_universe is not null);
alter table business_domains_all add constraint business_domains_universe_required check (deleted_at is not null or operating_universe is not null);
alter table agents_all add constraint agents_universe_required check (deleted_at is not null or operating_universe is not null);
alter table assistant_orchestrators_all add constraint assistant_orchestrators_universe_required check (deleted_at is not null or operating_universe is not null);
alter table argument_scripts_all add constraint argument_scripts_universe_required check (deleted_at is not null or operating_universe is not null);
