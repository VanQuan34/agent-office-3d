import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { A_ANGLE, BI, createSkeleton, JOINTS, type BoneName, type Bones } from './rig'
import type { CharacterVariant } from './variants'

/**
 * Dựng nhân vật "Người Mầm" (Sprigling) hoàn toàn bằng code:
 * mỗi bộ phận là một khối tròn trịa (ellipsoid / lathe / limb thuôn), được gán trọng số skin
 * vào xương (trộn mượt ở khớp), sau đó gộp thành MỘT SkinnedMesh với 2 vật liệu (lì + bóng)
 * → chỉ 2 draw call mỗi nhân vật, có thể export GLB để rig/animate tiếp trong Blender.
 */

type V3 = [number, number, number]
type Skin = { bone: BoneName } | { along: { from: THREE.Vector3; to: THREE.Vector3; anchors: [number, BoneName][] } }

interface Part {
  geo: THREE.BufferGeometry
  glossy: boolean
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

class Kit {
  parts: Part[] = []

  /** Thêm hình học (đã ở toạ độ model) với màu + skin */
  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, skin: Skin, glossy = false) {
    const g = geo.index ? geo : geo.setIndex(Array.from({ length: geo.getAttribute('position').count }, (_, i) => i))
    g.deleteAttribute('uv')
    const pos = g.getAttribute('position')
    const n = pos.count
    const c = new THREE.Color(color)
    const col = new Float32Array(n * 3)
    const si = new Uint16Array(n * 4)
    const sw = new Float32Array(n * 4)
    const p = new THREE.Vector3()
    for (let i = 0; i < n; i++) {
      col.set([c.r, c.g, c.b], i * 3)
      if ('bone' in skin) {
        si[i * 4] = BI[skin.bone]
        sw[i * 4] = 1
      } else {
        // nội suy trọng số giữa các mốc dọc theo trục from→to (t = 0..1)
        const { from, to, anchors } = skin.along
        p.fromBufferAttribute(pos, i)
        const axis = to.clone().sub(from)
        const t = p.clone().sub(from).dot(axis) / axis.lengthSq()
        let k = 0
        while (k < anchors.length - 1 && t > anchors[k + 1][0]) k++
        const [t0, b0] = anchors[k]
        const [t1, b1] = anchors[Math.min(k + 1, anchors.length - 1)]
        const w = b0 === b1 || t1 === t0 ? 0 : THREE.MathUtils.smoothstep(t, t0, t1)
        si[i * 4] = BI[b0]
        sw[i * 4] = 1 - w
        si[i * 4 + 1] = BI[b1]
        sw[i * 4 + 1] = w
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4))
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4))
    this.parts.push({ geo: g, glossy })
  }

  ellipsoid(r: V3, at: V3, color: THREE.ColorRepresentation, skin: Skin, opts: { rot?: V3; seg?: number; glossy?: boolean; phi?: [number, number]; theta?: [number, number] } = {}) {
    const seg = opts.seg ?? 20
    const g = new THREE.SphereGeometry(1, seg, Math.max(8, Math.round(seg * 0.7)), opts.phi?.[0] ?? 0, opts.phi?.[1] ?? Math.PI * 2, opts.theta?.[0] ?? 0, opts.theta?.[1] ?? Math.PI)
    g.scale(...r)
    if (opts.rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...opts.rot)))
    g.translate(...at)
    this.add(g, color, skin, opts.glossy)
  }

  /** Khối thuôn tròn hai đầu từ a tới b (bán kính r1 → r2) */
  limb(a: THREE.Vector3, b: THREE.Vector3, r1: number, r2: number, color: THREE.ColorRepresentation, skin: Skin, seg = 14) {
    const L = a.distanceTo(b)
    const pts: THREE.Vector2[] = []
    const capSteps = 5
    for (let i = 0; i <= capSteps; i++) {
      const t = (i / capSteps) * (Math.PI / 2)
      pts.push(new THREE.Vector2(Math.sin(t) * r1, -Math.cos(t) * r1))
    }
    for (let i = 0; i <= capSteps; i++) {
      const t = (i / capSteps) * (Math.PI / 2)
      pts.push(new THREE.Vector2(Math.cos(t) * r2, L + Math.sin(t) * r2))
    }
    pts[pts.length - 1].x = 0
    const g = new THREE.LatheGeometry(pts, seg)
    const q = new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), b.clone().sub(a).normalize())
    g.applyQuaternion(q)
    g.translate(a.x, a.y, a.z)
    this.add(g, color, skin)
  }

  /** Thân tròn xoay quanh trục y theo profile [bán kính, y], ép dẹt theo z */
  lathe(profile: [number, number][], color: THREE.ColorRepresentation, skin: Skin, zScale = 0.78, seg = 24) {
    const g = new THREE.LatheGeometry(
      profile.map(([r, y]) => new THREE.Vector2(r, y)),
      seg,
    )
    g.scale(1, 1, zScale)
    this.add(g, color, skin)
  }

  torus(radius: number, tube: number, at: V3, rot: V3, color: THREE.ColorRepresentation, skin: Skin, arc = Math.PI * 2, glossy = false) {
    const g = new THREE.TorusGeometry(radius, tube, 10, 28, arc)
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)))
    g.translate(...at)
    this.add(g, color, skin, glossy)
  }

  cylinder(r1: number, r2: number, h: number, at: V3, rot: V3, color: THREE.ColorRepresentation, skin: Skin, seg = 16) {
    const g = new THREE.CylinderGeometry(r2, r1, h, seg)
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)))
    g.translate(...at)
    this.add(g, color, skin)
  }

  cone(r: number, h: number, at: V3, rot: V3, color: THREE.ColorRepresentation, skin: Skin) {
    const g = new THREE.ConeGeometry(r, h, 12, 2)
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)))
    g.translate(...at)
    this.add(g, color, skin)
  }
}

