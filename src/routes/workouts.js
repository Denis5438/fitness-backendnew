import { Router } from 'express';
import { getDatabase } from '../database/mock-db.js';
import { z } from 'zod';

const router = Router();

// Валидация данных тренировки
const workoutSetSchema = z.object({
  set: z.number(),
  weight: z.number(),
  reps: z.number(),
  rpe: z.number().min(1).max(10).optional(),
});

const exerciseSchema = z.object({
  exercise_name: z.string(),
  muscle_group: z.string().optional(),
  sets: z.array(workoutSetSchema),
});

const createWorkoutSchema = z.object({
  user_id: z.number(),
  date: z.string(), // ISO8601
  duration_minutes: z.number().optional(),
  notes: z.string().optional(),
  exercises: z.array(exerciseSchema).optional().default([]),
});

// GET /api/workouts/:user_id - Получить тренировки пользователя
router.get('/:user_id', (req, res) => {
  try {
    const userId = parseInt(req.params.user_id);
    const limit = parseInt(req.query.limit) || 10;
    const db = getDatabase();
    
    // Получаем тренировки
    const workouts = db.prepare(`
      SELECT * FROM workouts 
      WHERE user_id = ? 
      ORDER BY date DESC 
      LIMIT ?
    `).all(userId, limit);
    
    // Для каждой тренировки получаем упражнения
    const workoutsWithExercises = workouts.map((workout) => {
      const exercises = db.prepare(`
        SELECT * FROM exercises WHERE workout_id = ?
      `).all(workout.id);
      
      // Парсим JSON sets_data
      const exercisesWithSets = exercises.map((ex) => ({
        ...ex,
        sets_data: JSON.parse(ex.sets_data),
      }));
      
      return {
        ...workout,
        exercises: exercisesWithSets,
      };
    });
    
    res.json(workoutsWithExercises);
  } catch (error) {
    console.error('Error fetching workouts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/workouts - Создать тренировку
router.post('/', (req, res) => {
  try {
    const data = createWorkoutSchema.parse(req.body);
    const db = getDatabase();
    
    // Создаём тренировку в транзакции
    const workout = db.transaction((workoutData) => {
      // Создаём тренировку
      const workoutStmt = db.prepare(`
        INSERT INTO workouts (user_id, date, duration_minutes, notes)
        VALUES (?, ?, ?, ?)
        RETURNING *
      `);
      
      const newWorkout = workoutStmt.get(
        workoutData.user_id,
        workoutData.date,
        workoutData.duration_minutes || 0,
        workoutData.notes || ''
      );
      
      // Добавляем упражнения
      if (workoutData.exercises && workoutData.exercises.length > 0) {
        const exerciseStmt = db.prepare(`
          INSERT INTO exercises (workout_id, exercise_name, muscle_group, sets_data)
          VALUES (?, ?, ?, ?)
        `);
        
        for (const exercise of workoutData.exercises) {
          exerciseStmt.run(
            newWorkout.id,
            exercise.exercise_name,
            exercise.muscle_group || '',
            JSON.stringify(exercise.sets)
          );
        }
      }
      
      return newWorkout;
    })(data);
    
    res.status(201).json(workout);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error creating workout:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/workouts/:id - Удалить тренировку
router.delete('/:id', (req, res) => {
  try {
    const workoutId = parseInt(req.params.id);
    const db = getDatabase();
    
    const result = db.prepare('DELETE FROM workouts WHERE id = ?').run(workoutId);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Workout not found' });
    }
    
    res.json({ message: 'Workout deleted successfully' });
  } catch (error) {
    console.error('Error deleting workout:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/workouts/:user_id/stats - Получить статистику
router.get('/:user_id/stats', (req, res) => {
  try {
    const userId = parseInt(req.params.user_id);
    const db = getDatabase();
    
    // Общая статистика
    const totalWorkouts = db.prepare(`
      SELECT COUNT(*) as count FROM workouts WHERE user_id = ?
    `).get(userId);
    
    const avgDuration = db.prepare(`
      SELECT AVG(duration_minutes) as avg FROM workouts 
      WHERE user_id = ? AND duration_minutes IS NOT NULL
    `).get(userId);
    
    // Статистика по группам мышц
    const muscleGroupStats = db.prepare(`
      SELECT 
        muscle_group,
        COUNT(*) as frequency
      FROM exercises e
      JOIN workouts w ON e.workout_id = w.id
      WHERE w.user_id = ? AND e.muscle_group IS NOT NULL
      GROUP BY muscle_group
      ORDER BY frequency DESC
    `).all(userId);
    
    res.json({
      total_workouts: totalWorkouts.count,
      avg_duration: Math.round(avgDuration.avg || 0),
      muscle_groups: muscleGroupStats,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
