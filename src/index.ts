/**
 * Cloudflare Worker — Webhook Router
 *
 * Listens for incoming POST requests at /webhook/:entity where :entity is a
 * URL-encoded DID (e.g. did:web:entity.com:one → /webhook/did%3Aweb%3Aentity.com%3Aone).
 *
 * Each entity has its own Auth0 M2M client credentials and maps to its own
 * handler function. Auth0 tokens are cached per entity for 24 hours using the
 * Workers Cache API.
 *
 * The webhook payload is acknowledged immediately with a 200 OK and processing
 * is deferred via ctx.waitUntil() to avoid hitting the 15s SVIX timeout.
 */
import { getAccessToken } from './auth';
import { ENTITY_DIDS } from './entities';
import { handleConfirm } from './handlers/confirm';
import { handleBotRequestsPII } from './handlers/request-pii';
import { handleBotRequestsEncryptedPII } from './handlers/request-encrypted-pii';
import { handleRequestPIIFromBot } from './handlers/request-pii-from-bot';

import type { WebhookPayload } from './types';

export default {
	/**
	 * Routes incoming webhook requests, decodes the entity DID from the path,
	 * and defers entity-specific processing so the caller gets a fast ACK.
	 */
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const { pathname } = url;

		if (!pathname.startsWith('/webhook/')) {
			return new Response('Not Found', { status: 404 });
		}

		if (request.method !== 'POST') {
			return new Response('Method Not Allowed', {
				status: 405,
				headers: { Allow: 'POST' },
			});
		}

		const entity = decodeURIComponent(pathname.replace('/webhook/', ''));

		let payload: WebhookPayload;
		try {
			payload = (await request.json()) as WebhookPayload;
		} catch {
			return new Response('Invalid JSON', { status: 400 });
		}

		ctx.waitUntil(handleEvent(entity, payload, env));

		return new Response('OK', { status: 200 });
	},
} satisfies ExportedHandler<Env>;

/**
 * Dispatches a parsed webhook payload to the handler registered for the
 * destination entity DID.
 */
async function handleEvent(entity: string, payload: WebhookPayload, env: Env): Promise<void> {
	switch (entity) {
		case ENTITY_DIDS.accept:
			return handleApprove(entity, payload, env);
		case ENTITY_DIDS.confirm:
			return handleConfirm(entity, payload, env);
		case ENTITY_DIDS.reject:
			return handleReject(entity, payload, env);
		case ENTITY_DIDS.addCustodian:
			return handleAddCustodian(entity, payload, env);
		case ENTITY_DIDS.replace:
			return handleReplace(entity, payload, env);
		case ENTITY_DIDS.settle:
			return handleSettle(entity, payload, env);
		case ENTITY_DIDS.flag:
			return handleFlag(entity, payload, env);
		case ENTITY_DIDS.botRequestPII:
			return handleBotRequestsPII(entity, payload, env);
		case ENTITY_DIDS.requestPIIFromBot:
			return handleRequestPIIFromBot(entity, payload, env);
		case ENTITY_DIDS.botRequestsEncryptedPII:
			return handleBotRequestsEncryptedPII(entity, payload, env);
	}
}

async function handleAddCustodian(entity: string, payload: WebhookPayload, env: Env): Promise<void> {
	switch (payload.message) {
		case 'notification.transferCreated': {
			const entityDID = payload.payload.for;
			const id = payload.payload.id;

			const token = await getAccessToken(env, entity);

			const response = await fetch(`${env.NB_API_URL}/entity/${entityDID}/tx/${id}/agents`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					agent: {
						'@id': 'did:web:notabene.id:test:ck',
						role: 'Custodian',
						for: 'did:web:notabeneid-49944.sandbox.notabene.id:it',
					},
				}),
			});

			if (!response.ok) {
				return;
			}

			break;
		}
	}
}

/**
 * Handles rejects newly created
 * transactions through the Notabene API.
 */
async function handleReject(entity: string, payload: WebhookPayload, env: Env): Promise<void> {
	switch (payload.message) {
		case 'notification.transferCreated': {
			const token = await getAccessToken(env, entity);
			const entityDID = payload.payload.for;
			const id = payload.payload.id;

			console.log("entityDID", entityDID, id, token,)
			await fetch(`${env.NB_API_URL}/entity/${entityDID}/tx/${id}/reject`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					reason: 'BENEFICIARY_NOT_FOUND',
      				comment: 'Rejected',
				}),
			});
			break;
		}
	}
}

/**
 * Handles replace
 * transactions through the Notabene API.
 */
async function handleReplace(entity: string, payload: WebhookPayload, env: Env): Promise<void> {
	console.log(payload.message, payload, "payload message")
	switch (payload.message) {
		case 'tap.requireRelationshipConfirmationRequested': {
			const token = await getAccessToken(env, entity);
			const entityDID = payload.payload.beneficiaryAgentID;

			const id = payload.payload.id;

			console.log("entityDID", entityDID, id,)


			await fetch(`${env.NB_API_URL}/entity/${entityDID}/tx/${id}/agents/replace`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					"original": entityDID,
					"replacement": {
						"@id": "did:web:notabeneid-2999b.sandbox.notabene.id:ar",
						"role": "VASP",
						"for": "did:web:notabene.id:users:christ76"
					},
				}),
			});
			break;
		}
	}
}


/**
 * Handles Settle
 */
async function handleSettle(entity: string, payload: WebhookPayload, env: Env): Promise<void> {
	switch (payload.message) {
		case 'transaction.created': {
			const token = await getAccessToken(env, entity);

			const id = payload.payload.id;
			await fetch(`${env.NB_API_URL}/tx/${id}/settle`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({}),
			});
			break;
		}
	}
}


/**
 * Handles Flag
 */
async function handleFlag(entity: string, payload: WebhookPayload, env: Env): Promise<void> {
	switch (payload.message) {
		case 'transaction.created': {
			const token = await getAccessToken(env, entity);

			const id = payload.payload.id;
			await fetch(`${env.NB_API_URL}/tx/${id}/flag`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({}),
			});
			break;
		}
	}
}


/**
 * Handles AUTHORIZE webhook messages. Transfer-created notifications are
 * authorized automatically after fetching an Auth0 access token.
 */
async function handleApprove(entity: string, payload: WebhookPayload, env: Env): Promise<void> {
	switch (payload.message) {
		case 'notification.transferCreated': {
			try {
				const token = await getAccessToken(env, entity);

				const id = payload.payload.id;
				await fetch(`${env.NB_API_URL}/entity/${entity}/tx/${id}/authorize`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({}),
				});
			} catch {
			}
			break;
		}
	}
}
