import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import {
  BOUNDS,
  COFFEE_TABLE,
  CORRIDOR_PLANTS,
  DEPARTMENTS,
  FILLER_ROOMS,
  LOUNGE_CHAIRS,
  MEETING_ROOM,
  MEETING_SEATS,
  MEETING_TABLE,
  PANTRY_COUNTER,
  PANTRY_TABLE,
  PRINTER,
  SOFA,
  WALL_H,
  WALL_T,
  WALLS,
  WATER_COOLER,
  WHITEBOARD,
  type Department,
  type Wall,
} from '../sim/layout'
import type { Rect } from '../sim/types'
import { engine } from '../simInstance'
import { useUI } from '../store'
import { Box, Desk, Lounge, MeetingTable, Pantry, Plant, Printer, WaterCooler, Whiteboard } from './Furniture'
import { usePBR, type PBRName } from './assets'
import { getMaterials } from './materials'
import { MergeStatic } from './MergeStatic'
import { RoomItemView } from './RoomItems'

const { minX, maxX, minZ, maxZ } = BOUNDS

export function Office() {
  return (
    <group>
      {/* tường bao co giãn theo camera → không gộp */}
      {WALLS.filter((w) => w.kind === 'outer').map((w, i) => (
        <OuterWall key={i} wall={w} />
      ))}
      {DEPARTMENTS.map((d) => (
        <DeptSign key={d.id} dept={d} />
      ))}
      <ZoneLabels />
      <MergeStatic>
        <Floors />
        {WALLS.filter((w) => w.kind !== 'outer').map((w, i) =>
          w.kind === 'glass' ? <GlassWall key={i} wall={w} /> : <SolidWall key={i} wall={w} />,
        )}
        {DEPARTMENTS.map((d) => (
          <Room key={d.id} dept={d} />
        ))}
        {FILLER_ROOMS.flatMap((f, i) => f.items.map((it, k) => <RoomItemView key={`f${i}-${k}`} item={it} />))}
        <MeetingTable rect={MEETING_TABLE} seats={MEETING_SEATS} />
        <Whiteboard {...WHITEBOARD} />
        <Lounge sofa={SOFA} coffee={COFFEE_TABLE} chairs={LOUNGE_CHAIRS} />
        <Printer rect={PRINTER} />
        <WaterCooler rect={WATER_COOLER} />
        <Pantry counter={PANTRY_COUNTER} table={PANTRY_TABLE} />
        {CORRIDOR_PLANTS.map((p, i) => (
          <Plant key={i} x={p.x} z={p.z} tall rotation={i * 1.3} />
        ))}
      </MergeStatic>
    </group>
  )
}

/** Một phòng ban: bàn làm việc (kiểu riêng) + danh sách nội thất khai báo trong layout */
function Room({ dept }: { dept: Department }) {
  return (
    <group>
      <Desk
        spec={dept.desk}
        accent={dept.color}
        status={() => {
          const a = engine.agentById[dept.id]
          const t = a.currentTaskId ? engine.tasks.get(a.currentTaskId) : undefined
          return { working: !!t, progress: t?.progress ?? 0 }
        }}
      />
      {dept.items.map((it, i) => (
        <RoomItemView key={i} item={it} />
      ))}
    </group>
  )
}

// ---------------------------------------------------------------- sàn

function Floors() {
  const W = maxX - minX
  const D = maxZ - minZ
  const laminate = usePBR('laminate_floor_02', [W / 2, D / 2], { roughness: 0.8 })
  return (
    <group>
      {/* nền ngoài toà nhà */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#2a2f36" roughness={1} />
      </mesh>
      {/* sàn gỗ laminate sáng màu cho hành lang */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} material={laminate} receiveShadow>
        <planeGeometry args={[W, D]} />
      </mesh>
      {/* sàn riêng từng phòng ban */}
      {DEPARTMENTS.map((d) => (
        <RoomFloor key={d.id} dept={d} />
      ))}
      {FILLER_ROOMS.map((f, i) => (
        <FloorPatch key={i} rect={{ ...f.room, w: f.room.w - 0.15, d: f.room.d - 0.15 }} name="carpet012" color="#b8bcc4" />
      ))}
      <FloorPatch rect={{ ...MEETING_ROOM, w: MEETING_ROOM.w - 0.3, d: MEETING_ROOM.d - 0.3 }} name="carpet012" />
      {/* thảm khu sảnh */}
      <FloorPatch rect={{ x: SOFA.x, z: 0.7, w: 4.6, d: 3.0 }} name="carpet012" color="#c9c3b8" />
    </group>
  )
}

const FLOOR_TEX: Record<Department['floor']['kind'], { name: PBRName; tile: number; base: string }> = {
  carpetLight: { name: 'carpet016', tile: 1.5, base: '#ffffff' },
  carpetDark: { name: 'carpet012', tile: 1.5, base: '#ffffff' },
  walnut: { name: 'natural_walnut_veneer', tile: 0.9, base: '#e6d3bf' },
  oak: { name: 'white_oak_veneer', tile: 0.9, base: '#ffffff' },
}

function RoomFloor({ dept }: { dept: Department }) {
  const f = FLOOR_TEX[dept.floor.kind]
  const color = '#' + new THREE.Color(f.base).lerp(new THREE.Color(dept.color), dept.floor.tint).getHexString()
  return <FloorPatch rect={{ ...dept.room, w: dept.room.w - 0.15, d: dept.room.d - 0.15 }} name={f.name} color={color} tile={f.tile} />
}

function FloorPatch({ rect, name, color = '#ffffff', tile = 1.5 }: { rect: Rect; name: PBRName; color?: string; tile?: number }) {
  const mat = usePBR(name, [rect.w / tile, rect.d / tile], { color })
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[rect.x, 0.004, rect.z]} material={mat} receiveShadow>
      <planeGeometry args={[rect.w, rect.d]} />
    </mesh>
  )
}

