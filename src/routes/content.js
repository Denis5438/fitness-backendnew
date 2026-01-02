// Content Routes - MongoDB Version
import { Router } from 'express';
import { authMiddleware, hasAnyRole } from './api.js';
import {
    News,
    Program,
    TrainerRequest,
    SupportMessage,
    User
} from '../database/models.js';
import {
    createNews,
    getAllNews,
    deleteNews,
    createProgram,
    getProgram,
    updateProgram,
    deleteProgram,
    getPublishedPrograms,
    getTrainerPrograms,
    createTrainerRequest,
    getLastTrainerRequest,
    getPendingTrainerRequests,
    approveTrainerRequest,
    rejectTrainerRequest,
    setUserRole,
    addRole,
    removeRole,
    getUser,
    createSupportMessage,
    getSupportMessages,
    getUserSupportMessages,
    getUniqueSupportUsers,
} from '../database/users.js';

const router = Router();

// ==================== НОВОСТИ ====================

// Получить все новости (публичный доступ)
router.get('/news', async (req, res) => {
    try {
        const news = await getAllNews();
        // Convert to expected format
        res.json(news.map(n => ({
            id: n.id,
            author_id: n.authorId,
            author_name: n.authorName,
            title: n.title,
            content: n.content,
            created_at: n.createdAt,
        })));
    } catch (error) {
        console.error('❌ Ошибка получения новостей:', error);
        res.status(500).json({ error: error.message });
    }
});

// Создать новость (только модераторы)
router.post('/news', authMiddleware, async (req, res) => {
    try {
        if (!hasAnyRole(req.user, ['MODERATOR', 'ADMIN'])) {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }

        const { title, content } = req.body;
        if (!title || !content) {
            return res.status(400).json({ error: 'Заполните заголовок и текст' });
        }

        const authorName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'Модератор';
        const result = await createNews(req.user.telegramId, authorName, title, content);

        res.json({
            success: true,
            news: {
                id: result.id,
                author_id: req.user.telegramId,
                author_name: authorName,
                title,
                content,
                created_at: new Date().toISOString(),
            },
        });
    } catch (error) {
        console.error('❌ Ошибка создания новости:', error);
        res.status(500).json({ error: error.message });
    }
});

