"""Etapa 02 — cinto de couro preto (faixa ~3,8 cm) com fivela retangular de metal escuro (INIA_Belt).

Coordenadas de MUNDO. A faixa contorna a cintura por fora da calça e da barra da polo (o raio de cada
coluna vem do raio externo de calça/polo naquela altura). A fivela fica no centro da frente.
"""
from __future__ import annotations

import math

import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from outfit_polo import TORSO_AXIS_Y
from outfit_polo_front import outer_radius

COLS = 48


def build_belt(bm, uv_layer, trees: list[BVHTree], z0: float, z1: float, thick: float = 0.004, gap: float = 0.0012,
               belt_mat: int = 0) -> dict:
    thetas = [2 * math.pi * k / COLS for k in range(COLS)]  # 0 = frente (−Y)
    radii = []
    for th in thetas:
        best = 0.0
        for z in (z0, (z0 + z1) / 2, z1):
            for t in trees:
                r = outer_radius(t, th, z)
                if r is not None:
                    best = max(best, r)
        radii.append(best + gap)
    for _ in range(2):
        radii = [0.5 * radii[k] + 0.25 * (radii[k - 1] + radii[(k + 1) % COLS]) for k in range(COLS)]
    b = 0.0012
    profile = [(0.0, z0 + b), (thick * 0.75, z0), (thick, z0 + b * 1.5), (thick, z1 - b * 1.5), (thick * 0.75, z1), (0.0, z1 - b)]
    grid = []
    for th, r in zip(thetas, radii):
        d = Vector((math.sin(th), -math.cos(th), 0.0))
        grid.append([bm.verts.new(Vector((0.0, TORSO_AXIS_Y, z)) + d * (r + dr)) for dr, z in profile])
    faces = []
    perim = sum(radii) / COLS * 2 * math.pi
    for k in range(COLS):
        kn = (k + 1) % COLS
        for i in range(len(profile)):
            inx = (i + 1) % len(profile)
            f = bm.faces.new([grid[k][i], grid[kn][i], grid[kn][inx], grid[k][inx]])
            f.material_index = belt_mat
            f.smooth = i in (2, 5)
            u0, u1 = perim * k / COLS / 0.05, perim * (k + 1) / COLS / 0.05
            v0, v1 = i / len(profile), (i + 1) / len(profile)
            for loop, uv in zip(f.loops, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]):
                loop[uv_layer].uv = uv
            f.normal_update()
            c = f.calc_center_median()
            mid_z = (z0 + z1) / 2
            ref = Vector((c.x, c.y - TORSO_AXIS_Y, 0)).normalized() * (1 if i in (1, 2, 3) else -1 if i == 5 else 0)
            if i == 0:
                ref = Vector((0, 0, -1))
            elif i == 4:
                ref = Vector((0, 0, 1))
            if f.normal.dot(ref) < 0:
                f.normal_flip()
            faces.append(f)
    front_r = radii[0] + thick
    return {"faces": faces, "front": Vector((0.0, TORSO_AXIS_Y - front_r, (z0 + z1) / 2)), "tris": len(faces) * 2}


def build_buckle(bm, uv_layer, center: Vector, width: float = 0.058, height: float = 0.047, bar: float = 0.0062,
                 depth: float = 0.0045, mat: int = 0) -> list:
    """Moldura retangular com cantos levemente chanfrados, de frente para −Y (o pino fica escondido)."""
    n = Vector((0, -1, 0))
    right, up = Vector((-1, 0, 0)), Vector((0, 0, 1))  # direita de quem olha de frente = −X do mundo

    def rect(w, h, c):
        """8 pontos em sentido horário (cantos chanfrados de `c`), começando na borda de cima."""
        x, y = w / 2, h / 2
        return [Vector(p) for p in ((x - c, y), (x, y - c), (x, -y + c), (x - c, -y), (-x + c, -y), (-x, -y + c), (-x, y - c), (-x + c, y))]

    outer = rect(width, height, 0.0028)
    inner = rect(width - 2 * bar, height - 2 * bar, 0.0012)
    layers = []
    for z in (0.0, depth):
        layers.append(([bm.verts.new(center + right * p.x + up * p.y + n * z) for p in outer],
                       [bm.verts.new(center + right * p.x + up * p.y + n * z) for p in inner]))
    faces = []

    def add(vs, want):
        f = bm.faces.new(vs)
        f.material_index = mat
        f.smooth = False
        for loop in f.loops:
            loop[uv_layer].uv = (0.5, 0.5)
        f.normal_update()
        if f.normal.dot(want) < 0:
            f.normal_flip()
        faces.append(f)

    (ob_, ib), (of, if_) = layers
    for k in range(8):
        j = (k + 1) % 8
        add([of[k], of[j], if_[j], if_[k]], n)                  # frente
        add([ob_[k], ob_[j], ib[j], ib[k]], -n)                 # trás
        mid_o = (of[k].co + of[j].co) / 2 - center
        add([of[k], of[j], ob_[j], ob_[k]], mid_o - n * mid_o.dot(n))   # lado externo
        mid_i = (if_[k].co + if_[j].co) / 2 - center
        add([if_[k], if_[j], ib[j], ib[k]], -(mid_i - n * mid_i.dot(n)))  # lado interno
    return faces