// ---------------------------------------------------------------- tường

function segment(w: Wall) {
  const horizontal = w.z1 === w.z2
  const len = horizontal ? Math.abs(w.x2 - w.x1) : Math.abs(w.z2 - w.z1)
  return { horizontal, len, cx: (w.x1 + w.x2) / 2, cz: (w.z1 + w.z2) / 2 }
}

/** Tường bao: tự hạ thấp khi nằm giữa camera và văn phòng (kiểu "nhà búp bê") */
function OuterWall({ wall }: { wall: Wall }) {
  const m = getMaterials()
  const g = useRef<THREE.Group>(null)
  const { horizontal, len, cx, cz } = segment(wall)
  const n = wall.normal!
  const plaster = usePBR('plastered_wall_04', [len / 2, WALL_H / 2], { withMap: false, color: '#dcd8d1', normalScale: 0.7 })
  useFrame(({ camera }, dt) => {
    if (!g.current) return
    const facing = (camera.position.x - cx) * n.x + (camera.position.z - cz) * n.z > 0
    const target = facing ? 0.12 : 1
    g.current.scale.y += (target - g.current.scale.y) * Math.min(1, dt * 6)
  })
  const size: [number, number, number] = horizontal ? [len + WALL_T, WALL_H, WALL_T * 2] : [WALL_T * 2, WALL_H, len + WALL_T]
  return (
    <group ref={g} position={[cx + n.x * WALL_T * 0.5, 0, cz + n.z * WALL_T * 0.5]}>
      <Box size={size} position={[0, WALL_H / 2, 0]} material={plaster} />
      {/* phào chân tường */}
      <Box
        size={horizontal ? [len, 0.1, WALL_T * 2 + 0.02] : [WALL_T * 2 + 0.02, 0.1, len]}
        position={[0, 0.05, 0]}
        material={m.darkWood}
        cast={false}
      />
    </group>
  )
}

function SolidWall({ wall }: { wall: Wall }) {
  const m = getMaterials()
  const { horizontal, len, cx, cz } = segment(wall)
  const plaster = usePBR('plastered_wall_04', [len / 2, WALL_H / 2], { withMap: false, color: '#eeebe6', normalScale: 0.7 })
  return (
    <group position={[cx, 0, cz]}>
      <Box size={horizontal ? [len, WALL_H, WALL_T] : [WALL_T, WALL_H, len]} position={[0, WALL_H / 2, 0]} material={plaster} />
      <Box
        size={horizontal ? [len, 0.1, WALL_T + 0.02] : [WALL_T + 0.02, 0.1, len]}
        position={[0, 0.05, 0]}
        material={m.darkWood}
        cast={false}
      />
    </group>
  )
}

/** Vách kính khung nhôm + dải kính mờ */
function GlassWall({ wall }: { wall: Wall }) {
  const m = getMaterials()
  const { horizontal, len, cx, cz } = segment(wall)
  const H = WALL_H - 0.2
  const posts = Math.max(1, Math.round(len / 1.5))
  const along = (t: number): [number, number, number] => (horizontal ? [t, 0, 0] : [0, 0, t])
  const dims = (l: number, h: number, t: number): [number, number, number] => (horizontal ? [l, h, t] : [t, h, l])
  return (
    <group position={[cx, 0, cz]}>
      <mesh position={[0, H / 2, 0]} material={m.glass} renderOrder={2}>
        <boxGeometry args={dims(len, H, 0.03)} />
      </mesh>
      <mesh position={[0, 1.15, 0]} material={m.frosted} renderOrder={3}>
        <boxGeometry args={dims(len, 0.28, 0.035)} />
      </mesh>
      <Box size={dims(len, 0.07, 0.07)} position={[0, 0.035, 0]} material={m.aluminium} cast={false} />
      <Box size={dims(len, 0.06, 0.07)} position={[0, H, 0]} material={m.aluminium} cast={false} />
      {Array.from({ length: posts + 1 }, (_, i) => {
        const t = -len / 2 + (i * len) / posts
        const [x, , z] = along(t)
        return <Box key={i} size={[0.05, H, 0.05]} position={[x, H / 2, z]} material={m.aluminium} cast={false} />
      })}
    </group>
  )
}

// ---------------------------------------------------------------- nhãn

function DeptSign({ dept: d }: { dept: Department }) {
  const select = useUI((s) => s.select)
  const show = useUI((s) => s.showLabels)
  if (!show) return null
  return (
    <Html position={[d.door.x, WALL_H + 0.15, d.door.z]} center zIndexRange={[10, 0]}>
      <button className="dept-sign" style={{ ['--c' as string]: d.color }} onClick={() => select(d.id)}>
        <span className="dot" />
        {d.name}
      </button>
    </Html>
  )
}

function ZoneLabels() {
  const show = useUI((s) => s.showLabels)
  if (!show) return null
  const zones: [string, number, number][] = [
    ['Phòng họp', MEETING_ROOM.x, MEETING_ROOM.z],
    ['Sảnh', SOFA.x, SOFA.z + 0.3],
    ['Pantry', 15, 0],
  ]
  return (
    <>
      {zones.map(([name, x, z]) => (
        <Html key={name} position={[x, 2.4, z]} center zIndexRange={[10, 0]}>
          <div className="zone-label">{name}</div>
        </Html>
      ))}
    </>
  )
}
