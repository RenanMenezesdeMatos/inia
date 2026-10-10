-- Índice na FK workflow_enrollments.indicator_measurement_id: sem ele, apagar/reprocessar
-- medições em volume (Central de Dados) força uma varredura completa de matrículas por linha.
create index if not exists idx_workflow_enrollments_measurement on workflow_enrollments (indicator_measurement_id) where indicator_measurement_id is not null;
