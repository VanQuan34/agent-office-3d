# Agent Office 3D

Văn phòng 3D hiển thị các **agent Claude Code** (và **Antigravity CLI**) của một project làm việc theo thời gian thực:
mỗi agent một phòng, agent chính mang hồ sơ sang phòng subagent khi giao việc, subagent làm xong mang kết quả về.

## Dùng với project thật

**Bước 1 – build một lần** (trong thư mục `D:\3d-agent`):

```
npm install
npm run build
```

**Bước 2 – chạy trong thư mục gốc của project cần xem:**

```
cd D:\projects\my-project
npx D:\3d-agent run
```

Trình duyệt tự mở `http://127.0.0.1:4317/`. Nhật ký bên phải nạp sẵn ~60 hoạt động gần nhất của phiên Claude Code
mới nhất, sau đó cập nhật theo thời gian thực khi bạn dùng Claude Code **trong chính project đó**.

> ⚠️ Chỉ gõ đúng lệnh, **không dán kèm chú thích** kiểu `# ...` phía sau – Command Prompt (cmd) không coi `#` là chú thích
> nên sẽ hiểu nhầm thành tên thư mục. (Từ bản này CLI tự bỏ qua phần sau dấu `#`, và báo lỗi nếu thư mục project không tồn tại.)

Cách khác:
- Cài thành lệnh toàn cục: chạy `npm link` trong `D:\3d-agent`, sau đó ở project bất kỳ gõ `agent-office run`
- Không dùng npx: `node D:\3d-agent\bin\agent-office.mjs run D:\projects\my-project`
- Đóng gói để chia sẻ: `npm pack` → file `agent-office-0.1.0.tgz`; người khác chạy `npx ./agent-office-0.1.0.tgz run`
- Sau khi sửa code giao diện phải `npm run build` lại; dừng server bằng `Ctrl+C` rồi chạy lại lệnh

| Lệnh | Tác dụng |
|---|---|
| `agent-office run [project]` | Mở văn phòng 3D, theo dõi live |
| `agent-office run --replay` | Phát lại phiên gần nhất có subagent (nén thời gian), rồi theo dõi live |
| `agent-office run --replay --session <id> --speed 8` | Phát lại một phiên cụ thể |
| `agent-office run --port 5000 --no-open` | Đổi cổng, không tự mở trình duyệt |
| `agent-office agents [project]` | In danh sách agent phát hiện được |
| `agent-office run --agy` / `--no-agy` | Bật / tắt phòng Antigravity (mặc định tự bật nếu project từng dùng `agy`) |

### Đọc dữ liệu từ đâu (chỉ đọc, không sửa gì trong project)

- **Danh sách agent**: `<project>/.claude/agents/*.md` (frontmatter `name`, `description`, `model`, `color`)
  + các agent từng chạy trong project (vd `general-purpose`, `Explore`, agent cấp user) lấy từ lịch sử transcript.
- **Hoạt động**: transcript Claude Code ở `~/.claude/projects/<project>/`:
  - `<session>.jsonl` – agent chính: prompt của bạn, các tool gọi, lệnh `Agent` giao việc
  - `<session>/subagents/agent-*.jsonl` + `.meta.json` – từng subagent, cờ `finished` khi chạy nền
- Server chỉ lắng nghe `127.0.0.1`, không gửi dữ liệu ra ngoài. Không cần cài hook hay sửa `settings.json`.

### Diễn giải hoạt động

| Trong Claude Code | Trong văn phòng |
|---|---|
| Bạn gửi prompt | Agent chính (phòng "Điều phối") nhận việc, ngồi làm; tiến độ tăng theo số lần gọi tool |
| Agent gọi tool (Read, Edit, Bash…) | Bong bóng trên đầu agent: `✏️ Edit layout.ts`, `⌨️ npm test`…, ghi vào nhật ký |
| Lệnh `Agent` / `Task` giao subagent | Agent chính đứng dậy mang hồ sơ sang phòng subagent; nhiều lệnh song song → đi lần lượt |
| Subagent xong (kết quả trả về / meta `finished`) | Subagent mang báo cáo về phòng Điều phối |
| Agent chính trả lời xong (`end_turn`) | Việc được đánh dấu hoàn tất |

### Antigravity CLI (`agy`)

Nếu bạn chat với agent bằng **Antigravity CLI** trong project, văn phòng có thêm phòng **antigravity**:

- **Phát hiện**: CLI đọc `~/.gemini/antigravity-cli/history.jsonl`, lấy các hội thoại có `workspace` trùng thư mục project.
  Phòng tự bật nếu project từng dùng `agy` (hoặc có agent nhắc tới agy/Antigravity); ép bằng `--agy`, tắt bằng `--no-agy`.
- **Hoạt động**: đọc `~/.gemini/antigravity-cli/brain/<hội thoại>/.system_generated/logs/transcript.jsonl`
  – `USER_INPUT` → nhận yêu cầu, `PLANNER_RESPONSE.tool_calls` (`read_file`, `edit_file`, `run_command`, `search_web`…)
  → bong bóng + nhật ký, phản hồi không còn tool → trả lời xong.
