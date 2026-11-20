import { ENTITY_DIDS } from './entities';

/**
 * Returns an Auth0 access token for the entity, reusing the Workers Cache API
 * entry until Auth0's reported expiration time passes.
 */
export async function getAccessToken(env: Env, entity: string): Promise<string> {
	const cache = caches.default;
	const cacheKey = new Request(`https://cache.internal/access-token/${entity}`);

	const cached = await cache.match(cacheKey);
	if (cached) {
		return cached.text();
	}

	const { clientId, clientSecret } = getCredentials(env, entity);

	const response = await fetch(`${env.AUTH0_ISSUER}/oauth/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			grant_type: 'client_credentials',
			client_id: clientId,
			audience: env.AUTH0_AUDIENCE,
			client_secret: clientSecret,
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Failed to get access token: ${response.status} ${errorText}`);
	}

	const data = (await response.json()) as { access_token: string; expires_in: number };
	const token = data.access_token;

	const cacheResponse = new Response(token);
	cacheResponse.headers.set('Cache-Control', `max-age=${data.expires_in}`);
	await cache.put(cacheKey, cacheResponse);

	return token;
}

/**
 * Selects the Auth0 M2M client credentials that should be used for an entity.
 * Entity-specific credentials override the default webhook credentials.
 */
function getCredentials(env: Env, entity: string): { clientId: string; clientSecret: string } {
	switch (entity) {
		case ENTITY_DIDS.br:
			return {
				clientId: env.BR_CLIENT_ID,
				clientSecret: env.BR_CLIENT_SECRET,
			};
		case ENTITY_DIDS.accept:
			return {
				clientId: env.ACCEPT_CLIENT_ID,
				clientSecret: env.ACCEPT_CLIENT_SECRET,
			};
		case ENTITY_DIDS.reject:
			return {
				clientId: env.REJECT_CLIENT_ID,
				clientSecret: env.REJECT_CLIENT_SECRET,
			};
		case ENTITY_DIDS.replace:
			return {
				clientId: env.REPLACE_CLIENT_ID,
				clientSecret: env.REPLACE_CLIENT_SECRET,
			};
		case ENTITY_DIDS.confirm:
			return {
				clientId: env.CONFIRM_CLIENT_ID,
				clientSecret: env.CONFIRM_CLIENT_SECRET,
			};
		case ENTITY_DIDS.addCustodian:
			return {
				clientId: env.ADD_CLIENT_ID,
				clientSecret: env.ADD_CLIENT_SECRET,
			};
		case ENTITY_DIDS.botRequestPII:
			return {
				clientId: env.BOT_REQUESTS_PII_CLIENT_ID,
				clientSecret: env.BOT_REQUESTS_PII_CLIENT_SECRET,
			};
		case ENTITY_DIDS.botRequestsEncryptedPII:
			return {
				clientId: env.BOT_REQUESTS_ENCRYPTED_PII_CLIENT_ID,
				clientSecret: env.BOT_REQUESTS_ENCRYPTED_PII_CLIENT_SECRET,
			};
		case ENTITY_DIDS.requestPIIFromBot:
			return {
				clientId: env.REQUEST_BOT_PII_CLIENT_ID,
				clientSecret: env.REQUEST_BOT_PII_CLIENT_SECRET,
			};
		default:
			return {
				clientId: env.AUTH0_CLIENT_ID,
				clientSecret: env.AUTH0_CLIENT_SECRET,
			};
	}
}
