import type { IDataObject, INode, JsonObject } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

interface AmoCrmValidationError {
	code?: string;
	path?: string;
	detail?: string;
}

interface AmoCrmErrorBody {
	title?: string;
	detail?: string;
	status?: number;
	'validation-errors'?: Array<{
		request_id?: string;
		errors?: AmoCrmValidationError[];
	}>;
}

/** Pulls the HTTP status out of whatever shape the failure arrived in. */
export function extractStatusCode(error: unknown): number | undefined {
	const candidates = [
		(error as IDataObject)?.httpCode,
		((error as IDataObject)?.response as IDataObject)?.status,
		(error as IDataObject)?.statusCode,
		(((error as IDataObject)?.cause as IDataObject)?.response as IDataObject)?.status,
		((error as IDataObject)?.cause as IDataObject)?.statusCode,
		((error as IDataObject)?.context as IDataObject)?.statusCode,
	];

	for (const candidate of candidates) {
		const parsed = Number(candidate);
		if (Number.isFinite(parsed) && parsed >= 100 && parsed < 600) return parsed;
	}

	return undefined;
}

/** Pulls the response body out of whatever shape the failure arrived in. */
export function extractResponseBody(error: unknown): AmoCrmErrorBody | undefined {
	const candidates = [
		((error as IDataObject)?.response as IDataObject)?.data,
		((error as IDataObject)?.response as IDataObject)?.body,
		(((error as IDataObject)?.cause as IDataObject)?.response as IDataObject)?.data,
		((error as IDataObject)?.cause as IDataObject)?.error,
		(error as IDataObject)?.error,
	];

	for (const candidate of candidates) {
		if (candidate !== null && typeof candidate === 'object') return candidate as AmoCrmErrorBody;
	}

	return undefined;
}

/** Reads `Retry-After` (seconds) if the API bothered to send one. */
export function extractRetryAfterMs(error: unknown): number | undefined {
	const headers =
		(((error as IDataObject)?.response as IDataObject)?.headers as IDataObject) ??
		((((error as IDataObject)?.cause as IDataObject)?.response as IDataObject)
			?.headers as IDataObject);

	const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
	const seconds = Number(raw);

	return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

function describeValidationErrors(body: AmoCrmErrorBody): string {
	const lines: string[] = [];

	for (const group of body['validation-errors'] ?? []) {
		for (const item of group.errors ?? []) {
			const where = item.path ?? 'request';
			const what = item.detail ?? item.code ?? 'rejected';
			const which =
				group.request_id === undefined ? '' : ` (item #${Number(group.request_id) + 1})`;
			lines.push(`${where}: ${what}${which}`);
		}
	}

	return lines.join('\n');
}

/**
 * Turns an amoCRM failure into a NodeApiError a user can act on.
 *
 * The API's own messages are terse ("Request validation failed") and its 403 means
 * three unrelated things, so the mapping below spells out the likely causes rather
 * than passing the status straight through.
 */
export function toAmoCrmApiError(node: INode, error: unknown, status?: number): NodeApiError {
	if (error instanceof NodeApiError && status === undefined) return error;

	const httpCode = status ?? extractStatusCode(error);
	const body = extractResponseBody(error) ?? {};

	let message = body.title ?? 'amoCRM request failed';
	let description = body.detail ?? '';

	switch (httpCode) {
		case 400: {
			message = 'amoCRM rejected the request';
			const details = describeValidationErrors(body);
			description =
				details === ''
					? (body.detail ?? 'The request body did not pass validation.')
					: `${body.detail ?? 'Request validation failed'}\n${details}`;
			break;
		}
		case 401:
			message = 'amoCRM rejected the credentials';
			description =
				'The access token is invalid, expired or revoked. For a long-lived token, generate a new one on the integration card; for OAuth2, reconnect the credential.';
			break;
		case 402:
			message = 'The amoCRM account subscription has ended';
			description =
				'amoCRM blocks writes as soon as a subscription lapses, and reads 30 days later. This is a billing state, not a credentials problem.';
			break;
		case 403:
			message = 'amoCRM refused the request';
			description =
				'403 covers three unrelated causes: the authorising user lacks rights for this entity, the account restricts API access by IP, or the account or IP is blocked for exceeding the rate limit. Retrying makes a rate-limit block worse, so this request was not retried.';
			break;
		case 404:
			message = 'amoCRM found nothing at that address';
			description =
				description === ''
					? 'The entity id may be wrong, or the feature may not be enabled for this account.'
					: description;
			break;
		case 429:
			message = 'amoCRM rate limit exceeded';
			description =
				'The account went over its requests-per-second budget and the retries did not clear it. Lower "Requests per Second" on the credential, or reduce how many workflows call this account at once.';
			break;
		default:
			if (httpCode !== undefined && httpCode >= 500) {
				message = 'amoCRM returned a server error';
				description =
					httpCode === 504
						? 'A gateway timeout on a write is ambiguous — some entities in the batch may have been saved. Reduce the batch size and check the account before retrying.'
						: (description ?? '');
			}
	}

	return new NodeApiError(node, error as JsonObject, {
		message,
		description: description === '' ? undefined : description,
		httpCode: httpCode === undefined ? undefined : String(httpCode),
	});
}
