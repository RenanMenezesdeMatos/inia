#!/usr/bin/env bash
# Pipeline completo da INIA Mentora: 01 → 08, do GLB base até o modelo web conferido.
#
#   tools/avatar/inia-realista-v02/build.sh              # tudo
#   FROM=06 tools/avatar/inia-realista-v02/build.sh      # recomeça numa etapa (usa as saídas anteriores)
#   BLENDER=/caminho/Blender tools/avatar/inia-realista-v02/build.sh
#
# Variáveis: BLENDER (padrão: /Applications/Blender.app/Contents/MacOS/Blender), BUILD_DIR (arquivos
# intermediários, padrão assets/avatar/inia/realista-v02/work/build), FROM (01–08), RENDERS=0 (pula os
# renders da etapa 08), NODE (padrão: node; a conferência no three.js é pulada se não houver
# frontend/node_modules/three).
#
# Saídas: assets/avatar/inia/realista-v02/textures/*.png (etapas 02, 04, 05), inia-mentora.blend (06),
# frontend/public/models/inia-mentora-v02.glb (07), assets/avatar/inia/realista-v02/renders/*.jpg (08).
# Tempo medido (Mac M-series, 2026-09-25): ver README.md desta pasta.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
NODE="${NODE:-node}"
T="tools/avatar/inia-realista-v02"
B="${BUILD_DIR:-assets/avatar/inia/realista-v02/work/build}"
FROM="${FROM:-01}"
RENDERS="${RENDERS:-1}"
LOGS="$B/logs"
mkdir -p "$LOGS"

if [[ ! -x "$BLENDER" ]] && ! command -v "$BLENDER" >/dev/null 2>&1; then
  echo "Blender não encontrado em '$BLENDER' (defina BLENDER=...)" >&2
  exit 1
fi

TOTAL_START=$(date +%s)

# stage <número> <script> [args...]: roda uma etapa num Blender limpo; para no primeiro erro.
stage() {
  local number="$1" script="$2"
  shift 2
  if [[ "$number" < "$FROM" ]]; then
    echo "-- $number $script (pulada: FROM=$FROM)"
    return
  fi
  local log="$LOGS/$number.log" start
  start=$(date +%s)
  printf '== %s %s ... ' "$number" "$script"
  if ! "$BLENDER" -b --factory-startup --python-exit-code 1 --python "$T/$script" -- "$@" >"$log" 2>&1; then
    echo "FALHOU ($(($(date +%s) - start)) s) — últimas linhas de $log:"
    tail -25 "$log"
    exit 1
  fi
  echo "ok ($(($(date +%s) - start)) s)"
}

stage 01 01_base.py out="$B/01_base.blend"
stage 02 02_outfit.py in="$B/01_base.blend" out="$B/02_outfit.blend"
stage 03 03_proportions.py in="$B/02_outfit.blend" out="$B/03_proportions.blend"
stage 04 04_skin_eyes.py in="$B/03_proportions.blend" out="$B/04_skin_eyes.blend"
stage 05 05_hair.py in="$B/04_skin_eyes.blend" out="$B/05_hair.blend"
stage 06 06_finalize.py in="$B/05_hair.blend" out=assets/avatar/inia/realista-v02/inia-mentora-v02.blend
stage 07 07_export.py in=assets/avatar/inia/realista-v02/inia-mentora-v02.blend out=frontend/public/models/inia-mentora-v02.glb
stage 08 08_verify.py glb=frontend/public/models/inia-mentora-v02.glb renders="$RENDERS"

if [[ -d frontend/node_modules/three ]] && command -v "$NODE" >/dev/null 2>&1; then
  printf '== 08 three.js (GLTFLoader) ... '
  if ! "$NODE" "$T/lib/export_three_check.mjs" frontend/public/models/inia-mentora-v02.glb \
      --json assets/avatar/inia/realista-v02/work/inia-mentora-v02.three.json >"$LOGS/08_three.log" 2>&1; then
    echo "FALHOU:"; cat "$LOGS/08_three.log"; exit 1
  fi
  echo "ok"
else
  echo "-- 08 three.js pulado (sem frontend/node_modules/three ou node)"
fi

echo "Pronto em $(($(date +%s) - TOTAL_START)) s:"
echo "  assets/avatar/inia/realista-v02/inia-mentora-v02.blend"
echo "  frontend/public/models/inia-mentora-v02.glb ($(du -h frontend/public/models/inia-mentora-v02.glb | cut -f1))"
echo "  assets/avatar/inia/realista-v02/renders/"
