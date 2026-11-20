# Plan: Web 3D mô phỏng văn phòng AI Agent

## 1. Mục tiêu

Một trang web 3D hiển thị văn phòng chuyên nghiệp. Mỗi **agent đại diện cho 1 phòng ban**. Agent:
- Có nhân vật 3D, có animation (đứng, đi, ngồi gõ phím, nói chuyện, cầm tài liệu, uống cà phê)
- Tự di chuyển trong văn phòng (tìm đường tránh vật cản)
- Thực hiện công việc theo luồng nghiệp vụ: nhận task → xử lý ở bàn → mang kết quả sang phòng ban khác → họp...
- Người xem có thể click vào agent/phòng ban để xem trạng thái, log, task đang làm

## 2. Tech stack đề xuất

| Hạng mục | Lựa chọn | Lý do |
|---|---|---|
| Build | Vite + React + TypeScript | Nhanh, phổ biến |
| 3D | three.js qua **@react-three/fiber** + **@react-three/drei** | Viết scene dạng component, có sẵn helper (GLTF, camera, Html label, Environment) |
| Hậu kỳ | @react-three/postprocessing | SSAO, bloom nhẹ, tone mapping cho cảm giác "văn phòng thật" |
| State | zustand | Nhẹ, đọc được từ cả React UI lẫn render loop |
| Tìm đường | A* trên lưới (tự viết, ~100 dòng) → nâng cấp lên navmesh (`recast-navigation-js`) nếu cần | Văn phòng phẳng 1 tầng, lưới là đủ cho MVP |
| Tween/UI anim | framer-motion (UI 2D), lerp/slerp trong `useFrame` (3D) | |
| Asset 3D | Văn phòng low-poly CC0 (Kenney Furniture Kit, KayKit, Quaternius) hoặc tự dựng trong Blender; nhân vật rigged + animation từ Mixamo / Quaternius | Miễn phí, license rõ ràng |
| Nén asset | gltf-transform (Draco/Meshopt + KTX2) | Giảm dung lượng tải |
| Kết nối backend (giai đoạn sau) | WebSocket | Nhận event từ agent thật |

## 3. Bố cục văn phòng (gợi ý 8 phòng ban)

```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│  Ban Giám đốc│   Pháp chế   │   Tài chính  │   Nhân sự    │
│  (CEO/Điều   │   (Legal)    │  (Finance)   │    (HR)      │
│   phối)      │              │              │              │
├──────────────┴───────┬──────┴──────────────┴──────────────┤
│   Phòng họp lớn      │        Hành lang / Lễ tân          │
│   (Meeting room)     │   Pantry ☕   Máy in 🖨  Bảng trắng │
├──────────────┬───────┴──────┬──────────────┬──────────────┤
│   Kinh doanh │   Marketing  │   Kỹ thuật   │  CSKH        │
│   (Sales)    │              │ (Engineering)│  (Support)   │
└──────────────┴──────────────┴──────────────┴──────────────┘
```

Mỗi phòng ban có: bàn làm việc + ghế (điểm "ngồi làm"), biển tên + màu nhận diện, màn hình hiển thị trạng thái, khay "inbox" (điểm nhận/giao tài liệu).
Khu chung: phòng họp, pantry, máy in, bảng trắng → làm điểm đến cho hành vi phụ.

Layout được mô tả bằng **file JSON** (vị trí zone, bàn, waypoint, vật cản) để thay đổi không cần sửa code.

## 4. Kiến trúc

Tách bạch **Simulation (logic thuần TS)** và **Rendering (3D)** → logic test được, sau này thay nguồn dữ liệu (mock ↔ agent thật) không ảnh hưởng 3D.

```
┌───────────────────────────────────────────────────────────┐
│ Event Source (adapter)                                    │
│   MockScenarioSource  |  WebSocketSource (agent thật)     │
└──────────────┬────────────────────────────────────────────┘
               │ events: task_created, task_assigned,
               │ task_progress, handoff, meeting, done...
┌──────────────▼────────────────────────────────────────────┐
│ Simulation Engine (pure TS, tick cố định 10 Hz)           │
│  - TaskQueue / Workflow        - Agent FSM               │
│  - Scheduler (hành vi phụ)     - Pathfinding (A*)         │
│  - Reservation (ghế, phòng họp không bị chiếm trùng)      │
└──────────────┬────────────────────────────────────────────┘
               │ snapshot state (zustand store)
┌──────────────▼──────────────────┐  ┌──────────────────────┐
│ 3D Scene (R3F)                  │  │ UI 2D (React)        │
│  Office, Lighting, Camera       │  │  Panel phòng ban     │
│  AgentAvatar: nội suy vị trí,   │  │  Feed hoạt động      │
│  chọn clip animation theo state │  │  Điều khiển tốc độ   │
│  Bong bóng chat, icon task      │  │  Minimap, KPI        │
└─────────────────────────────────┘  └──────────────────────┘
```

