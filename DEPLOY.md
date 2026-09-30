# Deploy studio-manage lên VPS

**Build ở máy local, VPS chỉ chạy.** VPS không build gì — không `docker build`, không
`yarn install`, không `tsc`. `deploy.sh` build ra artifact rồi đẩy qua ssh; trên VPS các
artifact được mount thẳng vào image gốc (`nginx:1.27-alpine`, `node:20-alpine`, `mongo:7`).

Không còn CI/CD tự động: deploy = chạy `./deploy.sh` từ máy local.

## Cấu trúc

| Local | Trên VPS (`VPS_PATH`, mặc định `/opt/studio-manage`) |
|---|---|
| `deploy/docker-compose.yml` | `docker-compose.yml` |
| `deploy/nginx.conf` | `nginx.conf` (HTTPS, proxy `/api` → backend, ACME webroot) |
| `frontend/dist/` | `frontend/html/` |
| `backend/dist`, `backend/src/assets`, node_modules production | `backend/…` |
| `.env.production` (gitignore) | `.env` — một file cho cả compose lẫn backend |

Env production chỉ đi qua lệnh `./deploy.sh env`; các lệnh deploy khác **không ghi** `.env`.
Xem mục [Env production](#env-production).
Mongo không publish cổng ra ngoài; dữ liệu nằm ở volume `studio-manage_mongodb_data`.

## Cài đặt lần đầu (máy local)

```bash
cp .deploy.env.example .deploy.env && chmod 600 .deploy.env
$EDITOR .deploy.env                         # VPS_HOST, DOMAIN, ...
ssh-copy-id root@<VPS_HOST>                 # script chỉ dùng SSH key
cp .env.production.example .env.production && chmod 600 .env.production
$EDITOR .env.production                     # MONGO_ROOT_PASSWORD, JWT_SECRET, TELEGRAM_* ...
./deploy.sh env                             # VPS mới: chỉ lưu env, chưa khởi động
./deploy.sh                                 # đẩy code + khởi động
```

## Deploy hằng ngày

```bash
./deploy.sh              # cả frontend + backend
./deploy.sh frontend     # chỉ frontend — tráo thư mục atomic, không downtime
./deploy.sh backend      # chỉ backend — restart ~2s
./deploy.sh infra        # chỉ đẩy compose + nginx.conf
```

Script hỏi lại nếu `frontend/` hoặc `backend/` còn thay đổi chưa commit, và kiểm chứng
sau deploy (trang chủ 200, `/api/auth/login` phản hồi qua nginx).

## Env production

`.env.production` ở máy local (bị gitignore, chmod 600) là nguồn duy nhất. Mẫu:
`.env.production.example`.

```bash
./deploy.sh env:pull    # lấy env đang chạy trên VPS về .env.production (lần đầu / đồng bộ lại)
$EDITOR .env.production
./deploy.sh env         # in key thêm/đổi/xoá (không in giá trị), hỏi xác nhận, rồi đẩy
```

`env` backup bản cũ vào `.env-backups/` trên VPS (chmod 700, giữ 10 bản), rồi
`docker compose up -d` — compose chỉ recreate service có env/cổng thay đổi, rồi kiểm tra API.
Nếu API lỗi, script in sẵn lệnh rollback đúng cho lần chạy đó.

- `MONGO_ROOT_PASSWORD` chỉ đặt một lần: đổi biến này không đổi mật khẩu trong DB đã có, nên
  script chặn.
- `MONGO_URI`, `NODE_ENV`, `PORT` của backend do `docker-compose.yml` đặt.
- Khi deploy thường, nếu `.env.production` khác VPS thì script chỉ cảnh báo, không tự đẩy.

## SSL

Domain đi qua Cloudflare (SSL mode **Full / Full (strict)**); origin dùng chứng chỉ
Let's Encrypt ở `/etc/letsencrypt/live/<domain>`, gia hạn bằng `certbot` (timer có sẵn)
theo kiểu **webroot** `/var/www/certbot` — nginx phục vụ `/.well-known/acme-challenge/`
ở cả cổng 80 và 443. Hook `/etc/letsencrypt/renewal-hooks/deploy/reload-studio-nginx.sh`
reload nginx sau khi gia hạn. Kiểm tra: `certbot renew --dry-run`.

## Backup / restore Mongo

```bash
# Backup trên VPS → /opt/studio-manage/backup/
ssh root@<VPS_HOST> 'cd /opt/studio-manage && . ./.env && docker exec studio-mongodb \
  mongodump -u admin -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin \
  --gzip --archive=/backup/studio-$(date +%F).archive.gz'

# Restore (ghi đè)
ssh root@<VPS_HOST> 'cd /opt/studio-manage && . ./.env && docker exec studio-mongodb \
  mongorestore -u admin -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin \
  --gzip --archive=/backup/<file>.archive.gz --drop'
```

## Vận hành

```bash
ssh root@<VPS_HOST>
cd /opt/studio-manage
docker compose -p studio-manage ps
docker compose -p studio-manage logs -f backend
```

Luôn truyền `-p studio-manage` — đổi project name thì compose sẽ tạo volume Mongo mới (DB rỗng).
