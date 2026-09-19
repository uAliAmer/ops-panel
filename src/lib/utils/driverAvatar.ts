/**
 * A stable cartoon avatar for a local driver.
 *
 * Six names in a list read as six identical rows; a face does not. The seed is
 * the driver's name (their id as a fallback), so the same driver is the same
 * creature everywhere they appear — the directory, the pickup sheet, the order
 * they are carrying — which is the whole point of having one at all.
 *
 * Was defined inside DriversSheet; it lives here now because three screens draw
 * it and they must agree, or the same driver becomes three different animals.
 */
export function driverAvatar(name: string | null | undefined, id?: string | null): string {
	const seed = (name || id || 'driver').trim();
	return (
		'https://api.dicebear.com/10.x/critters/svg' +
		'?scale=1.22&translateX=0&tags=animation' +
		'&animationVariant=fast:89,fastest:60,medium:56,none:65,slow:57,slowest:57' +
		`&seed=${encodeURIComponent(seed)}`
	);
}