### Cấu trúc thư mục

```
src/
  app/            # App shell, layout UI, routing
  ui/             # Panel, ActivityFeed, SpeedControl, Minimap
  scene/          # OfficeScene, Lighting, CameraRig, Props
  agents/         # AgentAvatar, AnimationController, SpeechBubble, TaskIcon
  sim/            # engine.ts, fsm.ts, pathfinding.ts, scheduler.ts, workflow.ts
  sources/        # mockSource.ts, wsSource.ts (interface EventSource)
  data/           # departments.ts, office-layout.json, scenarios/*.json
  store/          # zustand stores
public/models/    # *.glb đã nén
```

## 5. Hệ thống Agent

### 5.1 State machine (FSM)

```
Idle ──► WalkingTo(target) ──► Arrived ──► (tùy target)
  ▲                                         ├─ WorkingAtDesk (ngồi + gõ phím, progress bar)
  │                                         ├─ Handoff (đưa tài liệu cho agent khác)
  │                                         ├─ InMeeting (ngồi phòng họp, nói luân phiên)
  │                                         ├─ OnBreak (pantry, uống cà phê)
  │                                         └─ Presenting (đứng ở bảng trắng)
  └─────────────── khi xong ────────────────┘
```

Mỗi state map tới 1 clip animation: `Idle`, `Walk`, `Sit`, `Typing`, `Talk`, `Carry`, `Drink`, `Point`. Chuyển clip bằng **crossfade 0.3s** để mượt.

### 5.2 Di chuyển
- Lưới 0.5m phủ sàn, đánh dấu ô bị chặn từ layout JSON → A* → làm mượt đường (string pulling) → đi theo spline.
- Xoay người mượt hướng về phía di chuyển (slerp).
- Tránh va chạm giữa agent: đơn giản là "đặt chỗ" ô kế tiếp + chờ ngắn; nâng cao dùng steering/RVO.
- Đi vào ghế: điểm "approach" trước ghế → xoay → phát animation ngồi.

### 5.3 Luồng công việc (ví dụ kịch bản mock)
1. **CSKH** nhận yêu cầu khách hàng → mang ticket sang **Kỹ thuật**
2. **Kinh doanh** chốt deal → gửi hợp đồng sang **Pháp chế** → duyệt xong chuyển **Tài chính** xuất hóa đơn
3. **Marketing** lên chiến dịch → họp với **Kinh doanh** + **Ban Giám đốc** ở phòng họp
4. **Nhân sự** đi quanh các phòng (onboarding, khảo sát)
5. Hành vi phụ ngẫu nhiên có trọng số: cà phê, in tài liệu, nói chuyện ngắn ở hành lang

Kịch bản viết bằng JSON (`data/scenarios/*.json`) để thêm/đổi không cần code.

### 5.4 Thể hiện trực quan
- Bong bóng hội thoại / icon trên đầu (📄 đang làm, 💬 đang họp, ☕ nghỉ, ✅ xong)
- Thanh tiến độ trên màn hình máy tính của bàn
- Tài liệu/thư mục 3D cầm trên tay khi handoff
- Đường bay (arc) phát sáng giữa 2 phòng ban khi có trao đổi
- Đèn/màn hình phòng ban đổi màu theo tải công việc

## 6. Camera & tương tác
- Mặc định: góc nhìn isometric từ trên xuống (OrbitControls giới hạn góc + zoom)
- Click agent → camera bay tới, theo dõi agent (follow mode); Esc để thoát
- Click phòng ban → panel bên phải: thành viên, task đang làm, lịch sử
- Thanh điều khiển: Pause / 1x / 2x / 5x, chọn kịch bản, bật/tắt label
- Activity feed: log thời gian thực "10:32 – Sales gửi hợp đồng #12 cho Legal"
- (Tùy chọn) chu kỳ ngày/đêm theo giờ mô phỏng, đèn văn phòng tự bật

