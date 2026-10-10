"""Etapa 07 — exporta o modelo web `frontend/public/models/inia-mentora.glb`.

    blender -b --python-exit-code 1 --python tools/avatar/inia-mentora/07_export.py -- \
        [in=assets/avatar/inia/mentora/inia-mentora.blend] [out=frontend/public/models/inia-mentora.glb] \
        [quality=88] [max_mb=12] [web_color=1]

- GLB com skin (55 ossos), morph targets com normais (accessors esparsos; blendshape sem delta sem
  dados), cor por vértice só onde o material usa (cabelo), Y para cima, SEM animações/câmeras/luzes,
  procedência em `asset.copyright` e nos extras do nó INIA_Rig.
- Texturas: cópias em WebP (EXT_texture_webp) com teto de 2048 no atlas pele/rosto e 1024 nas demais
  (`lib/export_textures.py`); as fontes não são tocadas e o .blend não é salvo.
- Cor para o visualizador web (`lib/export_web_color.py`, `web_color=0` desliga): os albedos das
  etapas 02–05 foram calibrados para o estúdio AgX do Blender; no app (luzes de studio-lighting.ts +
  PBR Neutral) eles saem escuros e supersaturados. As CÓPIAS exportadas (textura de cor base, cor por
  vértice dos cachos, cores de fator) recebem um ganho por grupo em OKLab medido contra as
  referências; o .blend final não muda.
- Normais dos morphs: deltas < 5e-4 (ruído do próprio exportador) saem dos accessors esparsos
  (`lib/export_prune.py`), o que corta quase metade dos morphs sem mudar a imagem.
- Meta ≤ `max_mb` (12 MB): se passar, reduz as texturas (×0,75, ×0,5) e exporta de novo.
- Relatório com o tamanho por categoria (geometria, morphs, texturas) em work/inia-mentora.07.json.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from common import FINAL_BLEND, FINAL_GLB, RIG, WORK, obj, open_blend, parse_args, write_report  # noqa: E402
import export_glb as EG  # noqa: E402
import export_prune as EP  # noqa: E402
import export_textures as ET  # noqa: E402
import export_web_color as WC  # noqa: E402
import finalize_materials as FM  # noqa: E402
import finalize_contract as C  # noqa: E402

SCALES = (1.0, 0.75, 0.5)


def check_input() -> None:
    for name in (RIG, *C.MESHES, *C.FRAMES):
        obj(name)
    if bpy.data.actions:
        raise RuntimeError("o .blend final não deveria ter ações (rode a etapa 06)")
    extra = sorted(ob.name for ob in bpy.data.objects if ob.name not in {RIG, *C.MESHES, *C.FRAMES})
    if extra:
        raise RuntimeError(f"objetos fora do contrato no .blend final: {extra}")


def main() -> dict:
    args = parse_args()
    src = Path(args.get("in", FINAL_BLEND)).resolve()
    dst = Path(args.get("out", FINAL_GLB)).resolve()
    quality = int(args.get("quality", 88))
    calibrate = args.get("web_color", "1") == "1"
    limit = float(args.get("max_mb", C.GLB_TARGET_BYTES / 1024 / 1024)) * 1024 * 1024
    tmp = WORK / "export_textures"
    attempts = []
    for scale in SCALES:
        open_blend(src)
        check_input()
        textures = ET.prepare(tmp, color_quality=quality, scale=scale, calibrate=calibrate)
        colors = WC.apply_to_scene([obj(n) for n in C.MESHES], FM.contract_materials()) if calibrate else {}
        EG.export(dst)
        pruned = EP.prune_morph_normals(dst)
        measured = EG.breakdown(dst)
        attempts.append({"texture_scale": scale, "file_mb": measured["file_mb"]})
        if measured["file_bytes"] <= limit:
            break
    else:
        raise RuntimeError(f"GLB acima da meta mesmo com texturas reduzidas: {attempts}")
    report = {"in": str(src), "out": str(dst), "attempts": attempts, "textures": textures,
              "web_color": {"calibration": WC.CALIBRATION if calibrate else None, "applied": colors},
              "morph_normal_pruning": pruned, **measured}
    write_report(WORK / "inia-mentora.07.json", report)
    return report


if __name__ == "__main__":
    result = main()
    summary = {k: result[k] for k in ("file_mb", "bin_bytes", "json_bytes", "attempts", "extensions_required")}
    print("REPORT_07", json.dumps(summary, ensure_ascii=False))
    print("OK 07_export", result["out"])
