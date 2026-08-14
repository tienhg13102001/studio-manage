# Deploy studio-manage trên Synology NAS (nhánh `nas-dev`)

**Build ở máy local, NAS chỉ chạy.** NAS không build gì cả — không `docker build`, không
`yarn install`, không `tsc`. Máy local build ra artifact rồi đẩy qua ssh, NAS mount thẳng
vào image gốc (`nginx:1.27-alpine`, `node:20-alpine`).

Nhánh này khác `main` (dành cho VPS có HTTPS).

## Vì sao chạy được

- Backend **không có native module** nào (`bcryptjs`, `mongoose`, `pdfkit` đều pure JS),
  frontend chỉ ra file tĩnh → artifact build trên macOS arm64 chạy nguyên xi trên NAS x86_64.
  `deploy-nas.sh` chặn sẵn: nếu sau này lọt vào dependency có file `.node`, script dừng và báo
  chứ không đẩy lên rồi mới crash.
- Build local ~10s (vite 7s + tsc 2s), đẩy 13MB frontend qua ssh ~2s. So với build trên NAS
  (CPU Celeron) tính bằng nhiều phút.
- Frontend cutover **atomic, không downtime**. Backend restart ~2s.

## Khác biệt so với `main`

- **MongoDB `4.4`** thay vì `7`: CPU NAS (Celeron/Atom) không hỗ trợ AVX, mongo 5+ crash `Illegal instruction`.
- **Healthcheck dùng `mongo`** thay vì `mongosh` (mongo 4.4 không có mongosh).
- **Frontend HTTP-only, port `8090`**: DSM đã giữ 80/443; dùng `nginx.nas.conf` (không SSL),
  không mount `/etc/letsencrypt`.

## Cài đặt lần đầu (máy local)

```bash
cp .deploy.env.example .deploy.env
chmod 600 .deploy.env
$EDITOR .deploy.env       # host / user / port / NAS_PATH / password
```

Chạy lần đầu — script tạo thư mục trên NAS, đẩy artifact, rồi **dừng lại** (chưa khởi động
container) vì thiếu file `.env`:

```bash
./deploy-nas.sh
```

Tạo 2 file `.env` trên NAS. Chúng không nằm trong git và **không bao giờ bị deploy ghi đè**.
Nếu đang chuyển từ thư mục deploy cũ thì copy thẳng sang:

```bash
ssh <user>@<nas>
OLD=/volume1/<share>/code/studio-manage          # thư mục git clone cũ
NEW=/volume1/<share>/code/studio-manage-release  # = NAS_PATH
cp "$OLD/.env" "$NEW/.env"                       # MONGO_ROOT_PASSWORD
cp "$OLD/backend/.env" "$NEW/backend/.env"       # JWT_SECRET, PORT, TELEGRAM_*, GAS_* ...
```

Rồi chạy lại `./deploy-nas.sh` — lần này container mới thật sự khởi động.

> **Dữ liệu Mongo không mất khi đổi thư mục deploy.** Script luôn ghim `-p studio-manage`,
> nên compose tái sử dụng đúng volume `studio-manage_mongodb_data` và đúng bộ container đang
> chạy, dù `NAS_PATH` là thư mục mới. Kiểm tra trước bằng:
> `sudo docker volume ls | grep mongo` và
> `sudo docker inspect studio-mongodb --format '{{index .Config.Labels "com.docker.compose.project"}}'`
> — phải ra `studio-manage`.

## Deploy hằng ngày

```bash
./deploy-nas.sh                  # build + đẩy cả frontend & backend
./deploy-nas.sh fe               # chỉ frontend (nhanh nhất, không downtime)
./deploy-nas.sh be               # chỉ backend
./deploy-nas.sh infra            # chỉ đẩy docker-compose + nginx.nas.conf
./deploy-nas.sh --no-build fe    # đẩy dist đang có, bỏ qua bước build
./deploy-nas.sh --force-modules  # ép đẩy lại backend/node_modules
```

Truy cập: `http://<IP-NAS>:8090`

Script chạy tuần tự: mở 1 connection ssh dùng chung → preflight (`.env` trên NAS) →
`yarn build` → dựng `node_modules` production riêng trong `.deploy/` → đẩy artifact →
`docker compose up -d` + restart backend + `nginx -s reload` → curl kiểm chứng
frontend và API.

`backend/node_modules` (52MB) chỉ được đẩy lại khi `backend/package.json` hoặc `yarn.lock`
đổi — script so checksum với file `.node_modules.stamp` trên NAS.

## Vì sao dùng tar-over-ssh chứ không phải rsync

Đã thử rsync và vướng 2 chỗ trên đúng môi trường này:

