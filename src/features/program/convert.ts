import { z } from 'zod';
import {
  ConvertFailureSchema,
  ConvertOutcomeSchema,
  ProgramDraftSchema,
  programFromDraft,
} from '../../core/program/draft.ts';
import { type Llm, type LlmReply, LlmReplySchema } from '../../ports/llm.ts';

const SYSTEM = `You convert a gym training program written as free text (any language) into JSON.
Rules:
- days: training days in the given order. Day name as written; if absent, name it after its main exercise.
- exercises: in order. Names short (max 60 chars), in the source language, without sets/reps/weights.
  The same exercise on several days must have one identical name, even if the source words it
  differently ("Squat" and "Barbell squat" -> one name).
- type: barbell = barbell lifts (squat, bench press, deadlift, barbell row, overhead press);
  machine = machines, cables, dumbbells, kettlebells, Smith machine;
  weighted_bodyweight = pull-ups, chin-ups, dips, push-ups, other bodyweight moves where weight can be added;
  reps_only = abs, planks and moves where weight is not tracked;
  light_load = neck, rehab and other very light-weight work.
  A type hint in brackets wins over your guess: (barbell / штанга), (machine / тренажёр),
  (dumbbells / гантели) = machine, (bodyweight / свой вес) = weighted_bodyweight,
  (no weight / без веса) = reps_only, (light load / лёгкий вес) = light_load.
  Hints are not part of the exercise name.
- setsMin/setsMax: working sets only, not warm-up sets. "3x8" -> 3,3; "2-3 sets" -> 2,3; not stated -> 3,3.
- repsMin/repsMax: reps per working set. "8-12" -> 8,12; "x5" -> 5,5. null for reps_only or when not stated.
- note: a short instruction from the source for this exercise (technique, tempo, rest, RPE, %), else null.
- name: the program title from the text, or a short descriptive title in the source language.
- unparsed: source lines with training content you could not map; empty if none. Ignore greetings and theory.`;

const RETRY = 'Your previous answer did not describe any training day with exercises. Try again.';

function llmSchema(): Record<string, unknown> {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value).filter(([k]) => k !== '$schema' && k !== 'readOnly').map((
        [k, v],
      ) => [k, strip(v)]),
    );
  };
  return z.record(z.string(), z.unknown()).parse(strip(z.toJSONSchema(ProgramDraftSchema)));
}

const SCHEMA = llmSchema();

export const ConversionSchema = z.object({
  outcome: ConvertOutcomeSchema,
  replies: z.array(LlmReplySchema).readonly(),
}).readonly();
export type Conversion = z.infer<typeof ConversionSchema>;

const failed = (replies: readonly LlmReply[], unavailable: boolean): Conversion => ({
  outcome: {
    ok: false,
    reason: unavailable
      ? ConvertFailureSchema.enum.unavailable
      : ConvertFailureSchema.enum.not_understood,
  },
  replies,
});

function readDraft(content: string): ReturnType<typeof ProgramDraftSchema.safeParse> | null {
  try {
    return ProgramDraftSchema.safeParse(JSON.parse(content));
  } catch {
    return null;
  }
}

export async function convertProgram(llm: Llm, text: string): Promise<Conversion> {
  const replies: LlmReply[] = [];
  for (const user of [text, `${text}\n\n${RETRY}`]) {
    const reply = await llm({ system: SYSTEM, user, schemaName: 'program_draft', schema: SCHEMA });
    replies.push(reply);
    if (!reply.ok) return failed(replies, reply.reason === 'unavailable');
    const draft = readDraft(reply.content);
    if (!draft?.success) continue;
    const program = programFromDraft(draft.data);
    if (program.ok) {
      return {
        outcome: { ok: true, program: program.value, unparsed: draft.data.unparsed },
        replies,
      };
    }
  }
  return failed(replies, false);
}
