"""Camada de cachos do afro (etapa 05): espirais tubulares distribuídas sobre o volume.

Cada cacho é uma mola (hélice) com tubo de 4 lados, raiz levemente enterrada no volume, eixo perto
da normal da superfície com inclinação/torção aleatórias e um pouco de gravidade, ponta fechada em
cone. Tudo em numpy e determinístico pela seed; o resultado vira uma malha comum (sem instâncias,
sem cards com alpha), pronta para o glTF.

Etapas:
1. `sample_roots()`: pontos tipo Poisson sobre a superfície do volume (lançamento de dardos com raio
   variável — mais fino e mais denso na linha do cabelo).
2. `CurlSpec` por raiz (tamanho, voltas, inclinação, cor).
3. `build_curls()`: gera as hélices, testa cada uma contra rosto/pele/ombros (`CurlGuard`) e encolhe
   ou descarta as que invadem; grava cor por vértice (atributo `Col`, exportado como COLOR_0).
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import bpy
import numpy as np


def _srgb_hex_to_linear(hex_color: str) -> np.ndarray:
    value = hex_color.removeprefix("#")
    c = np.array([int(value[i:i + 2], 16) / 255 for i in (0, 2, 4)], dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


# ---------------------------------------------------------------------------
# 1. Raízes
# ---------------------------------------------------------------------------

def mesh_triangles(ob: bpy.types.Object) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(vértices em mundo, triângulos, normais de face em mundo). Supõe malha triangulada."""
    mesh = ob.data
    matrix = np.array(ob.matrix_world)
    co = np.empty(len(mesh.vertices) * 3)
    mesh.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3) @ matrix[:3, :3].T + matrix[:3, 3]
    mesh.calc_loop_triangles()
    tris = np.empty(len(mesh.loop_triangles) * 3, dtype=np.int64)
    mesh.loop_triangles.foreach_get("vertices", tris)
    tris = tris.reshape(-1, 3)
    a, b, c = co[tris[:, 0]], co[tris[:, 1]], co[tris[:, 2]]
    n = np.cross(b - a, c - a)
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    return co, tris, n


def vertex_normals(co: np.ndarray, tris: np.ndarray) -> np.ndarray:
    a, b, c = co[tris[:, 0]], co[tris[:, 1]], co[tris[:, 2]]
    fn = np.cross(b - a, c - a)  # ponderado pela área
    vn = np.zeros_like(co)
    for k in range(3):
        np.add.at(vn, tris[:, k], fn)
    return vn / np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-12)


