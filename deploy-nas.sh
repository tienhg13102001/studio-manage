#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Deploy studio-manage lên NAS: BUILD Ở MÁY LOCAL, NAS chỉ chạy.
#
#   ./deploy-nas.sh                  # build + đẩy frontend & backend
#   ./deploy-nas.sh fe               # chỉ frontend
#   ./deploy-nas.sh be               # chỉ backend
#   ./deploy-nas.sh infra            # chỉ compose + nginx conf
#   ./deploy-nas.sh --no-build fe    # đẩy dist đang có, bỏ qua bước build
#   ./deploy-nas.sh --force-modules  # ép đẩy lại backend/node_modules
#
# Cấu hình: `.deploy.env` (xem .deploy.env.example).
#
# Vì sao build local chạy được trên NAS: backend không có native module nào
# (bcryptjs / mongoose / pdfkit đều pure JS), frontend chỉ ra file tĩnh → artifact
# build trên macOS arm64 chạy nguyên xi trên NAS x86_64. Script có bước chặn nếu
# sau này lọt vào dependency chứa file .node.
#
# Transport là tar-over-ssh chứ không phải rsync, vì hai lý do đã kiểm chứng trên
# DSM: (1) rsync trên Synology bị khoá sau công tắc Control Panel → File Services
# → rsync ("rsync service is no running", exit 43); (2) rsync bản macOS mặc định
# là openrsync, bỏ qua cả `-e` lẫn `RSYNC_RSH` nên không ghép được ssh tuỳ biến.
# tar + ssh có sẵn ở cả hai đầu, không cần bật gì thêm.
# ─────────────────────────────────────────────────────────────────────────────
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
    -h|--help)       sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)               die "Tham số không hiểu: $arg" ;;
  esac
done
TARGET="${TARGET:-all}"

want_fe=0; want_be=0
case "$TARGET" in
  all)   want_fe=1; want_be=1 ;;
  fe)    want_fe=1 ;;
  be)    want_be=1 ;;
  infra) ;;   # chỉ đẩy compose + nginx conf
esac

# ── Cấu hình ─────────────────────────────────────────────────────────────────
[ -f "$ROOT/.deploy.env" ] || die "Thiếu .deploy.env — chạy: cp .deploy.env.example .deploy.env rồi điền thông tin NAS"
# shellcheck disable=SC1091
set -a; . "$ROOT/.deploy.env"; set +a

: "${NAS_HOST:?thiếu NAS_HOST trong .deploy.env}"
: "${NAS_USER:?thiếu NAS_USER trong .deploy.env}"
: "${NAS_PATH:?thiếu NAS_PATH trong .deploy.env}"
NAS_PORT="${NAS_PORT:-22}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-studio-manage}"
NAS_SUDO_PASSWORD="${NAS_SUDO_PASSWORD:-}"
NAS_SSH_PASSWORD="${NAS_SSH_PASSWORD:-}"

STAGE="$ROOT/.deploy"
TMPD="$(mktemp -d)"
# Socket ssh phải nằm ở đường dẫn NGẮN: Unix domain socket giới hạn 104 ký tự,
# đường dẫn $TMPDIR của macOS đã vượt.
CTL="$HOME/.ssh/sm-${COMPOSE_PROJECT}.sock"

cleanup() {
  ssh -O exit -S "$CTL" "$NAS_USER@$NAS_HOST" >/dev/null 2>&1 || true
  rm -rf "$TMPD"
}
trap cleanup EXIT

# ── Kết nối SSH (một connection dùng chung cho mọi lệnh) ─────────────────────
step "Kết nối NAS"

