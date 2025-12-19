import { Router } from 'express';
import { getDatabase } from '../database/mock-db.js';
import { z } from 'zod';

const router = Router();

// Валидация данных пользователя
const createUserSchema = z.object({
  telegram_id: z.number(),
  username: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
});

// GET /api/users/:telegram_id - Получить пользователя
router.get('/:telegram_id', (req, res) => {
  try {
    const telegramId = parseInt(req.params.telegram_id);
    const db = getDatabase();
    
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users - Создать или обновить пользователя
router.post('/', (req, res) => {
  try {
    const data = createUserSchema.parse(req.body);
    const db = getDatabase();
    
    // Upsert пользователя
    const stmt = db.prepare(`
      INSERT INTO users (telegram_id, username, first_name, last_name)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        updated_at = datetime('now')
      RETURNING *
    `);
    
    const user = stmt.get(
      data.telegram_id,
      data.username,
      data.first_name,
      data.last_name
    );
    
    res.json(user);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/users/:telegram_id/subscription - Обновить подписку
router.patch('/:telegram_id/subscription', (req, res) => {
  try {
    const telegramId = parseInt(req.params.telegram_id);
    const { tier } = req.body;
    
    if (!['free', 'pro'].includes(tier)) {
      return res.status(400).json({ error: 'Invalid subscription tier' });
    }
    
    const db = getDatabase();
    const stmt = db.prepare(`
      UPDATE users 
      SET subscription_tier = ?, updated_at = datetime('now')
      WHERE telegram_id = ?
      RETURNING *
    `);
    
    const user = stmt.get(tier, telegramId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
  } catch (error) {
    console.error('Error updating subscription:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