// ---------------------------------------------------------------- dựng nhân vật

export interface BuiltCharacter {
  root: THREE.Group
  mesh: THREE.SkinnedMesh
  bones: Bones
  /** điểm gắn đạo cụ (tập hồ sơ, cốc) */
  propRight: THREE.Object3D
  propFront: THREE.Object3D
}

const J = JOINTS
const HEAD_C = v3(0, 1.37, 0) // tâm đầu
const HEAD_R = 0.2

export function buildCharacter(vr: CharacterVariant): BuiltCharacter {
  const k = new Kit()
  const head: Skin = { bone: 'Head' }
  const chest: Skin = { bone: 'Chest' }

  // ---------- thân: áo vest + sơ mi + cà vạt
  // hông/quần
  k.ellipsoid([0.15, 0.085, 0.092], [0, 0.7, -0.005], vr.pants, { bone: 'Hips' })
  k.lathe(
    [
      [0.0, 0.68],
      [0.12, 0.685],
      [0.152, 0.71],
      [0.15, 0.8],
      [0.158, 0.9],
      [0.168, 1.0],
      [0.16, 1.07],
      [0.12, 1.11],
      [0.05, 1.13],
      [0.0, 1.135],
    ],
    vr.suit,
    { along: { from: v3(0, 0.64, 0), to: v3(0, 1.13, 0), anchors: [[0, 'Hips'], [0.25, 'Hips'], [0.45, 'Spine'], [0.6, 'Chest'], [1, 'Chest']] } },
  )
  // mảng sơ mi trắng hình chữ V + cà vạt / nơ
  {
    // mảng sơ mi hình chữ V (tam giác mũi xuống) + cổ áo + ve áo vest
    const v = new THREE.ConeGeometry(0.068, 0.16, 3, 1)
    v.rotateZ(Math.PI)
    v.rotateY(Math.PI / 2)
    v.scale(1, 1, 0.35)
    v.rotateX(-0.22)
    v.translate(0, 1.03, 0.118)
    k.add(v, vr.shirt, chest)
    k.torus(0.058, 0.02, [0, 1.125, 0.005], [Math.PI / 2 - 0.12, 0, 0], vr.shirt, chest)
    for (const s of [1, -1]) {
      k.ellipsoid([0.035, 0.09, 0.014], [s * 0.062, 1.0, 0.135], vr.lapel, chest, { rot: [-0.25, 0, s * 0.42] })
    }
  }
  if (vr.neckwear === 'tie') {
    k.ellipsoid([0.022, 0.075, 0.014], [0, 0.965, 0.13], vr.accent, chest, { rot: [-0.15, 0, 0] })
    k.ellipsoid([0.02, 0.016, 0.014], [0, 1.045, 0.128], vr.accent, chest)
  } else if (vr.neckwear === 'bow') {
    k.ellipsoid([0.035, 0.022, 0.016], [-0.03, 1.05, 0.128], vr.accent, chest, { rot: [0, 0, 0.3] })
    k.ellipsoid([0.035, 0.022, 0.016], [0.03, 1.05, 0.128], vr.accent, chest, { rot: [0, 0, -0.3] })
    k.ellipsoid([0.014, 0.014, 0.014], [0, 1.05, 0.135], vr.accent, chest)
  } else {
    // khăn quàng dày
    k.torus(0.075, 0.03, [0, 1.1, 0.01], [Math.PI / 2 - 0.15, 0, 0], vr.accent, chest)
    k.ellipsoid([0.03, 0.07, 0.022], [0.035, 1.02, 0.12], vr.accent, chest, { rot: [-0.2, 0, 0.15] })
  }
  // khuy áo, thắt lưng, thẻ nhân viên
  for (const y of [0.83, 0.9]) k.ellipsoid([0.012, 0.012, 0.008], [0, y, 0.13], vr.trim, { bone: 'Spine' })
  k.torus(0.148, 0.018, [0, 0.715, 0], [Math.PI / 2, 0, 0], '#2a2420', { bone: 'Hips' })
  k.ellipsoid([0.02, 0.015, 0.008], [0, 0.715, 0.12], vr.trim, { bone: 'Hips' }, { glossy: true })
  {
    // thẻ nhân viên bo tròn trên túi ngực
    const card = new THREE.CapsuleGeometry(0.012, 0.028, 4, 8)
    card.rotateZ(Math.PI / 2)
    card.scale(1.25, 1.9, 0.3)
    card.rotateX(-0.1)
    card.translate(-0.088, 0.95, 0.148)
    k.add(card, '#ffffff', chest)
    k.ellipsoid([0.024, 0.006, 0.006], [-0.088, 0.968, 0.152], vr.accent, chest, { rot: [-0.1, 0, 0] })
  }

  // ---------- cổ + đầu
  k.cylinder(0.062, 0.056, 0.14, [0, 1.15, 0], [0, 0, 0], vr.skin, { bone: 'Neck' })
  k.ellipsoid([HEAD_R, HEAD_R * 0.96, HEAD_R * 0.93], [HEAD_C.x, HEAD_C.y, HEAD_C.z], vr.skin, head, { seg: 32 })
  // má phúng phính + cằm
  k.ellipsoid([0.155, 0.12, 0.14], [0, 1.3, 0.045], vr.skin, head, { seg: 24 })
  // mũi nhỏ
  k.ellipsoid([0.024, 0.02, 0.022], [0, 1.335, 0.2], vr.skin, head)
  // má hồng
  for (const s of [1, -1]) k.ellipsoid([0.032, 0.02, 0.012], [s * 0.11, 1.315, 0.148], vr.blush, head, { rot: [0, s * 0.62, 0] })
  // tai hình lá – dày, chĩa ra ngoài & hơi lên
  for (const s of [1, -1]) {
    k.ellipsoid([0.028, 0.085, 0.022], [s * 0.215, 1.41, -0.01], vr.skin, head, { rot: [0.15, 0, -s * 1.05] })
    k.ellipsoid([0.014, 0.05, 0.01], [s * 0.214, 1.405, 0.006], vr.blush, head, { rot: [0.15, 0, -s * 1.05] })
  }

  // ---------- mắt to biểu cảm
  for (const s of [1, -1]) {
    const x = s * 0.078
    k.ellipsoid([0.052, 0.064, 0.03], [x, 1.385, 0.162], '#fbfbf8', head, { rot: [0, s * 0.38, 0], glossy: true })
    k.ellipsoid([0.037, 0.046, 0.018], [x * 1.03, 1.38, 0.183], vr.iris, head, { rot: [0, s * 0.38, 0], glossy: true })
    k.ellipsoid([0.02, 0.026, 0.01], [x * 1.05, 1.378, 0.197], '#0e0b10', head, { rot: [0, s * 0.38, 0], glossy: true })
    k.ellipsoid([0.011, 0.011, 0.006], [x * 0.92, 1.398, 0.205], '#ffffff', head, { glossy: true })
    k.ellipsoid([0.005, 0.005, 0.004], [x * 1.15, 1.363, 0.205], '#ffffff', head, { glossy: true })
    // mi trên
    k.ellipsoid([0.054, 0.009, 0.016], [x, 1.447, 0.163], '#2b1d1a', head, { rot: [0.2, s * 0.38, -s * 0.12] })
    // lông mày
    k.ellipsoid([0.034, 0.009, 0.01], [s * 0.084, 1.478, 0.142], vr.hair, head, { rot: [0.45, s * 0.4, -s * 0.2] })
  }
  // miệng cười
  k.torus(0.03, 0.0085, [0, 1.288, 0.184], [0.3, 0, Math.PI + Math.PI * 0.075], '#7a2d32', head, Math.PI * 0.85)

  // ---------- mầm cây trên đầu (màu phòng ban) – nét nhận diện của tộc Người Mầm
  k.cylinder(0.014, 0.011, 0.07, [0, 1.585, 0.0], [0.15, 0, 0], '#5d8a3a', head, 10)
  for (const s of [1, -1]) {
    k.ellipsoid([0.055, 0.014, 0.03], [s * 0.05, 1.63, 0.005], vr.sprout, head, { rot: [0.1, s * 0.3, s * 0.45] })
  }

  // ---------- tóc
  buildHair(k, vr)
  // ---------- phụ kiện đặc trưng phòng ban
  buildAccessory(k, vr)

  // ---------- tay (A-pose), có vai tròn che khớp
  for (const side of ['Left', 'Right'] as const) {
    const s = side === 'Left' ? 1 : -1
    const sh = J[`${side}UpperArm`]
    const el = J[`${side}LowerArm`]
    const wr = J[`${side}Hand`]
    const armSkin: Skin = {
      along: {
        from: sh,
        to: wr,
        anchors: [
          [-0.2, 'Chest'],
          [0.05, `${side}UpperArm`],
          [0.45, `${side}UpperArm`],
          [0.58, `${side}LowerArm`],
          [1, `${side}LowerArm`],
        ],
      },
    }
    k.ellipsoid([0.068, 0.066, 0.066], [sh.x, sh.y, sh.z], vr.suit, armSkin)
    k.limb(sh, el, 0.056, 0.05, vr.suit, armSkin)
    k.ellipsoid([0.05, 0.05, 0.05], [el.x, el.y, el.z], vr.suit, armSkin)
    k.limb(el, wr.clone().lerp(el, 0.12), 0.05, 0.046, vr.suit, armSkin)
    // cổ tay áo sơ mi
    const cuffA = wr.clone().lerp(el, 0.16)
    k.limb(cuffA, wr.clone().lerp(el, 0.04), 0.044, 0.042, vr.shirt, { bone: `${side}LowerArm` })
    buildHand(k, wr, s, vr.skin, `${side}Hand`)
  }

  // ---------- chân + giày
  for (const side of ['Left', 'Right'] as const) {
    const hip = J[`${side}UpperLeg`]
    const knee = J[`${side}LowerLeg`]
    const ankle = J[`${side}Foot`]
    const legSkin: Skin = {
      along: {
        from: hip,
        to: ankle,
        anchors: [
          [-0.1, 'Hips'],
          [0.06, `${side}UpperLeg`],
          [0.45, `${side}UpperLeg`],
          [0.58, `${side}LowerLeg`],
          [1, `${side}LowerLeg`],
        ],
      },
    }
    k.limb(hip.clone().add(v3(0, 0.03, 0)), knee, 0.088, 0.07, vr.pants, legSkin)
    k.ellipsoid([0.07, 0.07, 0.07], [knee.x, knee.y, knee.z], vr.pants, legSkin)
    k.limb(knee, ankle.clone().add(v3(0, 0.03, 0)), 0.07, 0.06, vr.pants, legSkin)
    // ống quần loe nhẹ phủ cổ giày
    k.limb(ankle.clone().add(v3(0, 0.03, 0)), ankle.clone().add(v3(0, 0.08, 0)), 0.064, 0.062, vr.pants, legSkin)
    // giày tròn mũi
    const foot: Skin = { bone: `${side}Foot` }
    k.ellipsoid([0.074, 0.06, 0.125], [ankle.x, 0.058, 0.035], vr.shoes, foot, { seg: 20 })
    k.ellipsoid([0.077, 0.012, 0.128], [ankle.x, 0.008, 0.035], '#1d1916', foot)
  }

  // ---------- gộp
  const matte = k.parts.filter((p) => !p.glossy).map((p) => p.geo)
  const glossy = k.parts.filter((p) => p.glossy).map((p) => p.geo)
  const geometry = mergeGeometries([mergeGeometries(matte)!, mergeGeometries(glossy)!], true)!
  k.parts.forEach((p) => p.geo.dispose())

  const { bones, skeleton } = createSkeleton()
  const mesh = new THREE.SkinnedMesh(geometry, [
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0, name: 'sprigling_matte' }),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0, name: 'sprigling_glossy' }),
  ])
  mesh.name = `Sprigling_${vr.id}`
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.frustumCulled = false
  mesh.add(bones.Root)
  mesh.bind(skeleton)

  // điểm gắn đạo cụ
  const propRight = new THREE.Object3D()
  propRight.position.set(-Math.sin(A_ANGLE) * 0.07, -Math.cos(A_ANGLE) * 0.07, 0.02)
  bones.RightHand.add(propRight)
  const propFront = new THREE.Object3D()
  propFront.position.set(0, 0.0, 0.25)
  bones.Chest.add(propFront)

  const root = new THREE.Group()
  root.name = `Sprigling_${vr.id}`
  root.add(mesh)
  return { root, mesh, bones, propRight, propFront }
}

