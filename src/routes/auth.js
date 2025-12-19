import express from 'express';
import crypto from 'crypto';
import { config } from '../config.js';

const router = express.Router();

// Хранилище кодов авторизации (в продакшене использовать Redis)
const authCodes = new Map();

// Хранилище сессий
const sessions = new Map();

// Генерация случайного кода
function generateCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 символов
}

// Генерация токена сессии
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// POST /api/auth/request-code - Запрос кода авторизации
router.post('/request-code', (req, res) => {
  const code = generateCode();
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 минут
  
  authCodes.set(code, {
    code,
    expiresAt,
    telegramId: null,
    telegramUser: null,
    verified: false
  });
  
  // Очистка старых кодов
  for (const [key, value] of authCodes.entries()) {
    if (value.expiresAt < Date.now()) {
      authCodes.delete(key);
    }
  }
  
  res.json({ 
    code,
    expiresIn: 300, // секунд
    botUsername: config.telegram.botUsername || 'FitMarketBot'
  });
});

// GET /api/auth/check-code/:code - Проверка статуса кода
router.get('/check-code/:code', (req, res) => {
  const { code } = req.params;
  const authData = authCodes.get(code.toUpperCase());
  
  if (!authData) {
    return res.status(404).json({ error: 'Код не найден или истёк' });
  }
  
  if (authData.expiresAt < Date.now()) {
    authCodes.delete(code);
    return res.status(410).json({ error: 'Код истёк' });
  }
  
  if (authData.verified && authData.telegramUser) {
    // Создаём сессию
    const token = generateToken();
    sessions.set(token, {
      telegramId: authData.telegramId,
      user: authData.telegramUser,
      createdAt: Date.now()
    });
    
    // Удаляем использованный код
    authCodes.delete(code);
    
    return res.json({
      verified: true,
      token,
      user: authData.telegramUser
    });
  }
  
  res.json({ 
    verified: false,
    pending: true 
  });
});

// POST /api/auth/verify-code - Верификация кода ботом (вызывается из бота)
router.post('/verify-code', (req, res) => {
  const { code, telegramId, telegramUser, botSecret } = req.body;
  
  // Проверка секрета бота (простая защита)
  if (botSecret !== config.telegram.botToken) {
    return res.status(403).json({ error: 'Неверный секрет' });
  }
  
  const authData = authCodes.get(code.toUpperCase());
  
  if (!authData) {
    return res.status(404).json({ error: 'Код не найден' });
  }
  
  if (authData.expiresAt < Date.now()) {
    authCodes.delete(code);
    return res.status(410).json({ error: 'Код истёк' });
  }
  
  // Обновляем данные
  authData.telegramId = telegramId;
  authData.telegramUser = telegramUser;
  authData.verified = true;
  authCodes.set(code.toUpperCase(), authData);
  
  res.json({ success: true });
});

// GET /api/auth/me - Получить текущего пользователя по токену
router.get('/me', (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Не авторизован' });
  }
  
  const token = authHeader.substring(7);
  const session = sessions.get(token);
  
  if (!session) {
    return res.status(401).json({ error: 'Сессия не найдена' });
  }
  
  res.json({ user: session.user });
});

// POST /api/auth/logout - Выход
router.post('/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    sessions.delete(token);
  }
  
  res.json({ success: true });
});

// Экспорт для использования в боте
export { authCodes };
export default router;
