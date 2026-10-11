const NUMBER_WORDS: Record<string, number> = {
  one: 1, first: 1, "1": 1, "1st": 1,
  two: 2, second: 2, "2": 2, "2nd": 2,
  three: 3, third: 3, "3": 3, "3rd": 3,
  four: 4, fourth: 4, "4": 4, "4th": 4,
  five: 5, fifth: 5, "5": 5, "5th": 5,
  six: 6, sixth: 6, "6": 6, "6th": 6,
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Map a spoken transcript to an answer option: exact, then a single whole-phrase match (a phrase inside a longer matched option doesn't count), then "option two"/"the first one". */
export function matchSpokenOption(transcript: string, options: string[]): number | null {
  const spoken = normalize(transcript);
  if (!spoken) return null;
  const normalized = options.map(normalize);

  const exact = normalized.indexOf(spoken);
  if (exact !== -1) return exact;

  const padded = ` ${spoken} `;
  const contained = normalized
    .map((option, index) => ({ option, index }))
    .filter(({ option }) => option && padded.includes(` ${option} `));
  const distinct = contained.filter(
    ({ option }) => !contained.some((other) => other.option !== option && ` ${other.option} `.includes(` ${option} `)),
  );
  if (distinct.length === 1) return distinct[0]!.index;
  if (distinct.length > 1) return null;

  const numbers = new Set(spoken.split(" ").map((word) => NUMBER_WORDS[word]).filter((n) => n !== undefined));
  if (numbers.size === 1) {
    const index = [...numbers][0]! - 1;
    if (index < options.length) return index;
  }
  return null;
}

export function spokenQuestion(prompt: string, options: string[]): string {
  return `${prompt} Options: ${options.map((option, i) => `${i + 1}, ${option}`).join(". ")}.`;
}
