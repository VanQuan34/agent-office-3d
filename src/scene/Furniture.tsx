import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { DeskSpec } from '../sim/layout'
import type { Rect, Spot } from '../sim/types'
import { QUALITY } from '../quality'
import { Model, usePBR } from './assets'
import { getMaterials } from './materials'

type V3 = [number, number, number]

/** Hộp có đổ bóng – viên gạch cơ bản cho nội thất */
export function Box({
  size,
  position,
  material,
  rotation,
  cast = true,
}: {
  size: V3
  position: V3
  material: THREE.Material
  rotation?: V3
  cast?: boolean
}) {
  return (
    <mesh position={position} rotation={rotation} material={material} castShadow={cast} receiveShadow>
      <boxGeometry args={size} />
    </mesh>
  )
}

function Cyl({
  r,
  h,
  position,
  material,
  r2,
  seg = 24,
}: {
  r: number
  h: number
  position: V3
  material: THREE.Material
  r2?: number
  seg?: number
}) {
  return (
    <mesh position={position} material={material} castShadow receiveShadow>
      <cylinderGeometry args={[r, r2 ?? r, h, seg]} />
    </mesh>
  )
}

// ---------------------------------------------------------------- bàn làm việc + màn hình hiển thị tiến độ

export interface DeskStatus {
  working: boolean
  progress: number
}

/**
 * Bàn làm việc dựng theo hệ toạ độ cục bộ: người ngồi ở phía -z nhìn về +z, xoay theo spec.heading.
 * 5 kiểu: standard (bàn chân thép), executive (bàn gỗ óc chó liền khối + ghế giám đốc),
 * dual (2 màn hình), counter (quầy tiếp nhận có vách cao phía khách), creative (bàn trắng chân màu).
 */
