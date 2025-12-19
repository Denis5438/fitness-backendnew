import { Router } from 'express';
import { getDatabase } from '../database/mock-db.js';
import { config } from '../config.js';
import OpenAI from 'openai';
import { z } from 'zod';

const router = Router();

// Инициализация OpenAI
const openai = config.openai.apiKey 
  ? new OpenAI({ apiKey: config.openai.apiKey })
  : null;

// Валидация запроса
const aiQuerySchema = z.object({
  user_id: z.number(),
  message: z.string().min(1).max(500),
});

// Системный промпт для AI
const SYSTEM_PROMPT = `Ты — персональный фитнес-коуч. У тебя есть доступ к тренировочному дневнику пользователя.

ПРАВИЛА:
1. Отвечай кратко и по делу (максимум 3-4 предложения)
2. Давай конкретные, применимые советы
3. НЕ придумывай данные — используй только то, что есть в контексте
4. Если информации недостаточно — попроси уточнить
5. Отвечай на русском языке
6. НЕ давай медицинские диагнозы и не назначай лекарства

ФОКУС: прогрессия нагрузок, восстановление, техника выполнения упражнений.`;

// Функция для подготовки контекста из тренировок
function prepareWorkoutContext(userId) {
  const db = getDatabase();
  
  // Получаем последние 5 тренировок
  const recentWorkouts = db.prepare(`
    SELECT w.date, w.duration_minutes, w.notes,
           e.exercise_name, e.muscle_group, e.sets_data
    FROM workouts w
    LEFT JOIN exercises e ON e.workout_id = w.id
    WHERE w.user_id = ?
    ORDER BY w.date DESC
    LIMIT 5
  `).all(userId);
  
  if (recentWorkouts.length === 0) {
    return 'У пользователя пока нет записей тренировок.';
  }
  
  // Формируем краткое описание
  const workoutsByDate = recentWorkouts.reduce((acc, row) => {
    if (!acc[row.date]) {
      acc[row.date] = {
        duration: row.duration_minutes,
        notes: row.notes,
        exercises: [],
      };
    }
    if (row.exercise_name) {
      const sets = JSON.parse(row.sets_data);
      acc[row.date].exercises.push({
        name: row.exercise_name,
        muscle_group: row.muscle_group,
        sets: sets.length,
        max_weight: Math.max(...sets.map((s) => s.weight)),
      });
    }
    return acc;
  }, {});
  
  let context = 'ПОСЛЕДНИЕ ТРЕНИРОВКИ:\n';
  for (const [date, data] of Object.entries(workoutsByDate)) {
    context += `\n${date} (${data.duration || '?'} мин):\n`;
    data.exercises.forEach((ex) => {
      context += `- ${ex.name}: ${ex.sets} подходов, макс вес ${ex.max_weight}кг\n`;
    });
  }
  
  return context;
}

// Проверка лимита запросов
function checkAiRateLimit(userId) {
  const db = getDatabase();
  
  const user = db.prepare(`
    SELECT subscription_tier, ai_requests_count, ai_requests_reset_date
    FROM users WHERE telegram_id = ?
  `).get(userId);
  
  if (!user) {
    return { allowed: false, remaining: 0 };
  }
  
  // Проверяем, нужно ли сбросить счётчик (новый месяц)
  const now = new Date();
  const resetDate = user.ai_requests_reset_date 
    ? new Date(user.ai_requests_reset_date)
    : null;
  
  if (!resetDate || now.getMonth() !== resetDate.getMonth()) {
    // Сбрасываем счётчик
    db.prepare(`
      UPDATE users 
      SET ai_requests_count = 0, ai_requests_reset_date = ?
      WHERE telegram_id = ?
    `).run(now.toISOString(), userId);
    
    user.ai_requests_count = 0;
  }
  
  // Проверяем лимит
  const limit = user.subscription_tier === 'pro' 
    ? config.rateLimit.proTierAiRequests 
    : config.rateLimit.freeTierAiRequests;
  
  if (limit === -1) {
    return { allowed: true, remaining: -1 }; // Безлимит
  }
  
  const remaining = limit - user.ai_requests_count;
  return { allowed: remaining > 0, remaining };
}

// POST /api/ai/chat - Отправить сообщение AI
router.post('/chat', async (req, res) => {
  try {
    if (!openai) {
      return res.status(503).json({ 
        error: 'AI service not configured. Please set OPENAI_API_KEY.' 
      });
    }
    
    const data = aiQuerySchema.parse(req.body);
    
    // Проверяем rate limit
    const rateLimit = checkAiRateLimit(data.user_id);
    if (!rateLimit.allowed) {
      return res.status(429).json({ 
        error: 'AI request limit exceeded. Upgrade to Pro for unlimited requests.',
        remaining: 0,
      });
    }
    
    // Подготавливаем контекст
    const workoutContext = prepareWorkoutContext(data.user_id);
    
    // Получаем историю чата (последние 4 сообщения)
    const db = getDatabase();
    const chatHistory = db.prepare(`
      SELECT role, content FROM ai_messages
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 4
    `).all(data.user_id);
    
    // Формируем сообщения для OpenAI
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'system', content: workoutContext },
      ...chatHistory.reverse().map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      { role: 'user', content: data.message },
    ];
    
    // Запрос к OpenAI
    const completion = await openai.chat.completions.create({
      model: config.openai.model,
      messages,
      max_tokens: config.openai.maxTokens,
      temperature: config.openai.temperature,
    });
    
    const aiResponse = completion.choices[0]?.message?.content || 'Извините, не могу ответить.';
    
    // Сохраняем сообщения в БД
    const saveMessage = db.prepare(`
      INSERT INTO ai_messages (user_id, role, content)
      VALUES (?, ?, ?)
    `);
    
    saveMessage.run(data.user_id, 'user', data.message);
    saveMessage.run(data.user_id, 'assistant', aiResponse);
    
    // Увеличиваем счётчик запросов
    db.prepare(`
      UPDATE users 
      SET ai_requests_count = ai_requests_count + 1
      WHERE telegram_id = ?
    `).run(data.user_id);
    
    res.json({
      response: aiResponse,
      remaining: rateLimit.remaining - 1,
    });
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error in AI chat:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/ai/history/:user_id - Получить историю чата
router.get('/history/:user_id', (req, res) => {
  try {
    const userId = parseInt(req.params.user_id);
    const limit = parseInt(req.query.limit) || 20;
    const db = getDatabase();
    
    const messages = db.prepare(`
      SELECT * FROM ai_messages
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(userId, limit);
    
    res.json(messages.reverse());
  } catch (error) {
    console.error('Error fetching AI history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
