"""Etapa 03 — proporções do rosto e do corpo, preservando TODAS as shape keys.

    blender -b --python tools/avatar/inia-mentora/03_proportions.py -- in=<entrada.blend> out=<saida.blend> \
        [renders=<prefixo>] [checks=1] [rest=1] [expressions=1] [params=<json>] [identity=1]

Aplica UMA deformação espacial suave f (mundo, Z para cima) à Basis e às posições absolutas de cada
shape key de TODAS as malhas filhas do INIA_Rig (corpo, cabeça, roupas da etapa 02: polo, logos,
broche, cinto…), move as juntas do rig (edit bones) pela mesma f e translada os olhos rigidamente.
f = identidade + campos localizados definidos por marcos medidos em tempo de execução
(`lib/warp_landmarks.py`), nunca por índice de vértice:
- rosto (`lib/warp_face.py`): mandíbula/bochecha baixa mais largas, maçãs cheias, queixo rombo e mais
  cheio, boca mais larga/para frente com lábios mais grossos, nariz com asas mais largas; tudo zerado
  perto dos globos oculares (pálpebras/órbitas intactas, olhos rígidos);
- nariz (`lib/warp_sculpt.py`): suavização local de Taubin como offset por vértice (Basis + todas as
  keys): ponta redonda e transição asa-bochecha sem vinco;
- corpo (`lib/warp_body.py`): tronco mais cheio (ombros/costas, busto, cintura, quadril), pescoço mais
  grosso e mais curto (cabeça desce rigidamente), braços/antebraços com volume radial uniforme (o
  formato anatômico vem da etapa 02) e o membro inteiro acompanhando o ombro alargado, cotovelo mais
  baixo (braço : antebraço ≈ 1,3 : 1), pulso oval, mão adulta (escala anisotrópica afim: palma/dedos
  mais largos e grossos, um pouco mais curta) e polegar sem ponta de garra — juntas acompanham; coxas
  levemente mais cheias.
Relatório JSON: deslocamento máximo por shape key antes/depois, solda cabeça-corpo, rigidez dos olhos,
det(J) mínimo (sem dobras), juntas movidas. `checks=1` roda o teste de poke-through da boca/pálpebras
(entrada × saída). `renders=<p>` gera `<p>_compare.png` (4 vistas × referências) e `<p>_head_compare.png`.
Recusa rodar duas vezes sobre o mesmo arquivo (marca `inia_stage03` no rig).
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from common import BODY, EYES, HEAD, RIG, WORK, apply_preview_pose, clear_pose, compare_sheet, obj, open_blend, parse_args, render_views, save_blend  # noqa: E402
import warp_apply as WA  # noqa: E402
import warp_body as WB  # noqa: E402
import warp_checks as WC  # noqa: E402
import warp_face as WF  # noqa: E402
import warp_landmarks as WL  # noqa: E402
import warp_preview as WP  # noqa: E402
import warp_sculpt as WS  # noqa: E402
from warp_core import Warp, jacobian_report  # noqa: E402

STAGE_TAG = "inia_stage03"

# Parâmetros finais (sobrescrevem os padrões dos módulos; `params=<json>` sobrescreve estes).
FACE_PARAMS: dict = {}
BODY_PARAMS: dict = {}


def _vec(v) -> list:
    return [round(float(x), 4) for x in v]


def build_warp(face_lm: dict, body_lm: dict, face_params: dict, body_params: dict) -> Warp:
    warp = Warp()
    WF.add_face(warp, face_lm, face_params)
    WB.add_body(warp, body_lm, face_lm, body_params)
    return warp


def main() -> None:
    args = parse_args()
    src = Path(args.get("in", WORK / "01_base.blend"))
    dst = Path(args.get("out", WORK / "03_proportions.blend"))
    prefix = args.get("renders")
    identity = args.get("identity") == "1"
    t0 = time.time()
    overrides = json.loads(Path(args["params"]).read_text()) if args.get("params") else {}
    face_params = {**FACE_PARAMS, **overrides.get("face", {})}
    body_params = {**BODY_PARAMS, **overrides.get("body", {})}

    open_blend(src)
    for name in (RIG, BODY, HEAD, EYES):
        obj(name)
    rig = obj(RIG)
    if rig.get(STAGE_TAG):
        raise RuntimeError(f"{src} já passou pela etapa 03 ({STAGE_TAG} no rig) — rode sobre a saída da etapa 02")
    if obj(HEAD).data.shape_keys is None or obj(EYES).data.shape_keys is None:
        raise RuntimeError("INIA_Head/INIA_Eyes sem shape keys — entrada inesperada")
    clear_pose()
    for ob in (obj(HEAD), obj(EYES)):
        for kb in ob.data.shape_keys.key_blocks:
            kb.value = 0.0

    face_lm = WL.face_landmarks()
    body_lm = WL.body_landmarks()
    meshes = WA.rig_meshes(rig)
    report: dict = {"stage": "03_proportions", "in": str(src), "out": str(dst),
                    "objects": [o.name for o in meshes],
                    "landmarks_before": {"U": round(face_lm["U"], 4), "eye": _vec(face_lm["eye"]), "chin_z": round(face_lm["chin_z"], 4),
                                         "mouth_hw": round(face_lm["mouth_hw"], 4), "alae_x": round(float(face_lm["alae"][0]), 4)}}
    keys_before = {HEAD: WC.key_stats(obj(HEAD)), EYES: WC.key_stats(obj(EYES))}
    ring_before = face_lm["ring_positions"]
    report["seam_gap_before_mm"] = WC.seam_gap(ring_before)

    warp = Warp() if identity else build_warp(face_lm, body_lm, face_params, body_params)
    if not identity:
        pts = np.concatenate([WA.mesh_world_coords(o) for o in meshes])
        report["jacobian"] = jacobian_report(warp, pts)
        report["field_max_mm"] = warp.per_field_max(pts)
        if report["jacobian"]["det_min"] <= 0.2:
            raise RuntimeError(f"deformação com dobra/inversão: det(J) mínimo {report['jacobian']['det_min']}")

    report["meshes"] = {}
    for ob in meshes:
        if ob.name == EYES:
            continue
        report["meshes"][ob.name] = WA.warp_mesh(ob, warp)
    eyes = obj(EYES)
    report["eyes_rigid"] = WA.warp_rigid_groups(eyes, warp, WA.split_by_side(WA.mesh_world_coords(eyes)))
    bones = WA.warp_armature(rig, warp)
    report["bones"] = {"count": bones["bones"], "max_joint_move_mm": bones["max_joint_move_mm"],
                       "joints_mm": {k: v for k, v in bones["moved_mm"].items()
                                     if k in ("Head", "Neck", "LeftArm", "LeftForeArm", "LeftHand", "LeftUpLeg", "Spine2", "LeftShoulder")}}

    if not identity and face_params.get("sculpt", {}) is not None:
        # nariz arredondado/sem vinco: suavização local como offset por vértice (Basis + todas as keys)
        head_ob = obj(HEAD)
        labels = WL._islands(head_ob, WA.mesh_world_coords(head_ob))
        ids, counts = np.unique(labels, return_counts=True)
        # marcos de ANTES levados por f (os de depois confundem a asa com a bochecha que veio para frente)
        lm_s = {k: warp(np.asarray(face_lm[k], float)[None])[0] for k in ("nose_tip", "subnasale", "upper_lip", "alae", "eye_l", "eye_r")}
        lm_s.update(U=face_lm["U"], eye_radius=face_lm["eye_radius"])
        report["sculpt"] = WS.sculpt_nose(head_ob, labels == ids[np.argmax(counts)], lm_s, face_params.get("sculpt"))
        if face_params.get("philtrum", {}) is not None:
            # filtro: sulco entre o nariz e a boca (o asset não tem; a suavização do nariz alisa a região)
            report["philtrum"] = WS.sculpt_philtrum(head_ob, labels == ids[np.argmax(counts)], lm_s, face_params.get("philtrum"))

    keys_after = {HEAD: WC.key_stats(obj(HEAD)), EYES: WC.key_stats(obj(EYES))}
    report["shape_keys"] = {n: WC.compare_key_stats(keys_before[n], keys_after[n]) for n in keys_before}
    ring_after = warp(ring_before) if len(ring_before) else ring_before
    report["seam_gap_after_mm"] = WC.seam_gap(ring_after)
    lm2 = WL.face_landmarks()
    report["landmarks_after"] = {"U": round(lm2["U"], 4), "eye": _vec(lm2["eye"]), "chin_z": round(lm2["chin_z"], 4),
                                 "mouth_hw": round(lm2["mouth_hw"], 4), "alae_x": round(float(lm2["alae"][0]), 4)}
    rig[STAGE_TAG] = json.dumps({"face": face_params, "body": body_params, "identity": identity})
    save_blend(dst)
    report["seconds_warp"] = round(time.time() - t0, 1)

    if prefix:
        WP.hide_hair_faces()
        eye = Vector(lm2["eye"].tolist())
        WP.render_head_views(prefix, eye, lm2["U"])
        report["head_compare"] = WP.head_compare_sheet(prefix, extra_rows=[r for r in args.get("extra_rows", "").split(",") if r])
        if args.get("expressions") == "1":
            report["expressions"] = WP.expression_sheet(prefix, eye, lm2["U"])
        if args.get("body", "1") == "1":
            apply_preview_pose()
            render_views(prefix)
            report["compare"] = str(compare_sheet(prefix))
            if args.get("rest", "0") == "1":
                clear_pose()
                render_views(prefix + "_rest", ["front", "threequarter", "back"], framing="full")
                report["rest"] = str(compare_sheet(prefix + "_rest", ["front", "threequarter", "back"]))
            clear_pose()

    if args.get("checks") == "1":
        tag = Path(dst).stem
        after = WC.poke_counts(tag)
        open_blend(src)
        before = WC.poke_counts(Path(src).stem + "_ref")
        report["poke_green_pixels"] = {k: {"before": before[k], "after": after[k]} for k in after if not k.startswith("_")}

    report["seconds"] = round(time.time() - t0, 1)
    out_json = Path(dst).with_suffix(".json")
    out_json.write_text(json.dumps(report, indent=1, ensure_ascii=False))
    short = {k: report[k] for k in ("stage", "out", "seam_gap_before_mm", "seam_gap_after_mm", "seconds") if k in report}
    short["jacobian"] = report.get("jacobian")
    short["eyes_nonrigidity_mm"] = [g["nonrigidity_mm"] for g in report["eyes_rigid"]["groups"]]
    short["report"] = str(out_json)
    print("STAGE03_REPORT " + json.dumps(short, ensure_ascii=False))


main()
