@echo off
rem Varredura de diagnosticos (IT-INIA-005, etapa 8; docs/dev/diagnostic-bootstrap.md).
rem Uso: varredura opcoes, varredura plan ..., varredura execute ..., varredura report ...
cd /d "%~dp0"
node --import tsx scripts\feedback-engine\bootstrap-diagnostics.ts %*
