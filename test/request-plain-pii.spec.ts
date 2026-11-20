import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccessToken } from '../src/auth';
import { fetchPlainTransfer, handleBotRequestsPII } from '../src/handlers/request-pii';
import type { WebhookPayload } from '../src/types';

vi.mock('../src/auth', () => ({
	getAccessToken: vi.fn(),
}));

const BOT_DID = 'did:web:notabeneid-a417f.sandbox.notabene.id:be';
const NOTABENE_API_URL = 'https://api.eu1.notabene.id';

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(getAccessToken).mockResolvedValue('bot-token');
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('fetchPlainTransfer', () => {
	it('requests an unsanitized beneficiary transfer without decrypting it', async () => {
		const fetcher = vi.fn<typeof fetch>(async () =>
			Response.json({
				transfer: {
					'@id': 'transfer-id',
					ivms101: { originator: {} },
				},
			}),
		);

		const result = await fetchPlainTransfer(
			BOT_DID,
			'transfer-id',
			'bot-token',
			NOTABENE_API_URL,
			fetcher,
		);

		expect(result.responseShape).toBe('wrapped');
		expect(result.transfer).toMatchObject({
			'@id': 'transfer-id',
			ivms101: { originator: {} },
		});
		expect(fetcher).toHaveBeenCalledOnce();

		const [requestUrl, requestInit] = fetcher.mock.calls[0];
		expect(String(requestUrl)).toBe(
			'https://api.eu1.notabene.id/entities/did%3Aweb%3Anotabeneid-a417f.sandbox.notabene.id%3Abe/tx/transfer-id?sanitize=false',
		);
		expect(requestInit?.headers).toMatchObject({
			Authorization: 'Bearer bot-token',
		});
	});
});

describe('handleBotRequestsPII', () => {
	it('loads the plain transfer after the presentation is satisfied', async () => {
		const fetcher = vi.fn<typeof fetch>(async () =>
			Response.json({ transfer: { '@id': 'transfer-id', ivms101: {} } }),
		);
		const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
		vi.stubGlobal('fetch', fetcher);

		const payload: WebhookPayload = {
			message: 'tap.requirePresentationSatisfied',
			payload: {
				for: BOT_DID,
				id: 'transfer-id',
				from: 'did:web:requester.example:test',
				to: BOT_DID,
				settlementId: 'settlement-id',
			},
			version: '1.0.0',
		};

		await handleBotRequestsPII(BOT_DID, payload, { NB_API_URL: NOTABENE_API_URL } as Env);

		expect(getAccessToken).toHaveBeenCalledWith(expect.anything(), BOT_DID);
		expect(fetcher).toHaveBeenCalledOnce();
		expect(String(fetcher.mock.calls[0][0])).not.toContain('decrypt=true');
		expect(log).toHaveBeenCalledWith(
			JSON.stringify({
				message: 'bot_rfi.transfer_loaded',
				entity: BOT_DID,
				transferId: 'transfer-id',
				responseShape: 'wrapped',
				hasIvms101: true,
				transferFields: ['@id', 'ivms101'],
			}),
		);
	});
});
