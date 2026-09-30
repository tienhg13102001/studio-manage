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
#   ./deploy.sh env             đẩy .env.production (local) → .env trên VPS, recreate service
#   ./deploy.sh env:pull        lấy env đang chạy trên VPS về .env.production (lần đầu)
#   ./deploy.sh --no-build      đẩy dist đang có, không build lại
#   ./deploy.sh --force-modules ép đẩy lại backend/node_modules
#
# Cấu hình: .deploy.env (copy từ .deploy.env.example). SSH bằng key.
# Env production: .env.production ở local là nguồn duy nhất; chỉ lệnh `env` ghi .env trên VPS.
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
    env)             TARGET="env" ;;
    env:pull)        TARGET="env-pull" ;;
    all)             TARGET="all" ;;
    -h|--help)       sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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

# ── Env production (.env.production local ⇄ .env trên VPS) ────────────────────
ENV_LOCAL="$ROOT/.env.production"
REQUIRED_KEYS="MONGO_ROOT_PASSWORD JWT_SECRET"
ENV_BAK_DIR=".env-backups"   # trong VPS_PATH, chmod 700 — KHÔNG để trong backup/ (mount vào mongo)

# Chuẩn hoá một dòng env giống dotenv của compose: bỏ CR, tiền tố `export `, trim key/value,
# bỏ cặp nháy bao ngoài value. Dùng chung cho env_kv và bước gộp của env:pull.
ENV_AWK_NORM='
  function norm(line) {
    sub(/\r$/, "", line); sub(/^[[:space:]]*export[[:space:]]+/, "", line)
    K = line; sub(/=.*/, "", K); sub(/^[[:space:]]+/, "", K); sub(/[[:space:]]+$/, "", K)
    V = line; sub(/^[^=]*=/, "", V); sub(/^[[:space:]]+/, "", V); sub(/[[:space:]]+$/, "", V)
    if (V ~ /^".*"$/ || V ~ /^'"'"'.*'"'"'$/) V = substr(V, 2, length(V) - 2)
    return (K ~ /^[A-Za-z_][A-Za-z0-9_]*$/)
  }'

# env_kv <file>: "KEY<TAB>VALUE" đã sort, bỏ comment/dòng trống, key trùng → lấy dòng cuối
env_kv() {
  awk "$ENV_AWK_NORM"'
       /^[[:space:]]*#/ || !/=/ {next}
       norm($0) { kv[K] = V }
       END { for (k in kv) printf "%s\t%s\n", k, kv[k] }' "$1" | LC_ALL=C sort
}
# value = mọi thứ sau TAB đầu tiên (value có thể chứa TAB)
env_get() { env_kv "$1" | awk -v k="$2" 'index($0, k "\t") == 1 { print substr($0, length(k) + 2) }'; }

