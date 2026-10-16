-- NUMERADOR e DENOMINADOR no fechamento oficial (2026-10-16, contrato OFFICIAL_INDICATOR_PERFORMANCE@2).
--
-- O cliente passa a enviar, junto com o fechamento mensal por pessoa × indicador (valor, meta,
-- atingimento, peso e quartil, que continuam como estão), os dois componentes do valor quando a
-- estratégia do indicador os define (Taxa: ocorrências ÷ base × 100; Média ponderada: total ÷ volume).
-- Servem para agregar uma ESTRUTURA em valor (Σ numeradores ÷ Σ denominadores, com o fator da estratégia)
-- e para dizer quanto cada unidade pesa nesse valor. Nunca recalculam o fechamento: atingimento, PRV,
-- quartil e peso seguem os da fonte.
--
-- Opcionais e nulos por padrão: fechamentos antigos (contrato @1, seeds, ingestões anteriores) não têm
-- componentes, e componente ausente nunca é desempenho ruim. Os dois vêm juntos e o denominador é
-- positivo; o numerador pode ser negativo (uma média ponderada de pontos negativos, por exemplo).
-- Nenhuma linha existente é alterada aqui.

alter table employee_indicator_performance
  add column numerator numeric,
  add column denominator numeric;

alter table employee_indicator_performance
  add constraint employee_indicator_performance_components_check check (
    (numerator is null and denominator is null)
    or (numerator is not null and denominator is not null and denominator > 0)
  );
