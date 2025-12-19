import { Telegraf, Markup } from 'telegraf';
import { config } from './config.js';
import {
  getUser,
  createUser,
  setUserRole,
  findUserByUsername,
  getUsersByRole,
  getWorkoutStats
} from './database/users.js';
import { createDepositInvoice, getCryptoPay } from './cryptoBot.js';

const bot = new Telegraf(config.telegram.botToken);

// Проверка что пользователь - админ
function isAdmin(telegramId) {
  return telegramId === config.adminTelegramId;
}

// ==========================================
// КОМАНДЫ ДЛЯ ВСЕХ
// ==========================================

bot.command('start', async (ctx) => {
  const escapeHtml = (str) => String(str || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const firstName = escapeHtml(ctx.from.first_name) || 'Атлет';
  const telegramId = ctx.from.id;

  // Создаём пользователя если его нет
  let user = getUser(telegramId);
  if (!user) {
    user = createUser(telegramId, {
      username: ctx.from.username || '',
      first_name: ctx.from.first_name || '',
      last_name: ctx.from.last_name || '',
    });
  }

  await ctx.reply(
    `👋 Привет, ${firstName}!\n\n` +
    `💪 Добро пожаловать в <b>FitMarket</b>!\n\n` +
    `📝 Здесь ты можешь:\n` +
    `• Вести дневник тренировок\n` +
    `• Создавать свои программы\n` +
    `• Покупать программы тренеров\n\n` +
    `Нажми кнопку ниже, чтобы открыть приложение! 👇`,
    {
      parse_mode: 'HTML',
      ...Markup.keyboard([
        [Markup.button.webApp('🏋️ Открыть FitMarket', config.telegram.webappUrl)]
      ]).resize()
    }
  );
});

bot.command('help', async (ctx) => {
  const telegramId = ctx.from.id;
  const user = getUser(telegramId);
  const role = user?.role || 'USER';

  let helpText = `❓ <b>Помощь</b>\n\n` +
    `Твоя роль: <b>${role}</b>\n\n` +
    `📱 Команды:\n` +
    `/start - Открыть приложение\n` +
    `/help - Показать справку\n` +
    `/me - Мой профиль\n`;

  if (isAdmin(telegramId)) {
    helpText += `\n👑 <b>Команды администратора:</b>\n` +
      `/add_moderator @username - Назначить модератора\n` +
      `/remove_moderator @username - Снять модератора\n` +
      `/list_moderators - Список модераторов\n` +
      `/list_trainers - Список тренеров\n`;
  }

  await ctx.reply(helpText, {
    parse_mode: 'HTML',
    ...Markup.keyboard([
      [Markup.button.webApp('🏋️ Открыть FitMarket', config.telegram.webappUrl)]
    ]).resize()
  });
});

bot.command('me', async (ctx) => {
  const telegramId = ctx.from.id;
  let user = getUser(telegramId);

  if (!user) {
    user = createUser(telegramId, {
      username: ctx.from.username || '',
      first_name: ctx.from.first_name || '',
      last_name: ctx.from.last_name || '',
    });
  }

  const stats = getWorkoutStats(telegramId);

  // Экранируем HTML спецсимволы в имени
  const escapeHtml = (str) => String(str || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const firstName = escapeHtml(user.firstName);
  const lastName = escapeHtml(user.lastName);
  const username = escapeHtml(user.username) || 'не указан';

  await ctx.reply(
    `👤 <b>Твой профиль</b>\n\n` +
    `📛 Имя: ${firstName} ${lastName}\n` +
    `🆔 Username: @${username}\n` +
    `🎭 Роль: <b>${user.role}</b>\n\n` +
    `📊 <b>Статистика:</b>\n` +
    `• Всего тренировок: ${stats.totalWorkouts}\n` +
    `• За неделю: ${stats.weeklyWorkouts}\n` +
    `• За месяц: ${stats.monthlyWorkouts}`,
    { parse_mode: 'HTML' }
  );
});

// ==========================================
// КОМАНДЫ БАЛАНСА И ОПЛАТЫ
// ==========================================

// Команда пополнения баланса
bot.command('deposit', async (ctx) => {
  const telegramId = ctx.from.id;
  const args = ctx.message.text.split(' ');
  const amount = parseFloat(args[1]);

  if (!amount || amount < 1) {
    await ctx.reply(
      '💰 <b>Пополнение баланса</b>\n\n' +
      'Используй: /deposit [сумма]\n' +
      'Пример: /deposit 10\n\n' +
      'Минимальная сумма: 1 USDT',
      { parse_mode: 'HTML' }
    );
    return;
  }

  try {
    const invoice = await createDepositInvoice(telegramId, amount);

    await ctx.reply(
      `💳 <b>Оплата ${amount} USDT</b>\n\n` +
      `Нажми кнопку ниже чтобы оплатить через CryptoBot:`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.url('💎 Оплатить в CryptoBot', invoice.payUrl)]
        ])
      }
    );
  } catch (error) {
    console.error('Deposit error:', error);
    await ctx.reply('❌ Ошибка создания платежа: ' + error.message);
  }
});

// Команда проверки баланса
bot.command('balance', async (ctx) => {
  const telegramId = ctx.from.id;
  let user = getUser(telegramId);

  if (!user) {
    user = createUser(telegramId, {
      username: ctx.from.username || '',
      first_name: ctx.from.first_name || '',
      last_name: ctx.from.last_name || '',
    });
  }

  const balance = user.balance || 0;

  await ctx.reply(
    `💰 <b>Твой баланс:</b> ${balance} ⭐\n\n` +
    `Для пополнения используй /deposit [сумма]`,
    { parse_mode: 'HTML' }
  );
});

