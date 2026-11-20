import * as THREE from 'three'

/** Vật liệu trơn dùng chung (kính, kim loại, nhựa, vải). Vật liệu có texture PBR nằm ở assets.tsx */

let cache: ReturnType<typeof build> | null = null

function build() {
  return {
    glass: new THREE.MeshStandardMaterial({
      color: '#d8ecf5',
      roughness: 0.05,
      metalness: 0,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      envMapIntensity: 1.5,
      side: THREE.DoubleSide,
    }),
    frosted: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, transparent: true, opacity: 0.55, depthWrite: false }),
    aluminium: new THREE.MeshStandardMaterial({ color: '#c9cdd2', roughness: 0.4, metalness: 0.45 }),
    deskWood: new THREE.MeshStandardMaterial({ color: '#b58a5e', roughness: 0.45 }),
    darkWood: new THREE.MeshStandardMaterial({ color: '#5a4030', roughness: 0.5 }),
    white: new THREE.MeshStandardMaterial({ color: '#f4f4f2', roughness: 0.5 }),
    blackPlastic: new THREE.MeshStandardMaterial({ color: '#1d1f22', roughness: 0.4, metalness: 0.2 }),
    steel: new THREE.MeshStandardMaterial({ color: '#c3c7cc', roughness: 0.25, metalness: 0.9 }),
    fabricGrey: new THREE.MeshStandardMaterial({ color: '#5f6670', roughness: 0.95 }),
    fabricSofa: new THREE.MeshStandardMaterial({ color: '#3f5566', roughness: 0.95 }),
    pot: new THREE.MeshStandardMaterial({ color: '#e8e4dc', roughness: 0.7 }),
    leaf: new THREE.MeshStandardMaterial({ color: '#3f7d4a', roughness: 0.8 }),
    leafDark: new THREE.MeshStandardMaterial({ color: '#2f6339', roughness: 0.8 }),
    stone: new THREE.MeshStandardMaterial({ color: '#e7e3dc', roughness: 0.3, metalness: 0.05 }),
    book: ['#8a3b3b', '#2f4b6e', '#c7a25a', '#3d6b52', '#6c5a8a', '#d9d4c7'].map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }),
    ),
  }
}

export function getMaterials() {
  if (!cache) cache = build()
  return cache
}
