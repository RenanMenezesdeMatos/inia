"""Volume interno do afro (etapa 05): marcos do rosto, campo implícito e malha.

Fluxo:
1. `measure_landmarks()` mede no modelo (pose de repouso) os marcos que ancoram o cabelo: centro dos
   olhos, queixo, ponta do nariz, meia-largura do rosto nas bochechas, crânio, orelhas e a superfície
   da pele da cabeça (BVH, para distância com sinal).
2. `HairShape` converte as tabelas de `hair_refshape` (unidades do rosto) em metros e define o
   campo implícito F (negativo dentro): pilha de superelipses que reproduz as silhuetas de frente e
   perfil → função radial R(direção) em torno de um centro → distância aproximada. Soma-se uma
   "capa" que garante espessura mínima sobre couro cabeludo/orelhas, corta-se tudo à frente da linha
   do cabelo (costeletas/testa), esculpe-se o vinco do topo e afasta-se a base dos ombros.
3. `surface_nets()` extrai a malha (quads) do campo; `build_volume_object()` limpa, suaviza e
   decima para o orçamento de triângulos.
"""
from __future__ import annotations

import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

import hair_refshape as ref
from common import BODY, EYES, HEAD, bone_world_head


# ---------------------------------------------------------------------------
# Marcos
# ---------------------------------------------------------------------------

def _world_coords(ob: bpy.types.Object) -> np.ndarray:
    matrix = np.array(ob.matrix_world)
    co = np.empty(len(ob.data.vertices) * 3, dtype=np.float64)
    ob.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    return co @ matrix[:3, :3].T + matrix[:3, 3]


