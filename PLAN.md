# Технический план

## Архитектура

- Backend: Go, `chi`, `pgx`, PostgreSQL, явные SQL-запросы, автоматический запуск миграций при старте, HTTP-only cookie-сессии, CSRF-токен для изменяющих запросов.
- Frontend: React, TypeScript, Vite, React Router, TanStack Query, Tailwind CSS, Radix UI, Lucide Icons, Recharts, React Hook Form, Zod, PWA.
- Раздача production-фронтенда выполняется Go-сервером из встроенной папки `frontend/dist`.
- Деньги хранятся в PostgreSQL как целые копейки (`BIGINT`), фронтенд показывает рубли.
- Основной часовой пояс: `Europe/Moscow`.

## Основные сущности

- Пользователи: два локальных профиля с PIN, PIN хранится bcrypt-хешем.
- Категории: стартовый набор, цвет, иконка, сортировка, скрытие.
- Операции: расход/доход, сумма, категория, комментарий, дата, автор.
- Бюджеты, цели накоплений, регулярные платежи.
- Серверные сессии и таблица миграций.

## API

- Версия API: `/api/v1`.
- Реализуются setup, auth, categories, transactions, analytics, budgets, goals, recurring-payments, export/import.
- Ответы об ошибках имеют единый JSON-формат.
- Для создания операций используется `Idempotency-Key`.

## UX

- Первый экран после входа: мобильная панель с крупной суммой месяца, остатком бюджета, круговой диаграммой, быстрыми круглыми категориями и последними операциями.
- Быстрый сценарий: нажать категорию, ввести сумму на цифровой клавиатуре, сохранить.
- Альтернативный сценарий: кнопка `+`, сумма, категория, дата, комментарий.
- Русский интерфейс, адаптация под iOS Safari и Android Chrome, темная тема.

## Инфраструктура

- `docker compose up --build` поднимает PostgreSQL и приложение на `http://localhost:8080`.
- Multi-stage Dockerfile: сборка фронтенда, сборка Go-бинаря, минимальный runtime.
- `.env.example`, Makefile, healthchecks.

## Проверки

- Backend: `go test ./...`, `go vet ./...`.
- Frontend: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`.
- E2E: Playwright-сценарий настройки, входа, создания, редактирования и удаления расхода.

