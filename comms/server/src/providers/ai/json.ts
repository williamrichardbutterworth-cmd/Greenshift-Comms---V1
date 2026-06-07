// Models sometimes wrap JSON in ```json fences or add a stray sentence.
// This extracts and parses the JSON defensively.
export function extractJSON<T>(text: string): T {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // Fall back to the first {...} or [...] block if needed.
  if (!(t.startsWith('{') || t.startsWith('['))) {
    const obj = t.indexOf('{');
    const arr = t.indexOf('[');
    const start = [obj, arr].filter((i) => i >= 0).sort((a, b) => a - b)[0];
    if (start != null && start >= 0) t = t.slice(start);
  }
  try {
    return JSON.parse(t) as T;
  } catch {
    throw new Error('AI did not return valid JSON. Raw output:\n' + text.slice(0, 800));
  }
}
