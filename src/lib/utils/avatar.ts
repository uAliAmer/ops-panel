/**
 * Deterministic avatar for a person, seeded by their name — the same colleague
 * always gets the same face. DiceBear "initials", the same service the driver
 * sheet already uses for its cartoon avatars.
 */
export function avatarFor(name: string | null | undefined): string {
	const seed = (name ?? '').trim() || 'مستخدم';
	return `https://api.dicebear.com/10.x/initials/svg?seed=${encodeURIComponent(seed)}`;
}
