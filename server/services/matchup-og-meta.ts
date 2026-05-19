/** Pure OG title/description helpers (no DB). */

export function matchupOgPromptTitle(m: {
  promptText: string | null;
  title: string;
}): string {
  const prompt = m.promptText?.trim();
  return prompt && prompt.length > 0 ? prompt : m.title;
}

export function matchupOgDescription(m: {
  optionAText: string;
  optionBText: string;
}): string {
  return `${m.optionAText} vs ${m.optionBText}`;
}
