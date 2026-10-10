-- Situação funcional: evidência do período (hardening da Central de Dados × elegibilidade).
--
-- `effective_to_explicit`: o fim do período veio da FONTE (ausência explícita 04–20), e não de um
-- vizinho que o fechou. Um período explícito e limitado tem evidência temporal melhor do que um
-- snapshot sem intervalo — regra de precedência aplicada por `applyEmployeeStatusSnapshot`.
-- `authoritative`: o período veio de um feed marcado como autoritativo na Central (desempate
-- entre evidências de mesmo nível). Backfill: fim explícito ≈ período com fim e início não
-- inferido (aproximação documentada para o legado; a partir daqui o serviço grava o valor real).
alter table employee_status_periods add column if not exists effective_to_explicit boolean not null default false;
alter table employee_status_periods add column if not exists authoritative boolean not null default false;
update employee_status_periods set effective_to_explicit = true where effective_to is not null and not effective_from_inferred and effective_to_explicit = false;
