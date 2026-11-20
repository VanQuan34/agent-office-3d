import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { applyPose, blendPose, targetPose } from '../character/animate'
import { buildCharacter } from '../character/build'
import { variantFor } from '../character/variants'
import type { Agent } from '../sim/engine'
import type { AnimState } from '../sim/types'
import { IS_LIVE } from '../config'
import { useUI } from '../store'

/**
 * Nhân vật "Người Mầm" có rig thật (SkinnedMesh + 18 xương), animation thủ tục theo `agent.anim`.
 * Khi có GLB từ công cụ ngoài (Mixamo/Tripo…), chỉ cần thay `buildCharacter` bằng loader
 * miễn là bộ xương có cùng tên (xem src/character/rig.ts).
 */
export function Avatar({ agent }: { agent: Agent }) {
  const root = useRef<THREE.Group>(null)
  const ring = useRef<THREE.Mesh>(null)

  const selected = useUI((s) => s.selected === agent.id)
  const select = useUI((s) => s.select)
  useUI((s) => s.tick) // render lại bong bóng chat theo nhịp UI
  const showLabels = useUI((s) => s.showLabels)

  const character = useMemo(() => buildCharacter(variantFor(agent.dept)), [agent.dept])
  const props = useMemo(() => {
    const folder = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.035, 0.22),
      new THREE.MeshStandardMaterial({ color: agent.dept.color, roughness: 0.6 }),
    )
    folder.position.set(0, -0.1, 0.05)
    folder.rotation.x = 0.25
    folder.castShadow = true
    const cup = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.03, 0.09, 14),
      new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.4 }),
    )
    character.propFront.add(folder)
    character.propRight.add(cup)
    return { folder, cup }
  }, [character, agent.dept.color])

  useEffect(
    () => () => {
      character.mesh.geometry.dispose()
      ;(character.mesh.material as THREE.Material[]).forEach((m) => m.dispose())
    },
    [character],
  )

  const ringMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: agent.dept.color, transparent: true, opacity: 0.75, toneMapped: false }),
    [agent.dept.color],
  )

  const idx = agent.dept.agentName.charCodeAt(0) + agent.dept.agentName.length
  const pose = useRef(targetPose('idle', 0, 0))
  const phase = useRef(0)
  const lastPos = useRef(new THREE.Vector2(agent.pos.x, agent.pos.z))

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const g = root.current
    if (!g) return
    // vị trí lấy thẳng từ engine; pha bước chân theo quãng đường thực đi (chân không trượt)
    const moved = Math.hypot(agent.pos.x - lastPos.current.x, agent.pos.z - lastPos.current.y)
    lastPos.current.set(agent.pos.x, agent.pos.z)
    phase.current += moved * 4.6
    g.position.set(agent.pos.x, 0, agent.pos.z)
    let dh = agent.heading - g.rotation.y
    dh = Math.atan2(Math.sin(dh), Math.cos(dh))
    g.rotation.y += dh * Math.min(1, dt * 10)

    const target = targetPose(agent.anim, clock.elapsedTime + idx, phase.current)
    blendPose(pose.current, target, Math.min(1, dt * 9))
    applyPose(character.bones, pose.current)

    props.folder.visible = agent.carrying
    props.cup.visible = agent.anim === 'drink'
    if (ring.current) {
      ring.current.visible = selected
      const s = 1 + Math.sin(clock.elapsedTime * 4) * 0.06
      ring.current.scale.set(s, s, s)
    }
  })

  const bubble = agent.bubble?.text
  // văn phòng live đông agent: khi ngồi đúng bàn mình thì biển tên phòng đã đủ → ẩn nhãn tên cho đỡ rối
  const showChip = selected || (showLabels && (!IS_LIVE || agent.seatedAt !== 'desk'))

  return (
    <group
      ref={root}
      onClick={(e) => {
        e.stopPropagation()
        select(agent.id)
      }}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = '')}
    >
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} material={ringMat}>
        <ringGeometry args={[0.42, 0.5, 48]} />
      </mesh>
      <primitive object={character.root} />

      {(showChip || bubble) && (
        <Html position={[0, 1.95, 0]} center zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
          <div className="agent-tag">
            {bubble && <div className="bubble">{bubble}</div>}
            {showChip && (
              <div className={`name-chip ${selected ? 'sel' : ''}`} style={{ ['--c' as string]: agent.dept.color }}>
                {stateIcon(agent.anim, agent.carrying)} {agent.dept.agentName}
              </div>
            )}
          </div>
        </Html>
      )}
    </group>
  )
}

function stateIcon(anim: AnimState, carrying: boolean) {
  if (carrying) return '📄'
  switch (anim) {
    case 'type':
      return '💻'
    case 'sit':
    case 'sitTalk':
    case 'talk':
      return '💬'
    case 'drink':
      return '☕'
    case 'walk':
      return '🚶'
    default:
      return '•'
  }
}