1. **rsync trên Synology bị khoá sau công tắc DSM.** Chưa bật Control Panel → File Services →
   rsync thì mọi phiên đều chết với `rsync error: rsync service is no running (code 43)`,
   dù `command -v rsync` vẫn thấy `/usr/bin/rsync`.
2. **macOS mặc định là `openrsync`**, không phải GNU rsync. Nó bỏ qua cả `-e` lẫn `RSYNC_RSH`
   nên không ghép được ssh tuỳ biến (multiplexing / askpass).

`tar` + `ssh` có sẵn ở cả hai đầu, không cần bật gì thêm. Đổi lại là không có delta transfer —
chấp nhận được vì Vite đặt tên file theo content hash nên phần lớn bundle đổi mỗi lần build,
delta cũng không tiết kiệm được bao nhiêu.

## Xác thực SSH

DSM có thể đang **tắt user home service** (`/var/services/homes` trỏ tới `@fake_home_link`).
Khi đó không tồn tại `~/.ssh/authorized_keys` để đặt SSH key → phải dùng `NAS_SSH_PASSWORD`.
Script đưa mật khẩu qua `SSH_ASKPASS` (không lộ trong `ps`) và mở **một** connection ssh
multiplexed dùng chung cho toàn bộ phiên deploy, nên chỉ xác thực đúng 1 lần.

Muốn chuyển sang SSH key: DSM → Control Panel → User & Group → Advanced → User Home →
"Enable user home service", rồi `ssh-copy-id`, rồi để trống `NAS_SSH_PASSWORD`.

Login shell in ra `Could not chdir to home directory ...` mỗi lần ssh khi home service tắt —
vô hại, script đã lọc riêng dòng đó.

## Cấu trúc trên NAS

```
$NAS_PATH/
├── docker-compose.yml       ← đẩy từ docker-compose.nas.yml
├── nginx.nas.conf           ← đẩy
├── .env                     ← TẠO TAY, không bị đè (MONGO_ROOT_PASSWORD)
├── frontend/
│   └── html/                ← nội dung frontend/dist
└── backend/
    ├── package.json
    ├── dist/
    ├── node_modules/        ← production deps, dựng từ .deploy/
    ├── src/assets/          ← font Roboto cho pdfkit
    ├── .node_modules.stamp  ← checksum để bỏ qua lần đẩy thừa
    └── .env                 ← TẠO TAY, không bị đè
```

Hai chi tiết dễ sai, đã xử lý sẵn:

- **Thư mục frontend tên `html`, và compose mount thư mục CHA** (`./frontend` →
  `/usr/share/nginx`). Deploy tráo nguyên thư mục để cutover atomic, mà bind-mount gắn theo
  inode — nếu mount thẳng vào thư mục bị tráo thì container vẫn phục vụ nội dung CŨ. Mount cha
  thì nginx nhìn xuyên qua, thấy ngay bản mới. Tên `html` để khớp `root /usr/share/nginx/html`
  nên `nginx.nas.conf` không cần sửa gì.
- **`backend/src/assets` bắt buộc phải có.** `scheduleController.ts` nạp font qua
  `__dirname/../../src/assets/fonts/*.ttf`, từ `dist/controllers/` ra `/app/src/assets/fonts/`.
  Image cũ chỉ `COPY dist` nên xuất PDF lịch chụp bị thiếu font — cách deploy này sửa luôn.

## Submodule

`frontend` và `backend` vẫn là git submodule, nhưng **deploy không còn phụ thuộc git** —
script build từ đúng working tree đang mở rồi đẩy thẳng lên NAS. Muốn deploy code nào thì
checkout code đó ở local. Nhớ commit/push submodule sau khi deploy để repo không lệch với bản
đang chạy.

## Không còn CI deploy NAS

`./deploy-nas.sh` từ máy local là **cách duy nhất** để deploy lên NAS. Đường build-trên-NAS
đã bị xoá hẳn khỏi nhánh này:

- `.github/workflows/deploy-nas.yml` — workflow SSH vào NAS chạy `docker compose up -d --build`
- `docker-compose.yml` ở root — compose dạng `build:`, thay bằng `docker-compose.nas.yml`

Hệ quả cần nhớ: **push code lên không deploy gì cả.** Push chỉ để lưu code; muốn lên NAS thì
chạy `./deploy-nas.sh`.

`.github/workflows/deploy.yml` vẫn còn nhưng chỉ chạy khi push `main` để deploy **VPS** — không
đụng tới NAS. `Dockerfile` trong 2 submodule cũng giữ nguyên vì đường VPS còn dùng.

## HTTPS (tùy chọn)

DSM → Control Panel → Login Portal → Advanced → **Reverse Proxy**:

- Source: `https://yumestudio.id.vn:443`
- Destination: `http://localhost:8090`

Rồi cấp Let's Encrypt cho domain ngay trong DSM (Control Panel → Certificate) — DSM tự gia hạn,
không cần cert trong container.
