#!/usr/bin/env bash
# Deploy studio-manage lên VPS.
#
# Build ở máy local, VPS chỉ chạy: không docker build, không yarn install, không tsc
# trên VPS. Artifact được đẩy qua ssh (tar) và mount thẳng vào image gốc
# (nginx:1.27-alpine, node:20-alpine, mongo:7) — xem deploy/docker-compose.yml.
#
# Cách dùng:
#   ./deploy.sh                 build + deploy cả frontend lẫn backend
#   ./deploy.sh frontend        chỉ frontend (không downtime, không restart gì)
#   ./deploy.sh backend         chỉ backend (restart backend ~2s)
#   ./deploy.sh infra           chỉ đẩy deploy/docker-compose.yml + deploy/nginx.conf
#   ./deploy.sh --no-build      đẩy dist đang có, không build lại
#   ./deploy.sh --force-modules ép đẩy lại backend/node_modules
#
# Cấu hình: .deploy.env (copy từ .deploy.env.example). SSH bằng key.
# Không bao giờ ghi đè .env / backend/.env trên VPS.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; DIM=$'\033[2m'; OFF=$'\033[0m'
step() { printf '\n%s==> %s%s\n' "$BLUE" "$1" "$OFF"; }
ok()   { printf '%s  ✓ %s%s\n' "$GREEN" "$1" "$OFF"; }
info() { printf '%s    %s%s\n' "$DIM" "$1" "$OFF"; }
warn() { printf '%s  ! %s%s\n' "$YELLOW" "$1" "$OFF"; }
die()  { printf '\n%s✗ %s%s\n' "$RED" "$1" "$OFF" >&2; exit 1; }

# ── Tham số ──────────────────────────────────────────────────────────────────
DO_BUILD=1
FORCE_MODULES=0
TARGET=""
for arg in "$@"; do
  case "$arg" in
    --no-build)      DO_BUILD=0 ;;
    --force-modules) FORCE_MODULES=1 ;;
    fe|frontend)     TARGET="fe" ;;
    be|backend)      TARGET="be" ;;
    infra)           TARGET="infra" ;;
    all)             TARGET="all" ;;
    -h|--help)       sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)               die "Tham số không hiểu: $arg" ;;
  esac
done
TARGET="${TARGET:-all}"

want_fe=0; want_be=0
case "$TARGET" in
  all) want_fe=1; want_be=1 ;;
  fe)  want_fe=1 ;;
  be)  want_be=1 ;;
esac

# ── Cấu hình ─────────────────────────────────────────────────────────────────
[ -f "$ROOT/.deploy.env" ] || die "Thiếu .deploy.env — chạy: cp .deploy.env.example .deploy.env rồi điền thông tin VPS"
# shellcheck disable=SC1091
set -a; . "$ROOT/.deploy.env"; set +a

: "${VPS_HOST:?thiếu VPS_HOST trong .deploy.env}"
VPS_USER="${VPS_USER:-root}"
VPS_PORT="${VPS_PORT:-22}"
VPS_PATH="${VPS_PATH:-/opt/studio-manage}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-studio-manage}"
DOMAIN="${DOMAIN:-}"

STAGE="$ROOT/.deploy"
TMPD="$(mktemp -d)"
# Unix socket giới hạn 104 ký tự → để ở đường dẫn ngắn
CTL="$HOME/.ssh/sm-${COMPOSE_PROJECT}.sock"

cleanup() {
  ssh -O exit -S "$CTL" -p "$VPS_PORT" "$VPS_USER@$VPS_HOST" >/dev/null 2>&1 || true
  rm -rf "$TMPD"
}
trap cleanup EXIT

# ── Kết nối SSH (một connection dùng chung cho cả phiên) ─────────────────────
step "Kết nối VPS"
rm -f "$CTL"
ssh -M -S "$CTL" -o ControlPersist=30m -o ConnectTimeout=15 -o LogLevel=ERROR \
    -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
    -p "$VPS_PORT" -fN "$VPS_USER@$VPS_HOST" \
  || die "Không SSH được tới $VPS_USER@$VPS_HOST:$VPS_PORT bằng SSH key.
   Cấp key một lần: ssh-copy-id -p $VPS_PORT $VPS_USER@$VPS_HOST"
vps() { ssh -S "$CTL" -o LogLevel=ERROR -p "$VPS_PORT" "$VPS_USER@$VPS_HOST" "$@"; }
ok "Đã kết nối $VPS_USER@$VPS_HOST"

# ── Preflight ────────────────────────────────────────────────────────────────
step "Preflight"
FIRST_RUN=0
if ! vps "[ -f '$VPS_PATH/.env' ] && [ -f '$VPS_PATH/backend/.env' ]"; then
  FIRST_RUN=1
  warn "VPS chưa có $VPS_PATH/.env hoặc $VPS_PATH/backend/.env — sẽ chỉ đẩy file, chưa khởi động"
else
  ok "File .env trên VPS đầy đủ"
fi