if [ -n "$NAS_SSH_PASSWORD" ]; then
  # DSM tắt "user home service" → không đặt được ~/.ssh/authorized_keys → phải
  # dùng password. Đưa qua SSH_ASKPASS để mật khẩu không lộ trong `ps`.
  printf '#!/bin/sh\nprintf "%%s\\n" "$NAS_PW"\n' > "$TMPD/askpass"
  chmod 700 "$TMPD/askpass"
  export NAS_PW="$NAS_SSH_PASSWORD" SSH_ASKPASS="$TMPD/askpass" SSH_ASKPASS_REQUIRE=force
  AUTH_OPTS="-o StrictHostKeyChecking=accept-new -o NumberOfPasswordPrompts=1"
  AUTH_KIND="password"
else
  AUTH_OPTS="-o BatchMode=yes"
  AUTH_KIND="SSH key"
fi

rm -f "$CTL"
# shellcheck disable=SC2086
ssh -M -S "$CTL" -o ControlPersist=30m -o ConnectTimeout=15 -o LogLevel=ERROR \
    -p "$NAS_PORT" $AUTH_OPTS -fN "$NAS_USER@$NAS_HOST" \
  || die "Không SSH được tới $NAS_USER@$NAS_HOST:$NAS_PORT bằng $AUTH_KIND.
   • Dùng key: cần bật DSM → Control Panel → User & Group → Advanced → User Home.
   • Hoặc điền NAS_SSH_PASSWORD vào .deploy.env."

# DSM in ra 'Could not chdir to home directory' mỗi lần login khi user home tắt —
# vô hại nhưng rất ồn, lọc đúng dòng đó và giữ nguyên mọi stderr khác.
nas() {
  ssh -S "$CTL" -o LogLevel=ERROR "$NAS_USER@$NAS_HOST" "$@" \
    2> >(grep -v 'Could not chdir to home directory' >&2)
}
ok "Đã kết nối ($AUTH_KIND, dùng chung 1 connection cho cả phiên deploy)"

# ── Preflight ────────────────────────────────────────────────────────────────
step "Preflight"

FIRST_RUN=0
if ! nas "[ -d '$NAS_PATH' ]"; then
  FIRST_RUN=1
  warn "Lần deploy đầu tiên — sẽ tạo $NAS_PATH"
else
  nas "[ -f '$NAS_PATH/.env' ]" \
    || die "Thiếu $NAS_PATH/.env trên NAS (MONGO_ROOT_PASSWORD)."
  nas "[ -f '$NAS_PATH/backend/.env' ]" \
    || die "Thiếu $NAS_PATH/backend/.env trên NAS (JWT_SECRET, PORT, ...)."
  ok "File .env trên NAS đầy đủ"
fi

# Vite nhúng biến môi trường vào bundle lúc build → build ở local phải sạch
if [ "$want_fe" = 1 ] && [ "$DO_BUILD" = 1 ] && ls frontend/.env* >/dev/null 2>&1; then
  warn "frontend/ có file .env — VITE_* sẽ bị NHÚNG CỨNG vào bundle production:"
  ls -1 frontend/.env* | sed 's/^/      /'
  warn "Nếu file đó trỏ API về localhost thì bản trên NAS sẽ gọi sai địa chỉ."
fi

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

    # node_modules production dựng riêng trong .deploy/ để KHÔNG đụng node_modules
    # dev của workspace (yarn --production sẽ xoá sạch devDependencies).
    step "Dựng node_modules production cho backend"
    mkdir -p "$STAGE/backend"
    cp backend/package.json "$STAGE/backend/package.json"
    cp yarn.lock "$STAGE/backend/yarn.lock"   # lockfile root → pin version, yarn tự prune còn deps production
    ( cd "$STAGE/backend" && yarn install --production --ignore-scripts --non-interactive >/dev/null )

    # Native module = file .node, biên dịch theo CPU/OS → không mang từ arm64 sang amd64 được.
    if find "$STAGE/backend/node_modules" -name '*.node' -print -quit | grep -q .; then
      die "Backend đã có native module (.node) — không mang được từ macOS arm64 sang NAS x86_64.
   Phải quay lại build image trên NAS, hoặc build image linux/amd64 bằng docker buildx."
    fi
    ok "node_modules production sạch, không native module ($(du -sh "$STAGE/backend/node_modules" | cut -f1))"
  fi
