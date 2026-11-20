// Secrets set via the Cloudflare dashboard or `wrangler secret put`.
// Not declared in wrangler.jsonc to prevent deployments from overwriting them.
interface Env {
	AUTH0_CLIENT_SECRET: string;
	ACCEPT_CLIENT_SECRET: string;
	ADD_CLIENT_SECRET: string;
	BR_CLIENT_SECRET: string;
	CONFIRM_CLIENT_SECRET: string;
	BOT_REQUESTS_PII_CLIENT_SECRET: string;
	BOT_REQUESTS_ENCRYPTED_PII_CLIENT_SECRET: string;
	PF_BOT_PRIVATE_JWK: string;
	REQUEST_BOT_PII_CLIENT_SECRET: string;
	REJECT_CLIENT_SECRET: string;
	REPLACE_CLIENT_SECRET: string;
}