# Vite nhúng VITE_* vào bundle lúc build → cảnh báo nếu có .env local trong frontend
if [ "$want_fe" = 1 ] && [ "$DO_BUILD" = 1 ] && ls frontend/.env* >/dev/null 2>&1; then
  warn "frontend/ có file .env — VITE_* sẽ bị NHÚNG CỨNG vào bundle production:"
  ls -1 frontend/.env* | sed 's/^/      /'
fi

# Deploy code chưa commit là nguồn lỗi khó truy vết → hỏi lại trước khi đẩy
dirty=""
[ "$want_fe" = 1 ] && [ -n "$(git -C frontend status --porcelain)" ] && dirty="$dirty frontend"
[ "$want_be" = 1 ] && [ -n "$(git -C backend status --porcelain)" ] && dirty="$dirty backend"
if [ -n "$dirty" ] && [ "$DO_BUILD" = 1 ]; then
  warn "Có thay đổi CHƯA COMMIT trong:$dirty — bản deploy sẽ gồm cả những thay đổi này."
  read -r -p "    Vẫn deploy? [y/N] " a; [ "$a" = y ] || die "Huỷ"
fi
info "frontend @ $(git -C frontend rev-parse --short HEAD) ($(git -C frontend rev-parse --abbrev-ref HEAD))"
info "backend  @ $(git -C backend rev-parse --short HEAD) ($(git -C backend rev-parse --abbrev-ref HEAD))"

# ── Build ────────────────────────────────────────────────────────────────────
if [ "$DO_BUILD" = 1 ] && [ "$TARGET" != "infra" ]; then
  step "Cài dependencies (yarn workspaces ở root)"
  yarn install --frozen-lockfile --non-interactive
  ok "Dependencies OK"

  if [ "$want_fe" = 1 ]; then
    step "Build frontend (vite build)"
    yarn --cwd frontend build
    [ -f frontend/dist/index.html ] || die "frontend/dist/index.html không tồn tại — build thất bại"
    ok "frontend/dist sẵn sàng ($(du -sh frontend/dist | cut -f1))"
  fi

  if [ "$want_be" = 1 ]; then
    step "Build backend (tsc)"
    yarn --cwd backend build
    [ -f backend/dist/app.js ] || die "backend/dist/app.js không tồn tại — build thất bại"
    ok "backend/dist sẵn sàng"

    # node_modules production dựng riêng trong .deploy/ để không đụng node_modules
    # dev của workspace (yarn --production sẽ xoá devDependencies).
    step "Dựng node_modules production cho backend"
    rm -rf "$STAGE/backend" && mkdir -p "$STAGE/backend"
    cp backend/package.json "$STAGE/backend/package.json"
    cp yarn.lock "$STAGE/backend/yarn.lock"
    ( cd "$STAGE/backend" && yarn install --production --ignore-scripts --non-interactive >/dev/null )

    # Native module (.node) biên dịch theo CPU/OS → không mang từ macOS arm64 sang VPS x86_64
    if find "$STAGE/backend/node_modules" -name '*.node' -print -quit | grep -q .; then
      die "Backend đã có native module (.node) — không mang được từ macOS arm64 sang VPS x86_64.
   Cần build trên linux/amd64 (vd. docker buildx) rồi mới đẩy."
    fi
    ok "node_modules production sạch, không native module ($(du -sh "$STAGE/backend/node_modules" | cut -f1))"
  fi
elif [ "$DO_BUILD" = 0 ]; then
  warn "Bỏ qua build (--no-build) — đẩy dist đang có sẵn"
fi

# ── Transport: tar over ssh ──────────────────────────────────────────────────
# push_dir <local-dir> <remote-dir>: giải nén vào thư mục tạm rồi tráo → cutover atomic
push_dir() {
  local src="$1" dst="$2" name
  name="$(basename "$src")"
  [ -d "$src" ] || die "Không có thư mục để đẩy: $src"
  tar --no-xattrs --no-mac-metadata -czf - -C "$(dirname "$src")" "$name" \
    | vps "set -e
        mkdir -p '$(dirname "$dst")'
        rm -rf '$dst.new' '$dst.old'
        mkdir -p '$dst.new'
        tar xzf - -C '$dst.new'
        if [ -e '$dst' ]; then mv '$dst' '$dst.old'; fi
        mv '$dst.new/$name' '$dst'
        rm -rf '$dst.new' '$dst.old'"
}

# push_file: ghi đè tại chỗ (giữ inode) — nginx.conf được bind-mount dạng file
push_file() {
  local src="$1" dst="$2"
  vps "mkdir -p '$(dirname "$dst")' && cat > '$dst'" < "$src"
}

step "Đẩy lên VPS ($VPS_PATH)"
vps "mkdir -p '$VPS_PATH/frontend' '$VPS_PATH/backend' '$VPS_PATH/backup' /var/www/certbot"
push_file deploy/docker-compose.yml "$VPS_PATH/docker-compose.yml"
push_file deploy/nginx.conf         "$VPS_PATH/nginx.conf"
ok "docker-compose.yml + nginx.conf"

