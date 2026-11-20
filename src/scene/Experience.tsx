import { CameraControls, Environment, Lightformer, QuadraticBezierLine, Stats } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Bloom, EffectComposer, N8AO, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { QUALITY } from '../quality'
import { BOUNDS, DEPT_BY_ID } from '../sim/layout'
import { engine, source } from '../simInstance'
import { useUI } from '../store'
import { Avatar } from './Avatar'
import { Office } from './Office'

/** Hậu kỳ chỉ bật khi có AO/bloom; nếu không, renderer tự tone-map (rẻ hơn 1 pass toàn màn hình) */
export const USE_COMPOSER = QUALITY.ao || QUALITY.bloom

export function Experience() {
  return (
    <>
      <color attach="background" args={['#1d2228']} />
      <fog attach="fog" args={['#1d2228', 45, 90]} />
      <Lighting />
      <SimDriver />
      <CameraRig />
      <Office />
      {engine.agents.map((a) => (
        <Avatar key={a.id} agent={a} />
      ))}
      <Exchanges />
      {USE_COMPOSER && (
        <EffectComposer multisampling={QUALITY.msaa}>
          <>{QUALITY.ao && <N8AO aoRadius={0.9} distanceFalloff={0.6} intensity={2.2} quality="medium" halfRes />}</>
          <>{QUALITY.bloom && <Bloom intensity={0.25} luminanceThreshold={0.9} mipmapBlur />}</>
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <Vignette offset={0.3} darkness={0.45} />
        </EffectComposer>
      )}
      {QUALITY.stats && <Stats />}
    </>
  )
}

/** Chạy engine mô phỏng trong vòng lặp render, chia nhỏ bước khi tăng tốc */
function SimDriver() {
  useFrame((_, delta) => {
    const speed = useUI.getState().speed
    const dt = Math.min(delta, 0.1) * speed
    if (dt <= 0) return
    const n = Math.ceil(dt / 0.05)
    for (let i = 0; i < n; i++) {
      source.update?.(dt / n)
      engine.update(dt / n)
    }
  })
  return null
}

function Lighting() {
  return (
    <>
      <hemisphereLight args={['#ffffff', '#8a7f72', 0.55]} />
      <directionalLight
        position={[12, 24, 10]}
        intensity={2.4}
        color="#fff4e6"
        castShadow
        shadow-mapSize={[QUALITY.shadowMap, QUALITY.shadowMap]}
        shadow-camera-left={BOUNDS.minX - 6}
        shadow-camera-right={BOUNDS.maxX + 6}
        shadow-camera-top={18}
        shadow-camera-bottom={-18}
        shadow-camera-near={1}
        shadow-camera-far={70 + (BOUNDS.maxX - 18)}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-radius={4}
      />
      {/* môi trường phản chiếu dựng bằng tấm sáng – không cần tải HDRI */}
      <Environment resolution={256} frames={1} environmentIntensity={0.6}>
        {[-12, -4, 4, 12].map((x) =>
          [-6, 6].map((z) => (
            <Lightformer key={`${x}${z}`} form="rect" intensity={2.5} position={[x, 6, z]} rotation-x={Math.PI / 2} scale={[5, 1.2, 1]} />
          )),
        )}
        <Lightformer form="rect" intensity={1.2} color="#ffe2c4" position={[0, 3, 30]} scale={[60, 6, 1]} />
        <Lightformer form="rect" intensity={0.8} color="#cfe3ff" position={[0, 3, -30]} rotation-y={Math.PI} scale={[60, 6, 1]} />
      </Environment>
    </>
  )
}

/** Góc nhìn tổng: lùi xa theo chiều rộng toà nhà (văn phòng live có thể dài hơn 36m) */
const ZOOM = BOUNDS.maxX - BOUNDS.minX <= 36 ? 1 : (BOUNDS.maxX - BOUNDS.minX) / 31
export const HOME = { pos: [0, 31 * ZOOM, 29 * ZOOM] as const, target: [0, 0, 1] as const }

/** Camera: xoay/zoom tự do; khi chọn nhân viên sẽ bay tới và bám theo */
function CameraRig() {
  const ref = useRef<CameraControls>(null)
  const selected = useUI((s) => s.selected)
  const tmp = useRef(new THREE.Vector3())

  useEffect(() => {
    const c = ref.current
    if (!c) return
    if (selected) {
      const a = engine.agentById[selected]
      c.setLookAt(a.pos.x + 5, 8, a.pos.z + 8, a.pos.x, 1, a.pos.z, true)
    } else {
      c.setLookAt(...HOME.pos, ...HOME.target, true)
    }
  }, [selected])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useUI.getState().select(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useFrame(() => {
    const c = ref.current
    if (!c || !selected) return
    const a = engine.agentById[selected]
    c.getTarget(tmp.current)
    if (Math.hypot(a.pos.x - tmp.current.x, a.pos.z - tmp.current.z) > 0.01) c.moveTo(a.pos.x, 1, a.pos.z, true)
  })

  return (
    <CameraControls
      ref={ref}
      makeDefault
      minDistance={4}
      maxDistance={55}
      minPolarAngle={0.15}
      maxPolarAngle={1.3}
      dollySpeed={0.6}
      smoothTime={0.35}
    />
  )
}

/** Đường cong phát sáng nối 2 phòng ban khi vừa bàn giao hồ sơ */
function Exchanges() {
  useUI((s) => s.tick)
  return (
    <>
      {engine.fx.map((f) => (
        <ExchangeArc key={f.id} from={f.from} to={f.to} />
      ))}
    </>
  )
}

function ExchangeArc({ from, to }: { from: keyof typeof DEPT_BY_ID; to: keyof typeof DEPT_BY_ID }) {
  const a = DEPT_BY_ID[from].desk
  const b = DEPT_BY_ID[to].desk
  const ref = useRef<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any
  const mid = new THREE.Vector3((a.x + b.x) / 2, 5 + Math.hypot(a.x - b.x, a.z - b.z) * 0.12, (a.z + b.z) / 2)
  useFrame((_, dt) => {
    if (ref.current?.material) ref.current.material.dashOffset -= dt * 2
  })
  return (
    <QuadraticBezierLine
      ref={ref}
      start={[a.x, 1.2, a.z]}
      end={[b.x, 1.2, b.z]}
      mid={mid}
      color={DEPT_BY_ID[from].color}
      lineWidth={3}
      dashed
      dashSize={0.6}
      gapSize={0.3}
      toneMapped={false}
    />
  )
}
