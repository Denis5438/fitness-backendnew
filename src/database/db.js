import Database from 'better-sqlite3';
import { config } from '../config.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db = null;

export function getDatabase() {
  if (!db) {
    db = new Database(config.database.path);
    
    // Оптимизации для производительности
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.pragma('cache_size = -64000'); // 64MB
    
    console.log('✅ Database connected:', config.database.path);
  }
  
  return db;
}

export function initDatabase() {
  const database = getDatabase();
  
  // Читаем и выполняем SQL схему
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  
  database.exec(schema);
  
  console.log('✅ Database schema initialized');
}

export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    console.log('✅ Database connection closed');
  }
}
