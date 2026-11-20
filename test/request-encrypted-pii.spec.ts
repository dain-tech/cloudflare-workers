import { describe, expect, it, vi } from 'vitest';
import { fetchDecryptedTransfer } from '../src/handlers/request-encrypted-pii';

describe('fetchDecryptedTransfer', () => {
	it('requests an unsanitized, decrypted beneficiary transfer and unwraps it', async () => {
		const fetcher = vi.fn<typeof fetch>(async () =>
			Response.json({
				transfer: {
					'@id': 'transfer-id',
					ivms101: { originator: {} },
				},
			}),
		);

		const result = await fetchDecryptedTransfer(
			'did:web:beneficiary.example:kr',
			'transfer-id',
			'bot-token',
			'https://api.eu1.notabene.id',
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
			'https://api.eu1.notabene.id/entities/did%3Aweb%3Abeneficiary.example%3Akr/tx/transfer-id?decrypt=true&sanitize=false',
		);
		expect(requestInit?.headers).toMatchObject({
			Authorization: 'Bearer bot-token',
		});
	});
});
