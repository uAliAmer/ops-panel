import { cn } from '$lib/utils';

type FloatLabelOptions = {
	/** Label has moved up to sit on the border: the field is focused or filled. */
	floated: boolean;
	focused?: boolean;
	invalid?: boolean;
	/** Multi-line fields park the resting label near the top, not the middle. */
	multiline?: boolean;
	/**
	 * Background the floated label paints behind itself to break the border line.
	 * Must match whatever the field sits on, or the chip shows as a seam.
	 */
	bg?: string;
};

/**
 * Classes for a label that rests inside its field and rises onto the top border
 * once the field is focused or holds a value. Driven by props rather than
 * `peer-*` variants: two peer states would fight over which wins, and the order
 * Tailwind emits them in is not something to bet a form on.
 */
export function floatLabelClass(o: FloatLabelOptions): string {
	return cn(
		// Always on the start (right) edge, even over an LTR phone field: the
		// placeholder it would collide with only appears once focus has already
		// floated the label out of the way, and a lone left-aligned label breaks
		// the column every other label in the form lines up on.
		'pointer-events-none absolute start-3 z-10 max-w-[calc(100%-1.5rem)] truncate transition-all duration-150',
		o.floated
			? cn('top-0 -translate-y-1/2 rounded px-1 text-xs font-semibold leading-none', o.bg ?? 'bg-card')
			: o.multiline
				? 'top-3 text-base'
				: 'top-1/2 -translate-y-1/2 text-base',
		o.invalid ? 'text-red-600' : o.focused ? 'text-primary' : 'text-muted-foreground'
	);
}
