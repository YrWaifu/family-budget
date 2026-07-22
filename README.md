# Семейный бюджет

Self-hosted веб-приложение для двух человек, которые ведут общий бюджет. Интерфейс рассчитан на телефон: крупные суммы, быстрые круглые категории, ввод расхода за несколько секунд, история, аналитика, цели и регулярные платежи.

## Экраны

- Первичная настройка: создание двух локальных профилей с PIN.
- Вход: выбор профиля и ввод PIN.
- Главная: расходы, доходы, баланс, бюджет, остаток, диаграмма категорий, быстрые категории и последние операции.
- История: фильтры по месяцу, типу, категории, поиск, редактирование и удаление.
- Аналитика: динамика по дням, расходы по категориям, прогноз до конца месяца.
- Еще: бюджет месяца, категории, цели накоплений, регулярные платежи, темная тема.

## Стек

- Backend: Go, chi, pgx, PostgreSQL, slog, SQL-миграции.
- Frontend: React, TypeScript, Vite, React Router, TanStack Query, Tailwind CSS, Radix UI, Lucide Icons, Recharts, React Hook Form, Zod.
- Инфраструктура: Docker, Docker Compose, multi-stage Dockerfile, healthchecks.

## Структура

```text
backend/
  cmd/server/                # запуск HTTP-сервера
  internal/config/           # переменные окружения
  internal/httpapi/          # REST handlers, auth middleware, static frontend
  internal/models/           # модели API
  internal/money/            # безопасная работа с суммами
  internal/storage/          # pgx repository и embedded migrations
  migrations/                # SQL-миграции для чтения/ручного применения
frontend/
  public/                    # PWA manifest, service worker, icons
  src/app/                   # приложение, страницы и стили
  src/shared/api/            # API-клиент
  src/shared/lib/            # форматирование и иконки
```

## Быстрый запуск

```bash
docker compose up --build
```

Приложение откроется на [http://localhost:8080](http://localhost:8080).

При первом запуске создайте два профиля. После этого оба профиля видят общий бюджет, а автор операции сохраняется автоматически.

Для своего сервера создайте `.env` на основе `.env.example`; Docker Compose подхватит значения автоматически.

## Переменные окружения

```text
APP_ENV=production
HTTP_ADDR=:8080
DATABASE_URL=postgres://family_budget:family_budget@db:5432/family_budget?sslmode=disable
SESSION_SECRET=change-this-long-random-secret
COOKIE_SECURE=false
APP_TIMEZONE=Europe/Moscow
ENABLE_DEMO_DATA=false
CORS_ORIGINS=http://localhost:8080
```

Для HTTPS за reverse proxy установите `COOKIE_SECURE=true`.

## Локальная разработка

Backend:

```bash
cd backend
go test ./...
go vet ./...
go run ./cmd/server
```

Frontend:

```bash
cd frontend
npm install
npm run dev
npm run lint
npm run typecheck
npm run test
npm run build
```

В dev-режиме Vite проксирует `/api` на `http://localhost:8080`.

## Миграции

Миграции запускаются автоматически при старте Go-сервера. Основной файл схемы: `backend/migrations/001_init.sql`; embedded-копия находится в `backend/internal/storage/migrations`.

Демо-данные создаются только при `ENABLE_DEMO_DATA=true`; в production по умолчанию они выключены.

## Backup PostgreSQL

Создать backup:

```bash
docker compose exec db pg_dump -U family_budget family_budget > backup.sql
```

Восстановить:

```bash
docker compose exec -T db psql -U family_budget family_budget < backup.sql
```

## Обновление

```bash
git pull
docker compose up --build -d
```

Миграции применятся автоматически при следующем старте приложения.

## Ubuntu VPS

1. Установите Docker и Docker Compose plugin.
2. Скопируйте репозиторий на сервер.
3. Создайте `.env` на основе `.env.example`.
4. Задайте длинный `SESSION_SECRET`, production `DATABASE_URL`, `COOKIE_SECURE=true`.
5. Запустите `docker compose up --build -d`.
6. Подключите домен через reverse proxy.

## Caddy

```caddyfile
budget.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

Caddy автоматически выпустит HTTPS-сертификат.

## Nginx

```nginx
server {
  server_name budget.example.com;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

HTTPS можно настроить через Certbot:

```bash
sudo certbot --nginx -d budget.example.com
```

## API

Все endpoints находятся под `/api/v1`.

```text
GET    /setup/status
POST   /setup
GET    /auth/profiles
POST   /auth/login
POST   /auth/logout
GET    /auth/me

GET    /categories
POST   /categories
PATCH  /categories/{id}
DELETE /categories/{id}

GET    /transactions
POST   /transactions
GET    /transactions/{id}
PATCH  /transactions/{id}
DELETE /transactions/{id}

GET    /analytics/summary
GET    /analytics/categories
GET    /analytics/timeline
GET    /analytics/comparison

GET    /budgets
PUT    /budgets/{year}/{month}

GET    /goals
POST   /goals
PATCH  /goals/{id}
POST   /goals/{id}/deposit
DELETE /goals/{id}

GET    /recurring-payments
POST   /recurring-payments
PATCH  /recurring-payments/{id}
DELETE /recurring-payments/{id}
POST   /recurring-payments/{id}/pay

GET    /export?format=csv
GET    /export?format=json
POST   /import
```

Для изменяющих запросов после входа нужен заголовок `X-CSRF-Token`. Для `POST /transactions` дополнительно нужен `Idempotency-Key`.

## Принятые решения

- Деньги хранятся в копейках как `BIGINT`, чтобы избежать ошибок float.
- Простая локальная авторизация: два профиля, bcrypt-хеш PIN, серверные сессии, HTTP-only cookie.
- CSRF-защита включена для всех записывающих endpoints.
- Фронтенд собирается в статические файлы и раздается Go-сервером.
- Категорию с операциями нельзя удалить, но можно скрыть.
- Основной часовой пояс зафиксирован как `Europe/Moscow`.
