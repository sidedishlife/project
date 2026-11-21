// 수동 확인: ANTHROPIC_API_KEY=... deno run -A scripts/try-ai.ts
import { gradeAnswer } from '../supabase/functions/api/ai.ts';

const r = await gradeAnswer(
  'P&ID와 PFD의 차이를 설명하세요',
  'PFD는 공정 흐름을 큰 그림으로, P&ID는 배관·계측·밸브 등 상세를 보여준다.',
  'PFD는 큰 흐름이고 P&ID는 더 자세한 배관 도면이에요',
  { model: Deno.env.get('AI_MODEL') ?? 'claude-haiku-5-5' },
);
console.log(r);
