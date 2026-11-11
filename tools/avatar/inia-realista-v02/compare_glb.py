#!/usr/bin/env python3
"""Métricas do GLB exportado (sem Blender): tamanho, triângulos, primitivas, texturas, esqueleto,
blendshapes e — no v02 — os pesos do osso de balanço do cabelo e o perfil de movimento gravado.

    python3 tools/avatar/inia-realista-v02/compare_glb.py frontend/public/models/inia-mentora-v02.glb \
        frontend/public/models/inia-mentora-v02.glb [--json saida.json]
"""
from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

COMPONENT = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read(path: Path) -> tuple[dict, bytes]:
    data = path.read_bytes()
    assert struct.unpack_from("<I", data, 0)[0] == 0x46546C67, f"não é GLB: {path}"
    jlen = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20:20 + jlen])
    start = 20 + jlen + 8
    return gltf, data[start:start + struct.unpack_from("<I", data, 20 + jlen)[0]]


def accessor(gltf: dict, blob: bytes, index: int) -> list[tuple]:
    acc = gltf["accessors"][index]
    view = gltf["bufferViews"][acc["bufferView"]]
    fmt, size = COMPONENT[acc["componentType"]]
    n = COUNT[acc["type"]]
    stride = view.get("byteStride") or size * n
    base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    return [struct.unpack_from("<" + fmt * n, blob, base + i * stride) for i in range(acc["count"])]


def describe(path: Path) -> dict:
    gltf, blob = read(path)
    nodes = gltf["nodes"]
    meshes = {}
    total = 0
    for node in nodes:
        if "mesh" not in node:
            continue
        mesh = gltf["meshes"][node["mesh"]]
        tris = sum(gltf["accessors"][p["indices"]]["count"] // 3 for p in mesh["primitives"])
        total += tris
        meshes[node["name"]] = {"triangles": tris, "primitives": len(mesh["primitives"]),
                                "morph_targets": len(mesh["primitives"][0].get("targets", []))}
    skin = gltf["skins"][0]
    joint_names = [nodes[j]["name"] for j in skin["joints"]]
    out = {
        "file": str(path), "bytes": path.stat().st_size, "mb": round(path.stat().st_size / 1048576, 2),
        "triangles": total, "primitives_draw_calls": sum(m["primitives"] for m in meshes.values()), "meshes": meshes,
        "materials": len(gltf["materials"]), "textures": len(gltf.get("images", [])),
        "texture_bytes": sum(gltf["bufferViews"][i["bufferView"]]["byteLength"] for i in gltf.get("images", [])),
        "bones": len(joint_names), "extensions": gltf.get("extensionsUsed", []),
        "copyright": gltf["asset"].get("copyright"),
        "rig_extras": next((n.get("extras") for n in nodes if n.get("name") == "INIA_Rig"), None),
    }
    if "hair_02_ph" in joint_names:
        sway = joint_names.index("hair_02_ph")
        hair = {}
        for name in ("INIA_Hair", "INIA_HairCurls"):
            node = next((n for n in nodes if n.get("name") == name), None)
            if node is None:
                continue
            weights = []
            for prim in gltf["meshes"][node["mesh"]]["primitives"]:
                joints = accessor(gltf, blob, prim["attributes"]["JOINTS_0"])
                wts = accessor(gltf, blob, prim["attributes"]["WEIGHTS_0"])
                scale = {5121: 255.0, 5123: 65535.0}.get(gltf["accessors"][prim["attributes"]["WEIGHTS_0"]]["componentType"], 1.0)
                for j, w in zip(joints, wts):
                    weights.append(sum(wi / scale for ji, wi in zip(j, w) if ji == sway))
            moving = [w for w in weights if w > 0.01]
            hair[name] = {"vertices": len(weights), "with_sway_weight": len(moving),
                          "max_sway_weight": round(max(weights), 3), "mean_sway_weight": round(sum(weights) / len(weights), 3)}
        out["hair_sway"] = hair
    return out


def main() -> None:
    args = sys.argv[1:]
    target = None
    if "--json" in args:
        i = args.index("--json")
        target = Path(args[i + 1])
        del args[i:i + 2]
    report = [describe(Path(a)) for a in args]
    text = json.dumps(report, indent=2, ensure_ascii=False)
    if target:
        target.write_text(text)
    print(text)


main()
