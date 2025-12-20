import { Router } from 'express';
import { getDb } from '../database/index.js';
import { authMiddleware } from './api.js';

const router = Router();

// ==================== НОВОСТИ ====================

// Получить все новости (публичный доступ)
router.get('/news', async (req, res) => {
    try {
        const db = getDb();
        const news = db.prepare(`
      SELECT id, author_id, author_name, title, content, created_at 
      FROM news 
      ORDER BY created_at DESC 
      LIMIT 50
    `).all();
        res.json(news);
    } catch (error) {
        console.error('❌ Ошибка получения новостей:', error);
        res.status(500).json({ error: error.message });
    }
});

// Создать новость (только модераторы)
router.post('/news', authMiddleware, async (req, res) => {
    try {
        // Проверяем роль
        if (req.user.role !== 'MODERATOR' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }

        const { title, content } = req.body;
        if (!title || !content) {
            return res.status(400).json({ error: 'Заполните заголовок и текст' });
        }

        const db = getDb();
        const id = `news_${Date.now()}`;
        const authorName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim();

        db.prepare(`
      INSERT INTO news (id, author_id, author_name, title, content) 
      VALUES (?, ?, ?, ?, ?)
    `).run(id, req.user.telegramId, authorName, title, content);

        res.json({
            success: true,
            news: { id, author_id: req.user.telegramId, author_name: authorName, title, content, created_at: new Date().toISOString() }
        });
    } catch (error) {
        console.error('❌ Ошибка создания новости:', error);
        res.status(500).json({ error: error.message });
    }
});

// Обновить новость (только модераторы)
router.put('/news/:id', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'MODERATOR' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }

        const { title, content } = req.body;
        const { id } = req.params;

        const db = getDb();
        db.prepare(`UPDATE news SET title = ?, content = ? WHERE id = ?`).run(title, content, id);

        res.json({ success: true });
    } catch (error) {
        console.error('❌ Ошибка обновления новости:', error);
        res.status(500).json({ error: error.message });
    }
});

// Удалить новость (только модераторы)
router.delete('/news/:id', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'MODERATOR' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }

        const { id } = req.params;
        const db = getDb();
        db.prepare(`DELETE FROM news WHERE id = ?`).run(id);

        res.json({ success: true });
    } catch (error) {
        console.error('❌ Ошибка удаления новости:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== ПРОГРАММЫ ТРЕНЕРОВ ====================

// Получить все опубликованные программы (публичный доступ)
router.get('/programs', async (req, res) => {
    try {
        const db = getDb();
        const programs = db.prepare(`
      SELECT p.*, u.first_name || ' ' || COALESCE(u.last_name, '') as author_name
      FROM programs p
      LEFT JOIN users u ON p.author_id = u.telegram_id
      WHERE p.is_published = 1
      ORDER BY p.created_at DESC
    `).all();

        // Парсим workouts из JSON
        const result = programs.map(p => ({
            ...p,
            exercises: JSON.parse(p.workouts || '[]'),
            author: p.author_name?.trim() || 'Неизвестный'
        }));

        res.json(result);
    } catch (error) {
        console.error('❌ Ошибка получения программ:', error);
        res.status(500).json({ error: error.message });
    }
});

// Получить программы тренера (только свои)
router.get('/programs/my', authMiddleware, async (req, res) => {
    try {
        const db = getDb();
        const programs = db.prepare(`
      SELECT * FROM programs WHERE author_id = ? ORDER BY created_at DESC
    `).all(req.user.telegramId);

        const result = programs.map(p => ({
            ...p,
            exercises: JSON.parse(p.workouts || '[]')
        }));

        res.json(result);
    } catch (error) {
        console.error('❌ Ошибка получения программ тренера:', error);
        res.status(500).json({ error: error.message });
    }
});

// Создать программу (только тренеры)
router.post('/programs', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'TRAINER' && req.user.role !== 'MODERATOR' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Только тренеры могут создавать программы' });
        }

        const { title, description, category, price, exercises } = req.body;
        if (!title) {
            return res.status(400).json({ error: 'Укажите название программы' });
        }

        const db = getDb();
        const id = `prog_${Date.now()}`;

        db.prepare(`
      INSERT INTO programs (id, author_id, title, description, category, price, workouts, is_published) 
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(id, req.user.telegramId, title, description || '', category || 'general', price || 0, JSON.stringify(exercises || []));

        const authorName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim();

        res.json({
            success: true,
            program: {
                id,
                author_id: req.user.telegramId,
                author: authorName,
                title,
                description,
                category,
                price: price || 0,
                exercises: exercises || [],
                is_published: 1,
                created_at: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('❌ Ошибка создания программы:', error);
        res.status(500).json({ error: error.message });
    }
});

// Обновить программу (только автор)
router.put('/programs/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, category, price, exercises } = req.body;

        const db = getDb();

        // Проверяем что программа принадлежит пользователю
        const program = db.prepare(`SELECT author_id FROM programs WHERE id = ?`).get(id);
        if (!program) {
            return res.status(404).json({ error: 'Программа не найдена' });
        }
        if (program.author_id !== req.user.telegramId && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Нет доступа к редактированию' });
        }

        db.prepare(`
      UPDATE programs 
      SET title = ?, description = ?, category = ?, price = ?, workouts = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(title, description || '', category || 'general', price || 0, JSON.stringify(exercises || []), id);

        res.json({ success: true });
    } catch (error) {
        console.error('❌ Ошибка обновления программы:', error);
        res.status(500).json({ error: error.message });
    }
});

// Удалить программу (только автор)
router.delete('/programs/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDb();

        const program = db.prepare(`SELECT author_id FROM programs WHERE id = ?`).get(id);
        if (!program) {
            return res.status(404).json({ error: 'Программа не найдена' });
        }
        if (program.author_id !== req.user.telegramId && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Нет доступа к удалению' });
        }

        db.prepare(`DELETE FROM programs WHERE id = ?`).run(id);
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Ошибка удаления программы:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
