-- FitMarket Database Schema
-- SQLite

-- Пользователи
CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT DEFAULT '',
    first_name TEXT DEFAULT '',
    last_name TEXT DEFAULT '',
    role TEXT DEFAULT 'USER' CHECK(role IN ('USER', 'TRAINER', 'MODERATOR', 'ADMIN')),
    subscription_tier TEXT DEFAULT 'free' CHECK(subscription_tier IN ('free', 'pro')),
    ai_requests_count INTEGER DEFAULT 0,
    ai_requests_reset_date TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Заявки на тренера
CREATE TABLE IF NOT EXISTS trainer_requests (
    id TEXT PRIMARY KEY,
    telegram_id INTEGER NOT NULL,
    bio TEXT DEFAULT '',
    experience TEXT DEFAULT '',
    specialization TEXT DEFAULT '',
    status TEXT DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
    reviewed_by INTEGER,
    reviewed_at TEXT,
    rejection_reason TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);

-- Программы тренировок
CREATE TABLE IF NOT EXISTS programs (
    id TEXT PRIMARY KEY,
    author_id INTEGER NOT NULL,
    title TEXT DEFAULT 'Без названия',
    description TEXT DEFAULT '',
    category TEXT DEFAULT 'general',
    difficulty TEXT DEFAULT 'intermediate',
    duration_weeks INTEGER DEFAULT 4,
    price REAL DEFAULT 0,
    is_published INTEGER DEFAULT 0,
    is_personal INTEGER DEFAULT 0,
    workouts TEXT DEFAULT '[]', -- JSON array
    purchase_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (author_id) REFERENCES users(telegram_id)
);

-- Дневник тренировок
CREATE TABLE IF NOT EXISTS workout_logs (
    id TEXT PRIMARY KEY,
    telegram_id INTEGER NOT NULL,
    program_id TEXT,
    workout_title TEXT DEFAULT 'Тренировка',
    exercises TEXT DEFAULT '[]', -- JSON array
    duration INTEGER DEFAULT 0,
    notes TEXT DEFAULT '',
    completed_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id),
    FOREIGN KEY (program_id) REFERENCES programs(id)
);

-- Покупки программ
CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    program_id TEXT NOT NULL,
    purchased_at TEXT DEFAULT (datetime('now')),
    UNIQUE(telegram_id, program_id),
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id),
    FOREIGN KEY (program_id) REFERENCES programs(id)
);

-- AI сообщения
CREATE TABLE IF NOT EXISTS ai_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(telegram_id)
);

-- Индексы для ускорения запросов
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_trainer_requests_status ON trainer_requests(status);
CREATE INDEX IF NOT EXISTS idx_programs_author ON programs(author_id);
CREATE INDEX IF NOT EXISTS idx_programs_published ON programs(is_published);
CREATE INDEX IF NOT EXISTS idx_workout_logs_user ON workout_logs(telegram_id);
CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchases(telegram_id);
CREATE INDEX IF NOT EXISTS idx_ai_messages_user ON ai_messages(user_id);
