/** 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 4 -> "4th" */
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Medal shown next to a player once they have finished. */
export function medal(p: any): string {
  if (p?.left && !p?.finished) return '✕';
  if (!p?.finished) return '';
  if (p.loser) return '😅';
  return ['🥇', '🥈', '🥉'][p.rank - 1] ?? '🏅';
}