if [ "$TARGET" = "env-pull" ]; then
  step "Lấy env production từ VPS"
  if [ -f "$ENV_LOCAL" ]; then
    mkdir -p "$STAGE"
    BAK="$STAGE/env.production.$(date +%Y%m%d-%H%M%S).bak"
    warn ".env.production đã có ở local — sẽ bị GHI ĐÈ (bản cũ lưu ở ${BAK#"$ROOT"/})"
    read -r -p "    Tiếp tục? [y/N] " a; [ "$a" = y ] || die "Huỷ"
    (umask 077; cp -p "$ENV_LOCAL" "$BAK")
  fi
  (umask 077
   vps "cat '$VPS_PATH/.env'" > "$TMPD/infra.env" || die "Không đọc được $VPS_PATH/.env"
   vps "cat '$VPS_PATH/backend/.env' 2>/dev/null || true" > "$TMPD/backend.env"
   {
     echo "# Env production — nguồn duy nhất, đẩy lên VPS bằng: ./deploy.sh env"
     echo "# Lấy từ $VPS_HOST:$VPS_PATH lúc $(date '+%F %T'). KHÔNG commit file này."
     echo
     tr -d '\r' < "$TMPD/infra.env"
     # VPS kiểu cũ còn tách backend/.env → gộp vào cùng file
     if [ -s "$TMPD/backend.env" ]; then
       echo
       echo "# ── Backend ──"
       # MONGO_URI/NODE_ENV/PORT do compose đặt; key trùng giữ lần xuất hiện cuối
       tr -d '\r' < "$TMPD/backend.env" > "$TMPD/backend.lf"
       awk "$ENV_AWK_NORM"'
            NR==FNR { if ($0 !~ /^[[:space:]]*#/ && $0 ~ /=/ && norm($0)) last[K]=FNR; next }
            /^[[:space:]]*#/ || !/=/ {print; next}
            !norm($0) || K=="MONGO_URI" || K=="NODE_ENV" || K=="PORT" {next}
            last[K]==FNR {print}' "$TMPD/backend.lf" "$TMPD/backend.lf" | cat -s
     fi
   } > "$ENV_LOCAL")
  chmod 600 "$ENV_LOCAL"
  ok ".env.production ($(env_kv "$ENV_LOCAL" | wc -l | tr -d ' ') key, chmod 600) — giá trị không in ra màn hình"
  exit 0
fi

if [ "$TARGET" = "env" ]; then
  step "Env production"
  [ -f "$ENV_LOCAL" ] || die "Chưa có .env.production — chạy ./deploy.sh env:pull (hoặc copy từ .env.production.example)"
  chmod 600 "$ENV_LOCAL"
  for k in $REQUIRED_KEYS; do
    [ -n "$(env_get "$ENV_LOCAL" "$k")" ] || die "Thiếu $k trong .env.production"
  done
  (umask 077; vps "cat '$VPS_PATH/.env' 2>/dev/null || true" > "$TMPD/remote.env")
  env_kv "$ENV_LOCAL" > "$TMPD/l.kv"; env_kv "$TMPD/remote.env" > "$TMPD/r.kv"

  # Đổi MONGO_ROOT_PASSWORD không đổi mật khẩu trong DB đã khởi tạo → backend mất kết nối
  old_pw="$(env_get "$TMPD/remote.env" MONGO_ROOT_PASSWORD)"
  if [ -n "$old_pw" ] && [ "$old_pw" != "$(env_get "$ENV_LOCAL" MONGO_ROOT_PASSWORD)" ]; then
    die "MONGO_ROOT_PASSWORD khác với VPS. Đổi biến này KHÔNG đổi mật khẩu trong DB đã có → backend
   sẽ không nối được Mongo. Giữ nguyên giá trị cũ (./deploy.sh env:pull để lấy lại)."
  fi
  if [ -z "$old_pw" ] && vps "docker volume inspect '${COMPOSE_PROJECT}_mongodb_data' >/dev/null 2>&1"; then
    warn "VPS không có MONGO_ROOT_PASSWORD nhưng volume Mongo đã tồn tại — mật khẩu phải TRÙNG mật khẩu lúc khởi tạo DB"
    read -r -p "    Chắc chắn đúng mật khẩu cũ? [y/N] " a; [ "$a" = y ] || die "Huỷ"
  fi

  # Chỉ in tên key, không bao giờ in giá trị (so cả dòng KEY<TAB>VALUE, value có thể chứa TAB)
  changes="$(awk 'NR==FNR { k=$0; sub(/\t.*/, "", k); r[k]=$0; next }
                  { k=$0; sub(/\t.*/, "", k)
                    if (!(k in r)) print "  + " k; else if (r[k] != $0) print "  ~ " k; delete r[k] }
                  END { for (k in r) print "  - " k }' "$TMPD/r.kv" "$TMPD/l.kv" | LC_ALL=C sort -k2)"
  if [ -z "$changes" ]; then ok "VPS đã khớp .env.production — không có gì để đẩy"; exit 0; fi
  printf '%s\n' "    Thay đổi so với VPS (+ thêm, ~ đổi giá trị, - xoá):" "$changes"
  read -r -p "    Đẩy lên VPS và khởi động lại service liên quan? [y/N] " a; [ "$a" = y ] || die "Huỷ"

  TS="$(date +%Y%m%d-%H%M%S)"
  # Upload vào file .new trước, rồi tráo tất cả trong MỘT lệnh remote → không có trạng thái nửa vời
  vps "mkdir -p '$VPS_PATH' && umask 077 && cat > '$VPS_PATH/.env.new'" < "$ENV_LOCAL"
  vps "cat > '$VPS_PATH/docker-compose.yml.new'" < deploy/docker-compose.yml
  MIGRATED="$(vps "set -e; cd '$VPS_PATH'
       mkdir -p $ENV_BAK_DIR; chmod 700 $ENV_BAK_DIR
       [ -f .env ] && cp -p .env $ENV_BAK_DIR/.env.$TS
       [ -f docker-compose.yml ] && cp -p docker-compose.yml $ENV_BAK_DIR/docker-compose.yml.$TS
       migrated=0
       # Kiểu cũ tách backend/.env → cất đi sau khi gộp
       if [ -f backend/.env ]; then mv backend/.env $ENV_BAK_DIR/backend.env.$TS; migrated=1; fi
       mv .env.new .env
       mv docker-compose.yml.new docker-compose.yml
       ls -1t $ENV_BAK_DIR/.env.* 2>/dev/null | tail -n +11 | xargs -r rm -f
       echo \$migrated")"
  ok "Đã đẩy .env (backup: $VPS_PATH/$ENV_BAK_DIR/*.$TS)"

  if [ "$MIGRATED" = 1 ]; then
    ROLLBACK="cd $VPS_PATH && mv $ENV_BAK_DIR/backend.env.$TS backend/.env && cp $ENV_BAK_DIR/.env.$TS .env && cp $ENV_BAK_DIR/docker-compose.yml.$TS docker-compose.yml && docker compose -p $COMPOSE_PROJECT up -d"
  else
    ROLLBACK="cd $VPS_PATH && cp $ENV_BAK_DIR/.env.$TS .env && docker compose -p $COMPOSE_PROJECT up -d"
  fi

  # VPS mới chưa có artifact → chưa khởi động (docker sẽ tạo nhầm nginx.conf thành thư mục)
  if ! vps "[ -f '$VPS_PATH/nginx.conf' ] && [ -f '$VPS_PATH/backend/dist/app.js' ]"; then
    warn "VPS chưa có bản build — env đã lưu, chạy ./deploy.sh để đẩy code và khởi động"
    exit 0
  fi

  # compose tự recreate service có env/cổng thay đổi (mongo không đổi thì giữ nguyên);
  # reload nginx vì backend recreate có thể đổi IP mà nginx đã resolve lúc start
  vps "set -o pipefail; cd '$VPS_PATH'
       out=\$(docker compose -p '$COMPOSE_PROJECT' up -d --remove-orphans 2>&1) || { echo \"\$out\"; exit 1; }
       echo \"\$out\" | grep -Ev '^ *Container .* (Running|Waiting|Healthy)' || true
       docker compose -p '$COMPOSE_PROJECT' exec -T frontend nginx -s reload >/dev/null 2>&1 \
         || docker compose -p '$COMPOSE_PROJECT' restart frontend
       docker compose -p '$COMPOSE_PROJECT' ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}'" \
    || die "docker compose up lỗi (xem trên). Rollback: ssh $VPS_USER@$VPS_HOST '$ROLLBACK'"
  HTTPS_PORT="$(env_get "$ENV_LOCAL" HTTPS_PORT)"; HTTPS_PORT="${HTTPS_PORT:-443}"
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    API_CODE="$(vps "curl -sk -o /dev/null -w '%{http_code}' --max-time 10 -X POST \
      --resolve '${DOMAIN:-localhost}:$HTTPS_PORT:127.0.0.1' https://${DOMAIN:-localhost}:$HTTPS_PORT/api/auth/login || echo 000")"
    case "$API_CODE" in 400|401|422) break ;; esac
    sleep 2
  done
  case "$API_CODE" in
    400|401|422) ok "backend API $API_CODE — chạy bình thường với env mới" ;;
    *) warn "backend API $API_CODE — xem: ssh $VPS_USER@$VPS_HOST 'cd $VPS_PATH && docker compose -p $COMPOSE_PROJECT logs --tail 50 backend'
    Rollback: ssh $VPS_USER@$VPS_HOST '$ROLLBACK'" ;;
  esac
  exit 0
