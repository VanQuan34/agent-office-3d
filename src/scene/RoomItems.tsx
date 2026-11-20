import { useMemo } from 'react'
import * as THREE from 'three'
import { QUALITY } from '../quality'
import type { RoomItem } from '../sim/layout'
import type { Spot } from '../sim/types'
import { Model, usePBR } from './assets'
import { Box, MeetingTable, Plant, Whiteboard } from './Furniture'
import { getMaterials } from './materials'

/** Vẽ một món nội thất theo khai báo trong layout (src/sim/layout.ts → Department.items) */
export function RoomItemView({ item }: { item: RoomItem }) {
  switch (item.kind) {
    case 'shelves':
      return <Shelves x={item.x} z={item.z} heading={item.heading} units={item.units} />
    case 'sideTable':
      return <SideTable x={item.x} z={item.z} axis={item.axis} />
    case 'plant':
      return <Plant x={item.x} z={item.z} tall={item.tall} rotation={item.x * 1.7 + item.z} />
    case 'cabinet':
      return (
        <group position={[item.x, 0, item.z]} rotation={[0, item.heading, 0]}>
          <Model name="cabinet" position={[0, 0, 0]} />
          <Model name="vase" position={[-0.8, 0.68, 0]} shadows={false} />
        </group>
      )
    case 'sofa':
      return <Model name="sofa" position={[item.x, 0, item.z]} rotation={item.heading} />
    case 'coffeeTable':
      return (
        <group position={[item.x, 0, item.z]}>
          <Model name="coffeeTable" position={[0, 0, 0]} />
          <Model name="vase" position={[0.2, 0.49, -0.1]} scale={0.7} shadows={false} />
        </group>
      )
    case 'armChair':
      return <Model name="armChair" position={[item.x, 0, item.z]} rotation={item.heading} />
    case 'meetingTable':
      return <SmallMeetingTable x={item.x} z={item.z} w={item.w} d={item.d} />
    case 'whiteboard':
      return <Whiteboard x={item.x} z={item.z} heading={item.heading} w={item.w} />
    case 'filing':
      return <FilingCabinets x={item.x} z={item.z} heading={item.heading} count={item.count} />
    case 'serverRack':
      return <ServerRacks x={item.x} z={item.z} heading={item.heading} count={item.count} />
    case 'workbench':
      return <Workbench x={item.x} z={item.z} heading={item.heading} />
    case 'safe':
      return <Safe x={item.x} z={item.z} heading={item.heading} />
    case 'beanBag':
      return <BeanBag x={item.x} z={item.z} color={item.color} />
    case 'rug':
      return <Rug {...item} />
    case 'frame':
      return <Model name={item.variant === 'A' ? 'frameA' : 'frameB'} position={[item.x, 1.6, item.z]} rotation={item.heading} shadows={false} />
    case 'clock':
      return <Model name="clock" position={[item.x, 2.15, item.z]} rotation={item.heading} shadows={false} />
  }
}

// ---------------------------------------------------------------- đồ dùng chung

/** Dãy kệ ô vuông; mỗi đơn vị rộng 1.1m. Model gốc dài theo z, mặt trước +x → xoay -90° */
function Shelves({ x, z, heading, units }: { x: number; z: number; heading: number; units: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, heading, 0]}>
      {Array.from({ length: units }, (_, i) => (
        <Model key={i} name="shelves" position={[(i - (units - 1) / 2) * 1.1, 0, 0]} rotation={-Math.PI / 2} />
      ))}
    </group>
  )
}

/** Bàn tròn + 2 ghế bành đối diện, xếp theo trục x hoặc z */
function SideTable({ x, z, axis }: { x: number; z: number; axis: 'x' | 'z' }) {
  return (
    <group position={[x, 0, z]} rotation={[0, axis === 'x' ? 0 : Math.PI / 2, 0]}>
      <Model name="roundTable" position={[0, 0, 0]} />
      <Model name="armChair" position={[-0.8, 0, 0]} rotation={Math.PI / 2} scale={0.95} />
      <Model name="armChair" position={[0.8, 0, 0]} rotation={-Math.PI / 2} scale={0.95} />
      <Model name="vase" position={[0, 0.746, 0]} scale={0.6} shadows={false} />
    </group>
  )
}

