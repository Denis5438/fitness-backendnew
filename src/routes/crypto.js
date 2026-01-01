import { Router } from 'express';
import crypto from 'crypto';
import { config } from '../config.js';
import { CryptoInvoice, Settings, WithdrawalRequest } from '../database/models.js';
import {
  createUser,
  getProgram,
  getUser,
  hasPurchased,
  purchaseProgram,
  debitUserBalanceIfEnough,
  updateUserBalance,
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

const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

async function getWithdrawalFeePercent() {
  const setting = await Settings.findOne({ key: 'withdrawalFeePercent' }).lean();
  const percent = Number(setting?.value);
  return Number.isFinite(percent) ? percent : 3;
}

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

    if (!result.invoiceId) {
      console.warn('⚠️ Webhook без invoiceId');
      return res.json({ ok: true });
    }

    // Идемпотентность по invoice_id
    try {
      await CryptoInvoice.create({
        invoice_id: result.invoiceId,
        type: result.type,
        status: 'PROCESSING',
        telegram_id: Number(result.userId) || undefined,
        program_id: result.programId || undefined,
        amount: Number(result.amount) || undefined,
        asset: result.asset || 'USDT',
      });
    } catch (error) {
      if (error.code === 11000) {
        const existing = await CryptoInvoice.findOne({ invoice_id: result.invoiceId }).lean();
        if (existing?.status === 'DONE' || existing?.status === 'PROCESSING') {
          return res.json({ ok: true });
        }

        const claimed = await CryptoInvoice.findOneAndUpdate(
          { invoice_id: result.invoiceId, status: 'FAILED' },
          { $set: { status: 'PROCESSING', error: '' } },
          { new: true }
        ).lean();

        if (!claimed) {
          return res.json({ ok: true });
        }
      } else {
        throw error;
      }
    }

    const markInvoiceFailed = async (reason) => {
      await CryptoInvoice.updateOne(
        { invoice_id: result.invoiceId },
        { $set: { status: 'FAILED', error: reason, processed_at: new Date() } }
      );
      return res.json({ ok: true });
    };

    // Обработка в зависимости от типа платежа
    try {
      if (result.type === 'deposit') {
        const targetUserId = Number(result.userId);
        if (!Number.isFinite(targetUserId)) {
          console.warn(`⚠️ Некорректный userId в пополнении: ${result.userId}`);
          return await markInvoiceFailed('invalid_user_id');
        }

        if (!await getUser(targetUserId)) {
          await createUser(targetUserId, {});
        }
        await updateUserBalance(targetUserId, result.amount);

        console.log(`✅ Пополнение баланса: ${result.amount} ${result.asset} для пользователя ${result.userId}`);
      } else if (result.type === 'purchase') {
        // Покупка программы: фиксируем покупку в существующем хранилище users.js
        const program = await getProgram(result.programId);
        if (!program) {
          console.warn(`⚠️ Программа не найдена (programId=${result.programId})`);
          return await markInvoiceFailed('program_not_found');
        }

        const buyerTelegramId = Number(result.userId);
        if (!Number.isFinite(buyerTelegramId)) {
          console.warn(`⚠️ Некорректный userId в платеже: ${result.userId}`);
          return await markInvoiceFailed('invalid_user_id');
        }

        // Гарантируем, что пользователь существует в хранилище
        if (!await getUser(buyerTelegramId)) {
          await createUser(buyerTelegramId, {});
        }

        const alreadyPurchased = await hasPurchased(buyerTelegramId, result.programId);
        if (!alreadyPurchased) {
          await purchaseProgram(buyerTelegramId, result.programId);

          const paidAmount = Number(result.amount) || Number(program.price) || 0;
          if (paidAmount > 0) {
            const trainerId = Number(result.trainerId) || program.authorId;
            const trainerShare = roundMoney(paidAmount * 0.9);
            const adminShare = roundMoney(paidAmount - trainerShare);
            if (trainerId) {
              await updateUserBalance(trainerId, trainerShare);
            }
            if (adminShare > 0 && config.adminTelegramId) {
              await updateUserBalance(config.adminTelegramId, adminShare);
            }
          }
        }

        console.log(`✅ Покупка программы: ${program.title} за ${result.amount} ${result.asset}`);
      } else {
        return await markInvoiceFailed('unknown_type');
      }

      await CryptoInvoice.updateOne(
        { invoice_id: result.invoiceId },
        { $set: { status: 'DONE', processed_at: new Date() } }
      );
    } catch (error) {
      console.error('❌ Ошибка обработки платежа:', error);
      await CryptoInvoice.updateOne(
        { invoice_id: result.invoiceId },
        { $set: { status: 'FAILED', error: error.message || 'processing_failed', processed_at: new Date() } }
      );
      throw error;
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

    const program = await getProgram(programId);
    if (!program) {
      return res.status(404).json({ error: 'Program not found' });
    }

    if (await hasPurchased(userId, programId)) {
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

// ==========================================
// WITHDRAWAL REQUESTS (server-side)
// ==========================================

// Создать заявку на вывод (тренер/модератор/админ)
router.post('/withdrawals', authMiddleware, async (req, res) => {
  try {
    if (!['TRAINER', 'MODERATOR', 'ADMIN'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Вывод доступен только тренерам' });
    }

    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Укажите сумму для вывода' });
    }

    const user = await getUser(req.user.telegramId);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    let debited = false;
    try {
      const debitedOk = await debitUserBalanceIfEnough(req.user.telegramId, amount);
      if (!debitedOk) {
        return res.status(400).json({ error: 'Недостаточно средств' });
      }
      debited = true;

      const userName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
      const id = `wr_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      const created = await WithdrawalRequest.create({
        id,
        telegram_id: req.user.telegramId,
        user_name: userName,
        username: user.username || '',
        amount,
        status: 'PENDING',
      });

      res.json({
        success: true,
        request: {
          id: created.id,
          userId: created.telegram_id,
          userName: created.user_name,
          username: created.username,
          amount: created.amount,
          status: created.status,
          createdAt: created.created_at,
        }
      });
    } catch (error) {
      if (debited) {
        await updateUserBalance(req.user.telegramId, amount);
      }
      throw error;
    }
  } catch (error) {
    console.error('❌ Ошибка создания заявки на вывод:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получить заявки на вывод (только модераторы)
router.get('/withdrawals/pending', authMiddleware, async (req, res) => {
  try {
    if (!['MODERATOR', 'ADMIN'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }

    const requests = await WithdrawalRequest.find({ status: { $in: ['PENDING', 'PROCESSING'] } })
      .sort({ created_at: 1 })
      .lean();

    res.json({
      success: true,
      requests: requests.map(r => ({
        id: r.id,
        userId: r.telegram_id,
        userName: r.user_name,
        username: r.username,
        amount: r.amount,
        status: r.status,
        createdAt: r.created_at,
      })),
    });
  } catch (error) {
    console.error('❌ Ошибка получения заявок на вывод:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получить мои заявки (пользователь)
router.get('/withdrawals/my', authMiddleware, async (req, res) => {
  try {
    const requests = await WithdrawalRequest.find({ telegram_id: req.user.telegramId })
      .sort({ created_at: -1 })
      .lean();

    res.json({
      success: true,
      requests: requests.map(r => ({
        id: r.id,
        userId: r.telegram_id,
        userName: r.user_name,
        username: r.username,
        amount: r.amount,
        status: r.status,
        feePercent: r.fee_percent || 0,
        feeAmount: r.fee_amount || 0,
        netAmount: r.net_amount || 0,
        createdAt: r.created_at,
        reviewedAt: r.reviewed_at,
      })),
    });
  } catch (error) {
    console.error('❌ Ошибка получения заявок пользователя:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Одобрить заявку (модератор)
router.post('/withdrawals/:id/approve', authMiddleware, async (req, res) => {
  try {
    if (!['MODERATOR', 'ADMIN'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }

    const { id } = req.params;
    let request = await WithdrawalRequest.findOne({ id }).lean();
    if (!request) {
      return res.status(404).json({ error: 'Заявка не найдена' });
    }

    if (request.status === 'APPROVED' || request.status === 'REJECTED') {
      return res.status(400).json({ error: 'Заявка уже обработана' });
    }

    const spendId = request.spend_id || `withdraw_${request.telegram_id}_${Date.now()}`;

    if (request.status === 'PENDING') {
      const updated = await WithdrawalRequest.findOneAndUpdate(
        { id, status: 'PENDING' },
        { $set: { status: 'PROCESSING', spend_id: spendId, updated_at: new Date() } },
        { new: true }
      ).lean();

      if (!updated) {
        return res.status(409).json({ error: 'Заявка уже в обработке' });
      }

      request = updated;
    } else if (request.status === 'PROCESSING' && !request.spend_id) {
      await WithdrawalRequest.updateOne(
        { id, status: 'PROCESSING' },
        { $set: { spend_id: spendId, updated_at: new Date() } }
      );
    }

    const feePercent = await getWithdrawalFeePercent();
    const feeAmount = roundMoney(request.amount * feePercent / 100);
    const netAmount = roundMoney(request.amount - feeAmount);

    try {
      const { withdrawToTrainer } = await import('../cryptoBot.js');
      await withdrawToTrainer(
        request.telegram_id,
        'USDT',
        netAmount,
        `Вывод средств тренеру ID:${request.telegram_id}`,
        spendId
      );
    } catch (error) {
      const message = error?.message || '';
      const isDuplicate = /spend_id|duplicate|SPEND_ID/i.test(message);
      if (!isDuplicate) {
        await WithdrawalRequest.updateOne(
          { id, status: 'PROCESSING' },
          { $set: { status: 'PENDING', updated_at: new Date() } }
        );
        throw error;
      }
    }

    await WithdrawalRequest.updateOne(
      { id, status: 'PROCESSING' },
      {
        $set: {
          status: 'APPROVED',
          reviewed_by: req.user.telegramId,
          reviewed_at: new Date(),
          fee_percent: feePercent,
          fee_amount: feeAmount,
          net_amount: netAmount,
          spend_id: spendId,
          updated_at: new Date(),
        }
      }
    );

    const updated = await WithdrawalRequest.findOne({ id }).lean();
    if (!updated) {
      return res.status(500).json({ error: 'Не удалось обновить заявку' });
    }
    if (updated.status !== 'APPROVED') {
      return res.status(500).json({ error: 'Не удалось завершить вывод' });
    }

    if (feeAmount > 0 && config.adminTelegramId) {
      await updateUserBalance(config.adminTelegramId, feeAmount);
    }

    res.json({
      success: true,
      request: {
        id: updated.id,
        userId: updated.telegram_id,
        userName: updated.user_name,
        username: updated.username,
        amount: updated.amount,
        status: updated.status,
        feePercent: updated.fee_percent,
        feeAmount: updated.fee_amount,
        netAmount: updated.net_amount,
        reviewedAt: updated.reviewed_at,
      }
    });
  } catch (error) {
    console.error('❌ Ошибка одобрения заявки:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Отклонить заявку (модератор)
router.post('/withdrawals/:id/reject', authMiddleware, async (req, res) => {
  try {
    if (!['MODERATOR', 'ADMIN'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }

    const { id } = req.params;
    const { reason } = req.body;
    const updated = await WithdrawalRequest.findOneAndUpdate(
      { id, status: 'PENDING' },
      {
        $set: {
          status: 'REJECTED',
          reviewed_by: req.user.telegramId,
          reviewed_at: new Date(),
          rejection_reason: reason || '',
          updated_at: new Date(),
        }
      },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ error: 'Заявка не найдена' });
    }

    await updateUserBalance(updated.telegram_id, updated.amount);

    res.json({
      success: true,
      request: {
        id: updated.id,
        userId: updated.telegram_id,
        userName: updated.user_name,
        username: updated.username,
        amount: updated.amount,
        status: updated.status,
        reviewedAt: updated.reviewed_at,
      }
    });
  } catch (error) {
    console.error('❌ Ошибка отклонения заявки:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Вывод средств (только для модераторов/админов)
router.post('/withdraw', authMiddleware, async (req, res) => {
  try {
    // Проверяем что пользователь - модератор или админ
    const hasRole = ['MODERATOR', 'ADMIN'].includes(req.user.role);

    if (!hasRole) {
      return res.status(403).json({ error: 'Вывод доступен только модераторам' });
    }

    const { amount, asset = 'USDT', targetUserId } = req.body;
    if (targetUserId) {
      return res.status(400).json({ error: 'Используйте одобрение заявки на вывод' });
    }
    // Если указан targetUserId — это модератор одобряет заявку тренера
    // Если нет — модератор выводит на себя
    const recipientId = req.user.telegramId;
    const balanceOwnerId = req.user.telegramId;

    const transferAmount = Number(amount);
    const totalAmount = transferAmount;
    const fee = 0;

    if (!Number.isFinite(transferAmount) || transferAmount <= 0) {
      return res.status(400).json({ error: 'Укажите сумму для вывода' });
    }
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      return res.status(400).json({ error: 'Некорректная сумма' });
    }
    if (totalAmount < transferAmount) {
      return res.status(400).json({ error: 'Сумма вывода превышает доступную' });
    }
    if (!Number.isFinite(balanceOwnerId) || !Number.isFinite(recipientId)) {
      return res.status(400).json({ error: 'Некорректный идентификатор пользователя' });
    }

    const balanceOwner = await getUser(balanceOwnerId);
    if (!balanceOwner) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    if ((balanceOwner.balance || 0) < totalAmount) {
      return res.status(400).json({ error: 'Недостаточно средств' });
    }

    // Вызываем функцию вывода через CryptoBot
    const { withdrawToTrainer } = await import('../cryptoBot.js');

    const result = await withdrawToTrainer(
      recipientId,
      asset,
      transferAmount,
      targetUserId ? `Вывод средств тренеру ID:${recipientId}` : 'Вывод средств FitMarket'
    );

    await updateUserBalance(balanceOwnerId, -totalAmount);
    if (fee > 0 && config.adminTelegramId) {
      await updateUserBalance(config.adminTelegramId, fee);
    }

    res.json({
      success: true,
      message: `Вывод ${transferAmount} ${asset} успешно отправлен`,
      transfer: result,
    });
  } catch (error) {
    console.error('❌ Ошибка вывода средств:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