def _largest_island(ob: bpy.types.Object) -> tuple[np.ndarray, list[list[int]]]:
    """Maior componente conexa (vértices soldados) da malha: a pele da cabeça, sem boca/dentes."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    bm.verts.index_update()
    seen: set[int] = set()
    best: list[int] = []
    for face in bm.faces:
        if face.index in seen:
            continue
        stack, comp = [face], []
        seen.add(face.index)
        while stack:
            current = stack.pop()
            comp.append(current.index)
            for edge in current.edges:
                for other in edge.link_faces:
                    if other.index not in seen:
                        seen.add(other.index)
                        stack.append(other)
        if len(comp) > len(best):
            best = comp
    used = sorted({v.index for i in best for v in bm.faces[i].verts})
    remap = {old: new for new, old in enumerate(used)}
    matrix = np.array(ob.matrix_world)
    co = np.array([bm.verts[i].co[:] for i in used], dtype=np.float64) @ matrix[:3, :3].T + matrix[:3, 3]
    polys = [[remap[v.index] for v in bm.faces[i].verts] for i in best]
    bm.free()
    return co, polys


def measure_landmarks() -> dict:
    head = bpy.data.objects[HEAD]
    eyes = bpy.data.objects[EYES]
    skin, polys = _largest_island(head)
    eye_co = _world_coords(eyes)
    centers = []
    for side in (-1, 1):
        sel = eye_co[eye_co[:, 0] * side > 0]
        if len(sel) == 0:
            raise RuntimeError("olhos: não encontrei os dois globos oculares em INIA_Eyes")
        centers.append((sel.min(0) + sel.max(0)) / 2)
    eye = (centers[0] + centers[1]) / 2
    midline = skin[np.abs(skin[:, 0]) < 0.004]
    if len(midline) < 10:
        raise RuntimeError("pele: linha média da cabeça não encontrada")
    nose_y = float(midline[:, 1].min())
    guess_u = 0.13
    chin_candidates = midline[(midline[:, 1] < eye[1] - 0.1 * guess_u) & (midline[:, 2] < eye[2])]
    chin_z = float(chin_candidates[:, 2].min())
    u = float(eye[2] - chin_z)
    if not 0.05 < u < 0.4:
        raise RuntimeError(f"marcos: distância olhos–queixo implausível ({u:.3f} m)")
    band = skin[(skin[:, 2] > eye[2] + 0.25 * u) & (skin[:, 2] < eye[2] + 0.45 * u)]
    skull_hw = float(np.abs(band[:, 0]).max())
    ears = skin[(np.abs(skin[:, 0]) > skull_hw + 0.003) & (skin[:, 2] < eye[2] + 0.4 * u) & (skin[:, 2] > chin_z)]
    ear_front_y = float(ears[:, 1].min()) if len(ears) else float(eye[1] + 0.5 * u)
    cheek = skin[(skin[:, 2] > eye[2] - 0.3 * u) & (skin[:, 2] < eye[2] - 0.1 * u) & (skin[:, 1] < ear_front_y - 0.005)]
    face_hw = float(np.abs(cheek[:, 0]).max())
    return {
        "eye": eye,
        "eye_z": float(eye[2]),
        "chin_z": chin_z,
        "nose_y": nose_y,
        "U": u,
        "face_hw": face_hw,
        "skull_hw": skull_hw,
        "crown_z": float(skin[:, 2].max()),
        "skull_back_y": float(skin[skin[:, 2] > eye[2], 1].max()),
        "ears": {
            "min": ears.min(0).tolist() if len(ears) else None,
            "max": ears.max(0).tolist() if len(ears) else None,
            "count": int(len(ears)),
        },
        "head_bone": list(bone_world_head("Head")),
        "skin_co": skin,
        "skin_polys": polys,
    }


class HeadDistance:
    """Distância com sinal até a pele da cabeça (positivo fora), pelo vizinho mais próximo + normal."""

    def __init__(self, co: np.ndarray, polys: list[list[int]]):
        self.tree = BVHTree.FromPolygons([Vector(p) for p in co], polys)

    def __call__(self, points: np.ndarray, max_dist: float = 1.0) -> np.ndarray:
        out = np.full(len(points), max_dist, dtype=np.float64)
        find = self.tree.find_nearest
        for i, p in enumerate(points):
            hit = find(Vector(p), max_dist)
            if hit[0] is None:
                continue
            location, normal = hit[0], hit[1]
            d = hit[3]
            delta = Vector(p) - location
            out[i] = d if delta.dot(normal) >= 0 else -d
        return out


class FaceWindow:
    """Janela do rosto: região (vista de frente) onde o cabelo não pode ficar NA FRENTE da pele que
    olha para a frente, abaixo de uma linha do cabelo em arco. Medida nas referências (vista
    frontal, em U acima dos olhos): centro 0,85; x = 0,5F → 0,80; 0,8F → 0,66; 1F → 0,47. Acima do
    arco, quanto mais à frente da testa, mais alto começa o cabelo (inclinação `slope`), para a
    franja nascer da linha do cabelo e subir, em vez de formar uma aba reta sobre a testa."""

    def __init__(self, lm: dict, center_u: float = 0.85, c2: float = 0.14, c4: float = 0.30,
                 slope: float = 0.15, margin: float = 0.01, cell: float = 0.004, facing: float = -0.2,
                 side_scale: float = 1.0, max_depth_u: float = 0.85):
        # profundidade da pele do rosto vista de frente: raio de −Y para +Y por célula (x, z); só conta
        # a pele cuja normal olha para a frente (n_y < facing), não têmporas/orelhas
        tree = BVHTree.FromPolygons([Vector(p) for p in lm["skin_co"]], lm["skin_polys"])
        self.cell = cell
        self.x0 = -0.2
        self.z0 = lm["chin_z"] - 0.12
        nx = int(0.4 / cell)
        nz = int((lm["crown_z"] + 0.05 - self.z0) / cell)
        grid = np.full((nx, nz), np.inf)
        start_y = float(lm["skin_co"][:, 1].min()) - 0.1
        direction = Vector((0.0, 1.0, 0.0))
        max_front_y = lm["nose_y"] + max_depth_u * lm["U"]
        for i in range(nx):
            x = self.x0 + (i + 0.5) * cell
            for k in range(nz):
                hit = tree.ray_cast(Vector((x, start_y, self.z0 + (k + 0.5) * cell)), direction, 1.0)
                if hit[0] is not None:
                    normal = hit[1]
                    if normal.y > 0:          # face "de costas" (enrolamento invertido): usa a normal oposta
                        normal = -normal
                    # só a pele do ROSTO (até ~0,85 U atrás da ponta do nariz): a frente das orelhas
                    # também olha para a frente, mas fica atrás — ali o cabelo tem que passar por cima
                    if normal.y < facing and hit[0].y < max_front_y:
                        grid[i, k] = hit[0].y
        self.depth = grid
        self.eye_z = lm["eye_z"]
        self.u = lm["U"]
        self.face_hw = lm["face_hw"]
        self.center_u, self.c2, self.c4 = center_u, c2, c4
        self.slope = slope
        self.margin = margin
        # a janela nunca passa do contorno do rosto (bochechas): orelhas e têmporas ficam cobertas
        self.side = side_scale * lm["face_hw"]

    def hairline_z(self, x: np.ndarray) -> np.ndarray:
        r = np.abs(x) / self.face_hw
        return self.eye_z + self.u * (self.center_u - self.c2 * r ** 2 - self.c4 * r ** 4)

    def front_depth(self, x: np.ndarray, z: np.ndarray) -> np.ndarray:
        ix = np.clip(((x - self.x0) / self.cell).astype(int), 0, self.depth.shape[0] - 1)
        iz = np.clip(((z - self.z0) / self.cell).astype(int), 0, self.depth.shape[1] - 1)
        return self.depth[ix, iz]

    def cut(self, p: np.ndarray, margin: float | None = None) -> np.ndarray:
        """Positivo onde o cabelo precisa sair (na frente da pele do rosto, abaixo do arco)."""
        x, y, z = p[..., 0], p[..., 1], p[..., 2]
        d = self.front_depth(x, z)
        m = self.margin if margin is None else margin
        valid = np.isfinite(d)
        d = np.where(valid, d, 0.0)
        top = self.hairline_z(x) + self.slope * np.clip(d - y, 0, None)
        return np.where(valid, np.minimum(np.minimum(top - z, (d + m) - y), self.side - np.abs(x)), -1.0)


def body_top_heightfield(cell: float = 0.01) -> tuple[np.ndarray, float, float, float]:
    """Altura máxima da ROUPA (sem pele e sem o cabelo antigo) por célula XY, dilatada 1 célula.
    Usada para manter a base do afro acima de ombros/gola."""
    body = bpy.data.objects[BODY]
    mats = [m.name if m else "" for m in body.data.materials]
    skip = {i for i, name in enumerate(mats) if name.startswith("girl_mat") or name.startswith("hair_mat") or name.startswith("M_Skin")}
    co = _world_coords(body)
    keep = set()
    for poly in body.data.polygons:
        if poly.material_index not in skip:
            keep.update(poly.vertices)
    pts = co[sorted(keep)] if keep else np.zeros((0, 3))
    x0, y0 = -0.45, -0.30
    nx, ny = int(0.9 / cell), int(0.75 / cell)
    grid = np.full((nx, ny), -np.inf)
    if len(pts):
        ix = np.clip(((pts[:, 0] - x0) / cell).astype(int), 0, nx - 1)
        iy = np.clip(((pts[:, 1] - y0) / cell).astype(int), 0, ny - 1)
        np.maximum.at(grid, (ix, iy), pts[:, 2])
    padded = np.pad(grid, 1, constant_values=-np.inf)
    dil = np.max([padded[1 + dx:1 + dx + nx, 1 + dy:1 + dy + ny] for dx in (-1, 0, 1) for dy in (-1, 0, 1)], axis=0)
    return dil, x0, y0, cell


# ---------------------------------------------------------------------------
# Forma
# ---------------------------------------------------------------------------

def _smooth_max(a: np.ndarray, b: np.ndarray, k: float) -> np.ndarray:
    h = np.clip(0.5 - 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h + k * h * (1 - h)


def _smooth_min(a: np.ndarray, b: np.ndarray, k: float) -> np.ndarray:
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h - k * h * (1 - h)


def _smoothstep(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


class HairShape:
    def __init__(self, lm: dict, width_scale: float = 1.0, height_scale: float = 1.0, back_scale: float = 1.0,
                 inset: float = 0.013, exponent: float = 2.4, cover: float = 0.014, clearance: float = 0.012,
                 face_window: "FaceWindow | None" = None, side_front_shift: float = 0.0):
        self.lm = lm
        self.side_front_shift = side_front_shift
        self.face_window = face_window
        self.inset = inset
        self.exponent = exponent
        self.cover = cover
        self.clearance = clearance
        u, eye_z, nose_y, face_hw = lm["U"], lm["eye_z"], lm["nose_y"], lm["face_hw"]

        def z_of(dz: float) -> float:
            # acima dos olhos a altura pode ser escalada (volume do topo); abaixo segue o rosto
            return eye_z + (dz * height_scale if dz > 0 else dz) * u

        front = ref.front_half_width_table()
        self.z_front = np.array([z_of(dz) for dz, _ in front][::-1])
        self.hw_front = np.array([hw * face_hw * width_scale for _, hw in front][::-1])
        pf = ref.profile_front_table()
        self.z_pf = np.array([z_of(dz) for dz, _ in pf][::-1])
        self.y_pf = np.array([nose_y + dy * u for _, dy in pf][::-1])
        pb = ref.profile_back_table()
        pivot = lm["skull_back_y"]
        self.z_pb = np.array([z_of(dz) for dz, _ in pb][::-1])
        self.y_pb = np.array([pivot + (nose_y + dy * u - pivot) * back_scale for _, dy in pb][::-1])
        self.z_top = min(self.z_front.max(), self.z_pf.max(), self.z_pb.max())
        self.z_bottom = max(self.z_front.min(), self.z_pf.min(), self.z_pb.min())
        self.dip_depth = ref.DIP_DEPTH_U * u * height_scale
        self.dip_hw = ref.DIP_HALF_WIDTH_U * u
        zc = 0.5 * (self.z_top + self.z_bottom)
        yc = 0.5 * (np.interp(zc, self.z_pf, self.y_pf) + np.interp(zc, self.z_pb, self.y_pb))
        self.center = np.array([0.0, yc, zc])
        self._radial_table()

    # pilha de superelipses: g < 1 dentro
    def stack_inside(self, p: np.ndarray) -> np.ndarray:
        x, y, z = p[..., 0], p[..., 1], p[..., 2]
        a = np.interp(z, self.z_front, self.hw_front, left=0.0, right=0.0)
        yf = np.interp(z, self.z_pf, self.y_pf)
        yb = np.interp(z, self.z_pb, self.y_pb)
        valid = (z > self.z_bottom) & (z < self.z_top) & (a > 1e-4) & (yb > yf + 1e-4)
        a = np.maximum(a, 1e-4)
        b = np.maximum((yb - yf) / 2, 1e-4)
        yc = (yb + yf) / 2
        n = self.exponent
        g = ((np.abs(x) / a) ** n + (np.abs(y - yc) / b) ** n) ** (1 / n)
        return valid & (g < 1.0)

    def _radial_table(self, n_theta: int = 91, n_phi: int = 180, n_steps: int = 500) -> None:
        theta = np.linspace(0, math.pi, n_theta)
        phi = np.linspace(-math.pi, math.pi, n_phi, endpoint=False)
        tt, pp = np.meshgrid(theta, phi, indexing="ij")
        dirs = np.stack([np.sin(tt) * np.cos(pp), np.sin(tt) * np.sin(pp), np.cos(tt)], axis=-1)
        r_max = 0.6
        rs = np.linspace(0, r_max, n_steps)
        pts = self.center + dirs[..., None, :] * rs[:, None]
        inside = self.stack_inside(pts)
        idx = np.where(inside.any(-1), n_steps - 1 - np.argmax(inside[..., ::-1], axis=-1), 0)
        lo = rs[idx]
        hi = rs[np.minimum(idx + 1, n_steps - 1)]
        for _ in range(18):
            mid = (lo + hi) / 2
            ins = self.stack_inside(self.center + dirs * mid[..., None])
            lo = np.where(ins, mid, lo)
            hi = np.where(ins, hi, mid)
        self.theta, self.phi = theta, phi
        self.radius = (lo + hi) / 2

    def radial(self, p: np.ndarray) -> np.ndarray:
        d = p - self.center
        r = np.linalg.norm(d, axis=-1)
        theta = np.arccos(np.clip(d[..., 2] / np.maximum(r, 1e-9), -1, 1))
        phi = np.arctan2(d[..., 1], d[..., 0])
        ti = theta / math.pi * (len(self.theta) - 1)
        pi = (phi + math.pi) / (2 * math.pi) * len(self.phi)
        t0 = np.clip(np.floor(ti).astype(int), 0, len(self.theta) - 2)
        ft = ti - t0
        p0 = np.floor(pi).astype(int) % len(self.phi)
        p1 = (p0 + 1) % len(self.phi)
        fp = pi - np.floor(pi)
        R = self.radius
        rad = (R[t0, p0] * (1 - ft) * (1 - fp) + R[t0 + 1, p0] * ft * (1 - fp)
               + R[t0, p1] * (1 - ft) * fp + R[t0 + 1, p1] * ft * fp)
        return r - rad

    def hairline_front_y(self, z: np.ndarray) -> np.ndarray:
        """Frente do cabelo na altura z (silhueta acima da testa, costeleta abaixo)."""
        yf = np.interp(z, self.z_pf, self.y_pf)
        if self.side_front_shift:
            # têmporas/costeletas (abaixo do joelho do perfil) um pouco mais à frente: cobre a
            # lateral da testa do modelo, que é mais alta que a da referência
            knee = self.lm["eye_z"] + 0.64 * self.lm["U"]
            w = _smoothstep(knee, knee - 0.1 * self.lm["U"], z)
            yf = yf - self.side_front_shift * w
        return yf

    def field(self, p: np.ndarray, head_sd: np.ndarray | None, body_top=None) -> np.ndarray:
        x, y, z = p[..., 0], p[..., 1], p[..., 2]
        f = self.radial(p) + self.inset
        yf = self.hairline_front_y(z)
        if head_sd is not None:
            # capa mínima sobre couro cabeludo/orelhas, só atrás da linha do cabelo e acima do queixo
            cover = head_sd - self.cover
            cover = _smooth_max(cover, (yf + 0.004) - y, 0.006)
            cover = _smooth_max(cover, (self.lm["chin_z"] + 0.01) - z, 0.006)
            f = _smooth_min(f, cover, 0.012)
        # nada à frente da linha do cabelo (rosto livre)
        f = _smooth_max(f, yf - y, 0.012)
        # rosto livre abaixo da linha do cabelo em arco
        if self.face_window is not None:
            f = _smooth_max(f, self.face_window.cut(p), 0.008)
        # vinco central do topo (formato de coração)
        ramp = _smoothstep(self.z_top - 2.2 * self.dip_depth, self.z_top - 0.9 * self.dip_depth, z)
        f = f + self.dip_depth * np.exp(-(x / self.dip_hw) ** 2) * ramp
        if body_top is not None:
            grid, x0, y0, cell = body_top
            ix = np.clip(((x - x0) / cell).astype(int), 0, grid.shape[0] - 1)
            iy = np.clip(((y - y0) / cell).astype(int), 0, grid.shape[1] - 1)
            top = grid[ix, iy]
            lift = np.where(np.isfinite(top), top + self.clearance - z, -1.0)
            f = _smooth_max(f, lift, 0.01)
        return f


# ---------------------------------------------------------------------------
# Superfície (surface nets)
# ---------------------------------------------------------------------------

def surface_nets(field: np.ndarray, origin: np.ndarray, h: float) -> tuple[np.ndarray, np.ndarray]:
    """Malha de quads da isosuperfície field=0 (negativo dentro). Vértice por célula ativa = média
    dos cruzamentos de aresta; um quad por aresta da grade que cruza a superfície."""
    nx, ny, nz = field.shape
    inside = field < 0
    cell_sum = np.zeros((nx - 1, ny - 1, nz - 1, 3))
    cell_cnt = np.zeros((nx - 1, ny - 1, nz - 1))
    offsets = {0: [(0, 0), (-1, 0), (0, -1), (-1, -1)], 1: [(0, 0), (-1, 0), (0, -1), (-1, -1)], 2: [(0, 0), (-1, 0), (0, -1), (-1, -1)]}
    quads = []
    for axis in range(3):
        a = [slice(None)] * 3
        b = [slice(None)] * 3
        a[axis] = slice(0, -1)
        b[axis] = slice(1, None)
        f0, f1 = field[tuple(a)], field[tuple(b)]
        cross = (f0 < 0) != (f1 < 0)
        idx = np.argwhere(cross)
        if len(idx) == 0:
            continue
        v0 = f0[cross]
        v1 = f1[cross]
        t = v0 / (v0 - v1)
        pos = origin + idx * h
        pos[:, axis] += t * h
        others = [ax for ax in range(3) if ax != axis]
        cell_ids = []
        for d1, d2 in offsets[axis]:
            c = idx.copy()
            c[:, others[0]] += d1
            c[:, others[1]] += d2
            ok = (c[:, 0] >= 0) & (c[:, 1] >= 0) & (c[:, 2] >= 0) & (c[:, 0] < nx - 1) & (c[:, 1] < ny - 1) & (c[:, 2] < nz - 1)
            cc = c[ok]
            np.add.at(cell_sum, (cc[:, 0], cc[:, 1], cc[:, 2]), pos[ok])
            np.add.at(cell_cnt, (cc[:, 0], cc[:, 1], cc[:, 2]), 1)
            cell_ids.append((c, ok))
        valid = cell_ids[0][1] & cell_ids[1][1] & cell_ids[2][1] & cell_ids[3][1]
        flip = inside[tuple(a)][cross]  # dentro na ponta inferior → normal aponta para +axis
        c00, c10, c01, c11 = (cid[0] for cid in cell_ids)
        quad = np.stack([c00, c10, c11, c01], axis=1)[valid]
        f_valid = flip[valid]
        # ordem cíclica depende do eixo (regra da mão direita em (others[0], others[1]))
        quad[f_valid] = quad[f_valid][:, ::-1]
        quads.append(quad)
    active = cell_cnt > 0
    ids = -np.ones(cell_cnt.shape, dtype=np.int64)
    ids[active] = np.arange(active.sum())
    verts = cell_sum[active] / cell_cnt[active][:, None]
    faces = []
    for quad in quads:
        faces.append(ids[quad[..., 0], quad[..., 1], quad[..., 2]])
    faces = np.concatenate(faces, axis=0)
    return verts, faces


def evaluate_grid(shape: HairShape, head_dist: HeadDistance, body_top, voxel: float) -> tuple[np.ndarray, np.ndarray]:
    """Avalia o campo numa grade regular que cobre o cabelo com folga. Devolve (campo, origem)."""
    r = shape.radius
    theta, phi = np.meshgrid(shape.theta, shape.phi, indexing="ij")
    surf = shape.center + np.stack([np.sin(theta) * np.cos(phi), np.sin(theta) * np.sin(phi), np.cos(theta)], -1) * r[..., None]
    lo = surf.reshape(-1, 3).min(0) - 4 * voxel
    hi = surf.reshape(-1, 3).max(0) + 4 * voxel
    head_co = shape.lm["skin_co"]
    lo = np.minimum(lo, head_co.min(0) - 0.03)
    hi = np.maximum(hi, np.array([head_co[:, 0].max(), head_co[:, 1].max(), hi[2]]) + 0.03)
    counts = np.ceil((hi - lo) / voxel).astype(int) + 1
    axes = [lo[i] + np.arange(counts[i]) * voxel for i in range(3)]
    grid = np.stack(np.meshgrid(*axes, indexing="ij"), axis=-1)
    flat = grid.reshape(-1, 3)
    head_sd = np.full(len(flat), 1.0)
    band_lo = head_co.min(0) - (shape.cover + 4 * voxel)
    band_hi = head_co.max(0) + (shape.cover + 4 * voxel)
    near = np.all((flat > band_lo) & (flat < band_hi), axis=1)
    head_sd[near] = head_dist(flat[near], max_dist=0.2)
    field = shape.field(flat, head_sd, body_top).reshape(grid.shape[:3])
    for axis in range(3):
        sl = [slice(None)] * 3
        sl[axis] = 0
        field[tuple(sl)] = np.maximum(field[tuple(sl)], voxel)
        sl[axis] = -1
        field[tuple(sl)] = np.maximum(field[tuple(sl)], voxel)
    return field, lo


def mesh_from_arrays(name: str, verts: np.ndarray, faces: np.ndarray) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], [tuple(int(i) for i in f) for f in faces])
    mesh.validate()
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def build_volume_object(name: str, shape: HairShape, head_dist: HeadDistance, body_top, voxel: float,
                        target_tris: int, interior_depth: float = 0.02) -> tuple[bpy.types.Object, dict]:
    field, origin = evaluate_grid(shape, head_dist, body_top, voxel)
    verts, faces = surface_nets(field, origin, voxel)
    stats = {"grid": list(field.shape), "nets_verts": int(len(verts)), "nets_quads": int(len(faces))}
    bm = bmesh.new()
    bm_verts = [bm.verts.new(v) for v in verts]
    for f in faces:
        try:
            bm.faces.new([bm_verts[i] for i in f])
        except ValueError:
            pass
    bm.verts.ensure_lookup_table()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # remove o que está enterrado fundo dentro da cabeça (invisível)
    co = np.array([v.co[:] for v in bm.verts])
    sd = head_dist(co, max_dist=0.2)
    deep = sd < -interior_depth
    kill = [f for f in bm.faces if all(deep[v.index] for v in f.verts)]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    for _ in range(4):
        bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(ob)
    tris = len(mesh.polygons)
    stats["before_decimate_tris"] = tris
    if tris > target_tris:
        mod = ob.modifiers.new("Decimate", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = target_tris / tris
        mod.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = ob
        with bpy.context.temp_override(object=ob, active_object=ob):
            bpy.ops.object.modifier_apply(modifier=mod.name)
    stats["tris"] = len(ob.data.polygons)
    return ob, stats
