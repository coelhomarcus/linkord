/** A person's initials: the first and last word's first letters. */
export function personInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const a = parts[0][0] || '';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase();
}

/** A server's or a group's initials: the first two words' first letters. */
export function titleInitials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'L';
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join('');
}