if [ "$want_fe" = 1 ]; then
  # Compose mount thư mục cha ./frontend → /usr/share/nginx, nên bản build nằm ở
  # frontend/html. Mount cha để việc tráo thư mục html được nginx thấy ngay.
  rm -rf "$TMPD/html" && cp -R frontend/dist "$TMPD/html"
  push_dir "$TMPD/html" "$VPS_PATH/frontend/html"
  ok "frontend/html ($(du -sh frontend/dist | cut -f1))"
fi

if [ "$want_be" = 1 ]; then
  push_dir backend/dist "$VPS_PATH/backend/dist"
  # pdfkit đọc font ở src/assets/fonts → thiếu thư mục này là hỏng xuất PDF
  push_dir backend/src/assets "$VPS_PATH/backend/src/assets"
  push_file backend/package.json "$VPS_PATH/backend/package.json"
  ok "backend/dist + src/assets + package.json"

  # node_modules ~50MB, ít đổi → chỉ đẩy khi package.json/yarn.lock đổi
  NM_STAMP="$(cat backend/package.json yarn.lock | shasum -a 256 | cut -d' ' -f1)"
  NM_REMOTE="$(vps "cat '$VPS_PATH/backend/.node_modules.stamp' 2>/dev/null || true")"
  if [ "$FORCE_MODULES" = 1 ] || [ "$NM_STAMP" != "$NM_REMOTE" ]; then
    [ -d "$STAGE/backend/node_modules" ] || die "Chưa có $STAGE/backend/node_modules — bỏ --no-build để dựng"
    push_dir "$STAGE/backend/node_modules" "$VPS_PATH/backend/node_modules"
    vps "printf '%s' '$NM_STAMP' > '$VPS_PATH/backend/.node_modules.stamp'"
    ok "backend/node_modules ($(du -sh "$STAGE/backend/node_modules" | cut -f1))"
  else
    info "backend/node_modules không đổi → bỏ qua (dùng --force-modules để ép)"
  fi
fi

if [ "$FIRST_RUN" = 1 ]; then
  printf '\n%s' "$YELLOW"
  cat <<EOF
Lần deploy đầu: VPS chưa có file .env nên chưa khởi động container. Tạo rồi chạy lại:

  ssh $VPS_USER@$VPS_HOST
  cd $VPS_PATH
  (umask 077; printf 'MONGO_ROOT_PASSWORD=%s\n' "\$(openssl rand -hex 24)" > .env)
  vi backend/.env    # JWT_SECRET, JWT_EXPIRES_IN, TELEGRAM_*, GAS_* (xem backend/.env.example)
EOF
  printf '%s' "$OFF"
  exit 0
fi

# ── Khởi động lại ────────────────────────────────────────────────────────────
step "Khởi động lại service"
vps "bash -s" <<REMOTE_SCRIPT
set -e
cd "$VPS_PATH"
# -p ghim project name → luôn dùng đúng volume ${COMPOSE_PROJECT}_mongodb_data
dc() { docker compose -p "$COMPOSE_PROJECT" "\$@"; }
dc up -d --remove-orphans
if [ "$want_be" = 1 ]; then dc restart backend; fi
# nginx đọc file tĩnh qua mount → reload chỉ để ăn conf mới
dc exec -T frontend nginx -s reload >/dev/null 2>&1 || dc restart frontend
echo
dc ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}'
REMOTE_SCRIPT

# ── Kiểm chứng ───────────────────────────────────────────────────────────────
step "Kiểm chứng"
HTTPS_PORT="$(vps "grep -E '^HTTPS_PORT=' '$VPS_PATH/.env' | cut -d= -f2" || true)"
HTTPS_PORT="${HTTPS_PORT:-443}"
HOSTNAME_CHECK="${DOMAIN:-localhost}"
check() {
  vps "curl -sk -o /dev/null -w '%{http_code}' --max-time 10 \
    --resolve '$HOSTNAME_CHECK:$HTTPS_PORT:127.0.0.1' $* || echo 000"
}
HTTP_CODE="$(check "https://$HOSTNAME_CHECK:$HTTPS_PORT/")"
# Backend vừa restart cần vài giây để nối Mongo → thử lại tới ~20s trước khi báo lỗi
for _ in 1 2 3 4 5 6 7 8 9 10; do
  API_CODE="$(check "-X POST https://$HOSTNAME_CHECK:$HTTPS_PORT/api/auth/login")"
  case "$API_CODE" in 400|401|422) break ;; esac
  sleep 2
done
[ "$HTTP_CODE" = "200" ] && ok "frontend HTTPS $HTTP_CODE" || warn "frontend HTTPS $HTTP_CODE (mong đợi 200)"
case "$API_CODE" in
  400|401|422) ok "backend API $API_CODE (phản hồi qua nginx)" ;;
  *)           warn "backend API $API_CODE (502 = nginx không tới được backend)" ;;
esac

step "Xong"
if [ -n "$DOMAIN" ] && [ "$HTTPS_PORT" = 443 ]; then ok "https://$DOMAIN"; else ok "$VPS_HOST — HTTPS cổng $HTTPS_PORT"; fi
