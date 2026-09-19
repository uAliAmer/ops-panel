/**
 * Arabic/Kurdish-tolerant text search for picker lists (regions, cities).
 *
 * Typing Arabic on a phone keyboard is lossy: people type ا for أ/إ/آ, ه for ة,
 * ي for ى, and Kurdish keyboards emit ە/ێ/ۆ where the region list stores ه/ي/و.
 * A raw String.includes() therefore fails on names the customer spelled
 * perfectly reasonably. Everything here folds those variants together before
 * comparing, so "الاعظمية", "الأعظمیة" and "اعظميه" all find "الأعظمية".
 *
 * Codepoints are written as escapes on purpose — several of these characters are
 * invisible or combining, and a literal would be uneditable.
 *
 * NOTE: this is a deliberate copy of the storefront's
 * genelog-storefront/packages/shared/src/arabic-search.ts (itself already copied
 * to genelog-storefront/storefront/src/lib/arabic-search.ts — the consumer
 * storefront is not a workspace member, see the root package.json comment).
 * shipping-system is a separate repo entirely, so it cannot import either.
 * Keep all three in sync.
 */

/** Harakat, superscript alef, tatweel, and Quranic marks — never meaningful here. */
const DIACRITICS = /[ً-ٰٟـۖ-ۭ]/g;
/** Zero-width joiners, the BOM, and the bidi controls RTL keyboards sprinkle in. */
const INVISIBLES = /[​-‏؜‪-‮⁦-⁩﻿]/g;
/** Latin combining marks, left over after NFD. */
const LATIN_MARKS = /[̀-ͯ]/g;

/**
 * Fold a string to its search-comparable form. Both the query and the candidate
 * go through this, so the mappings only need to be consistent, not "correct"
 * spelling-wise.
 */
export function normalizeSearchText(input: string): string {
    if (!input) return "";
    return input
        // Resolves the لا ligatures and other presentation forms to real letters.
        .normalize("NFKC")
        .replace(INVISIBLES, "")
        .replace(DIACRITICS, "")
        // Alef in all its dressings: آ أ إ ا ٱ ٲ ٳ
        .replace(/[آأإاٱٲٳ]/g, "ا")
        // Teh marbuta and the Kurdish/Urdu heh variants: ة ۀ ہ ۂ ۃ ھ ە
        .replace(/[ةۀہۂۃھە]/g, "ه")
        // Alef maqsura, Farsi yeh, hamza-on-yeh, Kurdish e: ى ی ئ ێ ې
        .replace(/[ىیئێې]/g, "ي")
        // Waw with hamza and the Kurdish o/u/v forms: ؤ ۆ ۇ ۈ ۋ ٶ
        .replace(/[ؤۆۇۈۋٶ]/g, "و")
        // Farsi/Kurdish kaf: ک ڪ
        .replace(/[کڪ]/g, "ك")
        // Kurdish heavy lam ڵ and rolled reh ڕ.
        .replace(/ڵ/g, "ل")
        .replace(/ڕ/g, "ر")
        // A standalone hamza carries no information once the carriers are folded.
        .replace(/ء/g, "")
        // Arabic-Indic (٠-٩) and extended Arabic-Indic (۰-۹) digits.
        .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
        .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
        .toLowerCase()
        .normalize("NFD")
        .replace(LATIN_MARKS, "")
        // Collapse the space runs left behind by a stray tatweel or bidi mark.
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Drop the definite article from the front of each word. The list stores
 * "الأعظمية" but people search "اعظمية" and vice-versa; stripping both sides
 * makes the two directions symmetric. The lookahead keeps words that merely
 * start with those letters (e.g. "الي") from being gutted.
 */
function stripArticles(normalized: string): string {
    return normalized.replace(/(^|\s)ال(?=\S\S)/g, "$1");
}

interface Nameable {
    name: string;
    nameAr: string;
}

interface Folded {
    ar: string;
    arBare: string;
    en: string;
}

/**
 * Folding every candidate on every keystroke is wasteful when the list itself
 * hasn't changed, which is the common case while typing.
 */
const foldCache = new WeakMap<object, Folded[]>();

function foldAll(items: readonly Nameable[]): Folded[] {
    const cached = foldCache.get(items as object);
    if (cached) return cached;
    const folded = items.map(item => {
        const ar = normalizeSearchText(item.nameAr);
        return { ar, arBare: stripArticles(ar), en: normalizeSearchText(item.name) };
    });
    foldCache.set(items as object, folded);
    return folded;
}

/**
 * How well `haystack` answers the query, lower is better; -1 means no match.
 * Every whitespace-separated token has to appear, so word order and extra
 * spaces don't matter ("حي الجامعة" finds "الجامعة - حي").
 */
function score(haystack: string, tokens: string[], whole: string): number {
    if (!haystack) return -1;
    for (const token of tokens) {
        if (!haystack.includes(token)) return -1;
    }
    if (haystack === whole) return 0;
    if (haystack.startsWith(whole)) return 1;
    if (haystack.includes(" " + whole)) return 2;
    return 3;
}

/**
 * Filter and rank a region/city list against a user-typed query. An empty query
 * returns the list untouched, preserving the order the API sent.
 */
export function searchByName<T extends Nameable>(items: readonly T[], term: string): T[] {
    const query = normalizeSearchText(term);
    if (!query) return items.slice();

    const bareQuery = stripArticles(query);
    const tokens = query.split(" ").filter(Boolean);
    const bareTokens = bareQuery.split(" ").filter(Boolean);
    const folded = foldAll(items);

    const hits: { item: T; rank: number; length: number }[] = [];
    for (let i = 0; i < items.length; i++) {
        const { ar, arBare, en } = folded[i];
        const ranks = [
            score(ar, tokens, query),
            score(arBare, bareTokens, bareQuery),
            score(en, tokens, query),
        ].filter(r => r >= 0);
        if (ranks.length === 0) continue;
        hits.push({ item: items[i], rank: Math.min(...ranks), length: ar.length || en.length });
    }

    // Shorter names win ties: "الجامعة" should outrank "الجامعة الثانية".
    hits.sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.length - b.length));
    return hits.map(h => h.item);
}
