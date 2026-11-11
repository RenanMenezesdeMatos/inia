"""Ajustes da forma do afro ao crânio do modelo (etapa 05, refinamento).

`FittedHairShape` estende `hair_volume.HairShape` com três correções que dependem do modelo, não
das referências:

1. Franja rente à testa: o crânio do modelo recua mais cedo que o da referência, então a frente do
   cabelo medida no perfil fica 3–5 cm à frente da testa na altura da linha do cabelo. Antes, o
   corte do rosto usava a pele LOCAL (que recua) e o "push" jogava a face de baixo da franja para
   trás da pele: sobrava uma faixa de couro cabeludo e uma aba de cogumelo. Agora (a) a capa sobre
   o couro não é limitada pela frente medida na região do rosto, só pela janela; (b) a janela
   (`FittedFaceWindow`) sobe em PLANO a partir da pele no arco (`slope`), como a franja das
   referências (~45°); (c) `push_out_of_face` corrige logo acima do arco subindo em z, não
   recuando para trás da pele. O arco do volume desce `window_drop_u` para compensar a suavização.
2. Topo em dois lóbulos: vinco central mais fundo e largo, que desce por toda a extensão frente →
   costas (risca), e um arredondamento dos "ombros" do topo — silhueta de coração na frente e nas
   costas, largura máxima nas têmporas.
3. Tudo em metros derivados dos marcos do rosto (U, F), como o restante da etapa.
"""
from __future__ import annotations

import numpy as np

import hair_volume as hv


class FittedHairShape(hv.HairShape):
    def __init__(self, lm: dict, *, fringe_side_u: float = 0.12,
                 dip_depth_u: float = 0.30, dip_hw_u: float = 0.24, dip_reach_u: float = 0.55,
                 shoulder_round_u: float = 0.0, **kwargs):
        super().__init__(lm, **kwargs)
        u = lm["U"]
        self.fringe_side = fringe_side_u * u
        self.dip_depth = dip_depth_u * u
        self.dip_hw = dip_hw_u * u
        self.dip_reach = dip_reach_u * u
        self.shoulder_round = shoulder_round_u * u

    # --- topo ----------------------------------------------------------------------------------
    def dip(self, p: np.ndarray) -> np.ndarray:
        """Quanto o vinco central remove (≥ 0): máximo no topo, some ~`dip_reach` abaixo dele."""
        x, z = p[..., 0], p[..., 2]
        ramp = hv._smoothstep(self.z_top - self.dip_reach, self.z_top - 0.25 * self.dip_depth, z)
        return self.dip_depth * np.exp(-(x / self.dip_hw) ** 2) * ramp

    def field(self, p: np.ndarray, head_sd: np.ndarray | None, body_top=None) -> np.ndarray:
        x, y, z = p[..., 0], p[..., 1], p[..., 2]
        f = self.radial(p) + self.inset
        if self.shoulder_round > 0:
            # arredonda os "ombros" do topo (acima das têmporas, longe do centro)
            zs = hv._smoothstep(self.z_top - 0.9 * self.dip_reach - 2 * self.shoulder_round, self.z_top, z)
            f = f + self.shoulder_round * zs * np.clip(np.abs(x) / (2.2 * self.dip_hw) - 0.6, 0, 1)
        yf = self.hairline_front_y(z)
        if head_sd is not None:
            cover = head_sd - self.cover
            cover = hv._smooth_max(cover, (self.lm["chin_z"] + 0.01) - z, 0.006)
            # na frente, a capa só é limitada pela janela do rosto (abaixo); nas laterais, pela
            # frente medida (costeleta)
            lateral = hv._smoothstep(self.face_window.side, self.face_window.side + self.fringe_side, np.abs(x))
            cover = hv._smooth_max(cover, ((yf + 0.004) - y) * lateral - (1 - lateral) * 0.05, 0.006)
            f = hv._smooth_min(f, cover, 0.012)
        f = hv._smooth_max(f, yf - y, 0.012)
        if self.face_window is not None:
            f = hv._smooth_max(f, self.face_window.cut(p), 0.008)
        f = f + self.dip(p)
        if body_top is not None:
            grid, x0, y0, cell = body_top
            ix = np.clip(((x - x0) / cell).astype(int), 0, grid.shape[0] - 1)
            iy = np.clip(((y - y0) / cell).astype(int), 0, grid.shape[1] - 1)
            top = grid[ix, iy]
            lift = np.where(np.isfinite(top), top + self.clearance - z, -1.0)
            f = hv._smooth_max(f, lift, 0.01)
        return f


