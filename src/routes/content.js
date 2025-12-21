import { Router } from 'express';
import { getDatabase } from '../database/db.js';
import { authMiddleware } from './api.js';

const router = Router();

// ==================== НОВОСТИ ====================

// Получить все новости (публичный доступ)
router.get('/news', async (req, res) => {
    try {
        const db = getDatabase();
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

        const db = getDatabase();
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

        const db = getDatabase();
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
        const db = getDatabase();
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
        const db = getDatabase();
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
        const db = getDatabase();
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

        const db = getDatabase();
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

        const db = getDatabase();

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
        const db = getDatabase();

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

// ==================== ЗАЯВКИ НА ТРЕНЕРА ====================

// Получить все заявки (только для модераторов и админов)
router.get('/trainer-requests', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'MODERATOR' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }

        const db = getDatabase();
        const requests = db.prepare(`
            SELECT tr.*, u.username, u.first_name, u.last_name
            FROM trainer_requests tr
            LEFT JOIN users u ON tr.telegram_id = u.telegram_id
            WHERE tr.status = 'PENDING'
            ORDER BY tr.created_at DESC
        `).all();

        res.json(requests);
    } catch (error) {
        console.error('❌ Ошибка получения заявок:', error);
        res.status(500).json({ error: error.message });
    }
});

// Отправить заявку на тренера
router.post('/trainer-requests', authMiddleware, async (req, res) => {
    try {
        const db = getDatabase();

        // Проверяем нет ли уже заявки
        const existing = db.prepare(`SELECT id FROM trainer_requests WHERE telegram_id = ? AND status = 'PENDING'`).get(req.user.telegramId);
        if (existing) {
            return res.status(400).json({ error: 'Заявка уже отправлена' });
        }

        const id = `req_${Date.now()}`;
        const { bio, experience, specialization } = req.body;

        db.prepare(`
            INSERT INTO trainer_requests (id, telegram_id, bio, experience, specialization)
            VALUES (?, ?, ?, ?, ?)
        `).run(id, req.user.telegramId, bio || '', experience || '', specialization || '');

        res.json({ success: true, requestId: id });
    } catch (error) {
        console.error('❌ Ошибка создания заявки:', error);
        res.status(500).json({ error: error.message });
    }
});

// Одобрить заявку
router.post('/trainer-requests/:id/approve', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'MODERATOR' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }

        const { id } = req.params;
        const db = getDatabase();

        const request = db.prepare(`SELECT * FROM trainer_requests WHERE id = ?`).get(id);
        if (!request) {
            return res.status(404).json({ error: 'Заявка не найдена' });
        }

        // Обновляем статус заявки
        db.prepare(`
            UPDATE trainer_requests 
            SET status = 'APPROVED', reviewed_by = ?, reviewed_at = datetime('now')
            WHERE id = ?
        `).run(req.user.telegramId, id);

        // Повышаем роль пользователя до тренера
        db.prepare(`UPDATE users SET role = 'TRAINER' WHERE telegram_id = ?`).run(request.telegram_id);

        res.json({ success: true });
    } catch (error) {
        console.error('❌ Ошибка одобрения заявки:', error);
        res.status(500).json({ error: error.message });
    }
});

// Отклонить заявку
router.post('/trainer-requests/:id/reject', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'MODERATOR' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }

        const { id } = req.params;
        const { reason } = req.body;
        const db = getDatabase();

        db.prepare(`
            UPDATE trainer_requests 
            SET status = 'REJECTED', reviewed_by = ?, reviewed_at = datetime('now'), rejection_reason = ?
            WHERE id = ?
        `).run(req.user.telegramId, reason || '', id);

        res.json({ success: true });
    } catch (error) {
        console.error('❌ Ошибка отклонения заявки:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== ЧАТ ТЕХПОДДЕРЖКИ ====================

// Получить все сообщения (для модераторов)
router.get('/support/messages', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'MODERATOR' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }

        const db = getDatabase();
        const messages = db.prepare(`
            SELECT * FROM support_messages 
            ORDER BY created_at ASC
        `).all();

        res.json(messages);
    } catch (error) {
        console.error('❌ Ошибка получения сообщений:', error);
        res.status(500).json({ error: error.message });
    }
});

