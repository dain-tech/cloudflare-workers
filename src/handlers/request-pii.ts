import { getAccessToken } from '../auth';
import type { WebhookPayload } from '../types';
import { handleConfirm } from './confirm';

type PlainTransfer = Record<string, unknown>;

/**
 * Observes the direct plain-PII flow for the unencrypted RoboVASP.
 * Notabene applies the entity's REQUIRE_PRESENTATION policy to the client's
 * original transfer, so this handler must not create a second transfer.
 */
export async function handleBotRequestsPII(
	entity: string,
	payload: WebhookPayload,
	env: Env,
): Promise<void> {
	const transferId = payload.payload.id;

	switch (payload.message) {
		case 'notification.transferCreated':
			console.log(
				JSON.stringify({
					message: 'bot_rfi.transfer_received',
					entity,
					transferId,
				}),
			);
			return;
		case 'tap.requireRelationshipConfirmationRequested':
			return handleConfirm(entity, payload, env);
		case 'tap.requirePresentationSatisfied': {
			console.log(
				JSON.stringify({
					message: 'bot_rfi.presentation_satisfied',
					entity,
					transferId,
				}),
			);

			const token = await getAccessToken(env, entity);
			const { transfer, responseShape } = await fetchPlainTransfer(
				entity,
				transferId,
				token,
				env.NB_API_URL,
			);

			console.log(
				JSON.stringify({
					message: 'bot_rfi.transfer_loaded',
					entity,
					transferId,
					responseShape,
					hasIvms101: transfer.ivms101 !== undefined,
					transferFields: Object.keys(transfer),
				}),
			);

			return;
		}
	}
}

/**
 * Retrieves the beneficiary's unsanitized transfer view. The returned
 * contents can include plaintext PII and must never be logged.
 */
export async function fetchPlainTransfer(
	entity: string,
	transferId: string,
	token: string,
	notabeneApiUrl: string,
	fetcher: typeof fetch = fetch,
): Promise<{ transfer: PlainTransfer; responseShape: 'wrapped' | 'direct' }> {
	const url = new URL(
		`/entities/${encodeURIComponent(entity)}/tx/${encodeURIComponent(transferId)}`,
		notabeneApiUrl,
	);
	url.searchParams.set('sanitize', 'false');

	const response = await fetcher(url, {
		headers: {
			Authorization: `Bearer ${token}`,
		},
	});

	if (!response.ok) {
		const responseBody = await response.text();
		throw new Error(`Plain transfer retrieval failed: ${response.status} ${responseBody}`);
	}

	const result: unknown = await response.json();
	if (!isRecord(result)) {
		throw new Error('Plain transfer response was not a JSON object');
	}

	if (isRecord(result.transfer)) {
		return { transfer: result.transfer, responseShape: 'wrapped' };
	}

	return { transfer: result, responseShape: 'direct' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
