import express from 'express';
import crypto from 'crypto';
import { config } from '../config.js';
import {
  getUser,
  createUser,
  updateUser,
  setUserRole,
  getUsersByRole,
  createTrainerRequest,
  getTrainerRequestByUser,
  getLastTrainerRequest,
  getPendingTrainerRequests,
  approveTrainerRequest,
  rejectTrainerRequest,
  createProgram,
  getProgram,
  updateProgram,
  deleteProgram,
  getPublishedPrograms,
  getPersonalPrograms,
  getTrainerPrograms,
  createWorkoutLog,
  getWorkoutLogs,
  getWorkoutStats,
  purchaseProgram,
  hasPurchased,
  getPurchasedPrograms,
} from '../database/users.js';

const router = express.Router();

// ==========================================
// MIDDLEWARE: Валидация Telegram initData с HMAC-SHA256
// ==========================================

function validateTelegramInitData(initDataString, botToken) {
  try {
    const params = new URLSearchParams(initDataString);
    const hash = params.get('hash');
    if (!hash) return null;

    // Удаляем hash из параметров для проверки
    params.delete('hash');

    // Сортируем параметры и формируем строку
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    // Создаём secret key
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    // Вычисляем hash
    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    // Сравниваем
    if (calculatedHash !== hash) {
      console.warn('⚠️ Invalid Telegram hash');
      return null;
    }

    // Проверяем auth_date (не старше 1 часа)
    const authDate = parseInt(params.get('auth_date') || '0');
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > 3600) {
      console.warn('⚠️ Telegram auth data expired');
      return null;
    }

    // Парсим user
    const userJson = params.get('user');
    if (!userJson) return null;

    return JSON.parse(userJson);
  } catch (e) {
    console.error('Error validating initData:', e);
    return null;
  }
}

function parseInitData(initDataString) {
  try {
    const params = new URLSearchParams(initDataString);
    const userJson = params.get('user');
    if (!userJson) return null;
    return JSON.parse(userJson);
  } catch {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];

  if (!initData) {
    return res.status(401).json({ error: 'Missing Telegram init data' });
  }

  let telegramUser = null;

  // В production валидируем подпись, в development просто парсим
  if (config.nodeEnv === 'production' && config.telegram.botToken) {
    telegramUser = validateTelegramInitData(initData, config.telegram.botToken);
    if (!telegramUser) {
      console.log('⚠️ initData validation failed. NODE_ENV:', config.nodeEnv);
      console.log('⚠️ initData (first 100 chars):', initData.substring(0, 100));
    }
  } else {
    // В development режиме просто парсим данные без проверки
    telegramUser = parseInitData(initData);
  }

  if (!telegramUser || !telegramUser.id) {
    return res.status(401).json({ error: 'Invalid init data' });
  }

  // Получаем или создаём пользователя
  let user = getUser(telegramUser.id);
  if (!user) {
    user = createUser(telegramUser.id, {
      username: telegramUser.username || '',
      first_name: telegramUser.first_name || '',
      last_name: telegramUser.last_name || '',
    });
  }

  req.telegramUser = telegramUser;
  req.user = user;
  next();
}

// Экспортируем authMiddleware для использования в других роутах
export { authMiddleware };

// Проверка роли модератора
function requireModerator(req, res, next) {
  if (req.user.role !== 'MODERATOR' && req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Access denied. Moderator role required.' });
  }
  next();
}

// Проверка роли тренера
function requireTrainer(req, res, next) {
  if (req.user.role !== 'TRAINER' && req.user.role !== 'MODERATOR' && req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Access denied. Trainer role required.' });
  }
  next();
}

// ==========================================
// USER API
// ==========================================

// GET /api/user/me - Получить текущего пользователя
router.get('/user/me', authMiddleware, (req, res) => {
  const stats = getWorkoutStats(req.user.telegramId);

  res.json({
    success: true,
    user: {
      ...req.user,
      stats,
    },
  });
});

// POST /api/user/update - Обновить профиль
router.post('/user/update', authMiddleware, (req, res) => {
  const { firstName, lastName } = req.body;

  const updated = updateUser(req.user.telegramId, {
    firstName: firstName || req.user.firstName,
    lastName: lastName || req.user.lastName,
  });

  res.json({ success: true, user: updated });
});

// ==========================================
// TRAINER REQUEST API (заявки на тренера)
// ==========================================

