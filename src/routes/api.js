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
  getExerciseRecords,
  saveExerciseRecords,
  updateLastSeenNews,
  resetUserAccount,
} from '../database/users.js';
import { Settings, User } from '../database/models.js';

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

async function authMiddleware(req, res, next) {
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

      // Fallback: если валидация не прошла, пробуем просто распарсить
      // и проверяем является ли это админом (для тестирования через браузер)
      const parsedUser = parseInitData(initData);
      if (parsedUser && parsedUser.id === config.adminTelegramId) {
        console.log('✅ Allowing admin bypass for testing');
        telegramUser = parsedUser;
      }
    }
  } else {
    // В development режиме просто парсим данные без проверки
    telegramUser = parseInitData(initData);
  }

  if (!telegramUser || !telegramUser.id) {
    return res.status(401).json({ error: 'Invalid init data' });
  }

  try {
    // Проверяем есть ли пользователь в БД (регистрация через /start в боте)
    let user = await getUser(telegramUser.id);

    if (!user) {
      // Пользователь не зарегистрирован через бота
      console.log(`⚠️ User ${telegramUser.id} not registered. Needs to /start bot first.`);
      return res.status(403).json({
        error: 'not_registered',
        message: 'Для использования приложения сначала напишите /start боту'
      });
    }

    // FORCE ADMIN ROLE: Если ID совпадает с конфигом, но роль не ADMIN — обновляем
    console.log('🔍 Auth check:', { userId: user.telegramId, adminId: config.adminTelegramId, userRole: user.role });
    if (config.adminTelegramId && user.telegramId === config.adminTelegramId && user.role !== 'ADMIN') {
      console.log(`👑 Auto-promoting user ${user.telegramId} to ADMIN`);
      await setUserRole(user.telegramId, 'ADMIN');
      user.role = 'ADMIN'; // Обновляем объект в памяти
    }

    req.telegramUser = telegramUser;
    req.user = user;
    next();
  } catch (error) {
    console.error('❌ Auth middleware error:', error);
    return res.status(500).json({ error: 'Database error' });
  }
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
router.get('/user/me', authMiddleware, async (req, res) => {
  try {
    const stats = await getWorkoutStats(req.user.telegramId);

    res.json({
      success: true,
      user: {
        ...req.user,
        stats,
      },
    });
  } catch (error) {
    console.error('Error getting user:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/user/update - Обновить профиль
router.post('/user/update', authMiddleware, async (req, res) => {
  try {
    const { displayName, avatarUrl } = req.body;

    // Валидация displayName
    if (displayName !== undefined) {
      if (typeof displayName !== 'string' || displayName.trim().length < 2) {
        return res.status(400).json({ error: 'Имя должно содержать минимум 2 символа' });
      }
      if (displayName.length > 50) {
        return res.status(400).json({ error: 'Имя слишком длинное (максимум 50 символов)' });
      }
    }

    // Валидация avatarUrl (Base64 или URL)
    if (avatarUrl !== undefined) {
      if (typeof avatarUrl !== 'string') {
        return res.status(400).json({ error: 'Некорректный формат аватара' });
      }
      // Проверяем размер Base64 (примерно 5MB в base64 = ~6.6MB)
      if (avatarUrl.length > 7000000) {
        return res.status(400).json({ error: 'Файл слишком большой (максимум 5MB)' });
      }
    }

    // Обновляем только переданные поля
    const updateData = {};
    if (displayName !== undefined) updateData.display_name = displayName.trim();
    if (avatarUrl !== undefined) updateData.avatar_url = avatarUrl;

    if (Object.keys(updateData).length > 0) {
      await User.updateOne(
        { telegram_id: req.user.telegramId },
        { $set: updateData }
      );
    }

    const updated = await getUser(req.user.telegramId);
    console.log(`✅ Профиль обновлён для ${req.user.telegramId}`);
    res.json({ success: true, user: updated });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// POST /api/user/seen-news - Отметить новости как прочитанные
router.post('/user/seen-news', authMiddleware, async (req, res) => {
  try {
    const { newsId } = req.body;
    if (!newsId) {
      return res.status(400).json({ error: 'Не указан newsId' });
    }

    await updateLastSeenNews(req.user.telegramId, newsId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating seen news:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/admin/reset-account - Сбросить аккаунт пользователя (только админ)
router.post('/admin/reset-account', authMiddleware, async (req, res) => {
  try {
    // Только админ может сбрасывать аккаунты
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }

    const { telegramId } = req.body;
    if (!telegramId) {
      return res.status(400).json({ error: 'Не указан Telegram ID' });
    }

    // Проверяем что пользователь существует
    const targetUser = await getUser(parseInt(telegramId));
    if (!targetUser) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const result = await resetUserAccount(parseInt(telegramId));
    console.log(`♻️ Admin ${req.user.telegramId} reset account of user ${telegramId}`);

    res.json(result);
  } catch (error) {
    console.error('Error resetting account:', error);
    res.status(500).json({ error: 'Ошибка сброса аккаунта' });
  }
});

// ==========================================
// GLOBAL SETTINGS API
// ==========================================

// GET /api/settings/new-year-theme - Получить статус новогодней темы (публичный)
router.get('/settings/new-year-theme', async (req, res) => {
  try {
    const setting = await Settings.findOne({ key: 'newYearThemeEnabled' });
    res.json({ enabled: setting?.value ?? true }); // По умолчанию включено
  } catch (error) {
    console.error('Error getting new year theme setting:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// POST /api/settings/new-year-theme - Установить статус новогодней темы (только админ/модератор)
router.post('/settings/new-year-theme', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'MODERATOR') {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }

    const { enabled } = req.body;

    await Settings.updateOne(
      { key: 'newYearThemeEnabled' },
      { $set: { value: !!enabled } },
      { upsert: true }
    );

    console.log(`🎄 ${req.user.telegramId} set newYearTheme to ${enabled}`);
    res.json({ success: true, enabled: !!enabled });
  } catch (error) {
    console.error('Error setting new year theme:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ==========================================
// TRAINER REQUEST API (заявки на тренера)
// ==========================================

// POST /api/trainer/request - Подать заявку на тренера
router.post('/trainer/request', authMiddleware, async (req, res) => {
  const { bio, experience, specialization, certPhotoUrl } = req.body;

  if (req.user.role === 'TRAINER') {
    return res.status(400).json({ error: 'Вы уже являетесь тренером' });
  }

  const existingRequest = await getTrainerRequestByUser(req.user.telegramId);
  if (existingRequest) {
    return res.status(400).json({ error: 'У вас уже есть активная заявка на рассмотрении' });
  }

  // Поля необязательные — модератор просто одобряет или отклоняет
  const request = await createTrainerRequest(req.user.telegramId, {
    bio: bio || '',
    experience: experience || '',
    specialization: specialization || '',
    certPhotoUrl: certPhotoUrl || '',
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
router.get('/workouts/stats', authMiddleware, async (req, res) => {
  try {
    const stats = await getWorkoutStats(req.user.telegramId);
    res.json({ success: true, stats });
  } catch (error) {
    console.error('Error getting workout stats:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/workouts/history - Получить историю тренировок
router.get('/workouts/history', authMiddleware, async (req, res) => {
  try {
    const history = await getWorkoutLogs(req.user.telegramId, 100);
    res.json({ success: true, history });
  } catch (error) {
    console.error('Error getting workout history:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/workouts/log - Сохранить тренировку
router.post('/workouts/log', authMiddleware, async (req, res) => {
  try {
    const { programId, workoutTitle, exercises, duration, volume, notes, records } = req.body;

    const result = await createWorkoutLog(req.user.telegramId, {
      programId,
      workoutTitle,
      exercises,
      duration,
      volume,
      notes,
    });

    // Сохраняем рекорды если есть
    if (records && Object.keys(records).length > 0) {
      await saveExerciseRecords(req.user.telegramId, records);
    }

    res.json({ success: true, workoutId: result.id });
  } catch (error) {
    console.error('Error saving workout:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/workouts/records - Получить рекорды упражнений
router.get('/workouts/records', authMiddleware, async (req, res) => {
  try {
    const records = await getExerciseRecords(req.user.telegramId);
    res.json({ success: true, records });
  } catch (error) {
    console.error('Error getting exercise records:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/programs/my - Получить свои программы
router.get('/programs/my', authMiddleware, async (req, res) => {
  try {
    const programs = await getPersonalPrograms(req.user.telegramId);
    res.json({ success: true, programs });
  } catch (error) {
    console.error('Error getting personal programs:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/programs/my - Сохранить личную программу
router.post('/programs/my', authMiddleware, async (req, res) => {
  try {
    const { id, title, exercises } = req.body;

    // Проверяем, существует ли уже программа с таким ID
    const existingProgram = id ? await getProgram(id) : null;

    if (existingProgram && existingProgram.authorId === req.user.telegramId) {
      // Обновляем существующую программу
      const updated = await updateProgram(id, {
        title,
        workouts: exercises,
      });
      return res.json({ success: true, program: updated });
    }

    // Создаём новую программу
    const program = await createProgram(req.user.telegramId, {
      id, // Используем переданный ID
      title,
      workouts: exercises,
      isPersonal: true,
      isPublished: false,
    });
    res.json({ success: true, program });
  } catch (error) {
    console.error('Error saving personal program:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// DELETE /api/programs/my/:id - Удалить личную программу
router.delete('/programs/my/:id', authMiddleware, async (req, res) => {
  try {
    const program = await getProgram(req.params.id);
    if (!program) {
      return res.status(404).json({ error: 'Программа не найдена' });
    }
    if (program.authorId !== req.user.telegramId) {
      return res.status(403).json({ error: 'Нельзя удалить чужую программу' });
    }
    await deleteProgram(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting program:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/purchases - Получить купленные программы
router.get('/purchases', authMiddleware, async (req, res) => {
  try {
    const programs = await getPurchasedPrograms(req.user.telegramId);
    res.json({ success: true, programs });
  } catch (error) {
    console.error('Error getting purchases:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// ==========================================
// HEALTH CHECK
// ==========================================

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default router;
