import * as THREE from 'three'

/**
 * Bộ xương chuẩn (bind pose = A-pose, nhân vật nhìn +z, đơn vị mét).
 * Tên xương theo quy ước humanoid phổ biến để sau này dễ map sang Mixamo/VRM.
 */
export const BONE_NAMES = [
  'Root',
  'Hips',
  'Spine',
  'Chest',
  'Neck',
  'Head',
  'LeftUpperArm',
  'LeftLowerArm',
  'LeftHand',
  'RightUpperArm',
  'RightLowerArm',
  'RightHand',
  'LeftUpperLeg',
  'LeftLowerLeg',
  'LeftFoot',
  'RightUpperLeg',
  'RightLowerLeg',
  'RightFoot',
] as const

export type BoneName = (typeof BONE_NAMES)[number]
export const BI = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i])) as Record<BoneName, number>

/** Góc A-pose: tay mở ra khỏi thân ~43° */
export const A_ANGLE = 0.75
const SA = Math.sin(A_ANGLE)
const CA = Math.cos(A_ANGLE)

export const UPPER_ARM = 0.21
export const LOWER_ARM = 0.19
export const HIP_Y = 0.7

/** Vị trí khớp trong không gian model ở bind pose */
export const JOINTS: Record<BoneName, THREE.Vector3> = (() => {
  const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z)
  const shoulder = (s: number) => v(s * 0.165, 1.075)
  const elbow = (s: number) => shoulder(s).add(v(s * SA * UPPER_ARM, -CA * UPPER_ARM))
  const wrist = (s: number) => elbow(s).add(v(s * SA * LOWER_ARM, -CA * LOWER_ARM))
  return {
    Root: v(0, 0),
    Hips: v(0, HIP_Y),
    Spine: v(0, 0.8),
    Chest: v(0, 0.94),
    Neck: v(0, 1.11),
    Head: v(0, 1.17),
    LeftUpperArm: shoulder(1),
    LeftLowerArm: elbow(1),
    LeftHand: wrist(1),
    RightUpperArm: shoulder(-1),
    RightLowerArm: elbow(-1),
    RightHand: wrist(-1),
    LeftUpperLeg: v(0.085, 0.67),
    LeftLowerLeg: v(0.085, 0.37),
    LeftFoot: v(0.085, 0.085),
    RightUpperLeg: v(-0.085, 0.67),
    RightLowerLeg: v(-0.085, 0.37),
    RightFoot: v(-0.085, 0.085),
  }
})()

const PARENT: Partial<Record<BoneName, BoneName>> = {
  Hips: 'Root',
  Spine: 'Hips',
  Chest: 'Spine',
  Neck: 'Chest',
  Head: 'Neck',
  LeftUpperArm: 'Chest',
  LeftLowerArm: 'LeftUpperArm',
  LeftHand: 'LeftLowerArm',
  RightUpperArm: 'Chest',
  RightLowerArm: 'RightUpperArm',
  RightHand: 'RightLowerArm',
  LeftUpperLeg: 'Hips',
  LeftLowerLeg: 'LeftUpperLeg',
  LeftFoot: 'LeftLowerLeg',
  RightUpperLeg: 'Hips',
  RightLowerLeg: 'RightUpperLeg',
  RightFoot: 'RightLowerLeg',
}

export type Bones = Record<BoneName, THREE.Bone>

export function createSkeleton(): { bones: Bones; list: THREE.Bone[]; skeleton: THREE.Skeleton } {
  const bones = {} as Bones
  for (const name of BONE_NAMES) {
    const b = new THREE.Bone()
    b.name = name
    bones[name] = b
  }
  for (const name of BONE_NAMES) {
    const p = PARENT[name]
    const local = JOINTS[name].clone()
    if (p) {
      local.sub(JOINTS[p])
      bones[p].add(bones[name])
    }
    bones[name].position.copy(local)
  }
  const list = BONE_NAMES.map((n) => bones[n])
  bones.Root.updateMatrixWorld(true)
  return { bones, list, skeleton: new THREE.Skeleton(list) }
}
