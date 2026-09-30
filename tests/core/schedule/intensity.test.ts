import { assertEquals } from '@std/assert';
import { IsoWeekSchema } from '../../../src/core/schedule/calendar.ts';
import {
  activeNotes,
  type IntensityLog,
  pairIntensity,
  weekIntensities,
} from '../../../src/core/schedule/intensity.ts';
import { specProgram } from '../../support/spec.ts';

const program = await specProgram();
const pair = program.intensityPairs[0];
if (!pair) throw new Error('в программе нет пары 100/70');
const w = (s: string): ReturnType<typeof IsoWeekSchema.parse> => IsoWeekSchema.parse(s);
const log = (exerciseId: string, week: string, intensity: 'high' | 'low'): IntensityLog => ({
  exerciseId,
  isoWeek: w(week),
  intensity,
});
const now = w('2026-W40');

Deno.test('правило 1: присед уже на 100% на этой неделе → становая на 70%', () => {
  assertEquals(pairIntensity(pair, [log('front_squat', '2026-W40', 'high')], now), {
    kind: 'known',
    byExercise: { front_squat: 'high', deadlift: 'low' },
    source: 'this_week',
  });
});

Deno.test('правило 2: прошлая неделя — кто был на 100%, теперь на 70%', () => {
  const logs = [log('front_squat', '2026-W39', 'high'), log('deadlift', '2026-W39', 'low')];
  assertEquals(pairIntensity(pair, logs, now), {
    kind: 'known',
    byExercise: { front_squat: 'low', deadlift: 'high' },
    source: 'previous_week',
  });
});

Deno.test('правило 2: в прошлую неделю было только одно из пары', () => {
  const r = pairIntensity(pair, [log('deadlift', '2026-W39', 'low')], now);
  assertEquals(r.kind === 'known' && r.byExercise, { front_squat: 'low', deadlift: 'high' });
});

Deno.test('пропущенная неделя не сбивает чередование', () => {
  const logs = [log('front_squat', '2026-W37', 'high'), log('deadlift', '2026-W37', 'low')];
  const r = pairIntensity(pair, logs, now);
  assertEquals(r.kind === 'known' && r.byExercise, { front_squat: 'low', deadlift: 'high' });
});

Deno.test('ручное переключение в лог перекрывает правило: последняя запись недели', () => {
  const logs = [log('front_squat', '2026-W40', 'high'), log('front_squat', '2026-W40', 'low')];
  const r = pairIntensity(pair, logs, now);
  assertEquals(r.kind === 'known' && r.byExercise, { front_squat: 'low', deadlift: 'high' });
});

Deno.test('правило 3: истории нет → бот спрашивает; будущие и чужие записи не считаются', () => {
  assertEquals(pairIntensity(pair, [], now), { kind: 'unknown' });
  assertEquals(
    pairIntensity(
      pair,
      [log('bb_row', '2026-W39', 'high'), log('deadlift', '2026-W41', 'high')],
      now,
    ),
    {
      kind: 'unknown',
    },
  );
});

Deno.test('правило 7: заметка к тяге — только когда становая на этой неделе 100%', () => {
  const heavyDeadlift = weekIntensities(program, [log('front_squat', '2026-W39', 'high')], now);
  assertEquals(heavyDeadlift, { front_squat: 'low', deadlift: 'high' });
  assertEquals(activeNotes(program, 'bb_row', heavyDeadlift).length, 1);
  assertEquals(activeNotes(program, 'bb_row', { front_squat: 'high', deadlift: 'low' }), []);
  assertEquals(activeNotes(program, 'bb_row', {}), [], 'интенсивность неизвестна — заметки нет');
});