/** Bàn họp nhỏ, ghế xếp đều hai cạnh dài */
function SmallMeetingTable({ x, z, w, d }: { x: number; z: number; w: number; d: number }) {
  const seats = useMemo(() => {
    const n = Math.max(1, Math.round(w / 0.95))
    const out: Spot[] = []
    for (let i = 0; i < n; i++) {
      const sx = x + (i - (n - 1) / 2) * (w / n)
      out.push({ x: sx, z: z - d / 2 - 0.42, heading: 0 }, { x: sx, z: z + d / 2 + 0.42, heading: Math.PI })
    }
    return out
  }, [x, z, w, d])
  return <MeetingTable rect={{ x, z, w, d }} seats={seats} />
}

function Rug({ x, z, w, d, color, round }: { x: number; z: number; w: number; d: number; color: string; round?: boolean }) {
  const mat = usePBR('carpet016', [w / 1.2, d / 1.2], { color })
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.008, z]} material={mat} receiveShadow scale={round ? [w / 2, d / 2, 1] : [1, 1, 1]}>
      {round ? <circleGeometry args={[1, 48]} /> : <planeGeometry args={[w, d]} />}
    </mesh>
  )
}

// ---------------------------------------------------------------- Tài chính

/** Dãy tủ hồ sơ kim loại 4 ngăn kéo */
function FilingCabinets({ x, z, heading, count }: { x: number; z: number; heading: number; count: number }) {
  const m = getMaterials()
  const body = useMemo(() => new THREE.MeshStandardMaterial({ color: '#b9bec4', roughness: 0.45, metalness: 0.5 }), [])
  return (
    <group position={[x, 0, z]} rotation={[0, heading, 0]}>
      {Array.from({ length: count }, (_, i) => {
        const cx = (i - (count - 1) / 2) * 0.5
        return (
          <group key={i} position={[cx, 0, 0]}>
            <Box size={[0.48, 1.32, 0.6]} position={[0, 0.66, 0]} material={body} />
            {[0, 1, 2, 3].map((k) => (
              <group key={k}>
                <Box size={[0.44, 0.005, 0.01]} position={[0, 0.33 * k + 0.01, 0.302]} material={m.blackPlastic} cast={false} />
                <Box size={[0.14, 0.025, 0.03]} position={[0, 0.33 * k + 0.24, 0.31]} material={m.steel} cast={false} />
                <Box size={[0.08, 0.04, 0.005]} position={[0, 0.33 * k + 0.19, 0.303]} material={m.white} cast={false} />
              </group>
            ))}
          </group>
        )
      })}
    </group>
  )
}

function Safe({ x, z, heading }: { x: number; z: number; heading: number }) {
  const body = useMemo(() => new THREE.MeshStandardMaterial({ color: '#3a3f46', roughness: 0.35, metalness: 0.7 }), [])
  const gold = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d9a93b', roughness: 0.25, metalness: 1 }), [])
  return (
    <group position={[x, 0, z]} rotation={[0, heading, 0]}>
      <Box size={[0.7, 0.82, 0.68]} position={[0, 0.41, 0]} material={body} />
      <Box size={[0.6, 0.7, 0.02]} position={[0, 0.43, 0.345]} material={body} />
      <mesh position={[0.12, 0.5, 0.37]} rotation={[Math.PI / 2, 0, 0]} material={gold}>
        <cylinderGeometry args={[0.07, 0.07, 0.03, 24]} />
      </mesh>
      <Box size={[0.03, 0.16, 0.04]} position={[-0.18, 0.45, 0.37]} material={gold} />
    </group>
  )
}

// ---------------------------------------------------------------- Kỹ thuật

