"""Texturas do volume interno do afro (etapa 05): tapete tileável de cachinhos, gerado em numpy.

O volume `INIA_Hair` fica por baixo da camada de cachos 3D; onde os cachos 3D deixam frestas, ele
precisa ler como "massa de cachinhos definidos", nunca como uma casca lisa. Estas funções desenham
(de forma determinística, pela seed) dezenas de molas vistas de lado — a mesma linguagem dos cachos
3D — num z-buffer periódico e derivam dele:

- `hair_volume_basecolor.png` (sRGB): molas marrom-escuras e caramelo sobre um fundo quase preto,
  com oclusão nas frestas (albedo; nenhuma luz direcional assada).
- `hair_volume_normal.png` (tangente, convenção OpenGL/glTF): relevo das molas.

O padrão é periódico nas duas direções: o 05_hair repete a textura com UV em metros (projeção por
caixa, V = altura) e as molas "penduram" para baixo nas laterais e nas costas.
"""
from __future__ import annotations

import math
from pathlib import Path

import bpy
import numpy as np


def _hex(h: str) -> np.ndarray:
    v = h.removeprefix("#")
    return np.array([int(v[i:i + 2], 16) / 255 for i in (0, 2, 4)], dtype=np.float32)


DARK_TONES = ("#050201", "#0b0401")
LIGHT_TONES = ("#44210c", "#632f12", "#80421c")
BACKGROUND = "#010000"


def _ringlet_buffers(size: int, count: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
    """Cachinhos (molas finas) vistos com o eixo inclinado em direção à câmera: cada volta vira um
    laço (ℓℓℓ), como os cachos das referências — não barras empilhadas."""
    rng = np.random.default_rng(seed)
    zbuf = np.zeros((size, size), dtype=np.float32)
    color = np.tile(_hex(BACKGROUND), (size, size, 1))
    dark = [_hex(h) for h in DARK_TONES]
    light = [_hex(h) for h in LIGHT_TONES]
    for _ in range(count):
        cx, cy = rng.uniform(0, size, 2)
        radius = rng.uniform(0.034, 0.046) * size
        pitch = radius * rng.uniform(0.8, 1.05)
        turns = rng.uniform(3.0, 5.0)
        tube = radius * rng.uniform(0.2, 0.26)
        phi = math.radians(rng.uniform(32.0, 60.0))        # inclinação do eixo em direção à câmera
        ang = math.pi / 2 + rng.normal(0.0, 0.4)          # em média pendurada (ponta para V menor)
        d = np.array([math.cos(ang), math.sin(ang)])
        perp = np.array([-d[1], d[0]])
        phase = rng.uniform(0, 2 * math.pi)
        hand = rng.choice([-1.0, 1.0])
        layer = rng.uniform(0.0, 1.4) * radius
        # todo cachinho tem a frente da volta clara e o fundo escuro; a variação grande de cor
        # (caramelo por fora, escuro na risca/rosto) vem da cor por vértice do volume
        a, b = light[0], light[2]
        tone = (a + (b - a) * rng.random() ** 1.2) * rng.uniform(0.75, 1.1)
        npts = max(int(turns * 44), 24)
        t = np.linspace(0.0, 1.0, npts)
        theta = phase + hand * 2 * math.pi * turns * t
        taper = 1.0 - 0.25 * t
        length = pitch * turns
        along = math.cos(phi) * length * (t - 0.5) + math.sin(phi) * radius * taper * np.cos(theta)
        side = radius * taper * np.sin(theta)
        px = cx + d[0] * along + perp[0] * side
        py = cy + d[1] * along + perp[1] * side
        depth = layer + radius * taper * np.cos(theta) * math.cos(phi)
        w_t = tube * (1.0 - 0.3 * t)
        front = 0.5 + 0.5 * np.cos(theta)
        for x0, y0, z0, w, fr, tpos in zip(px, py, depth, w_t, front, t):
            r = int(math.ceil(w)) + 1
            xs = np.arange(int(x0) - r, int(x0) + r + 1)
            ys = np.arange(int(y0) - r, int(y0) + r + 1)
            dx = (xs - x0)[None, :]
            dy = (ys - y0)[:, None]
            r2 = dx * dx + dy * dy
            inside = r2 < w * w
            height = z0 + np.sqrt(np.clip(w * w - r2, 0, None))
            iy, ix = np.ix_(ys % size, xs % size)
            current = zbuf[iy, ix]
            upd = inside & (height > current)
            if not upd.any():
                continue
            # frente de cada laço mais clara que o de trás (volume, sem luz direcional)
            shade = (0.22 + 0.78 * fr ** 1.5) * (0.6 + 0.4 * min(1.0, tpos / 0.35))
            zb = current.copy()
            zb[upd] = height[upd]
            zbuf[iy, ix] = zb
            col = color[iy, ix]
            col[upd] = tone * shade
            color[iy, ix] = col
    return zbuf, color


def _blur_wrap(a: np.ndarray, passes: int = 1) -> np.ndarray:
    for _ in range(passes):
        a = (a * 4 + np.roll(a, 1, 0) + np.roll(a, -1, 0) + np.roll(a, 1, 1) + np.roll(a, -1, 1)) / 8
    return a


def _save_png(path: Path, rgb: np.ndarray, colorspace: str) -> None:
    h, w = rgb.shape[:2]
    name = path.stem
    old = bpy.data.images.get(name)
    if old is not None:
        bpy.data.images.remove(old)
    image = bpy.data.images.new(name, w, h, alpha=False)
    image.colorspace_settings.name = colorspace
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(rgb, 0, 1)
    image.pixels.foreach_set(rgba[::-1].ravel())
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)


def build_volume_textures(tex_dir: Path, size: int = 1024, density: float = 1.0, seed: int = 20260924) -> dict[str, Path]:
    """Gera (ou regera, igual pela seed) as duas texturas do volume. Devolve os caminhos."""
    count = int(380 * density)
    zbuf, color = _ringlet_buffers(size, count, seed)
    height = _blur_wrap(zbuf, 1)
    zmax = float(np.percentile(height, 99.5)) or 1.0
    # oclusão nas frestas: quanto mais fundo, mais escuro
    occlusion = np.clip(0.35 + 0.65 * (height / zmax), 0.0, 1.0) ** 0.8
    albedo = color * occlusion[..., None]
    strength = 0.45
    gx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 0.5 * strength
    gy = (np.roll(height, 1, 0) - np.roll(height, -1, 0)) * 0.5 * strength  # linha 0 = topo da imagem
    n = np.stack([-gx, -gy, np.ones_like(gx)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    normal = n * 0.5 + 0.5
    paths = {"basecolor": tex_dir / "hair_volume_basecolor.png", "normal": tex_dir / "hair_volume_normal.png"}
    _save_png(paths["basecolor"], albedo.astype(np.float32), "sRGB")
    _save_png(paths["normal"], normal.astype(np.float32), "Non-Color")
    return paths