export function Desk({ spec, accent, status }: { spec: DeskSpec; accent: string; status: () => DeskStatus }) {
  const m = getMaterials()
  const screenMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#0c1117', emissive: new THREE.Color(accent), emissiveIntensity: 0.25 }),
    [accent],
  )
  const barMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), [])
  const accentMat = useMemo(() => new THREE.MeshStandardMaterial({ color: accent, roughness: 0.6 }), [accent])
  const bar = useRef<THREE.Mesh>(null)
  const oak = usePBR('white_oak_veneer', [1, 0.5], { roughness: 0.9 })
  const walnut = usePBR('natural_walnut_veneer', [1, 0.5], { roughness: 0.75 })

  useFrame((_, dt) => {
    const s = status()
    const target = s.working ? 0.9 : 0.25
    screenMat.emissiveIntensity += (target - screenMat.emissiveIntensity) * Math.min(1, dt * 4)
    if (bar.current) {
      bar.current.visible = s.working
      bar.current.scale.x = Math.max(0.001, s.progress)
      bar.current.position.x = -0.24 + 0.24 * s.progress
    }
  })

  const { w, d, style } = spec
  const H = 0.74
  const top = style === 'executive' ? walnut : style === 'creative' ? m.white : oak
  const legMat = style === 'creative' ? accentMat : m.aluminium
  const monZ = d / 2 - 0.28
  const monitor = (x: number, rotY: number, withBar: boolean) => (
    <group position={[x, H + 0.02, monZ]} rotation={[0, rotY, 0]}>
      <Box size={[0.22, 0.015, 0.16]} position={[0, 0.008, 0.02]} material={m.blackPlastic} />
      <Box size={[0.04, 0.22, 0.04]} position={[0, 0.12, 0.05]} material={m.blackPlastic} />
      <Box size={[0.62, 0.37, 0.025]} position={[0, 0.38, 0]} material={m.blackPlastic} />
      <mesh position={[0, 0.385, -0.0135]} rotation={[0, Math.PI, 0]} material={screenMat}>
        <planeGeometry args={[0.58, 0.33]} />
      </mesh>
      {withBar && (
        <mesh ref={bar} position={[-0.24, 0.25, -0.015]} rotation={[0, Math.PI, 0]} material={barMat} userData={{ dynamic: true }}>
          <planeGeometry args={[0.48, 0.025]} />
        </mesh>
      )}
    </group>
  )

  return (
    <group position={[spec.x, 0, spec.z]} rotation={[0, spec.heading, 0]}>
      <Box size={[w, style === 'executive' ? 0.06 : 0.04, d]} position={[0, H, 0]} material={top} />
      {style === 'executive' ? (
        <>
          {/* bàn giám đốc liền khối: 2 hộc gỗ + vách trước + viền màu phòng ban */}
          {[-1, 1].map((sx) => (
            <Box key={sx} size={[0.45, H - 0.03, d - 0.06]} position={[sx * (w / 2 - 0.25), (H - 0.03) / 2, 0]} material={walnut} />
          ))}
          <Box size={[w - 0.9, H - 0.2, 0.04]} position={[0, (H - 0.2) / 2 + 0.17, d / 2 - 0.05]} material={walnut} />
          <Box size={[w - 0.06, 0.03, 0.03]} position={[0, H - 0.05, d / 2 - 0.01]} material={accentMat} />
        </>
      ) : (
        <>
          {[-1, 1].map((sx) => (
            <group key={sx} position={[sx * (w / 2 - 0.06), 0, 0]}>
              <Box size={[0.05, H - 0.02, 0.05]} position={[0, (H - 0.02) / 2, d / 2 - 0.08]} material={legMat} />
              <Box size={[0.05, H - 0.02, 0.05]} position={[0, (H - 0.02) / 2, -d / 2 + 0.08]} material={legMat} />
              <Box size={[0.05, 0.04, d - 0.1]} position={[0, 0.02, 0]} material={m.aluminium} />
            </group>
          ))}
          {style !== 'counter' && (
            <>
              <Box size={[w - 0.14, 0.4, 0.02]} position={[0, H - 0.25, d / 2 - 0.05]} material={m.white} />
              <Box size={[w - 0.14, 0.04, 0.025]} position={[0, H - 0.1, d / 2 - 0.04]} material={accentMat} />
            </>
          )}
        </>
      )}
      {style === 'counter' && (
        <>
          {/* quầy tiếp nhận: vách cao phía khách + mặt quầy nhô ra */}
          <Box size={[w + 0.1, 1.1, 0.06]} position={[0, 0.55, d / 2 + 0.05]} material={m.white} />
          <Box size={[w + 0.1, 0.06, 0.07]} position={[0, 0.3, d / 2 + 0.09]} material={accentMat} />
          <Box size={[w + 0.2, 0.04, 0.34]} position={[0, 1.12, d / 2 + 0.1]} material={oak} />
          {[-1, 1].map((sx) => (
            <Box key={sx} size={[0.06, 1.1, d]} position={[sx * (w / 2 + 0.02), 0.55, 0.03]} material={m.white} />
          ))}
        </>
      )}

      {/* màn hình */}
      {style === 'dual' ? (
        <>
          {monitor(-0.34, 0.22, true)}
          {monitor(0.34, -0.22, false)}
        </>
      ) : (
        monitor(0, 0, true)
      )}

      {/* bàn phím, chuột, cốc */}
      <Box size={[0.42, 0.02, 0.14]} position={[0, H + 0.03, -d / 2 + 0.23]} material={m.blackPlastic} />
      <Box size={[0.06, 0.02, 0.1]} position={[0.33, H + 0.03, -d / 2 + 0.23]} material={m.blackPlastic} />
      <Cyl r={0.04} h={0.1} position={[-0.45, H + 0.07, -d / 2 + 0.28]} material={m.white} />

      {/* đồ trên bàn theo kiểu */}
      {style === 'executive' && (
        <>
          <Box size={[0.3, 0.07, 0.05]} position={[0.55, H + 0.065, d / 2 - 0.12]} rotation={[-0.3, 0, 0]} material={accentMat} />
          <Model name="vase" position={[-0.85, H + 0.03, d / 2 - 0.2]} scale={0.75} shadows={false} />
          <Box size={[0.3, 0.04, 0.4]} position={[0.62, H + 0.05, -0.12]} rotation={[0, -0.2, 0]} material={m.darkWood} />
        </>
      )}
      {(style === 'standard' || style === 'counter') && (
        <>
          <Box size={[0.24, 0.05, 0.32]} position={[0.5, H + 0.045, -d / 2 + 0.28]} rotation={[0, 0.2, 0]} material={accentMat} />
          <Model name="plantSmall" position={[w / 2 - 0.14, H + 0.02, d / 2 - 0.16]} shadows={QUALITY.propShadows} />
        </>
      )}
      {style === 'standard' && (
        <Model name="deskLamp" position={[-w / 2 + 0.18, H + 0.02, d / 2 - 0.2]} rotation={Math.PI * 0.85} scale={0.85} shadows={QUALITY.propShadows} />
      )}
      {style === 'dual' && (
        <>
          <Model name="plantSmall" position={[-w / 2 + 0.15, H + 0.02, d / 2 - 0.15]} shadows={QUALITY.propShadows} />
          <Box size={[0.32, 0.02, 0.22]} position={[w / 2 - 0.3, H + 0.03, -0.05]} rotation={[0, -0.3, 0]} material={m.blackPlastic} />
        </>
      )}
      {style === 'creative' && (
        <>
          {/* giấy note màu + sổ phác thảo + cây */}
          {['#ffd84d', '#ff8fb1', '#7fd6ff', '#9be27a'].map((c, i) => (
            <Note key={c} color={c} position={[-0.95 + i * 0.12, H + 0.022, -0.1 + (i % 2) * 0.12]} rot={i * 0.3} />
          ))}
          <Model name="plantSmall" position={[w / 2 - 0.18, H + 0.02, d / 2 - 0.18]} shadows={QUALITY.propShadows} />
          <Box size={[0.42, 0.015, 0.3]} position={[0.75, H + 0.028, -0.05]} rotation={[0, 0.15, 0]} material={m.white} />
        </>
      )}

      {/* ghế */}
      {style === 'executive' ? <ExecutiveChair position={[0, 0, -(d / 2 + 0.6)]} /> : <OfficeChair position={[0, 0, -(d / 2 + 0.6)]} />}
    </group>
  )
}