fi

# ── Preflight ────────────────────────────────────────────────────────────────
step "Preflight"
FIRST_RUN=0
if ! vps "[ -f '$VPS_PATH/.env' ]"; then
  FIRST_RUN=1
  warn "VPS chưa có $VPS_PATH/.env — sẽ chỉ đẩy file, chưa khởi động"
elif (umask 077; vps "cat '$VPS_PATH/.env'" > "$TMPD/r.env"); [ -z "$(env_get "$TMPD/r.env" JWT_SECRET)" ]; then
  # docker-compose.yml nạp env backend từ .env → VPS còn tách backend/.env thì chưa deploy được
  die "Env trên VPS còn tách .env + backend/.env (kiểu cũ). Gộp một lần:
   ./deploy.sh env:pull && ./deploy.sh env"
else
  ok "File .env trên VPS đầy đủ"
  if [ -f "$ENV_LOCAL" ] && [ "$(env_kv "$ENV_LOCAL" | shasum)" != "$(env_kv "$TMPD/r.env" | shasum)" ]; then
    warn ".env.production (local) khác .env trên VPS — lệnh này KHÔNG đẩy env; chạy ./deploy.sh env nếu cần"
  fi
fi

# Code backend dùng env mà .env.production chưa có → cảnh báo trước khi deploy
# (bỏ qua key do compose đặt, key tuỳ chọn và key chỉ dùng cho script chạy tay ở src/utils)
if [ "$want_be" = 1 ] && [ -f "$ENV_LOCAL" ]; then
  ENV_IGNORE="MONGO_URI NODE_ENV PORT CORS_ORIGIN"
  missing=""
  for k in $(grep -rhoE 'process\.env\.[A-Z_][A-Z0-9_]*' backend/src --exclude-dir=utils | sed 's/process\.env\.//' | sort -u); do
    case " $ENV_IGNORE " in *" $k "*) continue ;; esac
    [ -n "$(env_get "$ENV_LOCAL" "$k")" ] || missing="$missing $k"
  done
  if [ -n "$missing" ]; then
    warn "Backend dùng env chưa có (hoặc rỗng) trong .env.production:$missing"
    info "Thêm vào .env.production rồi chạy ./deploy.sh env trước khi deploy backend"
    read -r -p "    Vẫn deploy? [y/N] " a; [ "$a" = y ] || die "Huỷ"
  fi
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
Lần deploy đầu: VPS chưa có file .env nên chưa khởi động container. Tạo env ở local rồi đẩy lên:

  cp .env.production.example .env.production && chmod 600 .env.production
  \$EDITOR .env.production   # MONGO_ROOT_PASSWORD: openssl rand -hex 24; JWT_SECRET, TELEGRAM_*, GAS_* ...
  ./deploy.sh env && ./deploy.sh
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