// Получить уникальных пользователей чата (для модераторов)
router.get('/support/users', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'MODERATOR' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }

        const db = getDatabase();
        const users = db.prepare(`
            SELECT DISTINCT from_user_id as id, from_user_name as name, from_username as username,
                   MAX(created_at) as last_message_at
            FROM support_messages 
            WHERE from_user_id != 0
            GROUP BY from_user_id
            ORDER BY last_message_at DESC
        `).all();

        res.json(users);
    } catch (error) {
        console.error('❌ Ошибка получения пользователей:', error);
        res.status(500).json({ error: error.message });
    }
});

// Получить сообщения пользователя (для модераторов)
router.get('/support/messages/:userId', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        const db = getDatabase();

        // Если обычный пользователь - только свои сообщения
        if (req.user.role !== 'MODERATOR' && req.user.role !== 'ADMIN') {
            if (parseInt(userId) !== req.user.telegramId) {
                return res.status(403).json({ error: 'Доступ запрещён' });
            }
        }

        const messages = db.prepare(`
            SELECT * FROM support_messages 
            WHERE from_user_id = ? OR to_user_id = ?
            ORDER BY created_at ASC
        `).all(userId, userId);

        res.json(messages);
    } catch (error) {
        console.error('❌ Ошибка получения сообщений:', error);
        res.status(500).json({ error: error.message });
    }
});

