# Backend - Telegram Fitness App

## Установка

```bash
npm install
```

## Настройка

Создайте `.env` файл:

```bash
cp .env.example .env
```

Заполните переменные окружения в `.env`.

## Инициализация БД

```bash
npm run db:init
```

## Запуск

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

## API Endpoints

### Users
- `GET /api/users/:telegram_id` - Получить пользователя
- `POST /api/users` - Создать/обновить пользователя
- `PATCH /api/users/:telegram_id/subscription` - Обновить подписку

### Workouts
- `GET /api/workouts/:user_id` - Получить тренировки
- `POST /api/workouts` - Создать тренировку
- `DELETE /api/workouts/:id` - Удалить тренировку
- `GET /api/workouts/:user_id/stats` - Статистика

### AI
- `POST /api/ai/chat` - Отправить сообщение AI
- `GET /api/ai/history/:user_id` - История чата
