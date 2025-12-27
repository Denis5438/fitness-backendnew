// MongoDB Database Layer for FitMarket
// Replaces SQLite users.js

import {
  User,
  TrainerRequest,
  Program,
  WorkoutLog,
  Purchase,
  AIMessage,
  News,
  SupportMessage,
  ExerciseRecord
} from './models.js';

// ==========================================
// USERS
// ==========================================

export async function getUser(telegramId) {
  const user = await User.findOne({ telegram_id: telegramId }).lean();
  if (!user) return null;

  // Автоматическая миграция: если roles пустой, мигрируем из role
  let roles = user.roles || [];
  if (roles.length === 0 && user.role) {
    // Мигрируем старое поле role в массив roles
    roles = ['USER'];
    if (user.role !== 'USER') {
      roles.push(user.role);
    }
    // Сохраняем миграцию в БД
    await User.updateOne(
      { telegram_id: telegramId },
      { $set: { roles: roles } }
    );
  }

  // Для обратной совместимости возвращаем главную роль в поле role
  const primaryRole = roles.includes('ADMIN') ? 'ADMIN'
    : roles.includes('MODERATOR') ? 'MODERATOR'
      : roles.includes('TRAINER') ? 'TRAINER'
        : 'USER';

  return {
    telegramId: user.telegram_id,
    username: user.username,
    firstName: user.first_name,
    lastName: user.last_name,
    displayName: user.display_name || '', // Кастомное имя
    avatarUrl: user.avatar_url || '', // Аватар
    role: primaryRole, // Главная роль для обратной совместимости
    roles: roles, // Полный массив ролей
    subscriptionTier: user.subscription_tier,
    balance: user.balance || 0,
    lastSeenNewsId: user.last_seen_news_id || '',
    aiRequestsCount: user.ai_requests_count,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

export async function createUser(telegramId, userData) {
  // Check if exists
  const existing = await getUser(telegramId);
  if (existing) return existing;

  await User.create({
    telegram_id: telegramId,
    username: userData.username || userData.first_name || '',
    first_name: userData.first_name || '',
    last_name: userData.last_name || '',
    role: 'USER',
    roles: ['USER'], // Новый формат
  });

  return getUser(telegramId);
}

export async function updateUser(telegramId, updates) {
  const user = await getUser(telegramId);
  if (!user) return null;

  const updateObj = {};
  if (updates.firstName !== undefined) updateObj.first_name = updates.firstName;
  if (updates.lastName !== undefined) updateObj.last_name = updates.lastName;
  if (updates.username !== undefined) updateObj.username = updates.username;

  if (Object.keys(updateObj).length > 0) {
    await User.updateOne({ telegram_id: telegramId }, { $set: updateObj });
  }

  return getUser(telegramId);
}

// Старая функция - оставляем для обратной совместимости
export async function setUserRole(telegramId, role) {
  // Обновляем и role, и roles для совместимости
  const roles = role === 'USER' ? ['USER'] : ['USER', role];
  await User.updateOne(
    { telegram_id: telegramId },
    { $set: { role: role, roles: roles } }
  );
  return getUser(telegramId);
}

// ==========================================
// НОВЫЕ ФУНКЦИИ ДЛЯ МНОЖЕСТВЕННЫХ РОЛЕЙ
// ==========================================

// Добавить роль пользователю
export async function addRole(telegramId, role) {
  const user = await User.findOne({ telegram_id: telegramId });
  if (!user) {
    return { success: false, error: 'user_not_found', message: 'Пользователь не найден' };
  }

  // Получаем текущие роли
  let roles = user.roles || [];
  if (roles.length === 0 && user.role) {
    roles = user.role === 'USER' ? ['USER'] : ['USER', user.role];
  }

  // Проверяем, есть ли уже эта роль
  if (roles.includes(role)) {
    return { success: true, alreadyHas: true, message: 'Роль уже назначена' };
  }

  // Добавляем роль
  roles.push(role);

  // Определяем главную роль для обратной совместимости
  const primaryRole = roles.includes('ADMIN') ? 'ADMIN'
    : roles.includes('MODERATOR') ? 'MODERATOR'
      : roles.includes('TRAINER') ? 'TRAINER'
        : 'USER';

  await User.updateOne(
    { telegram_id: telegramId },
    { $set: { roles: roles, role: primaryRole } }
  );

  return { success: true, message: `Роль ${role} назначена` };
}

// Удалить конкретную роль у пользователя
export async function removeRole(telegramId, role) {
  const user = await User.findOne({ telegram_id: telegramId });
  if (!user) {
    return { success: false, error: 'user_not_found', message: 'Пользователь не найден' };
  }

  // Получаем текущие роли
  let roles = user.roles || [];
  if (roles.length === 0 && user.role) {
    roles = user.role === 'USER' ? ['USER'] : ['USER', user.role];
  }

  // Нельзя удалить роль USER
  if (role === 'USER') {
    return { success: false, error: 'cannot_remove_user', message: 'Нельзя удалить базовую роль USER' };
  }

  // Проверяем, есть ли эта роль
  if (!roles.includes(role)) {
    return { success: true, notHad: true, message: 'Роль не была назначена' };
  }

  // Удаляем роль
  roles = roles.filter(r => r !== role);

  // Определяем главную роль
  const primaryRole = roles.includes('ADMIN') ? 'ADMIN'
    : roles.includes('MODERATOR') ? 'MODERATOR'
      : roles.includes('TRAINER') ? 'TRAINER'
        : 'USER';

  await User.updateOne(
    { telegram_id: telegramId },
    { $set: { roles: roles, role: primaryRole } }
  );

  return { success: true, message: `Роль ${role} снята` };
}

// Проверить наличие роли
export async function hasRole(telegramId, role) {
  const user = await getUser(telegramId);
  if (!user) return false;
  return user.roles.includes(role);
}

// Получить пользователей с определённой ролью (обновлено для массива)
export async function getUsersByRole(role) {
  // Ищем в массиве roles
  const users = await User.find({ roles: role }).lean();
  return users.map(u => {
    const roles = u.roles || (u.role === 'USER' ? ['USER'] : ['USER', u.role]);
    return {
      telegramId: u.telegram_id,
      username: u.username,
      firstName: u.first_name,
      lastName: u.last_name,
      role: u.role,
      roles: roles,
    };
  });
}

export async function findUserByUsername(username) {
  const cleanUsername = username.replace('@', '').toLowerCase();
  const user = await User.findOne({
    username: { $regex: new RegExp(`^${cleanUsername}$`, 'i') }
  }).lean();

  if (!user) return null;

  return {
    telegramId: user.telegram_id,
    username: user.username,
    firstName: user.first_name,
    lastName: user.last_name,
    role: user.role,
  };
}

// ==========================================
// TRAINER REQUESTS
// ==========================================

export async function createTrainerRequest(telegramId, requestData) {
  const id = `tr_${Date.now()}`;

  await TrainerRequest.create({
    id,
    telegram_id: telegramId,
    bio: requestData.bio || '',
    experience: requestData.experience || '',
    specialization: requestData.specialization || '',
    status: 'PENDING',
  });

  return { id, status: 'PENDING' };
}

export async function getTrainerRequestByUser(telegramId) {
  // Возвращаем только PENDING заявки, старые одобренные/отклонённые не блокируют
  return TrainerRequest.findOne({ telegram_id: telegramId, status: 'PENDING' }).lean();
}

export async function getLastTrainerRequest(telegramId) {
  return TrainerRequest.findOne({ telegram_id: telegramId })
    .sort({ created_at: -1 })
    .lean();
}

export async function getPendingTrainerRequests() {
  const requests = await TrainerRequest.find({ status: 'PENDING' })
    .sort({ created_at: 1 })
    .lean();

  // Enrich with user data
  const enriched = [];
  for (const req of requests) {
    const user = await getUser(req.telegram_id);
    enriched.push({
      ...req,
      user: user || { telegramId: req.telegram_id, firstName: 'Unknown' },
    });
  }

  return enriched;
}

export async function approveTrainerRequest(requestId, reviewerId) {
  const request = await TrainerRequest.findOne({ id: requestId }).lean();
  if (!request) return null;

  await TrainerRequest.updateOne(
    { id: requestId },
    {
      $set: {
        status: 'APPROVED',
        reviewed_by: reviewerId,
        reviewed_at: new Date()
      }
    }
  );

  // Update user role
  await setUserRole(request.telegram_id, 'TRAINER');

  return TrainerRequest.findOne({ id: requestId }).lean();
}

export async function rejectTrainerRequest(requestId, reviewerId, reason = '') {
  await TrainerRequest.updateOne(
    { id: requestId },
    {
      $set: {
        status: 'REJECTED',
        reviewed_by: reviewerId,
        reviewed_at: new Date(),
        rejection_reason: reason,
      }
    }
  );

  return TrainerRequest.findOne({ id: requestId }).lean();
}

// ==========================================
// PROGRAMS
// ==========================================

export async function createProgram(authorId, programData) {
  const id = programData.id || `prog_${Date.now()}`;

  await Program.create({
    id,
    author_id: authorId,
    title: programData.title || 'Без названия',
    description: programData.description || '',
    category: programData.category || 'general',
    difficulty: programData.difficulty || 'intermediate',
    duration_weeks: programData.durationWeeks || 4,
    price: programData.price || 0,
    is_published: programData.isPublished || false,
    is_personal: programData.isPersonal || false,
    workouts: programData.workouts || [],
  });

  return getProgram(id);
}

export async function getProgram(programId) {
  const prog = await Program.findOne({ id: programId }).lean();
  if (!prog) return null;

  return {
    id: prog.id,
    authorId: prog.author_id,
    title: prog.title,
    description: prog.description,
    category: prog.category,
    difficulty: prog.difficulty,
    durationWeeks: prog.duration_weeks,
    price: prog.price,
    isPublished: prog.is_published,
    isPersonal: prog.is_personal,
    workouts: prog.workouts,
    purchaseCount: prog.purchase_count,
    createdAt: prog.created_at,
    updatedAt: prog.updated_at,
  };
}

export async function updateProgram(programId, updates) {
  const updateObj = {};
  if (updates.title !== undefined) updateObj.title = updates.title;
  if (updates.description !== undefined) updateObj.description = updates.description;
  if (updates.category !== undefined) updateObj.category = updates.category;
  if (updates.difficulty !== undefined) updateObj.difficulty = updates.difficulty;
  if (updates.durationWeeks !== undefined) updateObj.duration_weeks = updates.durationWeeks;
  if (updates.price !== undefined) updateObj.price = updates.price;
  if (updates.isPublished !== undefined) updateObj.is_published = updates.isPublished;
  if (updates.isPersonal !== undefined) updateObj.is_personal = updates.isPersonal;
  if (updates.workouts !== undefined) updateObj.workouts = updates.workouts;

  if (Object.keys(updateObj).length > 0) {
    await Program.updateOne({ id: programId }, { $set: updateObj });
  }

  return getProgram(programId);
}

export async function deleteProgram(programId) {
  const result = await Program.deleteOne({ id: programId });
  return result.deletedCount > 0;
}

export async function getPublishedPrograms() {
  const programs = await Program.find({ is_published: true })
    .sort({ created_at: -1 })
    .lean();

  const enriched = [];
  for (const prog of programs) {
    const author = await getUser(prog.author_id);
    enriched.push({
      id: prog.id,
      authorId: prog.author_id,
      authorName: author ? `${author.firstName} ${author.lastName}`.trim() : 'Тренер',
      title: prog.title,
      description: prog.description,
      category: prog.category,
      difficulty: prog.difficulty,
      durationWeeks: prog.duration_weeks,
      price: prog.price,
      isPublished: prog.is_published,
      workouts: prog.workouts,
      purchaseCount: prog.purchase_count,
      createdAt: prog.created_at,
    });
  }

  return enriched;
}

export async function getPersonalPrograms(telegramId) {
  const programs = await Program.find({
    author_id: telegramId,
    is_personal: true
  }).sort({ created_at: -1 }).lean();

  return programs.map(prog => ({
    id: prog.id,
    title: prog.title,
    workouts: prog.workouts,
    createdAt: prog.created_at,
  }));
}

export async function getTrainerPrograms(trainerId) {
  const programs = await Program.find({ author_id: trainerId })
    .sort({ created_at: -1 })
    .lean();

  return programs.map(prog => ({
    id: prog.id,
    title: prog.title,
    description: prog.description,
    category: prog.category,
    price: prog.price,
    isPublished: prog.is_published,
    workouts: prog.workouts,
    purchaseCount: prog.purchase_count,
    createdAt: prog.created_at,
  }));
}

// ==========================================
// WORKOUT LOGS
// ==========================================

export async function createWorkoutLog(telegramId, logData) {
  const id = `wlog_${Date.now()}`;

  await WorkoutLog.create({
    id,
    telegram_id: telegramId,
    program_id: logData.programId,
    workout_title: logData.workoutTitle || 'Тренировка',
    exercises: logData.exercises || [],
    duration: logData.duration || 0,
    volume: logData.volume || 0,
    notes: logData.notes || '',
    completed_at: new Date(),
  });

  return { id };
}

export async function getWorkoutLogs(telegramId, limit = 50) {
  const logs = await WorkoutLog.find({ telegram_id: telegramId })
    .sort({ completed_at: -1 })
    .limit(limit)
    .lean();

  return logs.map(log => ({
    id: log.id,
    programId: log.program_id,
    workoutTitle: log.workout_title,
    exercises: log.exercises,
    duration: log.duration,
    volume: log.volume || 0,
    notes: log.notes,
    completedAt: log.completed_at,
  }));
}

export async function getWorkoutStats(telegramId) {
  const logs = await WorkoutLog.find({ telegram_id: telegramId }).lean();

  return {
    totalWorkouts: logs.length,
    totalDuration: logs.reduce((sum, l) => sum + (l.duration || 0), 0),
    totalExercises: logs.reduce((sum, l) => sum + (l.exercises?.length || 0), 0),
  };
}

// ==========================================
// PURCHASES
// ==========================================

export async function purchaseProgram(telegramId, programId) {
  try {
    await Purchase.create({
      telegram_id: telegramId,
      program_id: programId,
    });

    // Increment purchase count
    await Program.updateOne(
      { id: programId },
      { $inc: { purchase_count: 1 } }
    );

    return { success: true };
  } catch (error) {
    if (error.code === 11000) {
      // Duplicate key - already purchased
      return { success: false, error: 'Already purchased' };
    }
    throw error;
  }
}

export async function hasPurchased(telegramId, programId) {
  const purchase = await Purchase.findOne({
    telegram_id: telegramId,
    program_id: programId
  }).lean();
  return !!purchase;
}

export async function getPurchasedPrograms(telegramId) {
  const purchases = await Purchase.find({ telegram_id: telegramId }).lean();

  const programs = [];
  for (const p of purchases) {
    const prog = await getProgram(p.program_id);
    if (prog) {
      programs.push({
        ...prog,
        purchasedAt: p.purchased_at,
      });
    }
  }

  return programs;
}

// ==========================================
// AI MESSAGES
// ==========================================

export async function saveAIMessage(userId, role, content) {
  await AIMessage.create({
    user_id: userId,
    role,
    content,
  });
}

export async function getAIHistory(userId, limit = 20) {
  const messages = await AIMessage.find({ user_id: userId })
    .sort({ created_at: -1 })
    .limit(limit)
    .lean();

  return messages.reverse().map(m => ({
    role: m.role,
    content: m.content,
  }));
}

export async function clearAIHistory(userId) {
  await AIMessage.deleteMany({ user_id: userId });
}

export async function incrementAIRequests(userId) {
  await User.updateOne(
    { telegram_id: userId },
    { $inc: { ai_requests_count: 1 } }
  );
}

export async function resetAIRequestsIfNeeded(userId) {
  const user = await User.findOne({ telegram_id: userId }).lean();
  if (!user) return;

  const now = new Date();
  const resetDate = user.ai_requests_reset_date ? new Date(user.ai_requests_reset_date) : null;

  if (!resetDate || now >= resetDate) {
    const nextReset = new Date();
    nextReset.setDate(nextReset.getDate() + 1);
    nextReset.setHours(0, 0, 0, 0);

    await User.updateOne(
      { telegram_id: userId },
      { $set: { ai_requests_count: 0, ai_requests_reset_date: nextReset } }
    );
  }
}

// ==========================================
// NEWS
// ==========================================

export async function createNews(authorId, authorName, title, content) {
  const id = `news_${Date.now()}`;

  await News.create({
    id,
    author_id: authorId,
    author_name: authorName,
    title,
    content,
  });

  return { id };
}

export async function getAllNews() {
  const news = await News.find()
    .sort({ created_at: -1 })
    .lean();

  return news.map(n => ({
    id: n.id,
    authorId: n.author_id,
    authorName: n.author_name,
    title: n.title,
    content: n.content,
    createdAt: n.created_at,
  }));
}

export async function deleteNews(newsId) {
  const result = await News.deleteOne({ id: newsId });
  return result.deletedCount > 0;
}

// ==========================================
// SUPPORT MESSAGES
// ==========================================

export async function createSupportMessage(fromUserId, fromUserName, fromUsername, toUserId, message) {
  const id = `msg_${Date.now()}`;

  await SupportMessage.create({
    id,
    from_user_id: fromUserId,
    from_user_name: fromUserName,
    from_username: fromUsername,
    to_user_id: toUserId,
    message,
  });

  return { id };
}

export async function getSupportMessages() {
  return SupportMessage.find().sort({ created_at: 1 }).lean();
}

export async function getUserSupportMessages(userId) {
  return SupportMessage.find({
    $or: [
      { from_user_id: userId },
      { to_user_id: String(userId) }
    ]
  }).sort({ created_at: 1 }).lean();
}

export async function getUniqueSupportUsers() {
  const messages = await SupportMessage.find({ to_user_id: 'support' }).lean();
  const uniqueUsers = new Map();

  for (const msg of messages) {
    if (!uniqueUsers.has(msg.from_user_id)) {
      uniqueUsers.set(msg.from_user_id, {
        id: msg.from_user_id,
        name: msg.from_user_name,
        username: msg.from_username,
      });
    }
  }

  return Array.from(uniqueUsers.values());
}

// ==========================================
// EXERCISE RECORDS
// ==========================================

export async function getExerciseRecords(telegramId) {
  const records = await ExerciseRecord.find({ telegram_id: telegramId }).lean();

  // Convert to object keyed by exercise name
  const result = {};
  for (const r of records) {
    result[r.exercise_name] = {
      weight: r.best_weight,
      reps: r.best_reps,
      volume: r.best_volume,
    };
  }
  return result;
}

export async function saveExerciseRecords(telegramId, records) {
  // records is an object like { "Жим лёжа": { weight: 100, reps: 8 }, ... }
  for (const [exerciseName, data] of Object.entries(records)) {
    const volume = (data.weight || 0) * (data.reps || 0);

    await ExerciseRecord.updateOne(
      { telegram_id: telegramId, exercise_name: exerciseName },
      {
        $set: {
          best_weight: data.weight || 0,
          best_reps: data.reps || 0,
          best_volume: volume,
          updated_at: new Date(),
        }
      },
      { upsert: true }
    );
  }
  return true;
}

// ==========================================
// NOTIFICATIONS (Last Seen News)
// ==========================================

export async function updateLastSeenNews(telegramId, newsId) {
  await User.updateOne(
    { telegram_id: telegramId },
    { $set: { last_seen_news_id: newsId } }
  );
  return true;
}

// ==========================================
// ACCOUNT RESET (Admin)
// ==========================================

export async function resetUserAccount(telegramId) {
  // Удаляем все тренировки пользователя
  await WorkoutLog.deleteMany({ telegram_id: telegramId });

  // Удаляем все личные программы пользователя
  await Program.deleteMany({ author_id: telegramId, is_published: false });

  // Удаляем все покупки
  await Purchase.deleteMany({ telegram_id: telegramId });

  // Удаляем рекорды упражнений
  await ExerciseRecord.deleteMany({ telegram_id: telegramId });

  // Сбрасываем баланс но СОХРАНЯЕМ роль!
  await User.updateOne(
    { telegram_id: telegramId },
    {
      $set: {
        balance: 0,
        last_seen_news_id: '',
        ai_requests_count: 0,
      }
    }
  );

  return { success: true, message: 'Аккаунт успешно сброшен' };
}

// ==========================================
// BALANCE
// ==========================================

export async function updateUserBalance(telegramId, amount) {
  await User.updateOne(
    { telegram_id: telegramId },
    { $inc: { balance: amount } }
  );
  return true;
}

export async function setUserBalance(telegramId, balance) {
  await User.updateOne(
    { telegram_id: telegramId },
    { $set: { balance: balance } }
  );
  return true;
}
