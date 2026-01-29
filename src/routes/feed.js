import express from 'express';
import { authMiddleware, hasRole } from './api.js';
import { User, Post, Comment } from '../database/models.js';

const router = express.Router();

// ==========================================
// FEED API
// ==========================================

// GET /api/feed - Получить ленту постов
router.get('/', authMiddleware, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const posts = await Post.find()
            .sort({ created_at: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Post.countDocuments();

        // Обогащаем посты (проверяем лайк от текущего пользователя)
        const enrichedPosts = posts.map(p => ({
            ...p.toObject(),
            isLiked: p.likes.includes(req.user.telegramId),
        }));

        res.json({
            success: true,
            posts: enrichedPosts,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching feed:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// POST /api/feed - Создать пост
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { content, imageUrl } = req.body;

        if (!content && !imageUrl) {
            return res.status(400).json({ error: 'Пост не может быть пустым' });
        }

        // Создаем ID
        const postId = `post_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const newPost = new Post({
            id: postId,
            author_id: req.user.telegramId,
            author_name: req.user.display_name || req.user.first_name || 'User',
            author_username: req.user.username || '',
            author_avatar: req.user.avatar_url || '',
            author_roles: req.user.roles || ['USER'],
            content: content || '',
            image_url: imageUrl || '',
            likes: [],
            likes_count: 0
        });

        await newPost.save();

        res.status(201).json({
            success: true,
            post: {
                ...newPost.toObject(),
                isLiked: false
            }
        });
    } catch (error) {
        console.error('Error creating post:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// DELETE /api/feed/:id - Удалить пост
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const post = await Post.findOne({ id });

        if (!post) {
            return res.status(404).json({ error: 'Пост не найден' });
        }

        // Удалять может только автор или модератор/админ
        const isAuthor = post.author_id === req.user.telegramId;
        const isAdmin = hasRole(req.user, 'ADMIN') || hasRole(req.user, 'MODERATOR');

        if (!isAuthor && !isAdmin) {
            return res.status(403).json({ error: 'Нет прав на удаление' });
        }

        await Post.deleteOne({ id });
        // Удаляем комментарии к посту
        await Comment.deleteMany({ post_id: id });

        res.json({ success: true, message: 'Пост удален' });
    } catch (error) {
        console.error('Error deleting post:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// POST /api/feed/:id/like - Лайк/Дизлайк
router.post('/:id/like', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const post = await Post.findOne({ id });

        if (!post) {
            return res.status(404).json({ error: 'Пост не найден' });
        }

        const userId = req.user.telegramId;
        const isLiked = post.likes.includes(userId);

        if (isLiked) {
            // Убираем лайк
            post.likes = post.likes.filter(uid => uid !== userId);
        } else {
            // Ставим лайк
            post.likes.push(userId);
        }

        post.likes_count = post.likes.length;
        await post.save();

        res.json({
            success: true,
            likesCount: post.likes_count,
            isLiked: !isLiked
        });
    } catch (error) {
        console.error('Error toggling like:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// GET /api/feed/:id/comments - Получить комментарии
router.get('/:id/comments', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const comments = await Comment.find({ post_id: id }).sort({ created_at: 1 });
        res.json({ success: true, comments });
    } catch (error) {
        console.error('Error fetching comments:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// POST /api/feed/:id/comments - Написать комментарий
router.post('/:id/comments', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { text } = req.body;

        if (!text || !text.trim()) {
            return res.status(400).json({ error: 'Комментарий не может быть пустым' });
        }

        const post = await Post.findOne({ id });
        if (!post) {
            return res.status(404).json({ error: 'Пост не найден' });
        }

        const commentId = `cmt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const newComment = new Comment({
            id: commentId,
            post_id: id,
            author_id: req.user.telegramId,
            author_name: req.user.display_name || req.user.first_name || 'User',
            author_avatar: req.user.avatar_url || '',
            text: text.trim()
        });

        await newComment.save();

        res.status(201).json({
            success: true,
            comment: newComment
        });
    } catch (error) {
        console.error('Error creating comment:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

export default router;
