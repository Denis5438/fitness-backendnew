import { Router } from 'express';
import crypto from 'crypto';
import { config } from '../config.js';
import {
  createUser,
  getProgram,
  getUser,
  hasPurchased,
  purchaseProgram,
} from '../database/users.js';
import {
  createDepositInvoice,
  createPurchaseInvoice,
  checkInvoiceStatus,
  handleCryptoWebhook,
  getCryptoBalance,
} from '../cryptoBot.js';
import { authMiddleware } from './api.js';

const router = Router();

// Верификация подписи вебхука от CryptoBot
function verifyCryptoBotSignature(rawBody, signature) {
  if (!config.cryptoBot?.token) return false;
  if (!signature) return false;

  const secret = crypto
    .createHash('sha256')
    .update(config.cryptoBot.token)
    .digest();

  const hmac = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  return hmac === signature;
}

// Вебхук от CryptoBot (POST /api/crypto/webhook)
router.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['crypto-pay-api-signature'];

    // Проверяем подпись
    if (!verifyCryptoBotSignature(req.rawBody || Buffer.from(JSON.stringify(req.body || {})), signature)) {
      console.warn('⚠️ Неверная подпись вебхука CryptoBot');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Обрабатываем вебхук
    const result = await handleCryptoWebhook(req.body);

    if (!result) {
      return res.json({ ok: true });
    }

    // Обработка в зависимости от типа платежа
    if (result.type === 'deposit') {
      // Пополнение баланса: в текущей версии проекта баланс не хранится в БД.
      // Здесь просто подтверждаем событие. При необходимости добавим таблицу/поле balance.
      console.log(`✅ Пополнение баланса: ${result.amount} ${result.asset} для пользователя ${result.userId}`);
    } else if (result.type === 'purchase') {
      // Покупка программы: фиксируем покупку в существующем хранилище users.js
      const program = getProgram(result.programId);
      if (!program) {
        console.warn(`⚠️ Программа не найдена (programId=${result.programId})`);
        return res.json({ ok: true });
      }

      const buyerTelegramId = Number(result.userId);
      if (!Number.isFinite(buyerTelegramId)) {
        console.warn(`⚠️ Некорректный userId в платеже: ${result.userId}`);
        return res.json({ ok: true });
      }

      // Гарантируем, что пользователь существует в хранилище
      if (!getUser(buyerTelegramId)) {
        createUser(buyerTelegramId, {});
      }

      if (!hasPurchased(buyerTelegramId, result.programId)) {
        purchaseProgram(buyerTelegramId, result.programId);
      }

      console.log(`✅ Покупка программы: ${program.title} за ${result.amount} ${result.asset}`);
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('❌ Ошибка обработки вебхука:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Создать инвойс для пополнения баланса (требуется авторизация)
router.post('/deposit', authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    const userId = req.user.telegramId; // Берём из авторизации

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const invoice = await createDepositInvoice(userId, amount);
    res.json(invoice);
  } catch (error) {
    console.error('❌ Ошибка создания инвойса:', error);
    res.status(500).json({ error: error.message });
  }
});

// Создать инвойс для покупки программы (требуется авторизация)
router.post('/purchase', authMiddleware, async (req, res) => {
  try {
    const { programId } = req.body;
    const userId = req.user.telegramId; // Берём из авторизации

    if (!programId) {
      return res.status(400).json({ error: 'Invalid programId' });
    }

    const program = getProgram(programId);
    if (!program) {
      return res.status(404).json({ error: 'Program not found' });
    }

    if (hasPurchased(userId, programId)) {
      return res.status(400).json({ error: 'Вы уже приобрели эту программу' });
    }

    const invoice = await createPurchaseInvoice(
      userId,
      programId,
      program.title,
      program.price,
      program.authorId
    );

    res.json(invoice);
  } catch (error) {
    console.error('❌ Ошибка создания инвойса:', error);
    res.status(500).json({ error: error.message });
  }
});

// Проверить статус инвойса
router.get('/invoice/:invoiceId', async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const status = await checkInvoiceStatus(invoiceId);

    if (!status) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.json(status);
  } catch (error) {
    console.error('❌ Ошибка проверки инвойса:', error);
    res.status(500).json({ error: error.message });
  }
});

// Получить баланс кошелька (только для модераторов)
router.get('/balance', authMiddleware, async (req, res) => {
  // Проверяем роль
  if (req.user.role !== 'MODERATOR' && req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Access denied' });
  }
  try {
    const balance = await getCryptoBalance();
    res.json(balance);
  } catch (error) {
    console.error('❌ Ошибка получения баланса:', error);
    res.status(500).json({ error: error.message });
  }
});

// Вывод средств (только для тренеров)
router.post('/withdraw', authMiddleware, async (req, res) => {
  try {
    // Проверяем что пользователь - тренер или выше
    if (req.user.role !== 'TRAINER' && req.user.role !== 'MODERATOR' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Вывод доступен только тренерам' });
    }

    const { amount, asset = 'USDT' } = req.body;
    const userId = req.user.telegramId;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Укажите сумму для вывода' });
    }

    // Вызываем функцию вывода через CryptoBot
    const { withdrawToTrainer } = await import('../cryptoBot.js');

    const result = await withdrawToTrainer(
      userId,
      asset,
      amount,
      'Вывод средств FitMarket'
    );

    res.json({
      success: true,
      message: `Вывод ${amount} ${asset} успешно отправлен`,
      transfer: result,
    });
  } catch (error) {
    console.error('❌ Ошибка вывода средств:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