/** Bàn tay cách điệu: lòng bàn tay tròn + 3 ngón mập + ngón cái, hướng theo A-pose */
function buildHand(k: Kit, wrist: THREE.Vector3, s: number, skin: string, bone: BoneName) {
  const rot = new THREE.Matrix4().makeRotationZ(s * A_ANGLE)
  const place = (p: THREE.Vector3) => p.applyMatrix4(rot).add(wrist)
  const sk: Skin = { bone }
  // lòng bàn tay (trong hệ tay buông thẳng: -y là hướng ngón)
  const palm = new THREE.SphereGeometry(1, 16, 12)
  palm.scale(0.032, 0.05, 0.042)
  palm.translate(0, -0.05, 0)
  palm.applyMatrix4(rot)
  palm.translate(wrist.x, wrist.y, wrist.z)
  k.add(palm, skin, sk)
  // 3 ngón
  for (const [dz, len] of [
    [0.026, 0.05],
    [0, 0.056],
    [-0.025, 0.048],
  ] as const) {
    const a = place(v3(0, -0.085, dz))
    const b = place(v3(-s * 0.012, -0.085 - len, dz))
    k.limb(a, b, 0.0165, 0.014, skin, sk, 10)
  }
  // ngón cái hướng về trước
  const ta = place(v3(-s * 0.004, -0.04, 0.035))
  const tb = place(v3(-s * 0.016, -0.075, 0.068))
  k.limb(ta, tb, 0.017, 0.015, skin, sk, 10)
}

