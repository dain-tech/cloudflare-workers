import { describe, expect, it, vi } from 'vitest';
import {
	submitEncryptedPii,
	type RequirePresentationRequestedWebhook,
} from '../src/client/submit-encrypted-pii';

describe('submitEncryptedPii', () => {
	it('encrypts IVMS-101 leaves and posts them to the webhook callback', async () => {
		const recipientKeyPair = await crypto.subtle.generateKey(
			{ name: 'ECDH', namedCurve: 'P-256' },
			true,
			['deriveBits'],
		);
		if (!('publicKey' in recipientKeyPair)) {
			throw new Error('Expected an ECDH key pair');
		}

		const exportedPublicKey = await crypto.subtle.exportKey('jwk', recipientKeyPair.publicKey);
		if (exportedPublicKey instanceof ArrayBuffer || !exportedPublicKey.x || !exportedPublicKey.y) {
			throw new Error('Expected a public JWK with P-256 coordinates');
		}

		const webhook: RequirePresentationRequestedWebhook = {
			message: 'tap.requirePresentationRequested',
			payload: {
				beneficiaryAgentID: 'did:web:beneficiary.example:kr',
				beneficiaryPresentationDefinition: 'https://pd.notabene.id/ivms101/v2/FA-1000.json',
				callbackUrl: '/entities/did:web:client.example:us/transfers/transfer-id/policies/policy-id/presentation',
				encryptionKey: {
					controller: 'did:web:beneficiary.example:kr',
					id: 'did:web:beneficiary.example:kr#notabene-pii',
					publicKeyJwk: {
						kty: 'EC',
						crv: 'P-256',
						x: exportedPublicKey.x,
						y: exportedPublicKey.y,
					},
					type: 'JsonWebKey2020',
				},
				for: 'did:web:client.example:us',
				id: 'transfer-id',
				originatorAgentID: 'did:web:client.example:us',
				policyId: 'policy-id',
			},
			version: '1.0.0',
		};

		const fetcher = vi.fn<typeof fetch>(async () =>
			new Response(JSON.stringify({ message: 'Presentation accepted and processing' }), {
				status: 202,
			}),
		);

		const result = await submitEncryptedPii({
			webhook,
			ivms101: {
				originator: {
					originatorPersons: [
						{
							naturalPerson: {
								customerIdentification: 'client-customer-001',
							},
						},
					],
				},
			},
			clientAccessToken: 'client-token',
			notabeneApiUrl: 'https://api.eu1.notabene.id',
			fetcher,
		});

		expect(result.status).toBe(202);
		expect(fetcher).toHaveBeenCalledOnce();

		const [requestUrl, requestInit] = fetcher.mock.calls[0];
		expect(requestUrl).toBe(
			'https://api.eu1.notabene.id/entities/did:web:client.example:us/transfers/transfer-id/policies/policy-id/presentation',
		);
		expect(requestInit?.method).toBe('POST');
		expect(requestInit?.headers).toMatchObject({
			Authorization: 'Bearer client-token',
			'Content-Type': 'application/json',
		});

		const requestBody = JSON.parse(String(requestInit?.body));
		const encryptedCustomerId =
			requestBody.ivms101.originator.originatorPersons[0].naturalPerson.customerIdentification;
		const jweSegments = encryptedCustomerId.split('.');
		expect(jweSegments).toHaveLength(5);
		expect(jweSegments[1]).toBe('');
		expect(encryptedCustomerId).not.toContain('client-customer-001');
	});
});
