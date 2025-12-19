// Хранилище пользователей с ролями - SQLite версия
// Роли: USER, TRAINER, MODERATOR

import { getDatabase } from './db.js';

// ==========================================
// ПОЛЬЗОВАТЕЛИ
// ==========================================

export function getUser(telegramId) {
  const db = getDatabase();
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  if (!user) return null;
  
  return {
    telegramId: user.telegram_id,
    username: user.username,
    firstName: user.first_name,
    lastName: user.last_name,
    role: user.role,
    subscriptionTier: user.subscription_tier,
    aiRequestsCount: user.ai_requests_count,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

export function createUser(telegramId, userData) {
  const db = getDatabase();
  
  // Проверяем, существует ли уже
  const existing = getUser(telegramId);
  if (existing) return existing;
  
  db.prepare(`
    INSERT INTO users (telegram_id, username, first_name, last_name, role)
    VALUES (?, ?, ?, ?, 'USER')
  `).run(
    telegramId,
    userData.username || userData.first_name || '',
    userData.first_name || '',
    userData.last_name || ''
  );
  
  return getUser(telegramId);
}

export function updateUser(telegramId, updates) {
  const db = getDatabase();
  const user = getUser(telegramId);
  if (!user) return null;
  
  const fields = [];
  const values = [];
  
  if (updates.firstName !== undefined) {
    fields.push('first_name = ?');
    values.push(updates.firstName);
  }
  if (updates.lastName !== undefined) {
    fields.push('last_name = ?');
    values.push(updates.lastName);
  }
  if (updates.username !== undefined) {
    fields.push('username = ?');
    values.push(updates.username);
  }
  
  if (fields.length > 0) {
    fields.push("updated_at = datetime('now')");
    values.push(telegramId);
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE telegram_id = ?`).run(...values);
  }
  
  return getUser(telegramId);
}

export function setUserRole(telegramId, role) {
  const db = getDatabase();
  db.prepare(`UPDATE users SET role = ?, updated_at = datetime('now') WHERE telegram_id = ?`).run(role, telegramId);
  return getUser(telegramId);
}

export function getUsersByRole(role) {
  const db = getDatabase();
  const users = db.prepare('SELECT * FROM users WHERE role = ?').all(role);
  return users.map(u => ({
    telegramId: u.telegram_id,
    username: u.username,
    firstName: u.first_name,
    lastName: u.last_name,
    role: u.role,
  }));
}

export function findUserByUsername(username) {
  const db = getDatabase();
  const cleanUsername = username.replace('@', '').toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE LOWER(username) = ?').get(cleanUsername);
  if (!user) return null;
  
  return {
    telegramId: user.telegram_id,
    username: user.username,
    firstName: user.first_name,
    lastName: user.last_name,
    role: user.role,
  };
}

export function getAllUsers() {
  const db = getDatabase();
  const users = db.prepare('SELECT * FROM users').all();
  return users.map(u => ({
    telegramId: u.telegram_id,
    username: u.username,
    firstName: u.first_name,
    lastName: u.last_name,
    role: u.role,
  }));
}

// ==========================================
// ЗАЯВКИ НА ТРЕНЕРА
// ==========================================

export function createTrainerRequest(telegramId, data) {
  const db = getDatabase();
  const id = `req_${Date.now()}_${telegramId}`;
  
  db.prepare(`
    INSERT INTO trainer_requests (id, telegram_id, bio, experience, specialization)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, telegramId, data.bio || '', data.experience || '', data.specialization || '');
  
  return getTrainerRequest(id);
}

export function getTrainerRequest(requestId) {
  const db = getDatabase();
  const req = db.prepare('SELECT * FROM trainer_requests WHERE id = ?').get(requestId);
  if (!req) return null;
  
  return {
    id: req.id,
    telegramId: req.telegram_id,
    bio: req.bio,
    experience: req.experience,
    specialization: req.specialization,
    status: req.status,
    reviewedBy: req.reviewed_by,
    reviewedAt: req.reviewed_at,
    rejectionReason: req.rejection_reason,
    createdAt: req.created_at,
  };
}

export function getTrainerRequestByUser(telegramId) {
  const db = getDatabase();
  const req = db.prepare(`
    SELECT * FROM trainer_requests 
    WHERE telegram_id = ? AND status = 'PENDING'
    ORDER BY created_at DESC LIMIT 1
  `).get(telegramId);
  
  return req ? getTrainerRequest(req.id) : null;
}

export function getLastTrainerRequest(telegramId) {
  const db = getDatabase();
  const req = db.prepare(`
    SELECT * FROM trainer_requests 
    WHERE telegram_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(telegramId);
  
  return req ? getTrainerRequest(req.id) : null;
}

export function getPendingTrainerRequests() {
  const db = getDatabase();
  const requests = db.prepare(`
    SELECT * FROM trainer_requests 
    WHERE status = 'PENDING'
    ORDER BY created_at ASC
  `).all();
  
  return requests.map(req => getTrainerRequest(req.id));
}

export function approveTrainerRequest(requestId, moderatorId) {
  const db = getDatabase();
  const request = getTrainerRequest(requestId);
  if (!request) return null;
  
  db.prepare(`
    UPDATE trainer_requests 
    SET status = 'APPROVED', reviewed_by = ?, reviewed_at = datetime('now')
    WHERE id = ?
  `).run(moderatorId, requestId);
  
  // Обновляем роль пользователя
  setUserRole(request.telegramId, 'TRAINER');
  
  return getTrainerRequest(requestId);
}

export function rejectTrainerRequest(requestId, moderatorId, reason) {
  const db = getDatabase();
  
  db.prepare(`
    UPDATE trainer_requests 
    SET status = 'REJECTED', reviewed_by = ?, reviewed_at = datetime('now'), rejection_reason = ?
    WHERE id = ?
  `).run(moderatorId, reason || 'Причина не указана', requestId);
  
  return getTrainerRequest(requestId);
}

// ==========================================
// ПРОГРАММЫ ТРЕНИРОВОК
// ==========================================

export function createProgram(authorId, data) {
  const db = getDatabase();
  const id = `prog_${Date.now()}_${authorId}`;
  
  db.prepare(`
    INSERT INTO programs (id, author_id, title, description, category, difficulty, duration_weeks, price, is_personal, workouts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    authorId,
    data.title || 'Без названия',
    data.description || '',
    data.category || 'general',
    data.difficulty || 'intermediate',
    data.durationWeeks || 4,
    data.price || 0,
    data.isPersonal ? 1 : 0,
    JSON.stringify(data.workouts || [])
  );
  
  return getProgram(id);
}

export function getProgram(programId) {
  const db = getDatabase();
  const prog = db.prepare('SELECT * FROM programs WHERE id = ?').get(programId);
  if (!prog) return null;
  
  let workouts = [];
  try {
    workouts = JSON.parse(prog.workouts || '[]');
  } catch (e) {
    workouts = [];
  }
  
  return {
    id: prog.id,
    authorId: prog.author_id,
    title: prog.title,
    description: prog.description,
    category: prog.category,
    difficulty: prog.difficulty,
    durationWeeks: prog.duration_weeks,
    price: prog.price,
    isPublished: !!prog.is_published,
    isPersonal: !!prog.is_personal,
    workouts: workouts,
    purchaseCount: prog.purchase_count,
    createdAt: prog.created_at,
    updatedAt: prog.updated_at,
  };
}

export function updateProgram(programId, updates) {
  const db = getDatabase();
  const program = getProgram(programId);
  if (!program) return null;
  
  const fields = [];
  const values = [];
  
  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
  if (updates.category !== undefined) { fields.push('category = ?'); values.push(updates.category); }
  if (updates.difficulty !== undefined) { fields.push('difficulty = ?'); values.push(updates.difficulty); }
  if (updates.durationWeeks !== undefined) { fields.push('duration_weeks = ?'); values.push(updates.durationWeeks); }
  if (updates.price !== undefined) { fields.push('price = ?'); values.push(updates.price); }
  if (updates.isPublished !== undefined) { fields.push('is_published = ?'); values.push(updates.isPublished ? 1 : 0); }
  if (updates.workouts !== undefined) { fields.push('workouts = ?'); values.push(JSON.stringify(updates.workouts)); }
  
  if (fields.length > 0) {
    fields.push("updated_at = datetime('now')");
    values.push(programId);
    db.prepare(`UPDATE programs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }
  
  return getProgram(programId);
}

export function deleteProgram(programId) {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM programs WHERE id = ?').run(programId);
  return result.changes > 0;
}

export function getPublishedPrograms() {
  const db = getDatabase();
  const programs = db.prepare(`
    SELECT * FROM programs 
    WHERE is_published = 1 AND is_personal = 0
    ORDER BY created_at DESC
  `).all();
  
  return programs.map(p => getProgram(p.id));
}

export function getProgramsByAuthor(authorId) {
  const db = getDatabase();
  const programs = db.prepare(`
    SELECT * FROM programs 
    WHERE author_id = ?
    ORDER BY created_at DESC
  `).all(authorId);
  
  return programs.map(p => getProgram(p.id));
}

export function getPersonalPrograms(telegramId) {
  const db = getDatabase();
  const programs = db.prepare(`
    SELECT * FROM programs 
    WHERE author_id = ? AND is_personal = 1
    ORDER BY created_at DESC
  `).all(telegramId);
  
  return programs.map(p => getProgram(p.id));
}

export function getTrainerPrograms(trainerId) {
  const db = getDatabase();
  const programs = db.prepare(`
    SELECT * FROM programs 
    WHERE author_id = ? AND is_personal = 0
    ORDER BY created_at DESC
  `).all(trainerId);
  
  return programs.map(p => getProgram(p.id));
}

// ==========================================
// ДНЕВНИК ТРЕНИРОВОК
// ==========================================

export function createWorkoutLog(telegramId, data) {
  const db = getDatabase();
  const id = `log_${Date.now()}_${telegramId}`;
  
  db.prepare(`
    INSERT INTO workout_logs (id, telegram_id, program_id, workout_title, exercises, duration, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    telegramId,
    data.programId || null,
    data.workoutTitle || 'Тренировка',
    JSON.stringify(data.exercises || []),
    data.duration || 0,
    data.notes || ''
  );
  
  return {
    id,
    telegramId,
    programId: data.programId,
    workoutTitle: data.workoutTitle || 'Тренировка',
    exercises: data.exercises || [],
    duration: data.duration || 0,
    notes: data.notes || '',
    completedAt: new Date().toISOString(),
  };
}

export function getWorkoutLogs(telegramId, limit = 50) {
  const db = getDatabase();
  const logs = db.prepare(`
    SELECT * FROM workout_logs 
    WHERE telegram_id = ?
    ORDER BY completed_at DESC
    LIMIT ?
  `).all(telegramId, limit);
  
  return logs.map(log => {
    let exercises = [];
    try {
      exercises = JSON.parse(log.exercises || '[]');
    } catch (e) {
      exercises = [];
    }
    
    return {
      id: log.id,
      telegramId: log.telegram_id,
      programId: log.program_id,
      workoutTitle: log.workout_title,
      exercises,
      duration: log.duration,
      notes: log.notes,
      completedAt: log.completed_at,
    };
  });
}

export function getWorkoutStats(telegramId) {
  const db = getDatabase();
  
  const total = db.prepare('SELECT COUNT(*) as count FROM workout_logs WHERE telegram_id = ?').get(telegramId);
  const weekly = db.prepare(`
    SELECT COUNT(*) as count FROM workout_logs 
    WHERE telegram_id = ? AND completed_at >= datetime('now', '-7 days')
  `).get(telegramId);
  const monthly = db.prepare(`
    SELECT COUNT(*) as count FROM workout_logs 
    WHERE telegram_id = ? AND completed_at >= datetime('now', '-30 days')
  `).get(telegramId);
  const totalDuration = db.prepare(`
    SELECT COALESCE(SUM(duration), 0) as total FROM workout_logs WHERE telegram_id = ?
  `).get(telegramId);
  const lastWorkout = db.prepare(`
    SELECT completed_at FROM workout_logs WHERE telegram_id = ? ORDER BY completed_at DESC LIMIT 1
  `).get(telegramId);
  
  return {
    totalWorkouts: total?.count || 0,
    weeklyWorkouts: weekly?.count || 0,
    monthlyWorkouts: monthly?.count || 0,
    totalDuration: totalDuration?.total || 0,
    lastWorkout: lastWorkout?.completed_at || null,
  };
}

// ==========================================
// ПОКУПКИ ПРОГРАММ
// ==========================================

export function purchaseProgram(telegramId, programId) {
  const db = getDatabase();
  
  try {
    db.prepare(`
      INSERT INTO purchases (telegram_id, program_id)
      VALUES (?, ?)
    `).run(telegramId, programId);
    
    // Увеличиваем счётчик покупок
    db.prepare(`
      UPDATE programs SET purchase_count = purchase_count + 1 WHERE id = ?
    `).run(programId);
    
    return true;
  } catch (e) {
    // UNIQUE constraint failed - уже куплено
    return false;
  }
}

export function hasPurchased(telegramId, programId) {
  const db = getDatabase();
  const purchase = db.prepare(`
    SELECT 1 FROM purchases WHERE telegram_id = ? AND program_id = ?
  `).get(telegramId, programId);
  
  return !!purchase;
}

export function getPurchasedPrograms(telegramId) {
  const db = getDatabase();
  const purchases = db.prepare(`
    SELECT program_id FROM purchases WHERE telegram_id = ?
  `).all(telegramId);
  
  return purchases
    .map(p => getProgram(p.program_id))
    .filter(p => p !== null);
}