## 7. Chất lượng hình ảnh "văn phòng chuyên nghiệp" & hiệu năng
- Phong cách: low-poly sạch, tông trung tính (trắng/xám/gỗ), mỗi phòng ban 1 màu nhấn
- Ánh sáng: **bake lightmap/AO trong Blender** cho đồ tĩnh + 1 directional light cho bóng nhân vật → đẹp mà nhẹ
- Environment HDRI nhẹ cho phản chiếu; SSAO + bloom rất nhẹ; ACES tone mapping
- Instancing cho đồ lặp lại (bàn, ghế, cây, màn hình)
- Nén GLB (Meshopt/Draco + KTX2), tổng asset mục tiêu < 15 MB
- Dùng chung 1 skeleton + 1 bộ animation cho mọi nhân vật, khác nhau ở màu/phụ kiện
- `frameloop` hợp lý, giới hạn DPR, LOD/ẩn label khi zoom xa
- Mục tiêu: 60 FPS trên laptop tầm trung, ~10–30 agent

## 8. Lộ trình triển khai

| Giai đoạn | Nội dung | Kết quả | Ước lượng |
|---|---|---|---|
| **P0 – Setup** | Vite + R3F + TS, ESLint, cấu trúc thư mục, pipeline nén asset | Scene trống chạy được | 1–2 ngày |
| **P1 – Văn phòng tĩnh** | Dựng/ghép layout, ánh sáng, camera, biển tên phòng ban, layout JSON | Văn phòng nhìn đẹp, xoay/zoom được | 3–5 ngày |
| **P2 – Agent & di chuyển** | Load nhân vật + animation, AnimationController crossfade, A* pathfinding, ngồi vào ghế | Agent đi lại giữa các điểm mượt | 4–5 ngày |
| **P3 – Simulation engine** | FSM, task/workflow, scheduler hành vi phụ, reservation, kịch bản mock | Văn phòng "sống", các phòng ban phối hợp | 4–5 ngày |
| **P4 – UI/UX** | Panel phòng ban, activity feed, follow camera, speed control, bong bóng, đường trao đổi | Trải nghiệm hoàn chỉnh | 3–4 ngày |
| **P5 – Polish & tối ưu** | Bake lighting, postprocessing, âm thanh nền văn phòng, tối ưu FPS, responsive | Bản demo | 3–4 ngày |
| **P6 – (Tùy chọn) Agent thật** | WebSocket adapter nhận event từ hệ thống multi-agent (LLM) thật; replay log | Hiển thị agent thật đang chạy | 3–5 ngày |

**MVP (P0–P3 + phần cơ bản P4): ~3 tuần cho 1 dev.**

## 9. Hợp đồng event (để sau cắm agent thật)

```ts
type SimEvent =
  | { type: 'task_created';  taskId: string; dept: DeptId; title: string }
  | { type: 'task_progress'; taskId: string; dept: DeptId; progress: number }
  | { type: 'handoff';       taskId: string; from: DeptId; to: DeptId; payload?: string }
  | { type: 'meeting';       meetingId: string; room: string; participants: DeptId[]; topic: string }
  | { type: 'message';       from: DeptId; to?: DeptId; text: string }
  | { type: 'task_done';     taskId: string; dept: DeptId };
```
Mock source và WebSocket source đều phát cùng kiểu event này → engine không cần biết nguồn.
Engine tự lo "diễn" event thành hành động (đi tới, ngồi, nói…), kể cả khi event đến dồn dập (xếp hàng theo agent).

## 10. Rủi ro & cách xử lý

| Rủi ro | Giảm thiểu |
|---|---|
| Asset không đồng bộ phong cách | Chọn 1 bộ kit chính, chỉ đổi màu vật liệu |
| Animation bị trượt chân khi đi | Đồng bộ tốc độ di chuyển với tốc độ clip walk; dùng in-place animation |
| Agent kẹt/đè nhau | Reservation ô lưới + timeout tìm đường lại |
| FPS thấp | Bake lighting, instancing, tắt shadow đồ tĩnh, giới hạn DPR |
| Event thật đến quá nhanh | Hàng đợi hành động mỗi agent + tăng tốc animation/bỏ qua bước phụ |

