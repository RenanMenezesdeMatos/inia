"""Etapa 07 — poda do ruído das normais dos morph targets no GLB exportado.

O exportador glTF só usa accessor esparso para deltas EXATAMENTE nulos. As normais dos blendshapes
saem com milhares de deltas na casa de 1e-7 (ruído de normalização/transformação do próprio
exportador), que dobram o tamanho dos morphs sem mudar nada na tela. Aqui os deltas de normal abaixo
de `tolerance` viram zero (saem do accessor esparso) e o BIN é reempacotado. Posições não são
tocadas (o ruído delas já é zerado na etapa 06). Puro Python/numpy: não depende do Blender.
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np

COMPONENT = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}


def _read(path: Path) -> tuple[dict, bytearray]:
    data = path.read_bytes()
    json_len = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20:20 + json_len])
    bin_start = 20 + json_len
    bin_len = struct.unpack_from("<I", data, bin_start)[0]
    return gltf, bytearray(data[bin_start + 8:bin_start + 8 + bin_len])


def _write(path: Path, gltf: dict, blob: bytes) -> None:
    text = json.dumps(gltf, separators=(",", ":")).encode()
    text += b" " * (-len(text) % 4)
    blob += b"\0" * (-len(blob) % 4)
    total = 12 + 8 + len(text) + 8 + len(blob)
    out = struct.pack("<III", 0x46546C67, 2, total)
    out += struct.pack("<II", len(text), 0x4E4F534A) + text
    out += struct.pack("<II", len(blob), 0x004E4942) + blob
    path.write_bytes(out)


def prune_morph_normals(path: Path, tolerance: float = 5e-4) -> dict:
    gltf, blob = _read(path)
    views = gltf["bufferViews"]
    view_users: dict[int, int] = {}
    for accessor in gltf["accessors"]:
        for ref in [accessor.get("bufferView")] + ([accessor["sparse"]["indices"]["bufferView"],
                                                     accessor["sparse"]["values"]["bufferView"]]
                                                    if "sparse" in accessor else []):
            if ref is not None:
                view_users[ref] = view_users.get(ref, 0) + 1

    def view_bytes(index: int) -> bytes:
        view = views[index]
        start = view.get("byteOffset", 0)
        return bytes(blob[start:start + view["byteLength"]])

    new_views: dict[int, bytes] = {}
    before = after = 0
    targets = {t["NORMAL"] for m in gltf["meshes"] for p in m["primitives"] for t in p.get("targets", []) if "NORMAL" in t}
    for index in sorted(targets):
        accessor = gltf["accessors"][index]
        sparse = accessor.get("sparse")
        if not sparse or "bufferView" in accessor:
            continue
        iv, vv = sparse["indices"]["bufferView"], sparse["values"]["bufferView"]
        if view_users.get(iv) != 1 or view_users.get(vv) != 1 or sparse["indices"].get("byteOffset", 0) or sparse["values"].get("byteOffset", 0):
            continue
        idx_type = COMPONENT[sparse["indices"]["componentType"]]
        indices = np.frombuffer(view_bytes(iv), dtype=idx_type)[:sparse["count"]]
        values = np.frombuffer(view_bytes(vv), dtype=np.float32)[:sparse["count"] * 3].reshape(-1, 3)
        keep = np.abs(values).max(axis=1) >= tolerance
        before += len(indices)
        after += int(keep.sum())
        if keep.all():
            continue
        if not keep.any():
            keep[0] = True  # accessor esparso precisa de ≥ 1 entrada (e um delta nulo é inofensivo)
            values = values.copy()
            values[0] = 0
        sparse["count"] = int(keep.sum())
        new_views[iv] = indices[keep].astype(idx_type).tobytes()
        new_views[vv] = np.ascontiguousarray(values[keep], dtype=np.float32).tobytes()

    packed = bytearray()
    for index, view in enumerate(views):
        chunk = new_views.get(index, view_bytes(index))
        packed += b"\0" * (-len(packed) % 4)
        view["byteOffset"] = len(packed)
        view["byteLength"] = len(chunk)
        packed += chunk
    gltf["buffers"][0]["byteLength"] = len(packed)
    size_before = path.stat().st_size
    _write(path, gltf, bytes(packed))
    return {"normal_entries_before": before, "normal_entries_after": after, "tolerance": tolerance,
            "bytes_before": size_before, "bytes_after": path.stat().st_size}