// POST /api/trainer/request - Подать заявку на тренера
router.post('/trainer/request', authMiddleware, (req, res) => {
  const { bio, experience, specialization } = req.body;

  if (req.user.role === 'TRAINER') {
    return res.status(400).json({ error: 'Вы уже являетесь тренером' });
  }

  const existingRequest = getTrainerRequestByUser(req.user.telegramId);
  if (existingRequest) {
    return res.status(400).json({ error: 'У вас уже есть активная заявка на рассмотрении' });
  }

  if (!bio || !experience || !specialization) {
    return res.status(400).json({ error: 'Заполните все поля' });
  }

  const request = createTrainerRequest(req.user.telegramId, {
    bio,
    experience,
    specialization,
  });

  res.status(201).json({
    success: true,
    message: 'Заявка отправлена на рассмотрение',
    request,
  });
});

// GET /api/trainer/request/status - Статус своей заявки
router.get('/trainer/request/status', authMiddleware, (req, res) => {
  const request = getLastTrainerRequest(req.user.telegramId);

  res.json({
    hasRequest: !!request,
    request: request || null,
  });
});

// ==========================================
// MODERATOR API (панель модератора)
// ==========================================

// GET /api/moderator/requests - Список заявок на тренера
router.get('/moderator/requests', authMiddleware, requireModerator, (req, res) => {
  const requests = getPendingTrainerRequests();

  // Добавляем информацию о пользователях
  const enrichedRequests = requests.map(r => {
    const user = getUser(r.telegramId);
    return {
      ...r,
      user: user ? {
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
      } : null,
    };
  });

  res.json({
    success: true,
    count: enrichedRequests.length,
    requests: enrichedRequests,
  });
});

// POST /api/moderator/requests/:id/approve - Одобрить заявку
router.post('/moderator/requests/:id/approve', authMiddleware, requireModerator, (req, res) => {
  const { id } = req.params;

  const request = approveTrainerRequest(id, req.user.telegramId);

  if (!request) {
    return res.status(404).json({ error: 'Заявка не найдена' });
  }

  res.json({
    success: true,
    message: 'Заявка одобрена. Пользователь стал тренером.',
    request,
  });
});

// POST /api/moderator/requests/:id/reject - Отклонить заявку
router.post('/moderator/requests/:id/reject', authMiddleware, requireModerator, (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  const request = rejectTrainerRequest(id, req.user.telegramId, reason);

  if (!request) {
    return res.status(404).json({ error: 'Заявка не найдена' });
  }

  res.json({
    success: true,
    message: 'Заявка отклонена.',
    request,
  });
});

// ==========================================
// PROGRAMS API (программы тренировок)
// ВАЖНО: Специфичные роуты (/my/*) ПЕРЕД динамическими (/:id)
// ==========================================

// GET /api/programs/my/purchased - Мои купленные программы
// ВАЖНО: Этот роут должен быть ПЕРЕД /programs/:id
router.get('/programs/my/purchased', authMiddleware, (req, res) => {
  const programs = getPurchasedPrograms(req.user.telegramId);

  res.json({
    success: true,
    programs,
  });
});

// GET /api/programs/my/personal - Мои личные программы
// ВАЖНО: Этот роут должен быть ПЕРЕД /programs/:id
router.get('/programs/my/personal', authMiddleware, (req, res) => {
  const programs = getPersonalPrograms(req.user.telegramId);

  res.json({
    success: true,
    programs,
  });
});

// POST /api/programs/my/personal - Создать личную программу
router.post('/programs/my/personal', authMiddleware, (req, res) => {
  const { title, description, workouts } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'Название программы обязательно' });
  }

  const program = createProgram(req.user.telegramId, {
    title,
    description,
    workouts: workouts || [],
    isPersonal: true,
  });

  res.status(201).json({
    success: true,
    program,
  });
});

// PUT /api/programs/my/personal/:id - Обновить личную программу
router.put('/programs/my/personal/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const program = getProgram(id);

  if (!program || program.authorId !== req.user.telegramId || !program.isPersonal) {
    return res.status(404).json({ error: 'Программа не найдена' });
  }

  const updated = updateProgram(id, req.body);

  res.json({
    success: true,
    program: updated,
  });
});

// GET /api/programs - Список опубликованных программ (маркетплейс)
router.get('/programs', authMiddleware, (req, res) => {
  const programs = getPublishedPrograms();

  // Добавляем информацию о покупке
  const enrichedPrograms = programs.map(p => ({
    ...p,
    isPurchased: hasPurchased(req.user.telegramId, p.id),
    author: getUser(p.authorId),
  }));

  res.json({
    success: true,
    programs: enrichedPrograms,
  });
});