// Удалить новость
router.delete('/news/:id', authMiddleware, async (req, res) => {
    try {
        if (!hasAnyRole(req.user, ['MODERATOR', 'ADMIN'])) {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }

        const success = await deleteNews(req.params.id);
        res.json({ success });
    } catch (error) {
        console.error('❌ Ошибка удаления новости:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== ПРОГРАММЫ ====================

// Получить все программы (публичные)
router.get('/programs', async (req, res) => {
    try {
        const programs = await getPublishedPrograms();
        // Convert to expected format
        res.json(programs.map(p => ({
            id: p.id,
            author_id: p.authorId,
            author_name: p.authorName,
            title: p.title,
            description: p.description,
            category: p.category,
            difficulty: p.difficulty,
            duration_weeks: p.durationWeeks,
            price: p.price,
            is_published: p.isPublished ? 1 : 0,
            workouts: p.workouts,
            purchase_count: p.purchaseCount,
            created_at: p.createdAt,
        })));
    } catch (error) {
        console.error('❌ Ошибка получения программ:', error);
        res.status(500).json({ error: error.message });
    }
});

// Создать программу (только тренеры)
router.post('/programs', authMiddleware, async (req, res) => {
    try {
        if (!['TRAINER', 'MODERATOR', 'ADMIN'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Доступ запрещён. Нужна роль тренера.' });
        }

        const { title, description, category, difficulty, price, workouts, exercises, isPublished } = req.body;
        const normalizedWorkouts = Array.isArray(workouts)
            ? workouts
            : Array.isArray(exercises)
                ? exercises
                : [];
        const publishFlag = typeof isPublished === 'boolean'
            ? isPublished
            : (isPublished != null ? Boolean(isPublished) : true);

        const program = await createProgram(req.user.telegramId, {
            title,
            description,
            category,
            difficulty,
            price: price || 0,
            workouts: normalizedWorkouts,
            isPublished: publishFlag,
        });

        res.json({ success: true, program });
    } catch (error) {
        console.error('❌ Ошибка создания программы:', error);
        res.status(500).json({ error: error.message });
    }
});

// Обновить программу
router.put('/programs/:id', authMiddleware, async (req, res) => {
    try {
        const program = await getProgram(req.params.id);
        if (!program) {
            return res.status(404).json({ error: 'Программа не найдена' });
        }

        // Проверяем права
        if (program.authorId !== req.user.telegramId && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Нельзя редактировать чужую программу' });
        }

        const updates = { ...req.body };
        if (updates.workouts === undefined && Array.isArray(updates.exercises)) {
            updates.workouts = updates.exercises;
        }
        const updated = await updateProgram(req.params.id, updates);
        res.json({ success: true, program: updated });
    } catch (error) {
        console.error('❌ Ошибка обновления программы:', error);
        res.status(500).json({ error: error.message });
    }
});

// Удалить программу
router.delete('/programs/:id', authMiddleware, async (req, res) => {
    try {
        const program = await getProgram(req.params.id);
        if (!program) {
            return res.status(404).json({ error: 'Программа не найдена' });
        }

        if (program.authorId !== req.user.telegramId && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Нельзя удалить чужую программу' });
        }

        const success = await deleteProgram(req.params.id);
        res.json({ success });
    } catch (error) {
        console.error('❌ Ошибка удаления программы:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== ЗАЯВКИ НА ТРЕНЕРА ====================

// Получить все заявки (для модераторов)
router.get('/trainer-requests', authMiddleware, async (req, res) => {
    try {
        if (!hasAnyRole(req.user, ['MODERATOR', 'ADMIN'])) {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }

        const requests = await getPendingTrainerRequests();
        res.json(requests);
    } catch (error) {
        console.error('❌ Ошибка получения заявок:', error);
        res.status(500).json({ error: error.message });
    }
});

// Подать заявку на тренера
router.post('/trainer-requests', authMiddleware, async (req, res) => {
    try {
        // Проверяем нет ли уже заявки
        const existing = await getLastTrainerRequest(req.user.telegramId);
        if (existing && existing.status === 'PENDING') {
            return res.status(400).json({ error: 'У вас уже есть активная заявка' });
        }

        const { bio, experience, specialization } = req.body;
        const result = await createTrainerRequest(req.user.telegramId, {
            bio,
            experience,
            specialization,
        });

        res.json({ success: true, request: result });
    } catch (error) {
        console.error('❌ Ошибка создания заявки:', error);
        res.status(500).json({ error: error.message });
    }
});

// Одобрить заявку
router.post('/trainer-requests/:id/approve', authMiddleware, async (req, res) => {
    try {
        if (!hasAnyRole(req.user, ['MODERATOR', 'ADMIN'])) {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }

        const result = await approveTrainerRequest(req.params.id, req.user.telegramId);
        if (!result) {
            return res.status(404).json({ error: 'Заявка не найдена' });
        }

        res.json({ success: true, request: result });
    } catch (error) {
        console.error('❌ Ошибка одобрения заявки:', error);
        res.status(500).json({ error: error.message });
    }
});

// Отклонить заявку
router.post('/trainer-requests/:id/reject', authMiddleware, async (req, res) => {
    try {
        if (!hasAnyRole(req.user, ['MODERATOR', 'ADMIN'])) {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }

        const { reason } = req.body;

        // Получаем заявку чтобы узнать telegram_id пользователя
        const { TrainerRequest } = await import('../database/models.js');
        const request = await TrainerRequest.findOne({ id: req.params.id }).lean();

        if (!request) {
            return res.status(404).json({ error: 'Заявка не найдена' });
        }

        const result = await rejectTrainerRequest(req.params.id, req.user.telegramId, reason);

        // Отправляем уведомление пользователю в чат поддержки
        const rejectMessage = `❌ ОТКАЗ В РОЛИ ТРЕНЕРА

Ваша заявка на роль тренера была отклонена.${reason ? `

📝 Причина: ${reason}` : ''}

Если у вас есть вопросы, напишите нам.`;

        await createSupportMessage(
            0, // от поддержки
            '🔴 Модерация',
            'system',
            request.telegram_id, // кому
            rejectMessage
        );

        res.json({ success: true, request: result });
    } catch (error) {
        console.error('❌ Ошибка отклонения заявки:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== ЧАТ ПОДДЕРЖКИ ====================

// Получить все сообщения (для модераторов)
router.get('/support/messages', authMiddleware, async (req, res) => {
    try {
        if (!hasAnyRole(req.user, ['MODERATOR', 'ADMIN'])) {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }

        const messages = await getSupportMessages();
        res.json(messages);
    } catch (error) {
        console.error('❌ Ошибка получения сообщений:', error);
        res.status(500).json({ error: error.message });
    }
});

// Получить список пользователей с чатами
router.get('/support/users', authMiddleware, async (req, res) => {
    try {
        if (!hasAnyRole(req.user, ['MODERATOR', 'ADMIN'])) {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }

        const users = await getUniqueSupportUsers();
        res.json(users);
    } catch (error) {
        console.error('❌ Ошибка получения пользователей:', error);
        res.status(500).json({ error: error.message });
    }
});

// Получить сообщения конкретного пользователя
router.get('/support/messages/:userId', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;

        // Пользователь может видеть только свои сообщения
        if (!hasAnyRole(req.user, ['MODERATOR', 'ADMIN'])) {
            if (parseInt(userId) !== req.user.telegramId) {
                return res.status(403).json({ error: 'Доступ запрещён' });
            }
        }

        const messages = await getUserSupportMessages(userId);
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

        const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'Пользователь';
        const result = await createSupportMessage(
            req.user.telegramId,
            userName,
            req.user.username || '',
            'support',
            message.trim()
        );

        res.json({
            success: true,
            message: {
                id: result.id,
                from_user_id: req.user.telegramId,
                from_user_name: userName,
                to_user_id: 'support',
                message: message.trim(),
                created_at: new Date().toISOString(),
            },
        });
    } catch (error) {
        console.error('❌ Ошибка отправки сообщения:', error);
        res.status(500).json({ error: error.message });
    }
});

// Ответить пользователю (от модератора)
router.post('/support/reply/:userId', authMiddleware, async (req, res) => {
    try {
        if (!hasAnyRole(req.user, ['MODERATOR', 'ADMIN'])) {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }

        const { userId } = req.params;
        const { message } = req.body;

        if (!message?.trim()) {
            return res.status(400).json({ error: 'Сообщение не может быть пустым' });
        }

        const result = await createSupportMessage(0, 'Поддержка', 'support', userId, message.trim());

        res.json({
            success: true,
            message: {
                id: result.id,
                from_user_id: 0,
                from_user_name: 'Поддержка',
                to_user_id: userId,
                message: message.trim(),
                created_at: new Date().toISOString(),
            },
        });
    } catch (error) {
        console.error('❌ Ошибка отправки ответа:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== СБРОС АККАУНТА ====================

router.post('/reset-account/:userId', authMiddleware, async (req, res) => {
    console.log('🔄 Reset account called. User role:', req.user.role, 'Target userId:', req.params.userId);
    try {
        if (req.user.role !== 'ADMIN') {
            console.log('❌ Reset account denied. User role is not ADMIN:', req.user.role);
            return res.status(403).json({ error: 'Доступ запрещён' });
        }

        const { userId } = req.params;
        const numUserId = parseInt(userId);

        console.log('🗑️ Deleting data for user:', userId);

        // Delete user programs
        const programsResult = await Program.deleteMany({ author_id: numUserId });
        console.log('  - Programs deleted:', programsResult.deletedCount);

        // Delete workout logs
        const { WorkoutLog } = await import('../database/models.js');
        const workoutsResult = await WorkoutLog.deleteMany({ telegram_id: numUserId });
        console.log('  - Workout logs deleted:', workoutsResult.deletedCount);

        // Delete purchases
        const { Purchase } = await import('../database/models.js');
        const purchasesResult = await Purchase.deleteMany({ telegram_id: numUserId });
        console.log('  - Purchases deleted:', purchasesResult.deletedCount);

        // Delete AI messages
        const { AIMessage } = await import('../database/models.js');
        const aiResult = await AIMessage.deleteMany({ user_id: numUserId });
        console.log('  - AI messages deleted:', aiResult.deletedCount);

        // Don't delete user and their role!

        console.log('✅ Account reset successful for user:', userId);
        res.json({ success: true, message: `Аккаунт ${userId} сброшен!` });
    } catch (error) {
        console.error('❌ Ошибка сброса аккаунта:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== УПРАВЛЕНИЕ РОЛЯМИ ====================

// Получить список пользователей с особыми ролями
router.get('/roles', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }

        // Ищем пользователей у которых в массиве roles есть MODERATOR, TRAINER или ADMIN
        const staff = await User.find({
            $or: [
                { roles: { $in: ['MODERATOR', 'TRAINER', 'ADMIN'] } },
                { role: { $in: ['MODERATOR', 'TRAINER', 'ADMIN'] } }
            ]
        })
            .sort({ created_at: 1 })
            .lean();

        res.json(
            staff.map((u) => ({
                telegramId: u.telegram_id,
                telegram_id: u.telegram_id,
                firstName: u.first_name,
                first_name: u.first_name,
                lastName: u.last_name,
                last_name: u.last_name,
                username: u.username,
                role: u.role,
                roles: u.roles || [u.role], // Возвращаем массив ролей
            }))
        );
    } catch (error) {
        console.error('❌ Ошибка получения ролей:', error);
        res.status(500).json({ error: error.message });
    }
});

// Назначить роль пользователю (добавляет роль, не заменяет)
router.post('/roles/assign', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }

        const { telegramId, role } = req.body;

        // Валидация
        if (!telegramId) {
            return res.status(400).json({ error: 'Введите Telegram ID', code: 'empty_id' });
        }

        const numericId = parseInt(telegramId);
        if (isNaN(numericId)) {
            return res.status(400).json({ error: 'Telegram ID должен быть числом', code: 'invalid_id' });
        }

        if (!role || !['MODERATOR', 'TRAINER'].includes(role)) {
            return res.status(400).json({ error: 'Некорректная роль', code: 'invalid_role' });
        }

        // Проверяем существует ли пользователь
        let user = await getUser(numericId);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден. Он должен сначала запустить бота.', code: 'user_not_found' });
        }

        // Добавляем роль
        const result = await addRole(numericId, role);

        if (!result.success) {
            return res.status(400).json({ error: result.message, code: result.error });
        }

        // Получаем обновлённого пользователя
        const updatedUser = await getUser(numericId);

        console.log(`✅ Роль ${role} назначена пользователю ${numericId} админом ${req.user.telegramId}`);
        res.json({
            success: true,
            message: result.alreadyHas ? 'Роль уже была назначена' : `Роль ${role} успешно назначена`,
            alreadyHas: result.alreadyHas,
            user: updatedUser
        });
    } catch (error) {
        console.error('❌ Ошибка назначения роли:', error);
        res.status(500).json({ error: 'Ошибка сервера', code: 'server_error' });
    }
});

// Снять конкретную роль (не все роли, только указанную)
router.post('/roles/remove', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }

        const { telegramId, role } = req.body;

        // Валидация
        if (!telegramId) {
            return res.status(400).json({ error: 'Не указан ID пользователя', code: 'empty_id' });
        }

        const numericId = parseInt(telegramId);
        if (isNaN(numericId)) {
            return res.status(400).json({ error: 'Telegram ID должен быть числом', code: 'invalid_id' });
        }

        if (!role || !['MODERATOR', 'TRAINER'].includes(role)) {
            return res.status(400).json({ error: 'Укажите роль для снятия', code: 'invalid_role' });
        }

        // Удаляем конкретную роль
        const result = await removeRole(numericId, role);

        if (!result.success) {
            return res.status(400).json({ error: result.message, code: result.error });
        }

        // Получаем обновлённого пользователя
        const updatedUser = await getUser(numericId);

        console.log(`✅ Роль ${role} снята с пользователя ${numericId} админом ${req.user.telegramId}`);
        res.json({
            success: true,
            message: result.notHad ? 'Роль не была назначена' : `Роль ${role} успешно снята`,
            notHad: result.notHad,
            user: updatedUser
        });
    } catch (error) {
        console.error('❌ Ошибка снятия роли:', error);
        res.status(500).json({ error: 'Ошибка сервера', code: 'server_error' });
    }
});

export default router;