function Note({ color, position, rot }: { color: string; position: V3; rot: number }) {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: 0.8 }), [color])
  return <Box size={[0.09, 0.004, 0.09]} position={position} rotation={[0, rot, 0]} material={mat} cast={false} />
}

/** Ghế giám đốc: lưng cao, da tối màu */
function ExecutiveChair({ position }: { position: V3 }) {
  const m = getMaterials()
  const leather = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2a1f1b', roughness: 0.45 }), [])
  return (
    <group position={position}>
      <Box size={[0.58, 0.12, 0.55]} position={[0, 0.48, 0]} material={leather} />
      <Box size={[0.56, 0.85, 0.12]} position={[0, 0.98, -0.27]} rotation={[-0.1, 0, 0]} material={leather} />
      {[-1, 1].map((s) => (
        <Box key={s} size={[0.07, 0.06, 0.4]} position={[s * 0.3, 0.68, 0]} material={leather} />
      ))}
      <Cyl r={0.035} h={0.38} position={[0, 0.25, 0]} material={m.steel} />
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2
        return <Box key={i} size={[0.05, 0.035, 0.34]} position={[Math.sin(a) * 0.17, 0.05, Math.cos(a) * 0.17]} rotation={[0, a, 0]} material={m.steel} />
      })}
    </group>
  )
}

/** Ghế văn phòng; người ngồi nhìn về +z cục bộ */
export function OfficeChair({ position, rotation = 0 }: { position: V3; rotation?: number }) {
  const m = getMaterials()
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Box size={[0.5, 0.08, 0.48]} position={[0, 0.47, 0]} material={m.fabricGrey} />
      <Box size={[0.48, 0.58, 0.07]} position={[0, 0.82, -0.25]} rotation={[-0.12, 0, 0]} material={m.fabricGrey} />
      <Cyl r={0.03} h={0.38} position={[0, 0.25, 0]} material={m.steel} />
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2
        return (
          <Box
            key={i}
            size={[0.04, 0.03, 0.3]}
            position={[Math.sin(a) * 0.15, 0.05, Math.cos(a) * 0.15]}
            rotation={[0, a, 0]}
            material={m.blackPlastic}
          />
        )
      })}
    </group>
  )
}

// ---------------------------------------------------------------- đồ trang trí

export function Plant({ x, z, tall = false, rotation = 0 }: { x: number; z: number; tall?: boolean; rotation?: number }) {
  return <Model name={tall ? 'plantTall' : 'plantMedium'} position={[x, 0, z]} rotation={rotation} shadows={QUALITY.propShadows} />
}

// ---------------------------------------------------------------- khu chung

export function MeetingTable({ rect, seats }: { rect: Rect; seats: Spot[] }) {
  const m = getMaterials()
  const top = usePBR('natural_walnut_veneer', [2, 0.6], { roughness: 0.8 })
  return (
    <group>
      <group position={[rect.x, 0, rect.z]}>
        <Box size={[rect.w, 0.05, rect.d]} position={[0, 0.74, 0]} material={top} />
        {[-1, 1].map((s) => (
          <Box key={s} size={[0.12, 0.72, rect.d * 0.6]} position={[s * rect.w * 0.3, 0.36, 0]} material={m.steel} />
        ))}
        {/* hội nghị truyền hình */}
        <Box size={[0.3, 0.04, 0.3]} position={[0, 0.78, 0]} material={m.blackPlastic} />
      </group>
      {seats.map((s, i) => (
        <OfficeChair key={i} position={[s.x, 0, s.z - Math.cos(s.heading) * 0.1]} rotation={s.heading} />
      ))}
    </group>
  )
}

