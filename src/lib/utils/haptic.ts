export function haptic(pattern: number | number[] = 15): void {
	try {
		if (typeof navigator !== 'undefined' && navigator.vibrate) {
			navigator.vibrate(pattern);
		}
	} catch {
		/* ignore */
	}
}

export async function copyText(text: string): Promise<boolean> {
	if (!text) return false;
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}
