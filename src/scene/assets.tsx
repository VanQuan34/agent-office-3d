import { Clone, useGLTF, useTexture } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'

/**
 * Asset bán thực tế (CC0) – nguồn: Poly Haven (model, texture) & ambientCG (thảm).
 * Đã nén sẵn bằng gltf-transform (meshopt + webp) vào public/models, public/textures.
 * Danh sách nguồn: public/ASSETS.md
 */
export const MODELS = {
  shelves: '/models/wooden_display_shelves_01.glb',
  armChair: '/models/modern_arm_chair_01.glb',
  roundTable: '/models/round_wooden_table_02.glb',
  coffeeTable: '/models/coffee_table_round_01.glb',
  sofa: '/models/sofa_02.glb',
  plantTall: '/models/potted_plant_01.glb',
  plantMedium: '/models/potted_plant_02.glb',
  plantSmall: '/models/potted_plant_04.glb',
  barStool: '/models/bar_chair_round_01.glb',
  clock: '/models/wall_clock.glb',
  frameA: '/models/hanging_picture_frame_01.glb',
  frameB: '/models/hanging_picture_frame_02.glb',
  deskLamp: '/models/desk_lamp_arm_01.glb',
  cabinet: '/models/modern_wooden_cabinet.glb',
  vase: '/models/ceramic_vase_01.glb',
} as const

export type ModelName = keyof typeof MODELS

for (const url of Object.values(MODELS)) useGLTF.preload(url)

type V3 = [number, number, number]

/** Một bản sao của model, có đổ bóng. rotation: góc quay quanh trục y */
export function Model({
  name,
  position,
  rotation = 0,
  scale = 1,
  shadows = true,
}: {
  name: ModelName
  position: V3
  rotation?: number
  scale?: number | V3
  shadows?: boolean
}) {
  const { scene } = useGLTF(MODELS[name])
  toStandardMaterials(scene)
  return (
    <Clone
      object={scene}
      position={position}
      rotation={[0, rotation, 0]}
      scale={scale}
      castShadow={shadows}
      receiveShadow
    />
  )
}

const converted = new WeakSet<THREE.Object3D>()

/**
 * GLTFLoader tạo MeshPhysicalMaterial khi model có KHR_materials_* (transmission, specular, ior…).
 * Chỉ cần 1 vật liệu có transmission là three.js render lại TOÀN BỘ cảnh thêm 1 lần mỗi frame
 * (đo được: 44 → 60 FPS trên Intel UHD 630). Ở góc nhìn văn phòng khác biệt gần như không thấy,
 * nên đổi hết về MeshStandardMaterial (giữ map/normal/roughness/metalness/alpha).
 */
function toStandardMaterials(root: THREE.Object3D) {
  if (converted.has(root)) return
  converted.add(root)
  const cache = new Map<THREE.Material, THREE.MeshStandardMaterial>()
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const src = mesh.material as THREE.MeshPhysicalMaterial
    if (!src?.isMeshPhysicalMaterial) return
    let dst = cache.get(src)
    if (!dst) {
      const glassy = src.transmission > 0
      dst = new THREE.MeshStandardMaterial({
        name: src.name,
        color: src.color,
        map: src.map,
        normalMap: src.normalMap,
        normalScale: src.normalScale,
        roughness: src.roughness,
        roughnessMap: src.roughnessMap,
        metalness: src.metalness,
        metalnessMap: src.metalnessMap,
        aoMap: src.aoMap,
        emissive: src.emissive,
        emissiveMap: src.emissiveMap,
        alphaMap: src.alphaMap,
        alphaTest: src.alphaTest,
        side: src.side,
        // kính (transmission) → trong suốt thường
        transparent: src.transparent || glassy,
        opacity: glassy ? 0.25 : src.opacity,
        depthWrite: glassy ? false : src.depthWrite,
      })
      cache.set(src, dst)
    }
    mesh.material = dst
  })
}

// ---------------------------------------------------------------- vật liệu PBR

export type PBRName =
  | 'laminate_floor_02'
  | 'white_oak_veneer'
  | 'natural_walnut_veneer'
  | 'plastered_wall_04'
  | 'marble_01'
  | 'carpet016'
  | 'carpet012'

const TEX_NAMES: PBRName[] = [
  'laminate_floor_02',
  'white_oak_veneer',
  'natural_walnut_veneer',
  'plastered_wall_04',
  'marble_01',
  'carpet016',
  'carpet012',
]
const texUrls = (n: PBRName) => ({
  map: `/textures/${n}/diff.webp`,
  normalMap: `/textures/${n}/nor.webp`,
  roughnessMap: `/textures/${n}/rough.webp`,
})
for (const n of TEX_NAMES) useTexture.preload(Object.values(texUrls(n)))

/**
 * Vật liệu PBR lặp theo kích thước thật.
 * @param repeat số lần lặp texture theo [u, v]
 * @param opts withMap=false: chỉ dùng normal + roughness (giữ màu sơn trơn)
 */
export function usePBR(
  name: PBRName,
  repeat: [number, number],
  opts: { color?: THREE.ColorRepresentation; withMap?: boolean; normalScale?: number; roughness?: number } = {},
) {
  const tex = useTexture(texUrls(name))
  const { color, withMap = true, normalScale = 1, roughness = 1 } = opts
  return useMemo(() => {
    const prep = (t: THREE.Texture, srgb: boolean) => {
      const c = t.clone()
      c.wrapS = c.wrapT = THREE.RepeatWrapping
      c.repeat.set(repeat[0], repeat[1])
      c.anisotropy = 8
      c.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
      c.needsUpdate = true
      return c
    }
    return new THREE.MeshStandardMaterial({
      map: withMap ? prep(tex.map, true) : null,
      normalMap: prep(tex.normalMap, false),
      normalScale: new THREE.Vector2(normalScale, normalScale),
      roughnessMap: prep(tex.roughnessMap, false),
      roughness,
      color: color ?? '#ffffff',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tex, repeat[0], repeat[1], color, withMap, normalScale, roughness])
}
