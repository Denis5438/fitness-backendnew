import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { startBot } from './bot.js';
import apiRouter from './routes/api.js';
import { initCryptoPay } from './cryptoBot.js';
import cryptoRouter from './routes/crypto.js';
import contentRouter from './routes/content.js';

import { WithdrawalRequest } from './database/models.js';

const app = express();

// Middleware
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    'https://fitmarket-tg-webapp.netlify.app',
    'https://fitness-webapp-tg.netlify.app',
    'https://frontend-new-mu-seven.vercel.app',
    /\.vercel\.app$/,
    config.telegram.webappUrl,
  ],
  credentials: true,
}));
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  },
}));

// Логирование запросов
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Простой rate limiter (100 запросов в минуту на IP)
const rateLimitStore = new Map();
const RATE_LIMIT = 100; // запросов
const RATE_WINDOW = 60000; // 1 минута
const WITHDRAWAL_PROCESSING_TIMEOUT_MS = 10 * 60 * 1000; // 10 минут
const WITHDRAWAL_PROCESSING_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 минут

app.use((req, res, next) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const now = Date.now();

  if (!rateLimitStore.has(ip)) {
    rateLimitStore.set(ip, { count: 1, resetTime: now + RATE_WINDOW });
  } else {
    const record = rateLimitStore.get(ip);
    if (now > record.resetTime) {
      record.count = 1;
      record.resetTime = now + RATE_WINDOW;
    } else {
      record.count++;
      if (record.count > RATE_LIMIT) {
        console.warn(`⚠️ Rate limit exceeded for IP: ${ip}`);
        return res.status(429).json({ error: 'Too many requests. Try again later.' });
      }
    }
  }
  next();
});

// Очистка старых записей каждые 5 минут
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitStore.entries()) {
    if (now > record.resetTime + 300000) rateLimitStore.delete(ip);
  }
}, 300000);

// API Routes
app.use('/api', apiRouter);
app.use('/api/crypto', cryptoRouter);
app.use('/api/content', contentRouter);


// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'FitMarket API',
    version: '2.0.0',
    status: 'running',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Запуск сервера
async function start() {
  try {
    // Подключение к MongoDB
    const { connectMongoDB } = await import('./database/mongodb.js');
    await connectMongoDB();

    setInterval(async () => {
      try {
        const cutoff = new Date(Date.now() - WITHDRAWAL_PROCESSING_TIMEOUT_MS);
        const result = await WithdrawalRequest.updateMany(
          {
            status: 'PROCESSING',
            $or: [
              { updated_at: { $lt: cutoff } },
              { updated_at: { $exists: false }, created_at: { $lt: cutoff } },
            ],
          },
          { $set: { status: 'PENDING', updated_at: new Date() } }
        );
        const modified = result.modifiedCount ?? result.nModified ?? 0;
        if (modified > 0) {
          console.warn(`⚠️ Возвращено в PENDING: ${modified} заявок на вывод (таймаут)`);
        }
      } catch (error) {
        console.error('❌ Ошибка очистки зависших выводов:', error);
      }
    }, WITHDRAWAL_PROCESSING_CHECK_INTERVAL_MS);

    // Инициализация CryptoBot
    initCryptoPay(config.cryptoBot?.token);

    // Запуск HTTP сервера
    app.listen(config.port, () => {
      console.log(`✅ Server running on http://localhost:${config.port}`);
      console.log(`📊 Environment: ${config.nodeEnv}`);
    });

    // Запуск Telegram бота
    if (config.telegram.botToken) {
      try {
        await startBot();
      } catch (botError) {
        // Игнорируем ошибку конфлика (если бот уже запущен в другом месте)
        if (botError?.response?.error_code === 409) {
          console.warn('⚠️ Telegram Bot Conflict: Another instance is running. API-only mode enabled.');
        } else {
          console.error('❌ Failed to start Telegram bot:', botError);
          // Не роняем сервер из-за ошибки бота, API должен работать
        }
      }
    } else {
      console.warn('⚠️ TELEGRAM_BOT_TOKEN не задан - Telegram bot не запущен (API работает)');
    }

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down...');
  process.exit(0);
});

start();
