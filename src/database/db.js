// MongoDB Database Module
// This file is kept for backward compatibility
// Actual models and functions are in models.js and users.js

import { connectMongoDB, getMongoose } from './mongodb.js';

export { connectMongoDB as initDatabase };
export { getMongoose as getDatabase };

// For MongoDB, getDatabase returns mongoose instance
// In routes that use raw queries, we'll need to update them to use models
