"""Etapa 08 — confere o GLB exportado num Blender limpo e gera os renders finais.

    blender -b --python-exit-code 1 --python tools/avatar/inia-realista-v02/08_verify.py -- \
        [glb=frontend/public/models/inia-mentora-v02.glb] [renders=1] [rest=0]

- Reimporta o GLB (importador glTF padrão) e confere: nomes do contrato, 55 ossos Mixamo, 52
  blendshapes ARKit na ordem da base em INIA_Head e INIA_Eyes com delta onde a base tinha delta
  (tongueOut é vazio desde a base; nos olhos só os eyeLook* movem o globo), skinning, triângulos
  (< 130k), texturas decodificadas, alpha MASK do logo, empties de enquadramento, sem animações.
- Renders a partir do GLB (pose de conferência com os braços caídos) na réplica da iluminação do app
  (`lib/export_web_studio.py`; `studio=agx` usa o estúdio antigo das etapas 02–05), em
  `assets/avatar/inia/realista-v02/renders/` (JPEG ~1600 px): `inia-mentora_compare.jpg` (4 vistas × refs),
  `inia-mentora_head.jpg` (rosto frente / 3/4 / perfil) e `inia-mentora_expressions.jpg` (morphs).
  Mede a cor exibida de pele/polo/cabelo/calça/cinto × referências (`lib/export_color_check.py`) e
  sugere ganhos para `lib/export_web_color.py`. `rest=1` também renderiza o A-pose de repouso em work/renders (conferência de deformação).
- Relatório em work/inia-mentora.08.json; falha (código ≠ 0) se qualquer asserção falhar.
- O teste no three.js (GLTFLoader) é `lib/export_three_check.mjs` (chamado pelo build.sh).
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from common import (FFMPEG, FINAL_GLB, WORK, apply_preview_pose, clear_pose, compare_sheet,  # noqa: E402
                    obj, parse_args, render_views, write_report)
import export_color_check as CC  # noqa: E402
import export_renders as ER  # noqa: E402
import export_verify as EV  # noqa: E402
import finalize_contract as C  # noqa: E402

PREFIX = "inia-mentora-v02"
EXPRESSIONS = {
    "neutro": {},
    "sorriso": {"mouthSmileLeft": 0.8, "mouthSmileRight": 0.8, "cheekSquintLeft": 0.3, "cheekSquintRight": 0.3},
    "fala": {"jawOpen": 0.45, "mouthFunnel": 0.25},
    "piscada": {"eyeBlinkLeft": 1.0, "eyeBlinkRight": 1.0},
    "olhar": {"eyeLookOutLeft": 0.8, "eyeLookInRight": 0.8, "browInnerUp": 0.4},
}


def stack(paths: list[Path], out: Path, width: int = 1600) -> Path:
    inputs = [arg for p in paths for arg in ("-i", str(p))]
    graph = "".join(f"[{i}:v]" for i in range(len(paths))) + f"hstack=inputs={len(paths)},scale={width}:-2"
    if len(paths) == 1:
        graph = f"[0:v]scale={width}:-2"
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([FFMPEG, "-loglevel", "error", "-y", *inputs, "-filter_complex", graph, "-q:v", "3", str(out)], check=True)
    return out


def set_expression(values: dict[str, float]) -> None:
    for name in C.SHAPE_KEY_MESHES:
        for block in obj(name).data.shape_keys.key_blocks[1:]:
            block.value = values.get(block.name, 0.0)
    bpy.context.view_layer.update()


def renders(rest: bool, studio: str) -> dict:
    out_dir = C.RENDERS_DIR
    written = {}
    views = ["front", "threequarter", "profile", "back"]
    if rest:
        clear_pose()
        render_views(f"{PREFIX}_rest", views=["front", "threequarter", "back"], framing="full")
        written["rest"] = str(stack([WORK / "renders" / f"{PREFIX}_rest_{v}.png" for v in ("front", "threequarter", "back")],
                                    WORK / "renders" / f"{PREFIX}_rest.jpg"))
    apply_preview_pose()
    ER.render_reference(PREFIX, views, studio=studio)
    written["compare"] = str(stack([compare_sheet(PREFIX)], out_dir / f"{PREFIX}_compare.jpg"))
    head_views = ["front", "threequarter", "profile"]
    ER.render_closeups(f"{PREFIX}_head", head_views, studio=studio, height=0.42)
    written["head"] = str(stack([WORK / "renders" / f"{PREFIX}_head_{v}.png" for v in head_views], out_dir / f"{PREFIX}_head.jpg"))
    frames = []
    for label, values in EXPRESSIONS.items():
        set_expression(values)
        ER.render_closeups(f"{PREFIX}_expr_{label}", ["front"], studio=studio, height=0.30, res=(420, 480))
        frames.append(WORK / "renders" / f"{PREFIX}_expr_{label}_front.png")
    set_expression({})
    written["expressions"] = str(stack(frames, out_dir / f"{PREFIX}_expressions.jpg"))
    return written


def main() -> dict:
    args = parse_args()
    glb = Path(args.get("glb", FINAL_GLB)).resolve()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(glb))
    for helper in [ob for ob in bpy.data.objects if ob.name.startswith("Icosphere")]:
        bpy.data.objects.remove(helper, do_unlink=True)  # forma de exibição de osso criada pelo importador
    contract = C.base_contract()
    checks = EV.Checks()
    report: dict = {"glb_path": str(glb), "bytes": glb.stat().st_size}
    report["frames"] = EV.objects(checks)
    report["bones"] = EV.bones(checks, contract)
    report["shape_keys"] = EV.shape_keys(checks, contract)
    report["triangles"] = EV.triangles(checks)
    report["textures"] = EV.textures(checks)
    report["glb"] = EV.glb_summary(glb)
    checks.check(report["glb"]["alpha_modes"].get("M_Logo") == "MASK", "logo em alpha MASK")
    checks.check(report["glb"]["animations"] == 0, "GLB sem animações")
    report["passed"] = len(checks.passed)
    report["failures"] = checks.failures
    if args.get("renders", "1") == "1" and not checks.failures:
        studio = args.get("studio", "web")
        report["renders"] = renders(args.get("rest", "0") == "1", studio)
        if studio == "web":  # por último: troca os materiais por máscaras
            codes = CC.render_masks(f"{PREFIX}_mask", ["front", "threequarter", "profile", "back"])
            report["web_color"] = CC.measure(PREFIX, f"{PREFIX}_mask", codes)
    write_report(WORK / f"{PREFIX}.08.json", report)
    if checks.failures:
        raise RuntimeError("FALHAS:\n- " + "\n- ".join(checks.failures))
    return report


if __name__ == "__main__":
    result = main()
    print("REPORT_08", json.dumps({k: result[k] for k in ("passed", "failures", "triangles")}, ensure_ascii=False))
    for group, entry in result.get("web_color", {}).items():
        print("COR", group, entry["displayed"], "alvo", entry["target"], "ΔL", entry["delta_L"], "sugestão", entry["suggested"])
    print("OK 08_verify", result.get("renders", {}))
