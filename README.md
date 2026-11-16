# aoe1web

Bản làm lại Age of Empires 1 chạy trên trình duyệt (nhắm tới AoE1 + Rise of Rome 1.0a): lockstep tất định, phòng 2 người chơi vào bằng mã mời. TypeScript monorepo (npm workspaces), Node >= 24.

*English: a browser remake of Age of Empires 1, deterministic lockstep, 2-player rooms joined by invite code. This repository contains **no original game files**: you must own AoE1 / Rise of Rome and import the assets from your own install.*

## Không có file gốc của game

Repo này không chứa bất kỳ file nào của game gốc (`empires.dat`, `.drs`, `.slp`, `.wav`, `.mid`, bảng màu...). Bạn phải sở hữu bản AoE1 / Rise of Rome hợp lệ. Công cụ import sẽ đọc từ thư mục cài đặt của bạn và tạo "pack" trong `assets-local/pack/` (đã gitignore, ~100 MB). `npm run check` có guard từ chối mọi file game bị track.

## Import asset từ bản cài của bạn

```sh
npm ci
AOE1_DIR="<thư mục cài AoE1>" npm run assets:import
```

Pack gồm `empires.dat`, đồ họa (DRS/SLP + palette), âm thanh wav, nhạc mid. Nhạc cần một sound bank General MIDI: đặt `MUSIC_BANK=<file .dls/.sf2>`, nếu không sẽ dùng bank của hệ điều hành.

## Chạy local (dev)

```sh
npm run dev
```

Server ở `:8787` (env `PORT`), client ở `:5173` (env `CLIENT_PORT`). Mở hai tab, một người tạo phòng, người kia nhập mã mời.

## Build và chạy production

```sh
npm run build
PORT=8790 ASSETS_DIR=assets-local/pack npm run start
```

Một origin duy nhất: server phục vụ client ở `/`, pack ở `/assets/*`, `/health` và relay WebSocket `/ws`. Cần các thư mục: `apps/client/dist` (`CLIENT_DIR`), `apps/server/dist` và pack (`ASSETS_DIR`). Kiểm tra: `npm run test:e2e:prod`.

## Deploy

Xem [docs/deploy.md](docs/deploy.md) (systemd + Cloudflare tunnel; token tunnel chỉ nằm trên VM, không có trong git).

## Kiểm tra

`npm run check` (guard file, ESLint, typecheck, unit test). Xem thêm `AGENTS.md` và `docs/spec/`.

## Ghi công và bản quyền

Age of Empires do Ensemble Studios làm ra. "Age of Empires" là nhãn hiệu của Microsoft. Dự án này không liên kết hay được Microsoft / Ensemble Studios bảo trợ; nó là sản phẩm của người hâm mộ, không kèm tài sản của game gốc.

*Credits: Age of Empires by Ensemble Studios; Age of Empires is a trademark of Microsoft.*
