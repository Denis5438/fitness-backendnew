// Mock база данных для демонстрации (без better-sqlite3)

let users = new Map();
let workouts = [];
let exercises = [];
let aiMessages = [];

export function getDatabase() {
  return {
    prepare: (sql) => ({
      get: (...params) => {
        if (sql.includes('SELECT * FROM users WHERE telegram_id')) {
          return users.get(params[0]) || null;
        }
        if (sql.includes('SELECT COUNT(*) as count FROM workouts')) {
          return { count: workouts.filter(w => w.user_id === params[0]).length };
        }
        if (sql.includes('SELECT AVG(duration_minutes)')) {
          const userWorkouts = workouts.filter(w => w.user_id === params[0]);
          const avg = userWorkouts.reduce((sum, w) => sum + (w.duration_minutes || 0), 0) / userWorkouts.length;
          return { avg: avg || 0 };
        }
        return null;
      },
      all: (...params) => {
        if (sql.includes('SELECT * FROM workouts')) {
          return workouts.filter(w => w.user_id === params[0]).slice(0, params[1] || 10);
        }
        if (sql.includes('SELECT * FROM exercises WHERE workout_id')) {
          return exercises.filter(e => e.workout_id === params[0]);
        }
        if (sql.includes('SELECT * FROM ai_messages')) {
          return aiMessages.filter(m => m.user_id === params[0]).slice(0, params[1] || 20);
        }
        return [];
      },
      run: (...params) => {
        if (sql.includes('INSERT INTO users')) {
          const user = {
            telegram_id: params[0],
            username: params[1],
            first_name: params[2],
            last_name: params[3],
            subscription_tier: 'free',
            ai_requests_count: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          users.set(params[0], user);
          return { changes: 1 };
        }
        if (sql.includes('INSERT INTO workouts')) {
          const workout = {
            id: workouts.length + 1,
            user_id: params[0],
            date: params[1],
            duration_minutes: params[2],
            notes: params[3],
            created_at: new Date().toISOString(),
          };
          workouts.push(workout);
          return { changes: 1, lastInsertRowid: workout.id };
        }
        if (sql.includes('INSERT INTO exercises')) {
          const exercise = {
            id: exercises.length + 1,
            workout_id: params[0],
            exercise_name: params[1],
            muscle_group: params[2],
            sets_data: params[3],
            created_at: new Date().toISOString(),
          };
          exercises.push(exercise);
          return { changes: 1 };
        }
        if (sql.includes('INSERT INTO ai_messages')) {
          aiMessages.push({
            id: aiMessages.length + 1,
            user_id: params[0],
            role: params[1],
            content: params[2],
            created_at: new Date().toISOString(),
          });
          return { changes: 1 };
        }
        if (sql.includes('UPDATE users')) {
          const user = users.get(params[1]);
          if (user) {
            user.ai_requests_count = (user.ai_requests_count || 0) + 1;
            return { changes: 1 };
          }
        }
        if (sql.includes('DELETE FROM workouts')) {
          const index = workouts.findIndex(w => w.id === params[0]);
          if (index !== -1) {
            workouts.splice(index, 1);
            exercises = exercises.filter(e => e.workout_id !== params[0]);
            return { changes: 1 };
          }
        }
        return { changes: 0 };
      },
    }),
    transaction: (fn) => {
      // Mock transaction - просто выполняем функцию
      return fn({
        prepare: (sql) => ({
          get: (...params) => {
            if (sql.includes('INSERT INTO workouts') && sql.includes('RETURNING')) {
              const workout = {
                id: workouts.length + 1,
                user_id: params[0],
                date: params[1],
                duration_minutes: params[2],
                notes: params[3],
                created_at: new Date().toISOString(),
              };
              workouts.push(workout);
              return workout;
            }
            return null;
          },
          run: (...params) => {
            if (sql.includes('INSERT INTO exercises')) {
              const exercise = {
                id: exercises.length + 1,
                workout_id: params[0],
                exercise_name: params[1],
                muscle_group: params[2],
                sets_data: params[3],
                created_at: new Date().toISOString(),
              };
              exercises.push(exercise);
              return { changes: 1 };
            }
            return { changes: 0 };
          },
        }),
      });
    },
    pragma: () => {},
    exec: () => {},
    close: () => {},
  };
}

export function initDatabase() {
  console.log('✅ Mock database initialized (no real DB)');
}

export function closeDatabase() {
  console.log('✅ Mock database closed');
}
