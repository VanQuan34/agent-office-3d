import type { AnimState } from '../sim/types'
import { A_ANGLE, HIP_Y, JOINTS, type Bones } from './rig'

/**
 * Animation thủ tục điều khiển bộ xương. Mỗi trạng thái → một tư thế mục tiêu;
 * tư thế hiện tại nội suy dần về đó (crossfade mượt khi đổi trạng thái).
 * Quy ước góc: chân/tay xoay quanh trục x, âm = đưa ra trước.
 */
export interface Pose {
  hip: number
  back: number
  lean: number
  thighL: number
  thighR: number
  kneeL: number
  kneeR: number
  armL: number
  armR: number
  /** dang tay so với tư thế buông thõng (dương = ra ngoài) */
  spreadL: number
  spreadR: number
  elbowL: number
  elbowR: number
  head: number
  headTurn: number
  /** 1 = giữ A-pose gốc (dùng cho trang xem mẫu) */
  aPose: number
}

export const POSE_KEYS = [
  'hip', 'back', 'lean', 'thighL', 'thighR', 'kneeL', 'kneeR', 'armL', 'armR',
  'spreadL', 'spreadR', 'elbowL', 'elbowR', 'head', 'headTurn', 'aPose',
] as const satisfies readonly (keyof Pose)[]

export type PreviewAnim = AnimState | 'apose'

/** Hạ hông khi ngồi: mặt ghế ~0.51m, khung chậu nhân vật ~0.1m */
const SEATED: Partial<Pose> = { hip: 0.6 - HIP_Y, back: -0.06, thighL: -1.5, thighR: -1.5, kneeL: 1.35, kneeR: 1.35 }

export function targetPose(anim: PreviewAnim, t: number, walkPhase: number): Pose {
  const p: Pose = {
    hip: 0, back: 0, lean: Math.sin(t * 1.6) * 0.015, thighL: 0, thighR: 0, kneeL: 0.03, kneeR: 0.03,
    armL: 0.05, armR: 0.05, spreadL: 0.12, spreadR: 0.12, elbowL: -0.15, elbowR: -0.15,
    head: Math.sin(t * 0.7) * 0.03, headTurn: Math.sin(t * 0.37) * 0.08, aPose: 0,
  }
  const s = Math.sin(walkPhase)
  const c = Math.cos(walkPhase)
  switch (anim) {
    case 'apose':
      Object.assign(p, { aPose: 1, armL: 0, armR: 0, spreadL: 0, spreadR: 0, elbowL: 0, elbowR: 0, kneeL: 0, kneeR: 0, lean: 0, head: 0, headTurn: 0 })
      break
    case 'walk':
    case 'carry':
      p.thighL = -0.5 * s
      p.thighR = 0.5 * s
      p.kneeL = 0.08 + 0.75 * Math.max(0, c)
      p.kneeR = 0.08 + 0.75 * Math.max(0, -c)
      p.hip = -Math.abs(c) * 0.03 + 0.01
      p.lean = 0.06
      p.headTurn = 0
      if (anim === 'walk') {
        p.armL = 0.45 * s
        p.armR = -0.45 * s
        p.elbowL = p.elbowR = -0.35
      } else {
        p.armL = p.armR = -0.95
        p.elbowL = p.elbowR = -0.9
        p.spreadL = p.spreadR = -0.05
      }
      break
    case 'sit':
      Object.assign(p, SEATED)
      p.armL = p.armR = -0.45
      p.elbowL = p.elbowR = -0.9
      p.spreadL = p.spreadR = 0.05
      break
    case 'type':
      Object.assign(p, SEATED)
      p.lean = 0.14
      p.armL = p.armR = -0.85
      p.elbowL = -0.85 + Math.sin(t * 17) * 0.07
      p.elbowR = -0.85 + Math.sin(t * 19 + 1) * 0.07
      p.spreadL = p.spreadR = 0.02
      p.head = 0.12
      p.headTurn = Math.sin(t * 0.5) * 0.05
      break
    case 'talk':
      p.armR = -0.6 + Math.sin(t * 3.5) * 0.3
      p.elbowR = -1.1
      p.spreadR = 0.25
      p.head = Math.sin(t * 2.6) * 0.08
      p.headTurn = Math.sin(t * 1.3) * 0.15
      break
    case 'sitTalk':
      Object.assign(p, SEATED)
      p.armL = -0.45
      p.elbowL = -0.9
      p.armR = -0.85 + Math.sin(t * 3.5) * 0.3
      p.elbowR = -1.2
      p.spreadR = 0.2
      p.head = Math.sin(t * 2.6) * 0.08
      p.headTurn = Math.sin(t * 1.3) * 0.2
      break
    case 'drink': {
      const sip = Math.max(0, Math.sin(t * 0.9)) ** 3
      p.armR = -0.5 - sip * 0.35
      p.elbowR = -1.75 - sip * 0.6
      p.spreadR = 0.1
      p.head = -sip * 0.22
      break
    }
    case 'idle':
      break
  }
  return p
}

export function blendPose(cur: Pose, target: Pose, k: number) {
  for (const key of POSE_KEYS) cur[key] += (target[key] - cur[key]) * k
}

/** Áp tư thế lên xương. Tay ở bind pose đang mở A_ANGLE → bù lại để "buông thõng" khi aPose = 0 */
export function applyPose(b: Bones, p: Pose) {
  const hang = A_ANGLE * (1 - p.aPose)
  b.Hips.position.set(0, JOINTS.Hips.y + p.hip, p.back)
  b.Spine.rotation.x = p.lean * 0.5
  b.Chest.rotation.x = p.lean * 0.5
  b.Neck.rotation.set(p.head * 0.4, p.headTurn * 0.4, 0)
  b.Head.rotation.set(p.head * 0.6, p.headTurn * 0.6, 0)
  b.LeftUpperLeg.rotation.x = p.thighL
  b.RightUpperLeg.rotation.x = p.thighR
  b.LeftLowerLeg.rotation.x = p.kneeL
  b.RightLowerLeg.rotation.x = p.kneeR
  b.LeftFoot.rotation.x = -(p.thighL + p.kneeL) * 0.3
  b.RightFoot.rotation.x = -(p.thighR + p.kneeR) * 0.3
  b.LeftUpperArm.rotation.set(p.armL, 0, -hang + p.spreadL)
  b.RightUpperArm.rotation.set(p.armR, 0, hang - p.spreadR)
  b.LeftLowerArm.rotation.set(p.elbowL, 0, 0)
  b.RightLowerArm.rotation.set(p.elbowR, 0, 0)
}
