# Studio Management - Monorepo

## Cài đặt

```bash
# Clone repo kèm submodule
git clone --recurse-submodules https://github.com/tienhg13102001/studio-manage.git
cd studio-manage

# Cài tất cả dependencies
yarn install
```

## Lệnh chung (từ root)

| Lệnh | Mô tả |
|---|---|
| `yarn install` | Cài dependencies cho tất cả project |
| `yarn dev` | Chạy dev backend + frontend song song |
| `yarn build` | Build cả 2 project |
| `yarn format` | Format code cả 2 project |
| `yarn seed` | Chạy seed database (backend) |

## Cài thư viện cho từng project

Tên workspace lấy từ `name` trong `package.json` của mỗi project:
- Backend: `studio-management-backend`
- Frontend: `studio-management-frontend`

```bash
# Cài dependency cho backend
yarn workspace studio-management-backend add <package-name>

# Cài devDependency cho backend
yarn workspace studio-management-backend add -D <package-name>

# Cài dependency cho frontend
yarn workspace studio-management-frontend add <package-name>

# Cài devDependency cho frontend
yarn workspace studio-management-frontend add -D <package-name>

# Gỡ thư viện
yarn workspace studio-management-backend remove <package-name>

# Cài thư viện ở root (shared tools)
yarn add -W -D <package-name>
```

### Ví dụ

```bash
# Thêm helmet cho backend
yarn workspace studio-management-backend add helmet

# Thêm framer-motion cho frontend
yarn workspace studio-management-frontend add framer-motion

# Thêm eslint cho toàn project
yarn add -W -D eslint
```

## Chạy script của project con

```bash
yarn workspace studio-management-backend seed
yarn workspace studio-management-frontend build
```

## Git Submodule

```bash
# Cập nhật submodule lên commit mới nhất
cd backend && git pull origin main && cd ..
cd frontend && git pull origin main && cd ..
git add backend frontend
git commit -m "update submodules"

# Push code trong submodule
cd backend
git add -A && git commit -m "fix: ..." && git push origin main
cd ..
git add backend && git commit -m "update backend ref" && git push
```
