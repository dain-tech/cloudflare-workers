import { getAccessToken } from '../auth';
import type { WebhookPayload } from '../types';

export async function handleConfirm(
	entity: string,
	payload: WebhookPayload,
	env: Env,
): Promise<void> {
	switch (payload.message) {
		case 'tap.requireRelationshipConfirmationRequested': {
			const confirmCallbackUrl = payload.payload.confirmCallbackUrl;
			const entityDID = payload.payload.beneficiaryAgentID;
			const payloadFrom = payload.payload.from;

			if (!confirmCallbackUrl) {
				return;
			}

			const token = await getAccessToken(env, entity);

			const response = await fetch(`${env.NB_API_URL}/entity/${entityDID}/relationship?from=${payloadFrom}&to=${entityDID}`, {
				method: 'PATCH',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					from: payloadFrom,
					to: entityDID,
				}),
			});

			if (!response.ok) {
				return;
			}

			break;
		}
	}
}