elif [ "$DO_BUILD" = 0 ]; then
  warn "Bỏ qua build (--no-build) — đẩy dist đang có sẵn"
fi

# ── Transport: tar over ssh ──────────────────────────────────────────────────
# push_dir <local-dir> <remote-dir>
# Giải nén ra thư mục tạm rồi tráo → cutover atomic, không có trạng thái nửa vời,
# và tự động xoá file cũ đã biến mất (thay cho `rsync --delete`).
push_dir() {
  local src="$1" dst="$2" name
  name="$(basename "$src")"
  [ -d "$src" ] || die "Không có thư mục để đẩy: $src"
  # --no-xattrs/--no-mac-metadata: bỏ AppleDouble + xattr, nếu không tar bên NAS
  # sẽ cảnh báo 'unknown extended header keyword LIBARCHIVE.xattr.com.apple.*'
  tar --no-xattrs --no-mac-metadata -czf - -C "$(dirname "$src")" "$name" \
    | nas "set -e
        mkdir -p '$(dirname "$dst")'
        rm -rf '$dst.new' '$dst.old'
        mkdir -p '$dst.new'
        tar xzf - -C '$dst.new'
        if [ -e '$dst' ]; then mv '$dst' '$dst.old'; fi
        mv '$dst.new/$name' '$dst'
        rm -rf '$dst.new' '$dst.old'"
}

# push_file <local-file> <remote-file>
# Ghi ĐÈ tại chỗ (giữ nguyên inode) chứ không mv: nginx.nas.conf được bind-mount
# dạng file, thay inode sẽ làm container mất mount.
push_file() {
  local src="$1" dst="$2"
  nas "mkdir -p '$(dirname "$dst")' && cat > '$dst'" < "$src"
}

step "Đẩy lên NAS ($NAS_PATH)"
nas "mkdir -p '$NAS_PATH/frontend' '$NAS_PATH/backend'"

push_file docker-compose.nas.yml "$NAS_PATH/docker-compose.yml"
push_file nginx.nas.conf         "$NAS_PATH/nginx.nas.conf"
ok "docker-compose.yml + nginx.nas.conf"

if [ "$want_fe" = 1 ]; then
  # Đích tên `html` để khớp root mặc định /usr/share/nginx/html của nginx —
  # compose mount thư mục cha ./frontend vào /usr/share/nginx.
  rm -rf "$TMPD/html" && cp -R frontend/dist "$TMPD/html"
  push_dir "$TMPD/html" "$NAS_PATH/frontend/html"
  ok "frontend/html ($(du -sh frontend/dist | cut -f1))"
fi

if [ "$want_be" = 1 ]; then
  push_dir backend/dist       "$NAS_PATH/backend/dist"
  # pdfkit nạp font qua __dirname/../../src/assets/fonts (từ dist/controllers ra
  # /app/src/assets/fonts) → thiếu thư mục này là hỏng xuất PDF lịch chụp.
  push_dir backend/src/assets "$NAS_PATH/backend/src/assets"
  push_file backend/package.json "$NAS_PATH/backend/package.json"
  ok "backend/dist + src/assets + package.json"

  # node_modules 50MB+ và hầu như không đổi → chỉ đẩy lại khi deps thật sự đổi.
  NM_STAMP="$(cat backend/package.json yarn.lock | shasum -a 256 | cut -d' ' -f1)"
  NM_REMOTE="$(nas "cat '$NAS_PATH/backend/.node_modules.stamp' 2>/dev/null || true")"
  if [ "$FORCE_MODULES" = 1 ] || [ "$NM_STAMP" != "$NM_REMOTE" ]; then
    push_dir "$STAGE/backend/node_modules" "$NAS_PATH/backend/node_modules"
    nas "printf '%s' '$NM_STAMP' > '$NAS_PATH/backend/.node_modules.stamp'"
    ok "backend/node_modules ($(du -sh "$STAGE/backend/node_modules" | cut -f1))"
  else
    info "backend/node_modules không đổi → bỏ qua (dùng --force-modules để ép đẩy)"
  fi
