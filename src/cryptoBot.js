// CryptoBot Pay API интеграция
// Документация: https://help.crypt.bot/crypto-pay-api

const CRYPTO_BOT_API = 'https://pay.crypt.bot/api';

class CryptoPayAPI {
  constructor(token) {
    this.token = token;
    this.baseUrl = CRYPTO_BOT_API;
  }

  async request(method, params = {}) {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: {
        'Crypto-Pay-API-Token': this.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.error?.message || 'CryptoBot API error');
    }

    return data.result;
  }

  // Получить информацию о приложении
  async getMe() {
    return this.request('getMe');
  }

  // Получить доступные валюты
  async getCurrencies() {
    return this.request('getCurrencies');
  }

  // Получить курсы обмена
  async getExchangeRates() {
    return this.request('getExchangeRates');
  }

  // Создать инвойс для оплаты
  async createInvoice({
    asset = 'USDT',           // Валюта: BTC, TON, ETH, USDT, USDC, BNB
    amount,                    // Сумма
    description = '',          // Описание
    hiddenMessage = '',        // Сообщение после оплаты
    paidBtnName = 'callback',  // Кнопка после оплаты: callback, openUrl, closeBot
    paidBtnUrl = '',           // URL для кнопки
    payload = '',              // Данные для идентификации (до 4096 символов)
    allowComments = true,      // Разрешить комментарии
    allowAnonymous = true,     // Разрешить анонимную оплату
    expiresIn = 3600,          // Время жизни инвойса в секундах (1 час)
  }) {
    const params = {
      asset,
      amount: amount.toString(),
      description,
      hidden_message: hiddenMessage,
      paid_btn_name: paidBtnName,
      payload,
      allow_comments: allowComments,
      allow_anonymous: allowAnonymous,
      expires_in: expiresIn,
    };

    if (paidBtnUrl) {
      params.paid_btn_url = paidBtnUrl;
    }

    return this.request('createInvoice', params);
  }

  // Получить список инвойсов
  async getInvoices({
    asset,
    invoiceIds,
    status,  // active, paid, expired
    offset = 0,
    count = 100,
  } = {}) {
    const params = { offset, count };
    if (asset) params.asset = asset;
    if (invoiceIds) params.invoice_ids = invoiceIds.join(',');
    if (status) params.status = status;

    return this.request('getInvoices', params);
  }

  // Проверить статус конкретного инвойса
  async getInvoice(invoiceId) {
    const result = await this.getInvoices({ invoiceIds: [invoiceId] });
    return result.items?.[0] || null;
  }

  // Получить баланс
  async getBalance() {
    return this.request('getBalance');
  }

  // Перевод средств (для выплат тренерам)
  async transfer({
    userId,           // Telegram user ID получателя
    asset,            // Валюта
    amount,           // Сумма
    spendId,          // Уникальный ID операции (для предотвращения дублей)
    comment = '',     // Комментарий
    disableSendNotification = false,
  }) {
    return this.request('transfer', {
      user_id: userId,
      asset,
      amount: amount.toString(),
      spend_id: spendId,
      comment,
      disable_send_notification: disableSendNotification,
    });
  }
}

// Хранилище ожидающих оплаты инвойсов
const pendingInvoices = new Map();

// Создать экземпляр API
let cryptoPayInstance = null;

function initCryptoPay(token) {
  if (!token) {
    console.warn('⚠️ CRYPTO_BOT_TOKEN не установлен - платежи через крипту недоступны');
    return null;
  }
  cryptoPayInstance = new CryptoPayAPI(token);
  console.log('✅ CryptoBot Pay API инициализирован');
  return cryptoPayInstance;
}

function getCryptoPay() {
  return cryptoPayInstance;
}

