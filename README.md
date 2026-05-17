# Sales CRM

CRM для управляющего и менеджеров продаж. Текущая версия развивает MVP в минимальную рабочую вертикаль:

- вход и регистрация по email/password;
- роли `manager_owner` и `sales_manager`;
- компания и проекты;
- менеджеры проекта;
- проектная воронка;
- клиенты с назначением менеджеру;
- Kanban по этапам воронки;
- карточка клиента с chat-style notebook;
- запланированные взаимодействия;
- in-app уведомления;
- dashboard и CSV-отчет по проекту.

## Stack

- Frontend: React, Vite, TanStack Query, lucide-react.
- Backend: Go REST API.
- Database: SQLite.

## Запуск

```powershell
npm.cmd install
npm.cmd run dev
```

После запуска:

- frontend: http://127.0.0.1:5173
- API: http://127.0.0.1:3001/api

На Windows используйте `npm.cmd`, если PowerShell блокирует `npm.ps1`.

## Отдельные команды

```powershell
npm.cmd run server
npm.cmd run client
npm.cmd run build
```

`npm.cmd run server` запускает Go backend через:

```powershell
go run ./server
```

Старый Express backend оставлен как резерв и запускается командой:

```powershell
npm.cmd run server:node
```

## Демо-аккаунты

Пароль для всех демо-пользователей:

```text
demo123
```

- управляющий: `owner@crm.local`
- менеджер: `ivan@crm.local`
- менеджер: `anna@crm.local`

## Данные

SQLite-база создается автоматически:

```text
server/data/sales_crm.db
```

Схема CRM создается через таблицу `schema_migrations`. Старые таблицы первого MVP не удаляются.

