-- Voz do recado do avatar (Workflow Output → Avatar, 2026-09-30).
--
-- O recado passa a ser falado com a voz do Gemini (TTS do texto EXATO da entrega — o modelo lê, não reescreve), no mesmo
-- pipeline de áudio + lip-sync do Live. O áudio é gerado UMA vez por entrega (quando o convite aparece) e fica aqui em
-- cache: aceitar/ouvir de novo nunca sintetiza de novo. `text_sha256` + voz + modelo identificam o que foi sintetizado —
-- se algum mudar, o áudio é gerado outra vez. Apagar a entrega (matrícula apagada) apaga o áudio.
create table if not exists workflow_output_speech_audio (
  output_id uuid primary key references workflow_outputs(id) on delete cascade,
  organization_id uuid not null references organizations(id),
  text_sha256 text not null,
  voice_name text not null,
  model text not null,
  -- PCM16 mono little-endian, sem cabeçalho.
  sample_rate integer not null check (sample_rate between 8000 and 48000),
  audio bytea not null,
  duration_ms integer not null check (duration_ms >= 0),
  created_at timestamptz not null default now()
);