## 11. Quyết định đã chốt (2026-11-20)
1. **Nguồn dữ liệu:** giai đoạn đầu chạy **giả lập (MockSource)**. Sau này map vào project thực qua adapter cùng hợp đồng event ở mục 9 → giữ engine độc lập với nguồn dữ liệu.
2. **Nhân vật:** **mỗi phòng ban 1 nhân vật** (8 agent).
3. **Đồ họa: bán thực tế.** Hệ quả:
   - Vật liệu PBR (gỗ, thảm, kính, kim loại) – texture CC0 từ Poly Haven / ambientCG; HDRI văn phòng cho phản chiếu
   - Nội thất: model CC0 Poly Haven + Sketchfab (CC-BY, ghi nguồn) hoặc dựng Blender; bake lightmap/AO trong Blender
   - Nhân vật: model người bán thực tế có rig chuẩn Mixamo (cùng skeleton) + animation Mixamo (Idle, Walk, Sit, Typing, Talk, Carry, Drink, Point)
   - Kính trong suốt cho vách phòng ban (MeshPhysicalMaterial transmission tiết kiệm), shadow mềm, SSAO
   - Code dùng **hệ "asset slot"**: chạy được ngay với geometry placeholder, thả file GLB vào `public/models/` là tự thay thế
4. **Thiết bị:** **desktop** là chính (cho phép shadow/postprocessing chất lượng cao hơn).
5. (Còn mở) Nhúng vào sản phẩm sẵn có hay site độc lập – mặc định site độc lập, đóng gói được thành component sau.

## 12. Tiến độ

### 2026-11-20 – P0 xong, P1–P3 ở mức placeholder
- [x] Khung dự án: Vite + React 19 + TS + R3F + drei + postprocessing + zustand + vitest
- [x] Layout văn phòng 8 phòng ban + phòng họp + sảnh + máy in + pantry (`src/sim/layout.ts`)
- [x] Tìm đường A* lưới 0.5m + làm mượt đường (`src/sim/navgrid.ts`)
- [x] Engine: FSM agent, backlog task, bàn giao hồ sơ, họp (hàng đợi phòng họp), hành vi rảnh (cà phê, in, lấy nước)
- [x] MockSource: 6 workflow nghiệp vụ + họp giao ban; hợp đồng `SimEvent`/`EngineNotice` sẵn cho backend thật
- [x] Cảnh 3D: tường kính khung nhôm, tường tự hạ khi che camera, nội thất dựng bằng khối, ánh sáng + bóng + AO + bloom
- [x] Nhân vật placeholder có animation thủ tục (đi, mang hồ sơ, ngồi, gõ phím, nói, uống cà phê)
- [x] HUD: giờ mô phỏng, KPI, tốc độ 0/1/2/5x, panel phòng ban, nhật ký, camera bám theo agent
- [x] Test engine: đường tới mọi điểm, chạy 20 phút mô phỏng không kẹt, có việc hoàn tất

### 2026-11-20 – Nội thất bán thực tế + tối ưu GPU onboard
- [x] 17 model CC0 Poly Haven (kệ, ghế bành, bàn tròn, sofa, bàn trà, 3 loại cây, ghế bar, đồng hồ, tranh, đèn bàn, tủ gỗ, lọ hoa) – nén meshopt + WebP, tổng 3.5 MB (`public/ASSETS.md`)
- [x] Vật liệu PBR 1K: sàn laminate, thảm (ambientCG), mặt bàn sồi trắng, bàn họp óc chó, tường trát vữa, mặt đá marble pantry – 2.5 MB
- [x] Bàn làm việc + ghế xoay vẫn dựng thủ tục (model CC0 sẵn có mang phong cách cổ điển), nâng vật liệu PBR
- [x] `MergeStatic`: gộp toàn bộ hình tĩnh theo vật liệu → draw call 2.045 → ~440
- [x] Đổi vật liệu MeshPhysical (KHR transmission của kính khung tranh/đồng hồ) → Standard: bỏ 1 lần render toàn cảnh thừa mỗi frame
- [x] Preset chất lượng tự chọn theo GPU (`src/quality.ts`), nút Cao/Nhẹ trên HUD, override qua URL (`?q=low`, `?ao=0`, `?stats`)
- Kết quả đo trên Intel UHD 630 @1600×900: **Nhẹ = 60 FPS** (trước tối ưu ~9–16 FPS); Cao ≈ 24 FPS (AO là phần tốn nhất → dành cho card rời)

