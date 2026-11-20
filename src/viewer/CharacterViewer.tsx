import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { EffectComposer, N8AO, SMAA } from '@react-three/postprocessing'
import { useEffect, useMemo, useRef, useState } from 'react'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { applyPose, blendPose, targetPose, type PreviewAnim } from '../character/animate'
import { buildCharacter, type BuiltCharacter } from '../character/build'
import { variantFor } from '../character/variants'
import { DEPARTMENTS, DEPT_BY_ID } from '../sim/layout'
import type { DeptId } from '../sim/types'
import './viewer.css'

const ANIMS: [PreviewAnim, string][] = [
  ['apose', 'A-pose'],
  ['idle', 'Đứng'],
  ['walk', 'Đi bộ'],
  ['carry', 'Mang hồ sơ'],
  ['talk', 'Trò chuyện'],
  ['drink', 'Uống cà phê'],
]

/** Trang xem mẫu nhân vật: nền trắng studio, xoay 360°, xuất GLB có rig. Mở bằng ?view=character */
export function CharacterViewer() {
  const [dept, setDept] = useState<DeptId | 'all'>(DEPARTMENTS[0].id)
  const [anim, setAnim] = useState<PreviewAnim>('apose')
  const [spin, setSpin] = useState(true)
  const characters = useMemo(() => {
    const ids = dept === 'all' ? DEPARTMENTS.map((d) => d.id) : [dept]
    return ids.map((id) => buildCharacter(variantFor(DEPT_BY_ID[id])))
  }, [dept])
  const v = dept === 'all' ? null : variantFor(DEPT_BY_ID[dept])

  useEffect(() => () => characters.forEach((c) => c.mesh.geometry.dispose()), [characters])

  const exportGlb = () => {
    const c = characters[0]
    applyPose(c.bones, targetPose('apose', 0, 0))
    c.root.updateMatrixWorld(true)
    new GLTFExporter().parse(
      c.root,
      (res) => {
        const blob = new Blob([res as ArrayBuffer], { type: 'model/gltf-binary' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `sprigling_${dept}.glb`
        a.click()
        URL.revokeObjectURL(a.href)
      },
      (err) => alert('Xuất GLB lỗi: ' + err),
      { binary: true },
    )
  }

  const lineup = characters.length > 1
  return (
    <div className="viewer">
      <Canvas shadows flat dpr={[1, 2]} camera={{ position: lineup ? [0, 1.2, 6.2] : [0, 1.05, 3.1], fov: 32 }}>
        <color attach="background" args={['#ffffff']} />
        <Studio />
        {characters.map((c, i) => (
          <Posed key={c.root.uuid} c={c} anim={anim} x={lineup ? (i - (characters.length - 1) / 2) * 0.72 : 0} />
        ))}
        <ContactShadows position={[0, 0.001, 0]} opacity={0.5} scale={lineup ? 8 : 3} blur={2.4} far={1.5} resolution={1024} />
        <OrbitControls target={[0, 0.82, 0]} autoRotate={spin && !lineup} autoRotateSpeed={1.2} enablePan={false} minDistance={1.4} maxDistance={9} />
        <EffectComposer multisampling={0}>
          <N8AO aoRadius={0.25} distanceFalloff={0.5} intensity={2.2} quality="high" />
          <SMAA />
        </EffectComposer>
      </Canvas>

      <div className="v-panel">
        <h1>Người Mầm</h1>
        <p className="sub">Sprigling · tộc tiên rừng làm văn phòng</p>
        {v && (
          <p className="desc">
            <b>{v.title}</b> — {DEPARTMENTS.find((d) => d.id === dept)!.name}. Tai hình lá, mắt to, mầm cây trên đầu mang màu
            phòng ban. Rig 18 xương, A-pose, 2 vật liệu.
          </p>
        )}
        <div className="label">Nhân vật</div>
        <div className="chips">
          {DEPARTMENTS.map((d) => (
            <button key={d.id} className={dept === d.id ? 'on' : ''} style={{ ['--c' as string]: d.color }} onClick={() => setDept(d.id)}>
              {d.agentName}
            </button>
          ))}
          <button className={dept === 'all' ? 'on' : ''} onClick={() => setDept('all')}>
            Cả 8
          </button>
        </div>
        <div className="label">Tư thế</div>
        <div className="chips">
          {ANIMS.map(([a, n]) => (
            <button key={a} className={anim === a ? 'on' : ''} onClick={() => setAnim(a)}>
              {n}
            </button>
          ))}
        </div>
        <div className="row">
          <label>
            <input type="checkbox" checked={spin} onChange={(e) => setSpin(e.target.checked)} /> Tự xoay
          </label>
          <button className="primary" disabled={lineup} onClick={exportGlb} title="GLB có SkinnedMesh + bộ xương, ở A-pose">
            ⬇ Tải GLB (rig)
          </button>
        </div>
        <a className="back" href="./">
          ← Về văn phòng
        </a>
      </div>
    </div>
  )
}

function Posed({ c, anim, x }: { c: BuiltCharacter; anim: PreviewAnim; x: number }) {
  const pose = useRef(targetPose('apose', 0, 0))
  const phase = useRef(0)
  useFrame(({ clock }, dt) => {
    if (anim === 'walk' || anim === 'carry') phase.current += Math.min(dt, 0.1) * 1.35 * 4.6
    blendPose(pose.current, targetPose(anim, clock.elapsedTime + x * 3, phase.current), Math.min(1, dt * 8))
    applyPose(c.bones, pose.current)
  })
  return <primitive object={c.root} position={[x, 0, 0]} />
}

/** Ánh sáng studio: key ấm + fill lạnh + rim, môi trường softbox cho phản xạ mắt */
function Studio() {
  return (
    <>
      <hemisphereLight args={['#ffffff', '#e8e2da', 0.9]} />
      <directionalLight
        position={[2.5, 4.5, 3.5]}
        intensity={2.2}
        color="#fff3e6"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={3}
        shadow-camera-bottom={-1}
        shadow-bias={-0.0003}
        shadow-normalBias={0.02}
        shadow-radius={6}
      />
      <directionalLight position={[-3.5, 2.5, 2]} intensity={0.8} color="#e6efff" />
      <directionalLight position={[0, 3, -4]} intensity={1.4} color="#ffffff" />
      <Environment resolution={256} frames={1} environmentIntensity={0.5}>
        <Lightformer form="rect" intensity={3} position={[2, 3, 3]} scale={[3, 2, 1]} target={[0, 1, 0]} />
        <Lightformer form="rect" intensity={1.5} position={[-3, 2, 2]} scale={[2, 3, 1]} target={[0, 1, 0]} />
        <Lightformer form="ring" intensity={2} position={[0, 2, -3]} scale={2} target={[0, 1, 0]} />
      </Environment>
    </>
  )
}

export default CharacterViewer