/** Tủ server có đèn LED (vật liệu phát sáng → bloom bắt sáng) */
function ServerRacks({ x, z, heading, count }: { x: number; z: number; heading: number; count: number }) {
  const m = getMaterials()
  const body = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1f2328', roughness: 0.5, metalness: 0.6 }), [])
  const panel = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2b3036', roughness: 0.6, metalness: 0.4 }), [])
  const leds = useMemo(
    () => [
      new THREE.MeshBasicMaterial({ color: '#4dff9a', toneMapped: false }),
      new THREE.MeshBasicMaterial({ color: '#4db8ff', toneMapped: false }),
      new THREE.MeshBasicMaterial({ color: '#ffb84d', toneMapped: false }),
    ],
    [],
  )
  return (
    <group position={[x, 0, z]} rotation={[0, heading, 0]}>
      {Array.from({ length: count }, (_, i) => {
        const cx = (i - (count - 1) / 2) * 0.62
        return (
          <group key={i} position={[cx, 0, 0]}>
            <Box size={[0.6, 2.0, 0.9]} position={[0, 1.0, 0]} material={body} />
            {Array.from({ length: 9 }, (_, k) => (
              <group key={k} position={[0, 0.25 + k * 0.19, 0.452]}>
                <Box size={[0.52, 0.15, 0.01]} position={[0, 0, 0]} material={panel} cast={false} />
                {[0, 1, 2, 3].map((l) => (
                  <mesh key={l} position={[-0.2 + l * 0.035, 0.03, 0.007]} material={leds[(i + k + l) % 3]}>
                    <planeGeometry args={[0.018, 0.018]} />
                  </mesh>
                ))}
                <Box size={[0.22, 0.004, 0.005]} position={[0.1, -0.03, 0.006]} material={m.blackPlastic} cast={false} />
              </group>
            ))}
          </group>
        )
      })}
    </group>
  )
}

/** Bàn thợ: mặt gỗ, khung thép, bảng treo dụng cụ áp tường phía sau */
function Workbench({ x, z, heading }: { x: number; z: number; heading: number }) {
  const m = getMaterials()
  const peg = useMemo(() => new THREE.MeshStandardMaterial({ color: '#c9b08a', roughness: 0.9 }), [])
  const red = useMemo(() => new THREE.MeshStandardMaterial({ color: '#c0392b', roughness: 0.5 }), [])
  return (
    <group position={[x, 0, z]} rotation={[0, heading, 0]}>
      <Box size={[2.0, 0.05, 0.8]} position={[0, 0.9, 0]} material={m.darkWood} />
      {[-0.95, 0.95].map((sx) =>
        [-0.35, 0.35].map((sz) => <Box key={`${sx}${sz}`} size={[0.05, 0.88, 0.05]} position={[sx, 0.44, sz]} material={m.steel} />),
      )}
      <Box size={[1.9, 0.03, 0.7]} position={[0, 0.25, 0]} material={m.darkWood} />
      {/* bảng treo dụng cụ */}
      <Box size={[2.0, 0.9, 0.03]} position={[0, 1.55, -0.38]} material={peg} />
      {[-0.6, -0.2, 0.25, 0.65].map((px, i) => (
        <Box key={i} size={[0.05 + (i % 2) * 0.04, 0.25 + (i % 3) * 0.06, 0.03]} position={[px, 1.55, -0.35]} material={i % 2 ? m.steel : red} />
      ))}
      {/* hộp đồ nghề, laptop, linh kiện */}
      <Box size={[0.45, 0.2, 0.25]} position={[-0.6, 1.02, 0.1]} material={red} />
      <Box size={[0.36, 0.02, 0.25]} position={[0.3, 0.935, 0.12]} material={m.blackPlastic} />
      <Box size={[0.36, 0.22, 0.015]} position={[0.3, 1.04, 0.0]} rotation={[-0.25, 0, 0]} material={m.blackPlastic} />
      <Box size={[0.2, 0.08, 0.15]} position={[0.75, 0.97, 0.15]} material={m.steel} />
    </group>
  )
}

// ---------------------------------------------------------------- Marketing

function BeanBag({ x, z, color }: { x: number; z: number; color: string }) {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: 0.95 }), [color])
  const yaw = x * 2.3 + z
  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]}>
      <mesh position={[0, 0.24, 0]} scale={[0.42, 0.26, 0.42]} material={mat} castShadow={QUALITY.propShadows} receiveShadow>
        <sphereGeometry args={[1, 24, 16]} />
      </mesh>
      <mesh position={[0, 0.42, -0.2]} scale={[0.34, 0.26, 0.18]} material={mat} castShadow={QUALITY.propShadows} receiveShadow>
        <sphereGeometry args={[1, 20, 14]} />
      </mesh>
    </group>
  )
}
