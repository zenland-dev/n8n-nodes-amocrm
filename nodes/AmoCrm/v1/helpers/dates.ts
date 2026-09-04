/**
 * amoCRM stores every moment as Unix seconds, while n8n hands date inputs over as
 * ISO strings — and an expression can put anything at all in that box.
 *
 * Unparseable input is returned unchanged rather than dropped. Silently omitting a
 * mistyped date is the worst of the three options: the write succeeds, the field
 * stays empty, and nobody finds out. Passing the text through means amoCRM answers
 * with a validation error naming the exact field, which the transport turns into a
 * message the user can act on.
 */
export function toUnixSeconds(value: unknown): number | string | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	if (typeof value === 'number') return Math.floor(value);

	const text = String(value).trim();
	if (text === '') return undefined;

	// A bare number is already a timestamp.
	if (/^\d+$/.test(text)) return Number(text);

	const parsed = Date.parse(text);

	return Number.isNaN(parsed) ? text : Math.floor(parsed / 1000);
}