function buildHair(k: Kit, vr: CharacterVariant) {
  const head: Skin = { bone: 'Head' }
  const c = vr.hair
  const [cx, cy, cz] = [HEAD_C.x, HEAD_C.y, HEAD_C.z]
  // nền tóc: chỏm cầu phủ đỉnh + sau đầu
  // chỏm trên (tới đường chân tóc trán) + mảng sau/hai bên (phi quanh trục y, nửa sau là z < 0)
  k.ellipsoid([0.214, 0.205, 0.205], [cx, cy + 0.012, cz - 0.012], c, head, { seg: 28, theta: [0, Math.PI * 0.37] })
  k.ellipsoid([0.215, 0.205, 0.2], [cx, cy + 0.005, cz - 0.02], c, head, { seg: 28, phi: [Math.PI * 0.9, Math.PI * 1.2], theta: [0, Math.PI * 0.64] })

  switch (vr.hairStyle) {
    case 'swept': // mái vuốt chéo lên (quiff)
      k.ellipsoid([0.15, 0.07, 0.1], [0.02, cy + 0.17, 0.09], c, head, { rot: [-0.35, 0.15, -0.12] })
      k.ellipsoid([0.09, 0.05, 0.07], [-0.11, cy + 0.14, 0.11], c, head, { rot: [-0.6, 0, 0.4] })
      break
    case 'neat': // rẽ ngôi gọn
      k.ellipsoid([0.12, 0.05, 0.09], [0.06, cy + 0.15, 0.11], c, head, { rot: [-0.6, 0, -0.25] })
      k.ellipsoid([0.08, 0.045, 0.08], [-0.1, cy + 0.15, 0.1], c, head, { rot: [-0.6, 0, 0.3] })
      break
    case 'spiky': // tóc dựng nhọn (gốc dày)
      for (let i = 0; i < 7; i++) {
        const a = -1.1 + (i / 6) * 2.2
        k.cone(0.055, 0.13, [Math.sin(a) * 0.12, cy + 0.17 + Math.cos(a) * 0.02, 0.02 + Math.cos(a) * 0.05], [0.35, 0, -a * 0.6], c, head)
      }
      k.ellipsoid([0.13, 0.05, 0.08], [0, cy + 0.15, 0.12], c, head, { rot: [-0.7, 0, 0] })
      break
    case 'messy': // rối bù kiểu kỹ sư
      for (const [x, y, z, r] of [[-0.12, 0.15, 0.08, 0.07], [0.0, 0.19, 0.05, 0.08], [0.12, 0.15, 0.07, 0.07], [-0.06, 0.13, 0.14, 0.06], [0.07, 0.13, 0.14, 0.06], [0.0, 0.16, -0.1, 0.09]] as const)
        k.ellipsoid([r, r * 0.8, r], [x, cy + y, z], c, head)
      break
    case 'bob': // tóc bob ngang cằm
      k.ellipsoid([0.13, 0.05, 0.08], [0, cy + 0.14, 0.13], c, head, { rot: [-0.8, 0, 0] })
      for (const s of [1, -1]) k.ellipsoid([0.075, 0.16, 0.13], [s * 0.17, cy - 0.06, -0.01], c, head, { rot: [0, 0, s * 0.12] })
      k.ellipsoid([0.2, 0.15, 0.1], [0, cy - 0.06, -0.12], c, head)
      break
    case 'ponytail':
    case 'bun':
    case 'twinBuns':
      // mái mềm
      k.ellipsoid([0.08, 0.045, 0.08], [-0.07, cy + 0.14, 0.12], c, head, { rot: [-0.75, 0, 0.35] })
      k.ellipsoid([0.09, 0.045, 0.08], [0.06, cy + 0.15, 0.12], c, head, { rot: [-0.75, 0, -0.3] })
      if (vr.hairStyle === 'ponytail') {
        k.ellipsoid([0.03, 0.03, 0.03], [0, cy + 0.06, -0.205], vr.accent, head)
        k.ellipsoid([0.06, 0.1, 0.06], [0, cy - 0.03, -0.24], c, head, { rot: [0.35, 0, 0] })
        k.ellipsoid([0.05, 0.09, 0.05], [0, cy - 0.15, -0.26], c, head, { rot: [0.15, 0, 0] })
      } else if (vr.hairStyle === 'bun') {
        k.ellipsoid([0.085, 0.08, 0.085], [0, cy + 0.17, -0.12], c, head)
        k.torus(0.06, 0.014, [0, cy + 0.13, -0.1], [Math.PI / 2 + 0.6, 0, 0], vr.accent, head)
      } else {
        for (const s of [1, -1]) k.ellipsoid([0.07, 0.07, 0.07], [s * 0.15, cy + 0.15, -0.04], c, head)
      }
      // tóc ôm hai bên má
      for (const s of [1, -1]) k.ellipsoid([0.05, 0.12, 0.09], [s * 0.18, cy - 0.04, 0.0], c, head, { rot: [0, 0, s * 0.1] })
      break
  }
}