// Отправить сообщение в поддержку (от пользователя)
router.post('/support/messages', authMiddleware, async (req, res) => {
    try {
        const { message } = req.body;
        if (!message?.trim()) {
            return res.status(400).json({ error: 'Сообщение не может быть пустым' });
        }

        const db = getDatabase();
        const id = `msg_${Date.now()}`;
        const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'Пользователь';

        db.prepare(`
            INSERT INTO support_messages (id, from_user_id, from_user_name, from_username, to_user_id, message)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(id, req.user.telegramId, userName, req.user.username || '', 'support', message.trim());

        res.json({
            success: true,
            message: {
                id,
                from_user_id: req.user.telegramId,
                from_user_name: userName,
                to_user_id: 'support',
                message: message.trim(),
                created_at: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('❌ Ошибка отправки сообщения:', error);
        res.status(500).json({ error: error.message });
    }
});

// Ответить пользователю (от модератора)
router.post('/support/reply/:userId', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'MODERATOR' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }

        const { userId } = req.params;
        const { message } = req.body;

        if (!message?.trim()) {
            return res.status(400).json({ error: 'Сообщение не может быть пустым' });
        }

        const db = getDatabase();
        const id = `msg_${Date.now()}`;

        db.prepare(`
            INSERT INTO support_messages (id, from_user_id, from_user_name, from_username, to_user_id, message)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(id, 0, 'Поддержка', 'support', userId, message.trim());

        res.json({
            success: true,
            message: {
                id,
                from_user_id: 0,
                from_user_name: 'Поддержка',
                to_user_id: userId,
                message: message.trim(),
                created_at: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('❌ Ошибка отправки ответа:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== СБРОС АККАУНТА ====================

// Сбросить данные пользователя (только для админа)
router.post('/reset-account/:userId', authMiddleware, async (req, res) => {
    console.log('🔄 Reset account called. User role:', req.user.role, 'Target userId:', req.params.userId);
    try {
        if (req.user.role !== 'ADMIN') {
            console.log('❌ Reset account denied. User role is not ADMIN:', req.user.role);
            return res.status(403).json({ error: 'Доступ запрещён' });
        }

        const { userId } = req.params;
        const db = getDatabase();

        console.log('🗑️ Deleting data for user:', userId);

        // Удаляем программы пользователя
        const programs = db.prepare(`DELETE FROM programs WHERE author_id = ?`).run(userId);
        console.log('  - Programs deleted:', programs.changes);

        // Удаляем историю тренировок
        const workouts = db.prepare(`DELETE FROM workout_logs WHERE telegram_id = ?`).run(userId);
        console.log('  - Workout logs deleted:', workouts.changes);

        // Удаляем покупки
        const purchases = db.prepare(`DELETE FROM purchases WHERE telegram_id = ?`).run(userId);
        console.log('  - Purchases deleted:', purchases.changes);

        // Удаляем AI сообщения
        const aiMsgs = db.prepare(`DELETE FROM ai_messages WHERE user_id = ?`).run(userId);
        console.log('  - AI messages deleted:', aiMsgs.changes);

        // НЕ удаляем пользователя и его роль!

        console.log('✅ Account reset successful for user:', userId);
        res.json({ success: true, message: `Аккаунт ${userId} сброшен!` });
    } catch (error) {
        console.error('❌ Ошибка сброса аккаунта:', error);
        res.status(500).json({ error: error.message });
    }
});


// ==================== УПРАВЛЕНИЕ РОЛЯМИ ====================

// Получить список пользователей с особыми ролями (модераторы и тренеры)
router.get('/roles', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }

        const db = getDatabase();
        // Получаем всех кроме обычных юзеров, но исключаем самого админа из списка если нужно (или оставляем)
        // Обычно админ хочет видеть и себя, или всех у кого есть права
        const staff = db.prepare(`
            SELECT telegram_id, first_name, last_name, username, role 
            FROM users 
            WHERE role IN ('MODERATOR', 'TRAINER', 'ADMIN')
            ORDER BY role, created_at
        `).all();

        res.json(staff);
    } catch (error) {
        console.error('❌ Ошибка получения ролей:', error);
        res.status(500).json({ error: error.message });
    }
});

// Назначить роль пользователю
router.post('/roles/assign', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }

        const { telegramId, role } = req.body;

        if (!telegramId || !role || !['MODERATOR', 'TRAINER'].includes(role)) {
            return res.status(400).json({ error: 'Некорректные данные' });
        }

        const db = getDatabase();

        // Проверяем существует ли пользователь. Если нет - создаем заглушку или ошибку?
        // Лучше проверить.
        let user = db.prepare(`SELECT telegram_id FROM users WHERE telegram_id = ?`).get(telegramId);

        if (!user) {
            // Если пользователя нет в базе (например, ни разу не заходил), мы можем его создать предварительно?
            // Или требовать чтобы он сначала зашел.
            // Для упрощения, предположим что мы просто обновляем. Если нет - создадим минимальную запись.
            db.prepare(`
                INSERT INTO users (telegram_id, role) VALUES (?, ?)
                ON CONFLICT(telegram_id) DO UPDATE SET role = ?
            `).run(telegramId, role, role);
        } else {
            db.prepare(`UPDATE users SET role = ? WHERE telegram_id = ?`).run(role, telegramId);
        }

        res.json({ success: true, message: `Роль ${role} назначена пользователю ${telegramId}` });
    } catch (error) {
        console.error('❌ Ошибка назначения роли:', error);
        res.status(500).json({ error: error.message });
    }
});

// Снять роль (вернуть USER)
router.post('/roles/remove', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }

        const { telegramId } = req.body;

        if (!telegramId) {
            return res.status(400).json({ error: 'Не указан ID пользователя' });
        }

        // Нельзя снять роль с самого себя (если админ) - хотя тут проверка на ADMIN сверху, 
        // админ может себя разжаловать? Лучше запретить удаление главного админа.
        // Предположим главный админ это тот кто в конфиге или первый.
        // В данном случае просто обновим.

        const db = getDatabase();
        db.prepare(`UPDATE users SET role = 'USER' WHERE telegram_id = ?`).run(telegramId);

        res.json({ success: true, message: `Роль снята с пользователя ${telegramId}` });
    } catch (error) {
        console.error('❌ Ошибка снятия роли:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;

