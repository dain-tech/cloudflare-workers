import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect, vi } from 'vitest';
import worker from '../src/index';
import { ENTITY_DIDS } from '../src/entities';

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('Webhook worker', () => {
	it('responds with Not Found for non-webhook paths', async () => {
		const request = new IncomingRequest('http://example.com');
		// Create an empty context to pass to `worker.fetch()`.
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
		await waitOnExecutionContext(ctx);
		expect(await response.text()).toMatchInlineSnapshot(`"Not Found"`);
		expect(response.status).toBe(404);
	});

	it('responds with Method Not Allowed for GET webhook requests', async () => {
		const request = new IncomingRequest(
			`http://example.com/webhook/${encodeURIComponent(ENTITY_DIDS.reject)}`,
		);
		const ctx = createExecutionContext();

		const response = await worker.fetch(request, env, ctx);

		expect(response.status).toBe(405);
		expect(response.headers.get('Allow')).toBe('POST');
		expect(await response.text()).toBe('Method Not Allowed');
	});

	it('responds with Bad Request for malformed webhook JSON', async () => {
		const request = new IncomingRequest(
			`http://example.com/webhook/${encodeURIComponent(ENTITY_DIDS.reject)}`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '{',
			},
		);
		const ctx = createExecutionContext();

		const response = await worker.fetch(request, env, ctx);

		expect(response.status).toBe(400);
		expect(await response.text()).toBe('Invalid JSON');
	});

	it('responds with OK for webhook paths', async () => {
		const request = new IncomingRequest('http://example.com/webhook/did%3Aweb%3Anotabene.id%3Abr', {
			method: 'POST',
			body: JSON.stringify({
				message: 'notification.transferCreated',
				payload: {
					for: 'did:web:notabene.id:br',
					id: 'test-id',
				},
				version: '1.0.0',
			}),
		});
		// Create an empty context to pass to `worker.fetch()`.
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
		await waitOnExecutionContext(ctx);
		expect(await response.text()).toMatchInlineSnapshot(`"OK"`);
		expect(response.status).toBe(200);
	});

	it('routes requestPIIFromBot transfer notifications to the bot response handler', async () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
		const request = new IncomingRequest(
			`http://example.com/webhook/${encodeURIComponent(ENTITY_DIDS.requestPIIFromBot)}`,
			{
				method: 'POST',
				body: JSON.stringify({
					message: 'notification.transferCreated',
					payload: {
						for: ENTITY_DIDS.requestPIIFromBot,
						id: 'test-transfer-id',
					},
					version: '1.0.0',
				}),
			},
		);
		const ctx = createExecutionContext();

		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(log).toHaveBeenCalledWith(
			JSON.stringify({
				message: 'bot_pii.transfer_received',
				entity: ENTITY_DIDS.requestPIIFromBot,
				transferId: 'test-transfer-id',
			}),
		);
		log.mockRestore();
	});
});
