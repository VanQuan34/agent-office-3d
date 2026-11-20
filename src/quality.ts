/**
 * Cấu hình chất lượng đồ hoạ. Mặc định tự chọn theo GPU (onboard → low, card rời → high).
 * Ghi đè qua URL để đo hiệu năng, ví dụ:
 *   ?q=low | ?q=high  – ép preset
 *   ?ao=0&msaa=0      – tắt từng hiệu ứng
 *   ?stats            – hiện bảng FPS
 *
 * Số đo trên Intel UHD 630, 1600×900: low = 60 FPS (chạm vsync), high = ~24 FPS (AO tốn nhất).
 */
export interface Quality {
  preset: 'high' | 'low'
  ao: boolean
  bloom: boolean
  msaa: number
  shadowMap: number
  /** đồ trang trí nhỏ (cây, đèn bàn, lọ hoa…) có đổ bóng hay không */
  propShadows: boolean
  dpr: [number, number]
  stats: boolean
}

const PRESETS: Record<Quality['preset'], Omit<Quality, 'preset' | 'stats'>> = {
  high: { ao: true, bloom: true, msaa: 4, shadowMap: 4096, propShadows: true, dpr: [1, 2] },
  low: { ao: false, bloom: true, msaa: 0, shadowMap: 2048, propShadows: true, dpr: [1, 1] },
}

function read(): Quality {
  const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search)
  const preset = q.get('q') === 'high' ? 'high' : q.get('q') === 'low' ? 'low' : detectPreset()
  const base = { preset, ...PRESETS[preset], stats: q.has('stats') } as Quality
  const bool = (k: string, d: boolean) => (q.has(k) ? q.get(k) !== '0' : d)
  const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d)
  return {
    ...base,
    ao: bool('ao', base.ao),
    bloom: bool('bloom', base.bloom),
    msaa: num('msaa', base.msaa),
    shadowMap: num('shadow', base.shadowMap),
    propShadows: bool('propShadows', base.propShadows),
    dpr: q.has('dpr') ? [num('dpr', 1), num('dpr', 1)] : base.dpr,
  }
}

export const QUALITY = read()

/** GPU onboard / phần mềm → low. Không đọc được tên GPU → high. */
function detectPreset(): Quality['preset'] {
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    const name = ext ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : ''
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    return /intel|uhd|iris|swiftshader|llvmpipe|software|mali|adreno|powervr|radeon\(tm\) graphics|vega \d+ graphics/i.test(name)
      ? 'low'
      : 'high'
  } catch {
    return 'low'
  }
}

/** Đổi preset bằng cách tải lại trang với ?q= */
export function switchPreset(p: Quality['preset']) {
  const u = new URL(location.href)
  u.searchParams.set('q', p)
  location.href = u.toString()
}