function buildAccessory(k: Kit, vr: CharacterVariant) {
  const head: Skin = { bone: 'Head' }
  const cy = HEAD_C.y
  const gold = '#d9a93b'
  switch (vr.accessory) {
    case 'circlet': // vòng lá vàng – Giám đốc
      k.torus(0.2, 0.012, [0, cy + 0.1, -0.01], [Math.PI / 2 + 0.25, 0, 0], gold, head, Math.PI * 2, true)
      for (const s of [-1, 0, 1]) k.ellipsoid([0.022, 0.04, 0.012], [s * 0.05, cy + 0.17, 0.165 - Math.abs(s) * 0.02], gold, head, { rot: [-0.4, s * 0.3, -s * 0.3], glossy: true })
      break
    case 'roundGlasses': // kính tròn – Pháp chế
      for (const s of [1, -1]) k.torus(0.045, 0.007, [s * 0.078, 1.383, 0.215], [0, s * 0.3, 0], '#3a2c22', head, Math.PI * 2, true)
      k.torus(0.018, 0.006, [0, 1.39, 0.222], [0, 0, 0], '#3a2c22', head, Math.PI, true)
      break
    case 'coinPendant': // mặt dây đồng xu – Tài chính
      k.torus(0.07, 0.006, [0, 1.06, 0.06], [Math.PI / 2 - 0.5, 0, 0], gold, { bone: 'Chest' }, Math.PI * 2, true)
      k.cylinder(0.03, 0.03, 0.012, [0, 0.99, 0.15], [Math.PI / 2 - 0.15, 0, 0], gold, { bone: 'Chest' })
      break
    case 'flower': // hoa cài tóc – Nhân sự
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2
        k.ellipsoid([0.024, 0.024, 0.012], [0.15 + Math.cos(a) * 0.026, cy + 0.14 + Math.sin(a) * 0.026, 0.1], '#ffd1dc', head, { rot: [0, 0.6, 0] })
      }
      k.ellipsoid([0.016, 0.016, 0.014], [0.152, cy + 0.14, 0.11], '#f2c14e', head)
      break
    case 'earpiece': // tai nghe kinh doanh
      k.ellipsoid([0.02, 0.03, 0.02], [-0.205, 1.37, 0.03], '#26292e', head)
      k.limb(v3(-0.205, 1.35, 0.04), v3(-0.16, 1.3, 0.13), 0.006, 0.006, '#26292e', head, 8)
      break
    case 'beret': // mũ nồi – Marketing
      k.ellipsoid([0.2, 0.06, 0.19], [0.03, cy + 0.19, -0.01], vr.accent, head, { rot: [0.15, 0, -0.25] })
      k.ellipsoid([0.015, 0.02, 0.015], [0.06, cy + 0.255, 0], vr.accent, head)
      break
    case 'goggles': // kính bảo hộ trên trán – Kỹ thuật
      k.torus(0.212, 0.014, [0, cy + 0.08, 0], [Math.PI / 2 + 0.2, 0, 0], '#3b3f45', head)
      for (const s of [1, -1]) {
        k.cylinder(0.042, 0.042, 0.035, [s * 0.065, cy + 0.12, 0.15], [Math.PI / 2 - 0.6, 0, 0], '#5b6068', head)
        k.cylinder(0.034, 0.034, 0.012, [s * 0.065, cy + 0.13, 0.168], [Math.PI / 2 - 0.6, 0, 0], '#8fd3ff', head)
      }
      break
    case 'headset': // tai nghe chụp + mic – CSKH
      k.torus(0.225, 0.014, [0, cy + 0.02, 0], [0, 0, 0], '#2f3338', head, Math.PI)
      for (const s of [1, -1]) k.cylinder(0.05, 0.05, 0.04, [s * 0.215, cy - 0.02, 0], [0, 0, Math.PI / 2], '#2f3338', head)
      k.limb(v3(-0.22, cy - 0.04, 0.03), v3(-0.13, 1.29, 0.16), 0.008, 0.008, '#2f3338', head, 8)
      k.ellipsoid([0.016, 0.016, 0.016], [-0.13, 1.29, 0.16], vr.accent, head)
      break
  }
}
