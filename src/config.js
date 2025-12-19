import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  database: {
    path: process.env.DATABASE_PATH || './fitness.db',
  },
  
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    maxTokens: parseInt(process.env.AI_MAX_TOKENS || '500', 10),
    temperature: parseFloat(process.env.AI_TEMPERATURE || '0.7'),
  },
  
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    botUsername: process.env.TELEGRAM_BOT_USERNAME || 'CalculatorKBJUbot',
    webappUrl: process.env.WEBAPP_URL || 'https://fitmarket-tg-webapp.netlify.app',
  },
  
  cryptoBot: {
    token: process.env.CRYPTO_BOT_TOKEN || '',
  },
  
  // Telegram ID администратора (только он может выдавать роль MODERATOR через бота)
  adminTelegramId: parseInt(process.env.ADMIN_TELEGRAM_ID || '0', 10),
  
  cors: {
    origins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5174,https://fitmarket-tg-webapp.netlify.app').split(','),
  },
  
  rateLimit: {
    freeTierAiRequests: parseInt(process.env.FREE_TIER_AI_REQUESTS || '10', 10),
    proTierAiRequests: parseInt(process.env.PRO_TIER_AI_REQUESTS || '-1', 10),
  },
};
