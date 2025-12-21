// MongoDB Connection
import mongoose from 'mongoose';
import { config } from '../config.js';

let isConnected = false;

export async function connectMongoDB() {
    if (isConnected) {
        console.log('✅ MongoDB already connected');
        return;
    }

    const uri = process.env.MONGODB_URI;

    if (!uri) {
        console.error('❌ MONGODB_URI not set in environment variables');
        throw new Error('MONGODB_URI is required');
    }

    try {
        await mongoose.connect(uri, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });

        isConnected = true;
        console.log('✅ MongoDB connected to Grizzly database');
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        throw error;
    }
}

export function getMongoose() {
    return mongoose;
}

// Graceful shutdown
process.on('SIGINT', async () => {
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
    process.exit(0);
});
