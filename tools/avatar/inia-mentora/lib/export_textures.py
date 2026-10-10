"""Etapa 07 — cópias das texturas para o GLB (redimensionadas e em WebP).

As fontes (`textures/*.png` e as empacotadas do asset base) NUNCA são alteradas: cada imagem usada
pelos materiais é copiada, reduzida ao teto (atlas pele/rosto ≤ 2048, demais ≤ 1024), gravada em WebP
numa pasta temporária e os nós de material passam a apontar para a cópia só durante a exportação
(o .blend não é salvo). O exportador glTF (modo AUTO) usa os bytes do arquivo WebP como estão
(EXT_texture_webp, suportado pelo GLTFLoader do three.js).

Qualidade: mapas de cor com perda (q 88); normal maps com perda leve (q 90 — sem perda eles sozinhos
passariam de 3 MB); alpha (logo, córnea) e metálico/rugosidade sem perda (serrilha no recorte do
alpha MASK; são pequenos). A cópia é feita numa imagem gerada porque `Image.save` de uma imagem de
arquivo não modificada regrava o formato original.
"""
from __future__ import annotations

from pathlib import Path

import bpy
import numpy as np

import export_web_color as WC
import finalize_contract as C
import finalize_materials as FM


def image_roles() -> dict[str, dict]:
    """Papel de cada imagem: cor (sRGB) ou dado, e se o alpha é usado."""
    roles: dict[str, dict] = {}
    for mat in FM.contract_materials():
        for node in mat.node_tree.nodes:
            if node.type != "TEX_IMAGE" or node.image is None:
                continue
            role = roles.setdefault(node.image.name, {"alpha": False, "data": False, "normal": False})
            role["normal"] |= any(link.to_node.type == "NORMAL_MAP" for link in node.outputs["Color"].links)
            role["alpha"] |= node.outputs["Alpha"].is_linked
            role["data"] |= node.image.colorspace_settings.name != "sRGB"
    return roles


def target_size(name: str, size: tuple[int, int], scale: float) -> tuple[int, int]:
    cap = C.ATLAS_MAX if name in C.ATLAS_IMAGES else C.OTHER_MAX
    cap = max(64, int(cap * scale))
    longest = max(size)
    if longest <= cap:
        return size
    factor = cap / longest
    return max(1, round(size[0] * factor)), max(1, round(size[1] * factor))


def save_webp(source: bpy.types.Image, path: Path, size: tuple[int, int], alpha: bool, quality: int,
              calibration: dict | None = None) -> None:
    """Cópia em imagem gerada (como o próprio exportador faz): `Image.save` de uma imagem de
    arquivo não modificada regrava o formato original, mesmo com `file_format` trocado."""
    width, height = source.size
    pixels = np.empty(width * height * 4, dtype=np.float32)
    source.pixels.foreach_get(pixels)
    if calibration is not None:  # cor base em sRGB: correção para o visualizador web
        rgba = pixels.reshape(-1, 4)
        rgba[:, :3] = WC.transform_srgb(rgba[:, :3], calibration["gL"], calibration["gC"], calibration["dh"])
    tmp = bpy.data.images.new("_export_tmp", width, height, alpha=alpha)
    tmp.colorspace_settings.name = source.colorspace_settings.name
    tmp.pixels.foreach_set(pixels)
    if (width, height) != size:
        tmp.scale(*size)
    tmp.filepath_raw = str(path)
    tmp.file_format = "WEBP"
    tmp.save(quality=quality)
    bpy.data.images.remove(tmp)
    if path.read_bytes()[8:12] != b"WEBP":
        raise RuntimeError(f"cópia não saiu em WebP: {path}")


def prepare(tmp_dir: Path, color_quality: int = 88, normal_quality: int = 90, scale: float = 1.0,
            calibrate: bool = True) -> dict:
    """Cria as cópias WebP e religa os nós de material. Devolve o relatório por imagem."""
    tmp_dir.mkdir(parents=True, exist_ok=True)
    roles = image_roles()
    calibrations = WC.image_calibrations(FM.contract_materials()) if calibrate else {}
    replacements: dict[int, bpy.types.Image] = {}  # ponteiro da imagem fonte → cópia WebP
    report = {}
    for name, role in sorted(roles.items()):
        source = bpy.data.images[name]
        calibration = calibrations.get(source.as_pointer())
        source.name = f"_src_{name}"
        width, height = target_size(name, tuple(source.size), scale)
        lossless = role["alpha"] or (role["data"] and not role["normal"])
        quality = 100 if lossless else (normal_quality if role["normal"] else color_quality)
        stem = Path(name).stem
        path = tmp_dir / f"{stem}.webp"
        save_webp(source, path, (width, height), role["alpha"], quality, calibration)
        exported = bpy.data.images.load(str(path), check_existing=False)
        exported.name = stem
        exported.colorspace_settings.name = source.colorspace_settings.name
        exported.alpha_mode = source.alpha_mode
        replacements[source.as_pointer()] = exported
        report[stem] = {
            "source": f"{name} {source.size[0]}x{source.size[1]}",
            "export": f"{width}x{height} webp {'sem perda' if lossless else f'q{quality}'}"
                      + (" + cor web" if calibration else ""),
            "bytes": path.stat().st_size,
        }
    for mat in FM.contract_materials():
        for node in mat.node_tree.nodes:
            if node.type == "TEX_IMAGE" and node.image and node.image.as_pointer() in replacements:
                node.image = replacements[node.image.as_pointer()]
    return report