class FittedFaceWindow(hv.FaceWindow):
    """Janela do rosto cuja rampa acima do arco é um plano que sobe a partir da pele NA linha do
    cabelo (profundidade da testa medida no arco), e não da pele local: a testa do modelo recua
    rápido, e a rampa pela pele local colava o cabelo no crânio (franja rala, couro aparecendo)."""

    def cut(self, p: np.ndarray, margin: float | None = None) -> np.ndarray:
        x, y, z = p[..., 0], p[..., 1], p[..., 2]
        arc = self.hairline_z(x)
        d_local = self.front_depth(x, z)
        valid = np.isfinite(d_local)
        d_arc = self.front_depth(x, np.minimum(z, arc))
        d_arc = np.where(np.isfinite(d_arc), d_arc, np.where(valid, d_local, y))
        m = self.margin if margin is None else margin
        d_local = np.where(valid, d_local, 0.0)
        top = arc + self.slope * np.clip(d_arc - y, 0, None)
        return np.where(valid, np.minimum(np.minimum(top - z, (d_local + m) - y), self.side - np.abs(x)), -1.0)


def push_out_of_face(ob, window: FittedFaceWindow, iterations: int = 3) -> int:
    """Vértices do volume que a suavização/decimação deixou na frente do rosto voltam ao limite
    pelo caminho mais curto: logo acima do arco sobem até o plano da franja (a face de baixo da
    franja continua rente à pele); mais abaixo (na frente do rosto) recuam para trás da pele."""
    co = hv._world_coords(ob)
    moved = 0
    for _ in range(iterations):
        cut = window.cut(co, margin=0.004)
        bad = cut > -0.001
        if not bad.any():
            break
        moved += int(bad.sum())
        x, y, z = co[bad, 0], co[bad, 1], co[bad, 2]
        arc = window.hairline_z(x)
        d_arc = window.front_depth(x, np.minimum(z, arc))
        d_arc = np.where(np.isfinite(d_arc), d_arc, y)
        top = arc + window.slope * np.clip(d_arc - y, 0, None)
        raise_z = top - z + 0.002
        near_arc = raise_z < 0.02
        co[np.nonzero(bad)[0][near_arc], 2] += raise_z[near_arc]
        idx = np.nonzero(bad)[0][~near_arc]
        d = window.front_depth(co[idx, 0], co[idx, 2])
        target = np.where(np.isfinite(d), d + window.margin + 0.004, co[idx, 1] + cut[bad][~near_arc] + 0.002)
        co[idx, 1] = np.maximum(co[idx, 1] + cut[bad][~near_arc] + 0.002, target)
    inv = np.array(ob.matrix_world.inverted())
    local = co @ inv[:3, :3].T + inv[:3, 3]
    ob.data.vertices.foreach_set("co", local.astype(np.float32).ravel())
    ob.data.update()
    return moved


def outfit_top_heightfield(cell: float = 0.01, exclude: tuple[str, ...] = ()) -> tuple[np.ndarray, float, float, float]:
    """Como `hair_volume.body_top_heightfield`, mas com TODAS as malhas da roupa (corpo, polo, gola,
    crachá, logos…), não só o INIA_Body: a gola da polo é um objeto próprio desde a etapa 02. Pele
    (girl_mat/M_Skin) fica de fora — o cabelo cobre a nuca."""
    import bpy
    x0, y0 = -0.45, -0.30
    nx, ny = int(0.9 / cell), int(0.75 / cell)
    grid = np.full((nx, ny), -np.inf)
    for ob in bpy.data.objects:
        if ob.type != "MESH" or ob.name in exclude:
            continue
        mats = [m.name if m else "" for m in ob.data.materials]
        skip = {i for i, n in enumerate(mats) if n.startswith(("girl_mat", "hair_mat", "M_Skin", "M_Hair", "glass_eye"))}
        keep = sorted({v for p in ob.data.polygons if p.material_index not in skip for v in p.vertices})
        if not keep:
            continue
        pts = hv._world_coords(ob)[keep]
        ix = np.clip(((pts[:, 0] - x0) / cell).astype(int), 0, nx - 1)
        iy = np.clip(((pts[:, 1] - y0) / cell).astype(int), 0, ny - 1)
        np.maximum.at(grid, (ix, iy), pts[:, 2])
    padded = np.pad(grid, 1, constant_values=-np.inf)
    dil = np.max([padded[1 + dx:1 + dx + nx, 1 + dy:1 + dy + ny] for dx in (-1, 0, 1) for dy in (-1, 0, 1)], axis=0)
    return dil, x0, y0, cell