### 2026-11-20 – Nhân vật "Người Mầm" (Sprigling)
- [x] Nhân vật hoạt hình gốc dựng hoàn toàn bằng code (`src/character/`): tộc tiên rừng tai lá, mắt to, mầm cây trên đầu mang màu phòng ban
- [x] Rig thật: SkinnedMesh + 18 xương humanoid (tên chuẩn), bind ở A-pose, trọng số skin trộn mượt ở vai/khuỷu/gối; 2 vật liệu (lì + bóng) → 2 draw call/nhân vật
- [x] 8 biến thể công sở fantasy: kiểu tóc + phụ kiện riêng (vòng lá vàng, kính tròn, mặt dây đồng xu, hoa cài, tai nghe, mũ nồi, kính bảo hộ, headset)
- [x] Animation thủ tục chuyển sang điều khiển xương (đi, mang hồ sơ, ngồi, gõ phím, nói, uống cà phê)
- [x] Trang xem mẫu `?view=character`: nền trắng studio, AO, bóng tiếp xúc, xoay 360°, xem cả 8, **xuất GLB có rig** (~38k tam giác)
- Văn phòng vẫn 60 FPS trên Intel UHD 630 (preset Nhẹ)

### 2026-11-20 – Bố cục riêng cho từng phòng
- [x] Phòng khác kích thước (dãy bắc 10.5 | 7.5 | 9 | 9 m, dãy nam 9 | 10 | 10 | 7 m), cửa đặt lệch, sàn riêng (gỗ óc chó, gỗ sồi, thảm sáng/tối)
- [x] 5 kiểu bàn: giám đốc (gỗ liền khối + ghế da), tiêu chuẩn, 2 màn hình, quầy tiếp nhận, bàn sáng tạo
- [x] Nội thất theo chức năng: tủ hồ sơ + két sắt (Tài chính), tủ server + bàn thợ (Kỹ thuật), ghế lười + moodboard (Marketing), bàn họp khách (Kinh doanh), thư viện (Pháp chế), góc sofa (Giám đốc, Nhân sự), góc chờ (CSKH)
- [x] Toàn bộ khai báo bằng dữ liệu trong `src/sim/layout.ts` (`DEFS` → `items`); vật cản tìm đường tự sinh từ đó

### 2026-11-20 – Đóng gói CLI, đọc agent Claude Code thật (P6)
- [x] CLI `agent-office run|agents` (Node thuần, không dependency lúc chạy), `--replay`, `--session`, `--speed`, `--port`
- [x] Khám phá agent: `.claude/agents/*.md` + agent từng chạy (meta.json trong transcript) + agent chính
- [x] Đọc transcript `~/.claude/projects/<project>/` theo thời gian thực (polling, chỉ đọc phần ghi thêm), hỗ trợ subagent chạy nền
- [x] Văn phòng tự sinh theo số agent: 8 phòng thiết kế tay thành mẫu phòng, gán theo từ khoá, lật gương khi trùng, toà nhà nới dài
- [x] `ActivityMapper`: prompt / tool / giao việc / kết quả / kết thúc lượt → hành động trong văn phòng
- [x] Kiểm chứng trên một project thật (13 agent, phát lại phiên có subagent) và live trên chính phiên đang chạy
- [x] 19 test (engine, bố cục 1/6/14 agent, ánh xạ hoạt động, dịch transcript, watcher live)

### 2026-11-20 – Hỗ trợ Antigravity CLI + sửa lỗi nhật ký
- [x] `server/antigravity.mjs`: đọc `~/.gemini/antigravity-cli` (history.jsonl → hội thoại theo workspace, transcript từng hội thoại), live + phát lại + nạp lịch sử
- [x] Phòng "antigravity" tự bật khi project từng dùng `agy`; `--agy` / `--no-agy`
- [x] Nối Claude Code → Antigravity: lệnh Bash gọi `agy` + prompt Antigravity ngay sau → diễn như giao việc, kết quả trả về đúng agent đã gọi
- [x] Sửa lỗi: watcher đọc lại từ đầu các transcript cũ > 12h → lịch sử bị diễn lại như live với giờ sai
- [x] Nhật ký: giờ thật, nhật ký riêng từng agent, gợi ý khi trống; CLI bỏ qua `# chú thích` lỡ dán vào lệnh
- [x] 30 test

### Việc tiếp theo
- [ ] Tinh chỉnh nhân vật: đường nối ở khuỷu/gối, biểu cảm (chớp mắt, khẩu hình khi nói)
- [ ] (Tuỳ chọn) Thay bằng GLB từ công cụ ngoài – giữ đúng tên xương ở `src/character/rig.ts` để dùng lại animation
- [ ] Bake lightmap/AO cho nội thất tĩnh
- [ ] Tránh va chạm giữa các agent
- [ ] P6: `WebSocketSource` khi map vào project thực
