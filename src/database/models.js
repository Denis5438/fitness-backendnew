// MongoDB Models for FitMarket
// Using fitmarket_ prefix to avoid conflicts with existing collections

import mongoose from 'mongoose';

const Schema = mongoose.Schema;

// ==================== USER ====================
const userSchema = new Schema({
    telegram_id: { type: Number, required: true, unique: true, index: true },
    username: { type: String, default: '' },
    first_name: { type: String, default: '' },
    last_name: { type: String, default: '' },
    display_name: { type: String, default: '' }, // Кастомное имя пользователя
    avatar_url: { type: String, default: '' }, // URL или Base64 аватара
    // Старое поле role для обратной совместимости (будет мигрировано)
    role: {
        type: String,
        default: 'USER',
        enum: ['USER', 'TRAINER', 'MODERATOR', 'ADMIN']
    },
    // Новое поле roles - массив ролей для поддержки множественных ролей
    roles: {
        type: [String],
        default: ['USER'],
        enum: ['USER', 'TRAINER', 'MODERATOR', 'ADMIN']
    },
    subscription_tier: {
        type: String,
        default: 'free',
        enum: ['free', 'pro']
    },
    balance: { type: Number, default: 0 }, // Баланс пользователя
    last_seen_news_id: { type: String, default: '' }, // ID последней прочитанной новости
    ai_requests_count: { type: Number, default: 0 },
    ai_requests_reset_date: { type: Date },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'fitmarket_users'
});

// ==================== TRAINER REQUEST ====================
const trainerRequestSchema = new Schema({
    id: { type: String, required: true, unique: true },
    telegram_id: { type: Number, required: true, index: true },
    bio: { type: String, default: '' },
    experience: { type: String, default: '' },
    specialization: { type: String, default: '' },
    status: {
        type: String,
        default: 'PENDING',
        enum: ['PENDING', 'APPROVED', 'REJECTED'],
        index: true
    },
    reviewed_by: { type: Number },
    reviewed_at: { type: Date },
    rejection_reason: { type: String, default: '' },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: false },
    collection: 'fitmarket_trainer_requests'
});

// ==================== PROGRAM ====================
const programSchema = new Schema({
    id: { type: String, required: true, unique: true },
    author_id: { type: Number, required: true, index: true },
    title: { type: String, default: 'Без названия' },
    description: { type: String, default: '' },
    category: { type: String, default: 'general' },
    difficulty: { type: String, default: 'intermediate' },
    duration_weeks: { type: Number, default: 4 },
    price: { type: Number, default: 0 },
    is_published: { type: Boolean, default: false, index: true },
    is_personal: { type: Boolean, default: false },
    workouts: { type: Array, default: [] }, // JSON array
    purchase_count: { type: Number, default: 0 },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'fitmarket_programs'
});

// ==================== WORKOUT LOG ====================
const workoutLogSchema = new Schema({
    id: { type: String, required: true, unique: true },
    telegram_id: { type: Number, required: true, index: true },
    program_id: { type: String },
    workout_title: { type: String, default: 'Тренировка' },
    exercises: { type: Array, default: [] }, // JSON array
    duration: { type: Number, default: 0 },
    notes: { type: String, default: '' },
    completed_at: { type: Date, default: Date.now },
}, {
    timestamps: false,
    collection: 'fitmarket_workout_logs'
});

// ==================== PURCHASE ====================
const purchaseSchema = new Schema({
    telegram_id: { type: Number, required: true, index: true },
    program_id: { type: String, required: true },
    purchased_at: { type: Date, default: Date.now },
}, {
    timestamps: false,
    collection: 'fitmarket_purchases'
});
purchaseSchema.index({ telegram_id: 1, program_id: 1 }, { unique: true });

// ==================== AI MESSAGE ====================
const aiMessageSchema = new Schema({
    user_id: { type: Number, required: true, index: true },
    role: { type: String, required: true, enum: ['user', 'assistant', 'system'] },
    content: { type: String, required: true },
    created_at: { type: Date, default: Date.now },
}, {
    timestamps: false,
    collection: 'fitmarket_ai_messages'
});

// ==================== NEWS ====================
const newsSchema = new Schema({
    id: { type: String, required: true, unique: true },
    author_id: { type: Number, required: true },
    author_name: { type: String, default: '' },
    title: { type: String, required: true },
    content: { type: String, required: true },
    created_at: { type: Date, default: Date.now, index: true },
}, {
    timestamps: false,
    collection: 'fitmarket_news'
});

// ==================== SUPPORT MESSAGE ====================
const supportMessageSchema = new Schema({
    id: { type: String, required: true, unique: true },
    from_user_id: { type: Number, required: true, index: true },
    from_user_name: { type: String, default: '' },
    from_username: { type: String, default: '' },
    to_user_id: { type: String, required: true }, // 'support' or telegram_id
    message: { type: String, required: true },
    is_read: { type: Boolean, default: false },
    created_at: { type: Date, default: Date.now },
}, {
    timestamps: false,
    collection: 'fitmarket_support_messages'
});

// ==================== EXERCISE RECORD ====================
const exerciseRecordSchema = new Schema({
    telegram_id: { type: Number, required: true, index: true },
    exercise_name: { type: String, required: true },
    best_weight: { type: Number, default: 0 },
    best_reps: { type: Number, default: 0 },
    best_volume: { type: Number, default: 0 }, // weight * reps
    updated_at: { type: Date, default: Date.now },
}, {
    timestamps: false,
    collection: 'fitmarket_exercise_records'
});
exerciseRecordSchema.index({ telegram_id: 1, exercise_name: 1 }, { unique: true });

// Export models
// ==================== SETTINGS ====================
const settingsSchema = new Schema({
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed },
}, {
    timestamps: true,
    collection: 'fitmarket_settings'
});

export const User = mongoose.model('FitmarketUser', userSchema);
export const TrainerRequest = mongoose.model('FitmarketTrainerRequest', trainerRequestSchema);
export const Program = mongoose.model('FitmarketProgram', programSchema);
export const WorkoutLog = mongoose.model('FitmarketWorkoutLog', workoutLogSchema);
export const Purchase = mongoose.model('FitmarketPurchase', purchaseSchema);
export const AIMessage = mongoose.model('FitmarketAIMessage', aiMessageSchema);
export const News = mongoose.model('FitmarketNews', newsSchema);
export const SupportMessage = mongoose.model('FitmarketSupportMessage', supportMessageSchema);
export const ExerciseRecord = mongoose.model('FitmarketExerciseRecord', exerciseRecordSchema);
export const Settings = mongoose.model('FitmarketSettings', settingsSchema);
