/**
 * Warehouse identity for the ops panel.
 *
 * Each branch gets ONE colour and ONE label everywhere it appears — the stock
 * chips on a line item and the shipping suggestion above them. An operator
 * scanning an order should recognise a warehouse by its colour before reading
 * the word.
 *
 * Keys are the ERP's own branch names, exactly as `erp_stock_branches` reports
 * them. A branch the ERP adds later falls through to a neutral style rather than
 * disappearing.
 */

type BranchStyle = {
	/** What the operator reads. The ERP's shorthand is not always a full name. */
	label: string;
	/** Border + background + text, tuned for light and dark. */
	chip: string;
	/** Solid pill for the suggestion line, where it must carry the sentence. */
	pill: string;
	/** Display rank, low first. Branches nobody ships from sort to the end. */
	order: number;
};

const BRANCHES: Record<string, BranchStyle> = {
	// بابلون ships first by preference, so it leads the suggestion and the chips.
	'بابلون': {
		label: 'مستودع بابلون',
		chip: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
		pill: 'bg-sky-600 text-white dark:bg-sky-500',
		order: 0
	},
	'مستودع رئيسي': {
		label: 'المستودع الرئيسي',
		chip: 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300',
		pill: 'bg-violet-600 text-white dark:bg-violet-500',
		order: 1
	},
	// Holding site, never a dispatch point — so it reads last on every line.
	'كمب ساره': {
		label: 'كمب ساره',
		chip: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
		pill: 'bg-amber-600 text-white dark:bg-amber-500',
		order: 9
	}
};

const FALLBACK: BranchStyle = {
	label: '',
	chip: 'border-muted-foreground/30 text-muted-foreground',
	pill: 'bg-muted-foreground text-background',
	order: 5
};

export function branchStyle(name: string): BranchStyle {
	const known = BRANCHES[name?.trim()];
	return known ?? { ...FALLBACK, label: name };
}

export const branchLabel = (name: string) => branchStyle(name).label;

/**
 * Sort anything carrying a branch name into display order. Stable, so branches of
 * equal rank keep the order the ERP reported them in.
 */
export function sortByBranch<T>(rows: T[], name: (row: T) => string): T[] {
	return [...(rows ?? [])].sort((a, b) => branchStyle(name(a)).order - branchStyle(name(b)).order);
}