- **Nối với Claude Code**: khi một agent Claude Code chạy lệnh `agy …` (vd subagent dispatcher) rồi Antigravity nhận
  yêu cầu, agent đó mang hồ sơ sang phòng Antigravity; Antigravity trả lời xong → mang kết quả về **đúng agent đã gọi**.
- Chat trực tiếp với `agy` (không qua Claude Code) → Antigravity tự nhận và hoàn tất việc trong phòng của nó.
- Vẫn chỉ đọc file trên máy, không tốn token.

| Trong Antigravity CLI | Trong văn phòng |
|---|---|
| Bạn gửi yêu cầu cho `agy` | Nhân vật phòng antigravity nhận việc |
| `read_file` / `edit_file` / `write_file` / `run_command` / `search_web` | `📖 Read …`, `✏️ Edit …`, `⌨️ <mô tả lệnh>`, `🌐 Search …` |
| Trả lời xong | Việc hoàn tất (hoặc mang kết quả về agent Claude Code đã gọi `agy`) |

Văn phòng tự sinh theo số agent: 8 phòng thiết kế sẵn là "mẫu phòng", mỗi agent được gán mẫu theo tên/mô tả
(reviewer → thư viện, runner/test → kỹ thuật, figma/design → sáng tạo…), mẫu trùng sẽ lật gương; toà nhà nới dài theo số phòng.

### Xem nhật ký hoạt động

- **Cột "Hoạt động" (bên phải)**: mọi hoạt động của mọi agent, giờ thật (HH:MM:SS) – yêu cầu của bạn, tool được gọi,
  giao việc / nhận kết quả. Ở chế độ live, lúc mở sẽ nạp sẵn lịch sử gần nhất.
- **Nhật ký riêng một agent**: bấm tên agent ở cột trái (hoặc bấm vào nhân vật) → mục "Nhật ký" hiện 10 hoạt động gần nhất của agent đó.
- Thanh trên cùng: `● LIVE` (xanh) = đang nhận dữ liệu; `Phát lại` = đang chạy `--replay`; `Mất kết nối` = server CLI đã tắt.

### Khi không thấy hoạt động

| Hiện tượng | Nguyên nhân / cách xử lý |
|---|---|
| Tên project trên thanh trên cùng sai (vd `#`) | Lệnh bị dán kèm chú thích → chạy lại đúng `npx D:\3d-agent run` |
| Chỉ có 1 phòng "Điều phối" | Project chưa có `.claude/agents/*.md` và chưa từng gọi subagent – bình thường |
| Nhật ký trống, CLI in `Transcript: chưa có` | Project chưa từng chạy Claude Code; mở Claude Code trong project rồi gửi yêu cầu |
| Mở `localhost:5173` thấy Minh, Lan, Phúc… | Đó là `npm run dev` (chế độ mô phỏng), không phải bản live – mở `http://127.0.0.1:4317/` |
| `Cổng 4317 đang bận` | Đã có server cũ đang chạy → tắt cửa sổ đó (Ctrl+C) hoặc thêm `--port 4320` |
| Live không cập nhật | Kiểm tra bạn đang dùng Claude Code trong **đúng thư mục project** đã truyền cho lệnh `run` |

## Phát triển

```bash
npm run dev      # chế độ mô phỏng (dữ liệu giả lập) – http://localhost:5173
npm test         # test engine, bố cục live, đọc transcript
npm run build
```

### Cấu trúc
- `bin/agent-office.mjs` – CLI
- `server/` – quét agent (`discover.mjs`), đọc transcript Claude Code live/phát lại (`transcripts.mjs`),
  đọc Antigravity CLI (`antigravity.mjs`), HTTP + SSE (`http.mjs`)
- `src/sim/` – engine mô phỏng thuần TypeScript: bố cục (`layout.ts`), tìm đường A*, FSM agent
- `src/sources/` – nguồn sự kiện: `mockSource.ts` (giả lập), `liveSource.ts` (Activity thật → hành động)
- `src/scene/` – cảnh 3D (React Three Fiber), `src/character/` – nhân vật "Người Mầm" có rig
- `src/ui/` – HUD

## Chất lượng đồ hoạ
Tự chọn theo GPU (onboard → **Nhẹ**, card rời → **Cao**), đổi bằng nút trên thanh trên cùng.
Ghi đè qua URL: `?q=low`, `?q=high`, `?ao=0`, `?msaa=0`, `?stats` (hiện FPS).

## Nhân vật
Mở `?view=character` (hoặc nút **Nhân vật** trên HUD) để xem các nhân vật "Người Mầm", đổi tư thế và tải GLB có rig.

## Asset
Model/texture CC0 từ Poly Haven & ambientCG, đã nén sẵn – xem `public/ASSETS.md`.

Xem `PLAN.md` cho kế hoạch tổng thể.
