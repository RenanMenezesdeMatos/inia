"""Etapa 04 — gravação determinística de PNG (zlib puro, sem gerenciamento de cor do Blender).

As texturas da pele/olhos são calculadas em numpy já na codificação final (sRGB para cor, linear para
metallic-roughness). Gravar pelo `Image.save()` do Blender funciona, mas depende do espaço de cor da
imagem e grava sempre RGBA; aqui o arquivo é exatamente o array (8 bits por canal), byte a byte
reprodutível entre execuções.

Convenção de entrada: array (H, W, C) float 0..1 com a linha 0 = base da imagem (mesma ordem de
`bpy.types.Image.pixels`); o PNG é gravado de cima para baixo.
"""
from __future__ import annotations

import struct
import zlib
from pathlib import Path

import numpy as np


def _chunk(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)


def write_png(path: str | Path, pixels: np.ndarray, level: int = 9) -> Path:
    array = np.asarray(pixels, dtype=np.float32)
    if array.ndim == 2:
        array = array[..., None]
    height, width, channels = array.shape
    color_type = {1: 0, 3: 2, 4: 6}[channels]
    data = np.clip(np.rint(array * 255.0), 0, 255).astype(np.uint8)[::-1]  # linha 0 do array = base
    raw = np.concatenate([np.zeros((height, 1), dtype=np.uint8), data.reshape(height, width * channels)], axis=1)
    png = b"\x89PNG\r\n\x1a\n"
    png += _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0))
    png += _chunk(b"IDAT", zlib.compress(raw.tobytes(), level))
    png += _chunk(b"IEND", b"")
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)
    return path
