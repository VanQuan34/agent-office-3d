import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Gộp mọi mesh tĩnh bên trong thành vài mesh lớn (mỗi vật liệu 1 mesh) → giảm draw call
 * từ hàng nghìn xuống vài chục, cả ở pass bóng đổ. Rất quan trọng với GPU onboard.
 *
 * - Mesh gốc được ẩn (visible=false) chứ không xoá, React vẫn quản lý chúng.
 * - Đánh dấu `userData={{ dynamic: true }}` lên object cần chuyển động/đổi hình → bỏ qua cả nhánh con.
 * - Vật liệu vẫn dùng chung, nên thay đổi thuộc tính vật liệu (vd màn hình sáng lên) vẫn có tác dụng.
 */
export function MergeStatic({ children }: { children: ReactNode }) {
  const src = useRef<THREE.Group>(null)
  const [merged, setMerged] = useState<THREE.Group | null>(null)

  useLayoutEffect(() => {
    const root = src.current
    if (!root) return
    const out = mergeStatic(root)
    setMerged(out.group)
    return () => {
      out.sources.forEach((m) => (m.visible = true))
      out.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
    }
  }, [])

  return (
    <>
      <group ref={src}>{children}</group>
      {merged && <primitive object={merged} />}
    </>
  )
}

const KEEP = ['position', 'normal', 'uv'] as const

function mergeStatic(root: THREE.Object3D) {
  root.updateWorldMatrix(true, true)
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const buckets = new Map<string, { mesh: THREE.Mesh; geoms: THREE.BufferGeometry[] }>()
  const sources: THREE.Mesh[] = []

  const walk = (o: THREE.Object3D) => {
    if (o.userData.dynamic) return
    const mesh = o as THREE.Mesh
    if (mesh.isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh && !(o as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(mesh.material) && o.visible) {
      const g = toFloatGeometry(mesh.geometry)
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld))
      const key = [mesh.material.uuid, mesh.castShadow, mesh.receiveShadow, mesh.renderOrder, Object.keys(g.attributes).sort().join()].join('|')
      let b = buckets.get(key)
      if (!b) buckets.set(key, (b = { mesh, geoms: [] }))
      b.geoms.push(g)
      sources.push(mesh)
    }
    o.children.forEach(walk)
  }
  walk(root)

  const group = new THREE.Group()
  group.name = 'merged-static'
  for (const { mesh, geoms } of buckets.values()) {
    const geometry = mergeGeometries(geoms, false)
    geoms.forEach((g) => g.dispose())
    if (!geometry) continue
    const m = new THREE.Mesh(geometry, mesh.material)
    m.castShadow = mesh.castShadow
    m.receiveShadow = mesh.receiveShadow
    m.renderOrder = mesh.renderOrder
    m.matrixAutoUpdate = false
    group.add(m)
  }
  // nhóm gộp nằm cùng hệ toạ độ với root
  group.matrixAutoUpdate = false
  group.matrix.copy(root.matrix)
  sources.forEach((m) => (m.visible = false))
  return { group, sources }
}

/** Chuẩn hoá về Float32 + có index (giải nén thuộc tính bị lượng tử hoá của meshopt) */
function toFloatGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  for (const name of KEEP) {
    const a = src.getAttribute(name) as THREE.BufferAttribute | undefined
    if (!a) continue
    const arr = new Float32Array(a.count * a.itemSize)
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = a.getComponent(i, c)
    g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize))
  }
  if (!g.getAttribute('normal')) g.computeVertexNormals()
  const count = g.getAttribute('position').count
  if (src.index) g.setIndex(Array.from(src.index.array as ArrayLike<number>))
  else g.setIndex(Array.from({ length: count }, (_, i) => i))
  return g
}
