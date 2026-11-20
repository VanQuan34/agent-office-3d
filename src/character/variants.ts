import * as THREE from 'three'
import type { Department, ThemeId } from '../sim/layout'
import type { DeptId } from '../sim/types'

export type HairStyle = 'swept' | 'neat' | 'spiky' | 'messy' | 'bob' | 'ponytail' | 'bun' | 'twinBuns'
export type Accessory = 'circlet' | 'roundGlasses' | 'coinPendant' | 'flower' | 'earpiece' | 'beret' | 'goggles' | 'headset'

export interface CharacterVariant {
  id: DeptId
  title: string
  skin: string
  blush: string
  hair: string
  hairStyle: HairStyle
  iris: string
  suit: string
  shirt: string
  pants: string
  shoes: string
  /** màu nhấn: cà vạt, khăn, buộc tóc… = màu phòng ban */
  accent: string
  trim: string
  /** ve áo vest – tối hơn màu áo */
  lapel: string
  /** mầm cây trên đầu */
  sprout: string
  neckwear: 'tie' | 'bow' | 'scarf'
  accessory: Accessory
}

/** Áo vest: màu phòng ban pha trầm để nhìn chuyên nghiệp */
const suitOf = (c: string, amt = 0.35) => '#' + new THREE.Color(c).lerp(new THREE.Color('#2b2f36'), amt).getHexString()
/** Mầm cây: xanh lá pha màu phòng ban – vẫn đọc được là "lá" */
const sproutOf = (c: string) => '#' + new THREE.Color('#7cc35a').lerp(new THREE.Color(c), 0.55).getHexString()

type Def = Omit<CharacterVariant, 'id' | 'suit' | 'accent' | 'sprout' | 'blush' | 'shirt' | 'pants' | 'shoes' | 'trim' | 'lapel'> &
  Partial<Pick<CharacterVariant, 'suit' | 'pants' | 'shoes' | 'trim'>>

const DEFS: Record<ThemeId, Def> = {
  ceo: { title: 'Trưởng lão Minh', skin: '#f1c9a5', hair: '#3a2a20', hairStyle: 'swept', iris: '#6b4a2b', neckwear: 'tie', accessory: 'circlet', suit: '#2c3445', trim: '#d9a93b' },
  legal: { title: 'Học giả Lan', skin: '#f6d5bd', hair: '#2a1f2e', hairStyle: 'ponytail', iris: '#7b55b8', neckwear: 'bow', accessory: 'roundGlasses' },
  finance: { title: 'Thủ quỹ Phúc', skin: '#e8b892', hair: '#1f1a17', hairStyle: 'neat', iris: '#2f7d55', neckwear: 'tie', accessory: 'coinPendant' },
  hr: { title: 'Người gác vườn Hà', skin: '#f3cdb0', hair: '#7a3f2a', hairStyle: 'bob', iris: '#b0573f', neckwear: 'scarf', accessory: 'flower' },
  sales: { title: 'Sứ giả Nam', skin: '#d9a07a', hair: '#1c1c22', hairStyle: 'spiky', iris: '#9a2e3a', neckwear: 'tie', accessory: 'earpiece' },
  marketing: { title: 'Thi sĩ Vy', skin: '#f5d3b8', hair: '#4a2c1f', hairStyle: 'bun', iris: '#c9782a', neckwear: 'scarf', accessory: 'beret' },
  engineering: { title: 'Thợ rèn Khoa', skin: '#e2ae88', hair: '#2b2622', hairStyle: 'messy', iris: '#2f6fd6', neckwear: 'tie', accessory: 'goggles' },
  support: { title: 'Người dẫn đường Chi', skin: '#f2c8a8', hair: '#3b2620', hairStyle: 'twinBuns', iris: '#1f8f84', neckwear: 'bow', accessory: 'headset' },
}

const SKINS = ['#f1c9a5', '#f6d5bd', '#e8b892', '#f3cdb0', '#d9a07a', '#f5d3b8', '#e2ae88', '#f2c8a8', '#c98e6a']
const HAIRS = ['#3a2a20', '#2a1f2e', '#1f1a17', '#7a3f2a', '#1c1c22', '#4a2c1f', '#2b2622', '#3b2620', '#8a5a2b', '#5b4636']
const IRIS = ['#6b4a2b', '#7b55b8', '#2f7d55', '#b0573f', '#9a2e3a', '#c9782a', '#2f6fd6', '#1f8f84']
const STYLES: HairStyle[] = ['swept', 'neat', 'spiky', 'messy', 'bob', 'ponytail', 'bun', 'twinBuns']

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/**
 * Ngoại hình theo mẫu phòng (phụ kiện, kiểu cổ áo) + màu của phòng ban.
 * Chế độ live: nhiều agent có thể dùng chung một mẫu → trộn da/tóc/mắt/kiểu tóc theo tên để mỗi người một vẻ.
 */
export function variantFor(dept: Department): CharacterVariant {
  const base = DEFS[dept.theme]
  const live = dept.id !== dept.theme
  const h = hash(dept.id)
  const d: Def = live
    ? {
        ...base,
        title: dept.agentName,
        skin: SKINS[h % SKINS.length],
        hair: HAIRS[(h >>> 4) % HAIRS.length],
        iris: IRIS[(h >>> 8) % IRIS.length],
        hairStyle: dept.theme === 'ceo' ? base.hairStyle : STYLES[(h >>> 12) % STYLES.length],
        suit: dept.theme === 'ceo' ? base.suit : undefined,
      }
    : base
  const color = dept.color
  return {
    id: dept.id,
    shirt: '#f6f3ee',
    pants: '#2e323a',
    shoes: '#4a3328',
    trim: '#e9e4da',
    blush: '#' + new THREE.Color(d.skin).lerp(new THREE.Color('#ff7a7a'), 0.35).getHexString(),
    ...d,
    suit: d.suit ?? suitOf(color),
    lapel: suitOf(d.suit ?? suitOf(color), 0.35),
    accent: color,
    sprout: sproutOf(color),
  }
}
