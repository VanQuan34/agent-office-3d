import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// ?view=character → trang xem mẫu nhân vật; mặc định → văn phòng
const isViewer = new URLSearchParams(location.search).get('view') === 'character'
const Page = isViewer ? lazy(() => import('./viewer/CharacterViewer')) : lazy(() => import('./App.tsx'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  </StrictMode>,
)