// ==========================================
// КОМАНДЫ АДМИНИСТРАТОРА (выдача модераторов)
// ==========================================

bot.command('add_moderator', async (ctx) => {
  const telegramId = ctx.from.id;

  if (!isAdmin(telegramId)) {
    await ctx.reply('❌ Эта команда доступна только администратору.');
    return;
  }

  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    await ctx.reply('❓ Использование: /add_moderator @username');
    return;
  }

  const username = args[1];
  const targetUser = findUserByUsername(username);

  if (!targetUser) {
    await ctx.reply(
      `❌ Пользователь ${username} не найден.\n\n` +
      `Он должен сначала открыть приложение через бота.`
    );
    return;
  }

  if (targetUser.role === 'MODERATOR') {
    await ctx.reply(`ℹ️ ${username} уже является модератором.`);
    return;
  }

  setUserRole(targetUser.telegramId, 'MODERATOR');

  await ctx.reply(`✅ Пользователь ${username} назначен **МОДЕРАТОРОМ**!`, { parse_mode: 'Markdown' });

  // Уведомляем пользователя
  try {
    await bot.telegram.sendMessage(
      targetUser.telegramId,
      `🎉 Поздравляем! Вам присвоена роль **МОДЕРАТОР**!\n\n` +
      `Теперь вы можете одобрять заявки тренеров в приложении.`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    // Пользователь мог заблокировать бота
  }
});

bot.command('remove_moderator', async (ctx) => {
  const telegramId = ctx.from.id;

  if (!isAdmin(telegramId)) {
    await ctx.reply('❌ Эта команда доступна только администратору.');
    return;
  }

  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    await ctx.reply('❓ Использование: /remove_moderator @username');
    return;
  }

  const username = args[1];
  const targetUser = findUserByUsername(username);

  if (!targetUser) {
    await ctx.reply(`❌ Пользователь ${username} не найден.`);
    return;
  }

  if (targetUser.role !== 'MODERATOR') {
    await ctx.reply(`ℹ️ ${username} не является модератором.`);
    return;
  }

  setUserRole(targetUser.telegramId, 'USER');

  await ctx.reply(`✅ Роль модератора снята с ${username}.`);
});

bot.command('list_moderators', async (ctx) => {
  const telegramId = ctx.from.id;

  if (!isAdmin(telegramId)) {
    await ctx.reply('❌ Эта команда доступна только администратору.');
    return;
  }

  const moderators = getUsersByRole('MODERATOR');

  if (moderators.length === 0) {
    await ctx.reply('📋 Модераторов пока нет.');
    return;
  }

  const list = moderators.map((m, i) =>
    `${i + 1}. ${m.firstName} ${m.lastName} (@${m.username || 'нет'})`
  ).join('\n');

  await ctx.reply(`🛡️ **Модераторы (${moderators.length}):**\n\n${list}`, { parse_mode: 'Markdown' });
});

bot.command('list_trainers', async (ctx) => {
  const telegramId = ctx.from.id;

  if (!isAdmin(telegramId)) {
    await ctx.reply('❌ Эта команда доступна только администратору.');
    return;
  }

  const trainers = getUsersByRole('TRAINER');

  if (trainers.length === 0) {
    await ctx.reply('📋 Тренеров пока нет.');
    return;
  }

  const list = trainers.map((m, i) =>
    `${i + 1}. ${m.firstName} ${m.lastName} (@${m.username || 'нет'})`
  ).join('\n');

  await ctx.reply(`💪 **Тренеры (${trainers.length}):**\n\n${list}`, { parse_mode: 'Markdown' });
});

// ==========================================
// ОБРАБОТКА ТЕКСТА
// ==========================================

bot.on('text', async (ctx) => {
  await ctx.reply(
    `👋 Используй кнопку ниже, чтобы открыть приложение!`,
    Markup.keyboard([
      [Markup.button.webApp('🏋️ Открыть FitMarket', config.telegram.webappUrl)]
    ]).resize()
  );
});

// Обработка ошибок
bot.catch((err, ctx) => {
  console.error(`❌ Bot error for ${ctx.updateType}:`, err);
});

// Запуск бота
async function startBot() {
  try {
    console.log('🤖 Starting Telegram bot...');
    console.log('🔑 Bot token:', config.telegram.botToken ? 'SET' : 'NOT SET');
    console.log('👑 Admin ID:', config.adminTelegramId || 'NOT SET');

    if (!config.telegram.botToken) {
      console.error('❌ TELEGRAM_BOT_TOKEN не установлен в .env файле!');
      process.exit(1);
    }

    await bot.telegram.setMyCommands([
      { command: 'start', description: 'Открыть приложение' },
      { command: 'help', description: 'Помощь' },
      { command: 'me', description: 'Мой профиль' },
    ]);

    await bot.launch();
    console.log('✅ Telegram bot is running!');
    console.log(`📱 WebApp URL: ${config.telegram.webappUrl}`);
  } catch (error) {
    console.error('❌ Failed to start bot:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('\n🛑 Stopping bot...');
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  console.log('\n🛑 Stopping bot...');
  bot.stop('SIGTERM');
});

export { bot, startBot };
