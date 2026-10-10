"""Etapa 06 — contrato do modelo web e arquivo editável final.

    blender -b --python-exit-code 1 --python tools/avatar/inia-mentora/06_finalize.py -- \
        in=<05_hair.blend> [out=assets/avatar/inia/mentora/inia-mentora.blend] [tex_dir=<pasta>]

- Nomes do contrato do frontend: INIA_Rig (armature), INIA_Body, INIA_Head, INIA_Eyes, INIA_Polo,
  INIA_Logos, INIA_Badge, INIA_Hair, INIA_HairCurls. O cinto da etapa 02 (`INIA_Belt`) é juntado ao
  INIA_Body (mesma malha da calça; materiais M_Belt/M_Buckle preservados). O mapeamento vai no relatório.
- Repouso: sem ação/NLA, pose zerada, blendshapes em 0 (o frontend monta as animações em código).
- Skinning: toda malha é filha (objeto) do INIA_Rig, com UM modificador Armature e ≤ 4 influências
  normalizadas por vértice, só em grupos com nome de osso; vértice sem peso é erro.
- Blendshapes: INIA_Head e INIA_Eyes com os 52 ARKit do GLB base (mesmos nomes e ordem); todo
  blendshape que tinha delta na base continua tendo (tongueOut é vazio desde a base).
- Empties INIA_Frame_Top/Face/Chest/Belt (ver `lib/finalize_frames.py` e `rig-framing.ts`).
- Materiais: Principled BSDF com imagens / cor por vértice; logo em alpha MASK (Math Round); córnea
  continua BLEND como no asset base; nó procedural é erro (precisa ser assado pela etapa que o criou).
- Imagens referenciadas de `textures/` por caminho relativo; as do asset base continuam empacotadas.
- Remove objetos auxiliares, câmeras, luzes, mundo e datablocks órfãos.
- Idempotente: rodar sobre a própria saída produz o mesmo resultado.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from common import FINAL_BLEND, RIG, TEX_DIR, WORK, obj, open_blend, parse_args, write_report  # noqa: E402
import finalize_contract as C  # noqa: E402
import finalize_frames as FF  # noqa: E402
import finalize_materials as FM  # noqa: E402
import finalize_rig as FR  # noqa: E402


def main() -> dict:
    args = parse_args()
    if "in" not in args:
        raise SystemExit("uso: 06_finalize.py -- in=<05_hair.blend> [out=<final.blend>]")
    src = Path(args["in"]).resolve()
    dst = Path(args.get("out", FINAL_BLEND)).resolve()
    tex_dir = Path(args.get("tex_dir", TEX_DIR))
    open_blend(src)
    contract = C.base_contract()

    report: dict = {"in": str(src), "out": str(dst)}
    report["mapping"] = FR.resolve_objects()
    report["rest"] = FR.rest_pose()
    report["cleanup"] = FM.cleanup()
    report["skinning"] = FR.skinning()
    report["shape_keys"] = FR.shape_keys(contract)
    bones = [b.name for b in obj(RIG).data.bones]
    if sorted(bones) != sorted(contract["bones"]):
        raise RuntimeError("ossos diferentes do GLB base")
    report["bones"] = len(bones)
    report["frames"] = FF.create_frames()
    report["materials"] = FM.materials()
    report["images"] = FM.images(tex_dir)
    for key, value in C.PROVENANCE.items():
        obj(RIG)[key] = value
    report["triangles"] = {name: FR.triangles(obj(name)) for name in C.MESHES}
    report["triangles_total"] = sum(report["triangles"].values())
    report["objects"] = sorted(ob.name for ob in bpy.data.objects)

    FM.relative_image_paths(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0  # sem .blend1 ao lado do arquivo versionado
    bpy.ops.wm.save_as_mainfile(filepath=str(dst), compress=True, relative_remap=False)
    write_report(Path(args.get("report", WORK / f"{dst.stem}.06.json")), report)
    return report


if __name__ == "__main__":
    result = main()
    print("REPORT_06", json.dumps({k: result[k] for k in ("mapping", "triangles_total", "frames")}, ensure_ascii=False))
    print("OK 06_finalize", result["out"])