// GET /api/programs/:id - Детали программы
// ВАЖНО: Динамический роут ПОСЛЕ специфичных (/my/*)
router.get('/programs/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const program = getProgram(id);

  if (!program) {
    return res.status(404).json({ error: 'Программа не найдена' });
  }

  const isOwner = program.authorId === req.user.telegramId;
  const isPurchased = hasPurchased(req.user.telegramId, id);
  const canView = isOwner || isPurchased || program.price === 0;

  res.json({
    success: true,
    program: {
      ...program,
      workouts: canView ? program.workouts : [],
    },
    access: { isOwner, isPurchased, canView },
  });
});

// POST /api/programs/:id/purchase - Купить программу
router.post('/programs/:id/purchase', authMiddleware, (req, res) => {
  const { id } = req.params;
  const program = getProgram(id);

  if (!program) {
    return res.status(404).json({ error: 'Программа не найдена' });
  }

  if (hasPurchased(req.user.telegramId, id)) {
    return res.status(400).json({ error: 'Вы уже приобрели эту программу' });
  }

  // TODO: Интеграция с платёжной системой
  // Пока просто добавляем в купленные
  purchaseProgram(req.user.telegramId, id);

  res.json({
    success: true,
    message: 'Программа приобретена',
  });
});

// ==========================================
// TRAINER PROGRAMS (программы тренера)
// ==========================================

// GET /api/trainer/programs - Мои программы (тренер)
router.get('/trainer/programs', authMiddleware, requireTrainer, (req, res) => {
  const programs = getTrainerPrograms(req.user.telegramId);

  res.json({
    success: true,
    programs,
  });
});

// POST /api/trainer/programs - Создать программу (тренер)
router.post('/trainer/programs', authMiddleware, requireTrainer, (req, res) => {
  const { title, description, category, difficulty, durationWeeks, price, workouts } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'Название программы обязательно' });
  }

  const program = createProgram(req.user.telegramId, {
    title,
    description,
    category,
    difficulty,
    durationWeeks,
    price: price || 0,
    workouts: workouts || [],
    isPersonal: false,
  });

  res.status(201).json({
    success: true,
    program,
  });
});

// PUT /api/trainer/programs/:id - Обновить программу
router.put('/trainer/programs/:id', authMiddleware, requireTrainer, (req, res) => {
  const { id } = req.params;
  const program = getProgram(id);

  if (!program || program.authorId !== req.user.telegramId) {
    return res.status(404).json({ error: 'Программа не найдена' });
  }

  const updated = updateProgram(id, req.body);

  res.json({
    success: true,
    program: updated,
  });
});

// POST /api/trainer/programs/:id/publish - Опубликовать программу
router.post('/trainer/programs/:id/publish', authMiddleware, requireTrainer, (req, res) => {
  const { id } = req.params;
  const program = getProgram(id);

  if (!program || program.authorId !== req.user.telegramId) {
    return res.status(404).json({ error: 'Программа не найдена' });
  }

  if (!program.workouts || program.workouts.length === 0) {
    return res.status(400).json({ error: 'Добавьте хотя бы одну тренировку' });
  }

  const updated = updateProgram(id, { isPublished: true });

  res.json({
    success: true,
    message: 'Программа опубликована',
    program: updated,
  });
});

// ==========================================
// WORKOUT LOG API (дневник тренировок)
// ==========================================

// GET /api/workouts - История тренировок
router.get('/workouts', authMiddleware, (req, res) => {
  const logs = getWorkoutLogs(req.user.telegramId);

  res.json({
    success: true,
    workouts: logs,
  });
});

// POST /api/workouts - Записать тренировку
router.post('/workouts', authMiddleware, (req, res) => {
  const { programId, workoutTitle, exercises, duration, notes } = req.body;

  if (!workoutTitle) {
    return res.status(400).json({ error: 'Название тренировки обязательно' });
  }

  const log = createWorkoutLog(req.user.telegramId, {
    programId,
    workoutTitle,
    exercises: exercises || [],
    duration: duration || 0,
    notes,
  });

  res.status(201).json({
    success: true,
    workout: log,
  });
});

// GET /api/workouts/stats - Статистика тренировок
router.get('/workouts/stats', authMiddleware, (req, res) => {
  const stats = getWorkoutStats(req.user.telegramId);

  res.json({
    success: true,
    stats,
  });
});

// ==========================================
// HEALTH CHECK
// ==========================================

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export { authMiddleware };
export default router;
