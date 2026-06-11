# Deploy studio-manage trên Synology NAS (nhánh `nas-dev`)

Nhánh này điều chỉnh cho NAS Synology, khác với `main` (dành cho VPS có HTTPS).

## Khác biệt so với `main`
- **MongoDB `4.4`** thay vì `7`: CPU NAS (Celeron/Atom) không hỗ trợ AVX, mongo 5+ crash `Illegal instruction`.
- **Healthcheck dùng `mongo`** thay vì `mongosh` (mongo 4.4 không có mongosh).
- **Frontend HTTP-only, port `8080`**: DSM đã giữ 80/443; bind-mount `nginx.nas.conf` (không SSL) đè config trong image, bỏ mount `/etc/letsencrypt`.

## Chạy
```bash
cd /volume1/NAS/code/studio-manage   # thư mục đã clone
git fetch origin
git checkout nas-dev
git pull

# tạo file .env ở thư mục gốc (KHÔNG có trong git)
echo 'MONGO_ROOT_PASSWORD=<mật-khẩu-mongo>' > .env
# và backend/.env theo nhu cầu backend

sudo docker compose up -d --build
sudo docker ps        # mongodb Healthy, backend + frontend Up
```

Truy cập: `http://<IP-NAS>:8080`

## HTTPS (tùy chọn, làm sau)
DSM → Control Panel → Login Portal → Advanced → **Reverse Proxy**:
- Source: `https://yumestudio.id.vn:443`
- Destination: `http://localhost:8080`

Rồi cấp Let's Encrypt cho domain ngay trong DSM (Control Panel → Certificate) — DSM tự gia hạn, không cần cert trong container.