fi

if [ "$FIRST_RUN" = 1 ]; then
  printf '\n%s' "$YELLOW"
  cat <<EOF
Lần deploy đầu: NAS chưa có file .env, chưa khởi động container. Tạo rồi chạy lại script:

  ssh -p $NAS_PORT $NAS_USER@$NAS_HOST
  cd $NAS_PATH
  echo 'MONGO_ROOT_PASSWORD=<mật-khẩu-mongo>' > .env
  vi backend/.env       # JWT_SECRET, PORT, TELEGRAM_BOT_TOKEN, GAS_* ...

Đang chuyển từ thư mục deploy cũ? Copy thẳng .env sang cho nhanh:
  cp <thư-mục-cũ>/.env $NAS_PATH/.env
  cp <thư-mục-cũ>/backend/.env $NAS_PATH/backend/.env
EOF
  printf '%s' "$OFF"
  exit 0
fi

# ── Khởi động lại trên NAS ───────────────────────────────────────────────────
step "Khởi động lại service trên NAS"
nas "bash -s" <<REMOTE_SCRIPT
set -e
cd "$NAS_PATH"

# Synology để docker ở /usr/local/bin, không nằm trong PATH của shell non-interactive
export PATH="/usr/local/bin:/usr/bin:/bin:\$PATH"
DOCKER_BIN="\$(command -v docker || echo /usr/local/bin/docker)"

# -p ghim project name → tái sử dụng đúng container + volume ${COMPOSE_PROJECT}_mongodb_data
# hiện có, dù thư mục deploy đã đổi. Đổi tên project = khởi động vào DB rỗng.
dc() {
  if [ -n "$NAS_SUDO_PASSWORD" ]; then
    # -p '' : bỏ prompt "[sudo] password for ..." khỏi stderr cho output sạch
    echo "$NAS_SUDO_PASSWORD" | sudo -S -p '' "\$DOCKER_BIN" compose -p "$COMPOSE_PROJECT" "\$@"
  else
    "\$DOCKER_BIN" compose -p "$COMPOSE_PROJECT" "\$@"
  fi
}

# up -d: tạo container còn thiếu / áp thay đổi compose; container không đổi config thì giữ nguyên.
dc up -d --remove-orphans

# backend nạp code vào RAM lúc khởi động → phải restart mới ăn dist mới
if [ "$want_be" = 1 ]; then
  dc restart backend
fi

# nginx đọc file tĩnh qua mount → bản mới có hiệu lực ngay; reload chỉ để ăn conf mới
dc exec -T frontend nginx -s reload >/dev/null 2>&1 || dc restart frontend

echo
echo ">>> Trạng thái container:"
dc ps
REMOTE_SCRIPT

# ── Kiểm chứng ───────────────────────────────────────────────────────────────
step "Kiểm chứng"
HTTP_CODE="$(nas "curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:8090/ || echo 000")"
API_CODE="$(nas "curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:8090/api/auth/login -X POST || echo 000")"
[ "$HTTP_CODE" = "200" ] && ok "frontend HTTP $HTTP_CODE" || warn "frontend HTTP $HTTP_CODE (mong đợi 200)"
# 400/401 = backend sống và trả lời; 502 = nginx không tới được backend
case "$API_CODE" in
  400|401|422) ok "backend API HTTP $API_CODE (đã phản hồi qua nginx)" ;;
  *)           warn "backend API HTTP $API_CODE (502 = nginx không tới được backend)" ;;
esac

step "Xong"
ok "http://$NAS_HOST:8090"
info "frontend cutover atomic, không downtime; backend restart ~2s"
