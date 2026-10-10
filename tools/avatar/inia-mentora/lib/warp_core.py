"""Núcleo da deformação espacial suave da etapa 03 (proporções).

Ideia: uma função f(p) = p + Σ dᵢ(p), definida em coordenadas de MUNDO (Z para cima, personagem
olhando para −Y), é aplicada à Basis e às posições ABSOLUTAS de todas as shape keys de todas as malhas
filhas do INIA_Rig (novo_k = f(k)). Assim cada expressão continua funcionando: o delta de cada key é
levado pela jacobiana local de f (mandíbula mais larga → jawOpen mais largo). Como a mesma f vale para
todas as malhas, o que estava soldado/encostado continua soldado/encostado (anel pescoço-corpo,
camadas de roupa sobre a pele, logos sobre a polo).

Os campos dᵢ são suaves e localizados (núcleos compactos C², rampas smoothstep) e definidos a partir de
marcos medidos no modelo em tempo de execução (ossos + malha) — nunca por índice de vértice.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Iterable

import numpy as np

Array = np.ndarray


# ---------------------------------------------------------------------------
# Funções escalares suaves
# ---------------------------------------------------------------------------

def smoothstep(e0: float, e1: float, x: Array) -> Array:
    """0 em x<=e0, 1 em x>=e1, C¹ entre (aceita e0>e1 para rampa descendente)."""
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def smootherstep(e0: float, e1: float, x: Array) -> Array:
    """Versão C² (derivadas 1ª e 2ª nulas nas pontas)."""
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * t * (t * (6.0 * t - 15.0) + 10.0)


def wendland(t: Array) -> Array:
    """Núcleo compacto C² de Wendland: 1 em t=0, 0 em t>=1, sem ondulação."""
    t = np.clip(t, 0.0, 1.0)
    return (1.0 - t) ** 4 * (4.0 * t + 1.0)


def bump(x: Array, a: float, b: float, c: float, d: float) -> Array:
    """Platô suave: 0 fora de [a,d], sobe em [a,b], 1 em [b,c], desce em [c,d]."""
    return smootherstep(a, b, x) * (1.0 - smootherstep(c, d, x))


def kernel(t: Array, plateau: float = 0.0) -> Array:
    """Peso radial: Wendland (plateau=0) ou platô 1 até t=plateau com descida smootherstep até t=1."""
    if plateau <= 0.0:
        return wendland(t)
    return 1.0 - smootherstep(plateau, 1.0, t)


def ellipsoid_t(P: Array, center: Iterable[float], radii: Iterable[float]) -> Array:
    """Distância normalizada ao centro de um elipsoide alinhado aos eixos (1 = superfície)."""
    q = (P - np.asarray(center, float)) / np.asarray(radii, float)
    return np.sqrt(np.einsum("ij,ij->i", q, q))


def piecewise_profile(x: Array, knots: list[tuple[float, float]]) -> Array:
    """Interpolação suave (smootherstep por trecho) de uma tabela (x, valor) ordenada por x."""
    xs = np.array([k[0] for k in knots], float)
    vs = np.array([k[1] for k in knots], float)
    out = np.full(x.shape, vs[0], float)
    for i in range(len(xs) - 1):
        s = smootherstep(xs[i], xs[i + 1], x)
        out = np.where(x >= xs[i], vs[i] + (vs[i + 1] - vs[i]) * s, out)
    return np.where(x >= xs[-1], vs[-1], out)


# ---------------------------------------------------------------------------
# Campos de deslocamento
# ---------------------------------------------------------------------------

class Field:
    """Um campo de deslocamento d(P) -> (N,3). Subclasses (dataclasses) têm `name` e implementam
    `displacement`."""

    def displacement(self, P: Array) -> Array:  # pragma: no cover - interface
        raise NotImplementedError

    def __call__(self, P: Array) -> Array:
        return self.displacement(P)


@dataclass
class RadialOffset(Field):
    """Empurra uma região elipsoidal por um vetor constante, com peso Wendland (C²)."""

    name: str
    center: tuple
    radii: tuple
    offset: tuple
    plateau: float = 0.0

    def displacement(self, P: Array) -> Array:
        w = kernel(ellipsoid_t(P, self.center, self.radii), self.plateau)
        return w[:, None] * np.asarray(self.offset, float)[None, :]


@dataclass
class LocalScale(Field):
    """Escala anisotrópica em torno de um pivô, ponderada por um elipsoide (Wendland):
    d = w(p)·(S − I)(p − pivô). Com S = diag(sx, sy, sz)."""

    name: str
    center: tuple
    radii: tuple
    scale: tuple
    pivot: tuple | None = None
    plateau: float = 0.0

    def displacement(self, P: Array) -> Array:
        w = kernel(ellipsoid_t(P, self.center, self.radii), self.plateau)
        pivot = np.asarray(self.pivot if self.pivot is not None else self.center, float)
        s = np.asarray(self.scale, float) - 1.0
        return w[:, None] * (P - pivot[None, :]) * s[None, :]


@dataclass
class SaturatingScale(Field):
    """Alargamento ao longo de um eixo que SATURA: d = w(p)·s·a·tanh(u/a)·eixo, u = (p − pivô)·eixo.
    Perto do plano do pivô é uma escala (fator 1+s); a partir de |u| ≈ a vira um deslocamento
    constante s·a — o tecido vizinho é empurrado junto em vez de esticado (sem dobra na borda)."""

    name: str
    center: tuple
    radii: tuple
    axis: tuple
    amount: float
    half_width: float
    pivot: tuple = (0.0, 0.0, 0.0)
    plateau: float = 0.0

    def displacement(self, P: Array) -> Array:
        w = kernel(ellipsoid_t(P, self.center, self.radii), self.plateau)
        axis = np.asarray(self.axis, float)
        u = (P - np.asarray(self.pivot, float)[None, :]) @ axis
        a = self.half_width
        return (w * self.amount * a * np.tanh(u / a))[:, None] * axis[None, :]


@dataclass
class Masked(Field):
    """Multiplica o deslocamento de outro campo por uma máscara escalar m(P) ∈ [0,1]."""

    name: str
    inner: Field
    mask: Callable[[Array], Array]

    def displacement(self, P: Array) -> Array:
        return self.inner(P) * self.mask(P)[:, None]


@dataclass
class FunctionField(Field):
    """Campo arbitrário dado por uma função numpy (usado pelos campos compostos do corpo/pescoço)."""

    name: str
    fn: Callable[[Array], Array]

    def displacement(self, P: Array) -> Array:
        return self.fn(P)


@dataclass
class Warp:
    """f(p) = p + Σ campos(p) (soma: ordem irrelevante, suave se cada campo for suave)."""

    fields: list = field(default_factory=list)

    def add(self, f: Field) -> Field:
        self.fields.append(f)
        return f

    def displacement(self, P: Array) -> Array:
        P = np.asarray(P, float)
        out = np.zeros_like(P)
        for f in self.fields:
            out += f(P)
        return out

    def __call__(self, P: Array) -> Array:
        P = np.asarray(P, float)
        return P + self.displacement(P)

    def jacobian(self, P: Array, h: float = 5e-4) -> Array:
        """Jacobiana por diferenças centrais: (N,3,3), J[:, i, j] = ∂fᵢ/∂xⱼ."""
        P = np.asarray(P, float)
        J = np.empty((len(P), 3, 3))
        for j in range(3):
            e = np.zeros(3)
            e[j] = h
            J[:, :, j] = (self(P + e) - self(P - e)) / (2 * h)
        return J

    def per_field_max(self, P: Array) -> dict[str, float]:
        """Maior deslocamento (mm) de cada campo sobre os pontos dados (relatório)."""
        return {f.name: round(float(np.linalg.norm(f(P), axis=1).max()) * 1000, 2) for f in self.fields}


def jacobian_report(warp: Warp, P: Array, chunk: int = 20000) -> dict:
    """det(J) mínimo (dobra/inversão se <= 0) e deformação máxima ‖J − I‖ nos pontos dados."""
    dets, strains = [], []
    for i in range(0, len(P), chunk):
        J = warp.jacobian(P[i:i + chunk])
        dets.append(np.linalg.det(J))
        strains.append(np.linalg.norm(J - np.eye(3)[None], axis=(1, 2)))
    det = np.concatenate(dets)
    strain = np.concatenate(strains)
    return {"det_min": round(float(det.min()), 4), "det_max": round(float(det.max()), 4),
            "strain_max": round(float(strain.max()), 4), "n_points": int(len(P))}
