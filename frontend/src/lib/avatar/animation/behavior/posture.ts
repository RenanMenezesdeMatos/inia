import { randRange } from "../random"
import { DEG, damp } from "../tuning"
import type { BehaviorContext, BoneOffsets, StateWeights } from "./context"
import { addBoneOffset, blendByState } from "./context"

/**
 * Postura: a cada 10–20 s o peso do corpo passa para outro lado (quadril gira/inclina um pouco,
 * a coluna compensa ao contrário para a cabeça não sair do lugar). É o que tira o "manequim" de
 * quem está parado — mas lento e raro: nada de balanço contínuo.
 * Por estado: ouvindo, inclina levemente para a frente (engajada); pensando, recua um pouco.
 */

const LEAN_BY_STATE: Readonly<StateWeights> = { idle: 0, listening: 1.3, thinking: -0.5, speaking: 0.5 }
const SHIFT_TAU = 1.1
const LEAN_TAU = 0.8

export class PostureLayer {
  private nextShiftAt = 6
  private targetRoll = 0
  private targetYaw = 0
  private targetPitch = 0
  private roll = 0
  private yaw = 0
  private pitch = 0
  private lean = 0

  reset(): void {
    this.nextShiftAt = 6
    this.targetRoll = 0
    this.targetYaw = 0
    this.targetPitch = 0
    this.roll = 0
    this.yaw = 0
    this.pitch = 0
    this.lean = 0
  }

  update(ctx: BehaviorContext, bones: BoneOffsets): void {
    const { rng, time, dt, weights, tuning } = ctx
    if (time >= this.nextShiftAt) {
      this.targetRoll = randRange(rng, -0.9, 0.9)
      this.targetYaw = randRange(rng, -1.2, 1.2)
      this.targetPitch = randRange(rng, -0.4, 0.5)
      this.nextShiftAt = time + randRange(rng, 10, 20)
    }
    this.roll = damp(this.roll, this.targetRoll, SHIFT_TAU, dt)
    this.yaw = damp(this.yaw, this.targetYaw, SHIFT_TAU, dt)
    this.pitch = damp(this.pitch, this.targetPitch, SHIFT_TAU, dt)
    this.lean = damp(this.lean, blendByState(weights, LEAN_BY_STATE), LEAN_TAU, dt)

    const motion = tuning.headMotion
    addBoneOffset(bones, "Hips", 0, this.yaw * motion * DEG, this.roll * motion * DEG)
    // A coluna devolve ~70% da inclinação e ~50% do giro: o tronco fica quase no lugar.
    addBoneOffset(bones, "Spine", this.pitch * motion * DEG, -this.yaw * 0.5 * motion * DEG, -this.roll * 0.7 * motion * DEG)
    addBoneOffset(bones, "Spine2", this.lean * motion * DEG, 0, 0)
  }
}
