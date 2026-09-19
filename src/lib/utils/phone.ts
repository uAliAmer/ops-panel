/** Convert an Iraqi phone number to a wa.me link. Returns '#' for falsy input. */
export function whatsappHref(phone: string | undefined | null): string {
	if (!phone) return '#';
	let p = phone.trim().replace(/\s+/g, '').replace(/\+/g, '');
	if (p.startsWith('0')) p = '964' + p.substring(1);
	else if (!p.startsWith('964')) p = '964' + p;
	return `https://wa.me/${p}`;
}
