import { Loader } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Suspense, useEffect } from 'react'
import { QUALITY } from './quality'
import { Experience, USE_COMPOSER } from './scene/Experience'
import { engine } from './simInstance'
import { useUI } from './store'
import { HUD } from './ui/HUD'

export default function App() {
  // nhịp cập nhật UI 2D (4 lần/giây) – scene 3D tự đọc engine mỗi frame
  useEffect(() => {
    const id = setInterval(() => useUI.getState().refresh(engine.feed.slice(-60)), 250)
    return () => clearInterval(id)
  }, [])

  return (
    <>
      <Canvas
        shadows="percentage"
        flat={USE_COMPOSER}
        dpr={QUALITY.dpr}
        camera={{ position: [0, 31, 29], fov: 40, near: 0.1, far: 200 }}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        onCreated={({ gl, scene }) => Object.assign(window, { __gl: gl, __scene: scene })}
        onPointerMissed={() => useUI.getState().select(null)}
      >
        <Suspense fallback={null}>
          <Experience />
        </Suspense>
      </Canvas>
      <HUD />
      <Loader dataInterpolation={(p) => `Đang tải văn phòng ${p.toFixed(0)}%`} />
    </>
  )
}