/** Bảng trắng treo tường: (x,z) sát mặt tường, heading = hướng mặt bảng */
export function Whiteboard({ x, z, heading, w }: { x: number; z: number; heading: number; w: number }) {
  const m = getMaterials()
  const marks = useMemo(() => new THREE.MeshBasicMaterial({ color: '#3a6fd8' }), [])
  const marks2 = useMemo(() => new THREE.MeshBasicMaterial({ color: '#d84a3a' }), [])
  return (
    <group position={[x, 1.45, z]} rotation={[0, heading, 0]}>
      <Box size={[w + 0.06, 1.16, 0.03]} position={[0, 0, -0.02]} material={m.aluminium} />
      <Box size={[w, 1.1, 0.02]} position={[0, 0, 0]} material={m.white} cast={false} />
      {[0.3, 0.15, 0, -0.15].map((y, i) => (
        <mesh key={i} position={[-w * 0.12 + i * 0.05, y, 0.012]} material={i === 2 ? marks2 : marks}>
          <planeGeometry args={[w * 0.46 - i * 0.12, 0.025]} />
        </mesh>
      ))}
      <Box size={[w * 0.9, 0.03, 0.06]} position={[0, -0.57, 0.03]} material={m.aluminium} />
    </group>
  )
}

export function Lounge({ sofa, coffee, chairs }: { sofa: Rect; coffee: Rect; chairs: (Rect & { heading: number })[] }) {
  return (
    <group>
      <Model name="sofa" position={[sofa.x, 0, sofa.z]} rotation={Math.PI} />
      <Model name="coffeeTable" position={[coffee.x, 0, coffee.z]} />
      <Model name="vase" position={[coffee.x + 0.2, 0.49, coffee.z - 0.1]} scale={0.7} shadows={false} />
      {chairs.map((c, i) => (
        <Model key={i} name="armChair" position={[c.x, 0, c.z]} rotation={c.heading} />
      ))}
    </group>
  )
}

export function Printer({ rect }: { rect: Rect }) {
  const m = getMaterials()
  return (
    <group position={[rect.x, 0, rect.z]}>
      <Box size={[rect.w, 0.9, rect.d]} position={[0, 0.45, 0]} material={m.white} />
      <Box size={[rect.w * 0.9, 0.12, rect.d * 0.9]} position={[0, 0.96, 0]} material={m.fabricGrey} />
      <Box size={[0.3, 0.02, 0.2]} position={[0, 0.75, rect.d / 2 + 0.08]} material={m.white} />
      <Box size={[0.16, 0.04, 0.1]} position={[0.3, 0.92, rect.d / 2 - 0.05]} material={m.blackPlastic} />
    </group>
  )
}

export function WaterCooler({ rect }: { rect: Rect }) {
  const m = getMaterials()
  const water = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#7cc4ff', transparent: true, opacity: 0.55, roughness: 0.05 }),
    [],
  )
  return (
    <group position={[rect.x, 0, rect.z]}>
      <Box size={[0.36, 1.0, 0.36]} position={[0, 0.5, 0]} material={m.white} />
      <Cyl r={0.15} h={0.42} position={[0, 1.22, 0]} material={water} />
    </group>
  )
}

export function Pantry({ counter, table }: { counter: Rect; table: Rect }) {
  const m = getMaterials()
  const marble = usePBR('marble_01', [0.5, 2], { roughness: 0.5 })
  const marbleTop = usePBR('marble_01', [0.6, 0.6], { roughness: 0.5 })
  return (
    <group>
      <group position={[counter.x, 0, counter.z]}>
        <Box size={[counter.w, 0.88, counter.d]} position={[0, 0.44, 0]} material={m.white} />
        <Box size={[counter.w + 0.04, 0.04, counter.d + 0.02]} position={[0, 0.9, 0]} material={marble} />
        {/* máy pha cà phê */}
        <Box size={[0.35, 0.42, 0.3]} position={[0, 1.13, -0.8]} material={m.blackPlastic} />
        <Box size={[0.35, 0.42, 0.3]} position={[0, 1.13, 0.8]} material={m.steel} />
        {/* tủ treo */}
        <Box size={[0.4, 0.6, counter.d]} position={[0.15, 2.05, 0]} material={m.deskWood} />
      </group>
      <group position={[table.x, 0, table.z]}>
        <Cyl r={table.w / 2} h={0.04} position={[0, 1.05, 0]} material={marbleTop} seg={32} />
        <Cyl r={0.04} h={1.03} position={[0, 0.52, 0]} material={m.steel} />
        <Cyl r={0.25} h={0.02} position={[0, 0.01, 0]} material={m.steel} />
        <Model name="barStool" position={[0, 0, -0.75]} />
        <Model name="barStool" position={[0, 0, 0.75]} rotation={Math.PI} />
      </group>
    </group>
  )
}