// Создать инвойс для пополнения баланса
async function createDepositInvoice(userId, amountUSD, description = 'Пополнение баланса FitMarket') {
  const api = getCryptoPay();
  if (!api) throw new Error('CryptoBot не настроен');

  const invoice = await api.createInvoice({
    asset: 'USDT',
    amount: amountUSD,
    description,
    payload: JSON.stringify({ type: 'deposit', userId, amountUSD }),
    paidBtnName: 'callback',
    expiresIn: 1800, // 30 минут
  });

  // Сохраняем для отслеживания
  pendingInvoices.set(invoice.invoice_id, {
    invoiceId: invoice.invoice_id,
    userId,
    amountUSD,
    type: 'deposit',
    createdAt: new Date(),
    payUrl: invoice.pay_url,
  });

  return {
    invoiceId: invoice.invoice_id,
    payUrl: invoice.pay_url,
    amount: amountUSD,
    asset: 'USDT',
    expiresAt: new Date(Date.now() + 1800 * 1000),
  };
}

// Создать инвойс для покупки программы
async function createPurchaseInvoice(userId, programId, programTitle, priceUSD, trainerId) {
  const api = getCryptoPay();
  if (!api) throw new Error('CryptoBot не настроен');

  const invoice = await api.createInvoice({
    asset: 'USDT',
    amount: priceUSD,
    description: `Покупка: ${programTitle}`,
    payload: JSON.stringify({ type: 'purchase', userId, programId, trainerId, priceUSD }),
    paidBtnName: 'callback',
    expiresIn: 1800,
  });

  pendingInvoices.set(invoice.invoice_id, {
    invoiceId: invoice.invoice_id,
    userId,
    programId,
    trainerId,
    priceUSD,
    type: 'purchase',
    createdAt: new Date(),
    payUrl: invoice.pay_url,
  });

  return {
    invoiceId: invoice.invoice_id,
    payUrl: invoice.pay_url,
    amount: priceUSD,
    asset: 'USDT',
  };
}

// Проверить статус инвойса
async function checkInvoiceStatus(invoiceId) {
  const api = getCryptoPay();
  if (!api) throw new Error('CryptoBot не настроен');

  const invoice = await api.getInvoice(invoiceId);
  if (!invoice) return null;

  return {
    invoiceId: invoice.invoice_id,
    status: invoice.status, // active, paid, expired
    amount: invoice.amount,
    asset: invoice.asset,
    paidAt: invoice.paid_at,
    payUrl: invoice.pay_url,
  };
}

// Обработка вебхука от CryptoBot
async function handleCryptoWebhook(update) {
  if (update.update_type !== 'invoice_paid') return null;

  const invoice = update.payload;
  const invoiceId = invoice.invoice_id;

  // Получаем сохранённые данные
  const pending = pendingInvoices.get(invoiceId);
  if (!pending) {
    console.warn(`⚠️ Неизвестный инвойс: ${invoiceId}`);
    return null;
  }

  // Парсим payload
  let payloadData = {};
  try {
    payloadData = JSON.parse(invoice.payload || '{}');
  } catch (e) {
    console.warn('⚠️ Ошибка парсинга payload:', e.message);
  }

  // Удаляем из ожидающих
  pendingInvoices.delete(invoiceId);

  return {
    type: pending.type,
    invoiceId,
    userId: pending.userId,
    amount: parseFloat(invoice.amount),
    asset: invoice.asset,
    programId: pending.programId,
    trainerId: pending.trainerId,
    paidAt: invoice.paid_at,
  };
}

// Получить баланс CryptoBot кошелька
async function getCryptoBalance() {
  const api = getCryptoPay();
  if (!api) return [];

  return api.getBalance();
}

// Вывод средств тренеру
async function withdrawToTrainer(trainerId, asset, amount, comment = 'Вывод средств FitMarket') {
  const api = getCryptoPay();
  if (!api) throw new Error('CryptoBot не настроен');

  const spendId = `withdraw_${trainerId}_${Date.now()}`;

  return api.transfer({
    userId: trainerId,
    asset,
    amount,
    spendId,
    comment,
  });
}

export {
  initCryptoPay,
  getCryptoPay,
  createDepositInvoice,
  createPurchaseInvoice,
  checkInvoiceStatus,
  handleCryptoWebhook,
  getCryptoBalance,
  withdrawToTrainer,
  pendingInvoices,
};