def sample_roots(co: np.ndarray, tris: np.ndarray, allowed_tri: np.ndarray, radius_fn, target: int,
                 rng: np.random.Generator, candidates_per_root: int = 12) -> tuple[np.ndarray, np.ndarray]:
    """Lançamento de dardos com raio variável. `radius_fn(points, tri_idx) -> raio de exclusão
    relativo` (1 = normal). O raio base é ajustado por bisseção até chegar perto de `target` raízes.
    Devolve (pontos, índice do triângulo)."""
    a, b, c = co[tris[:, 0]], co[tris[:, 1]], co[tris[:, 2]]
    area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1) * allowed_tri
    prob = area / area.sum()
    count = target * candidates_per_root
    tri_idx = rng.choice(len(tris), size=count, p=prob)
    r1 = np.sqrt(rng.random(count))
    r2 = rng.random(count)
    pts = (a[tri_idx] * (1 - r1)[:, None] + b[tri_idx] * (r1 * (1 - r2))[:, None] + c[tri_idx] * (r1 * r2)[:, None])
    rel = radius_fn(pts, tri_idx)
    total_area = area.sum()

    def dart(base: float) -> np.ndarray:
        cell = base * rel.max()
        grid: dict[tuple[int, int, int], list[int]] = {}
        accepted: list[int] = []
        for i in range(count):
            p = pts[i]
            ri = base * rel[i]
            key = tuple((p // cell).astype(int))
            ok = True
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for dz in (-1, 0, 1):
                        for j in grid.get((key[0] + dx, key[1] + dy, key[2] + dz), ()):
                            rj = base * rel[j]
                            if np.sum((pts[j] - p) ** 2) < (0.5 * (ri + rj)) ** 2:
                                ok = False
                                break
                        if not ok:
                            break
                    if not ok:
                        break
                if not ok:
                    break
            if ok:
                accepted.append(i)
                grid.setdefault(key, []).append(i)
        return np.array(accepted, dtype=np.int64)

    lo, hi = 0.2 * math.sqrt(total_area / target), 2.0 * math.sqrt(total_area / target)
    best = dart(math.sqrt(total_area / target))
    for _ in range(9):
        mid = 0.5 * (lo + hi)
        acc = dart(mid)
        if abs(len(acc) - target) < abs(len(best) - target):
            best = acc
        if len(acc) > target:
            lo = mid
        else:
            hi = mid
    return pts[best], tri_idx[best]


# ---------------------------------------------------------------------------
# 2/3. Geometria das molas
# ---------------------------------------------------------------------------

@dataclass
class CurlParams:
    sides: int = 4
    segments_per_turn: int = 5
    helix_radius: float = 0.0065     # m
    tube_radius: float = 0.0024      # m
    pitch: float = 0.0072            # m por volta
    turns: tuple[float, float] = (3.0, 5.2)
    embed: float = 0.004             # quanto a raiz entra no volume
    axis_lift: float = 0.5           # eixo da mola acima da superfície, em raios da hélice
    tilt_deg: tuple[float, float] = (62.0, 86.0)   # 90° = deitado na superfície (de frente vira anel)
    gravity: float = 0.25            # queda da ponta, em fração do comprimento
    scale_jitter: tuple[float, float] = (0.8, 1.2)
    flow_randomness: float = 0.35


def _perp_frame(axis: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    helper = np.where(np.abs(axis[:, 2:3]) < 0.9, np.array([[0.0, 0.0, 1.0]]), np.array([[1.0, 0.0, 0.0]]))
    b1 = np.cross(axis, helper)
    b1 /= np.linalg.norm(b1, axis=1, keepdims=True)
    b2 = np.cross(axis, b1)
    return b1, b2


def draw_curl_randoms(n: int, params: CurlParams, rng: np.random.Generator) -> dict:
    """Sorteia uma única vez tudo o que é aleatório por cacho (a geometria é recalculada sem novo
    sorteio quando um cacho precisa ser encolhido)."""
    rand = rng.normal(size=(n, 3))
    return {
        "turns": rng.uniform(*params.turns, n),
        "rand_dir": rand,
        "tilt": np.radians(rng.uniform(*params.tilt_deg, n)),
        "jitter": rng.uniform(*params.scale_jitter, n),
        "rh": rng.uniform(0.85, 1.15, n),
        "rt": rng.uniform(0.9, 1.1, n),
        "pitch": rng.uniform(0.85, 1.2, n),
        "phase": rng.uniform(0, 2 * math.pi, n),
        "hand": rng.choice([-1.0, 1.0], n),
    }


def curl_centerlines(roots: np.ndarray, normals: np.ndarray, size: np.ndarray, rnd: dict, params: CurlParams,
                     flow: np.ndarray, tilt_scale: np.ndarray | None = None) -> dict:
    """Centro do tubo de cada cacho: array (N, S+1, 3) + raio do tubo por amostra + direção radial.
    `size` = escala por cacho (linha do cabelo < 1). `flow` (N,3) = direção preferida de "caimento"
    (para fora da coroa e para baixo); é projetada no plano tangente e misturada com uma direção
    aleatória (`params.flow_randomness`)."""
    n = len(roots)
    turns = rnd["turns"] * np.sqrt(np.clip(size, 0.3, None))
    seg = np.maximum(np.round(turns * params.segments_per_turn).astype(int), 6)
    s_max = int(seg.max())
    down = np.array([0.0, 0.0, -1.0])
    t_flow = flow - normals * np.sum(flow * normals, axis=1, keepdims=True)
    t_flow_len = np.linalg.norm(t_flow, axis=1, keepdims=True)
    rand = rnd["rand_dir"] - normals * np.sum(rnd["rand_dir"] * normals, axis=1, keepdims=True)
    rand /= np.maximum(np.linalg.norm(rand, axis=1, keepdims=True), 1e-9)
    t_flow = np.where(t_flow_len > 0.1, t_flow / np.maximum(t_flow_len, 1e-9), rand)
    w = params.flow_randomness
    tangent = t_flow * (1 - w) + rand * w
    tangent /= np.maximum(np.linalg.norm(tangent, axis=1, keepdims=True), 1e-9)
    tilt = rnd["tilt"] * (tilt_scale if tilt_scale is not None else 1.0)
    axis = normals * np.cos(tilt)[:, None] + tangent * np.sin(tilt)[:, None]
    axis /= np.linalg.norm(axis, axis=1, keepdims=True)
    b1, b2 = _perp_frame(axis)
    jitter = rnd["jitter"] * size
    rh = params.helix_radius * jitter * rnd["rh"]
    rt = params.tube_radius * np.sqrt(jitter) * rnd["rt"]
    pitch = params.pitch * jitter * rnd["pitch"]
    phase, hand = rnd["phase"], rnd["hand"]
    length = pitch * turns
    k = np.arange(s_max + 1)[None, :]
    t = np.minimum(k / seg[:, None], 1.0)                 # 0..1 ao longo do cacho (repete no fim)
    theta = phase[:, None] + hand[:, None] * 2 * math.pi * turns[:, None] * t
    # raio da hélice abre depois da raiz (os cachos nascem juntos) e afina um pouco na ponta
    rh_t = rh[:, None] * (0.45 + 0.55 * np.clip(t / 0.25, 0, 1)) * (1 - 0.15 * t)
    along = (length[:, None] * t)[..., None] * axis[:, None, :]
    sag = (params.gravity * length[:, None] * t ** 2)[..., None] * down[None, None, :]
    radial = np.cos(theta)[..., None] * b1[:, None, :] + np.sin(theta)[..., None] * b2[:, None, :]
    base = roots + normals * (params.axis_lift * rh - params.embed)[:, None]
    center = base[:, None, :] + along + sag + rh_t[..., None] * radial
    tube = rt[:, None] * (1.0 - 0.45 * t ** 1.5)
    return {"center": center, "tube": tube, "radial": radial, "segments": seg, "t": t, "axis": axis,
            "length": length, "turns": turns}


def tube_mesh(center: np.ndarray, tube: np.ndarray, radial: np.ndarray, seg: np.ndarray, sides: int,
              values: np.ndarray | None = None
              ) -> tuple[np.ndarray, list[np.ndarray], np.ndarray, np.ndarray] | tuple:
    """Varre o perfil (quadrado girado) ao longo do centro. A última amostra vira a ponta do cone.
    Devolve (vértices, faces por cacho, índice do cacho por vértice, t por vértice) e, se `values`
    (N, S+1) for dado, também o valor da amostra de cada vértice (ex.: "lado de fora da volta")."""
    n, s1, _ = center.shape
    tangent = np.gradient(center, axis=1)
    tangent /= np.maximum(np.linalg.norm(tangent, axis=-1, keepdims=True), 1e-12)
    nr = radial - tangent * np.sum(radial * tangent, axis=-1, keepdims=True)
    nr /= np.maximum(np.linalg.norm(nr, axis=-1, keepdims=True), 1e-12)
    bn = np.cross(tangent, nr)
    verts: list[np.ndarray] = []
    faces: list[np.ndarray] = []
    owner: list[np.ndarray] = []
    tvals: list[np.ndarray] = []
    vvals: list[np.ndarray] = []
    offset = 0
    alpha = (np.arange(sides) + 0.5) * 2 * math.pi / sides
    ring_dir_cos, ring_dir_sin = np.cos(alpha), np.sin(alpha)
    for i in range(n):
        s = int(seg[i])
        c = center[i, :s + 1]
        rings = (c[:s, None, :] + tube[i, :s, None, None] * (ring_dir_cos[None, :, None] * nr[i, :s, None, :]
                                                             + ring_dir_sin[None, :, None] * bn[i, :s, None, :]))
        tip = c[s] + tangent[i, s] * tube[i, s] * 0.6
        v = np.concatenate([rings.reshape(-1, 3), tip[None, :]], axis=0)
        f = []
        for r in range(s - 1):
            for q in range(sides):
                a0 = r * sides + q
                a1 = r * sides + (q + 1) % sides
                f.append((a0, a1, a1 + sides, a0 + sides))
        apex = s * sides
        last = (s - 1) * sides
        for q in range(sides):
            f.append((last + q, last + (q + 1) % sides, apex, -1))
        f = np.array(f, dtype=np.int64)
        f[f >= 0] += offset
        faces.append(f)
        verts.append(v)
        owner.append(np.full(len(v), i))
        tv = np.concatenate([np.repeat(np.arange(s) / s, sides), [1.0]])
        tvals.append(tv)
        if values is not None:
            vvals.append(np.concatenate([np.repeat(values[i, :s], sides), [values[i, s]]]))
        offset += len(v)
    out = (np.concatenate(verts), faces, np.concatenate(owner), np.concatenate(tvals))
    if values is not None:
        return out + (np.concatenate(vvals),)
    return out


def surface_visibility(co: np.ndarray, tris: np.ndarray, fn: np.ndarray, occluders, directions: np.ndarray,
                       offset: float = 0.004) -> np.ndarray:
    """Fração (0..1) das direções de câmera de onde cada triângulo é visto (frente para a direção e
    sem nada no caminho). `occluders` = BVHTree em mundo com o próprio volume + cabeça + corpo.
    Serve para gastar o orçamento de cachos onde eles aparecem (superfície externa), não embaixo do
    volume nem encostado no pescoço."""
    from mathutils import Vector
    centroid = co[tris].mean(1)
    vis = np.zeros(len(tris))
    weight = np.zeros(len(tris))
    for d in directions:
        facing = fn @ d
        weight += 1.0
        idx = np.nonzero(facing > 0.05)[0]
        dv = Vector(d)
        for i in idx:
            start = Vector(centroid[i] + fn[i] * offset)
            hit = occluders.ray_cast(start, dv, 2.0)
            if hit[0] is None:
                vis[i] += 1.0
    return vis / np.maximum(weight, 1.0)


def smooth_noise(points: np.ndarray, wavelength: float, seed: int, terms: int = 18) -> np.ndarray:
    """Ruído suave 3D determinístico em [0, 1] (soma de senoides em direções aleatórias, comprimento
    de onda ~`wavelength`). Organiza os cachos em mechas: vizinhos compartilham cor e caimento."""
    rng = np.random.default_rng(seed)
    dirs = rng.normal(size=(terms, 3))
    dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
    k = 2 * math.pi / (wavelength * rng.uniform(0.7, 1.4, terms))
    phase = rng.uniform(0, 2 * math.pi, terms)
    v = np.sin(points @ (dirs * k[:, None]).T + phase).sum(1) / math.sqrt(terms / 2)
    return np.clip(0.5 + 0.5 * v / 1.6, 0.0, 1.0)


# ---------------------------------------------------------------------------
# Cor
# ---------------------------------------------------------------------------

# Albedo calibrado no estúdio de conferência (luz forte): o "iluminado" das referências é ~2,3× mais
# claro em sRGB (mesma razão usada na pele) e o AgX dessatura, então os tons aqui são escuros e saturados.
ROOT_DARK = ("#040100", "#080200")
MID_BROWN = ("#130703", "#1e0c04")
CARAMEL = ("#5c2c10", "#7e421c", "#9c5a2c")


def curl_colors(n: int, highlight: np.ndarray, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Cor linear (N,3) da raiz, do meio e da ponta de cada cacho. `highlight` ∈ [0,1] (região):
    chance/intensidade de caramelo nas pontas."""
    dark_a, dark_b = (_srgb_hex_to_linear(h) for h in ROOT_DARK)
    mid_a, mid_b = (_srgb_hex_to_linear(h) for h in MID_BROWN)
    car = [_srgb_hex_to_linear(h) for h in CARAMEL]
    u = rng.random(n)[:, None]
    root = dark_a + (dark_b - dark_a) * u
    mid = mid_a + (mid_b - mid_a) * rng.random(n)[:, None]
    # caramelo: escolhe entre os três tons (mais do meio), intensidade pela região
    pick = rng.random(n)
    tone = np.where(pick[:, None] < 0.35, car[0] + (car[1] - car[0]) * rng.random(n)[:, None],
                    car[1] + (car[2] - car[1]) * rng.random(n)[:, None] ** 1.5)
    is_light = rng.random(n) < highlight
    amount = np.where(is_light, rng.uniform(0.65, 1.0, n), rng.uniform(0.15, 0.45, n))[:, None]
    tip = mid + (tone - mid) * amount
    return root, mid, tip
