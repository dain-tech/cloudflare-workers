import { describe, expect, it } from 'vitest';
import { encryptPiiValue, type P256PublicJwk } from '../src/client/submit-encrypted-pii';
import {
	decryptIvms101,
	decryptPiiValue,
	parseP256PrivateJwk,
	type P256PrivateJwk,
} from '../src/crypto/decrypt-pii';

const recipientKeyId = 'did:web:notabeneid-cef76.sandbox.notabene.id:kr#pii';

describe('customer-managed encrypted PII', () => {
	it('decrypts a nested IVMS-101 payload with the PF private key', async () => {
		const { publicJwk, privateJwk } = await generateRecipientJwks();
		const senderDid = 'did:web:tester-one.example:us';
		const encryptionOptions = { senderDid, recipientKeyId };
		const encryptedIvms101 = {
			PayloadMetadata: {
				payloadVersion: 'IVMS101.2023',
			},
			originator: {
				originatorPerson: [
					{
						naturalPerson: {
							name: await encryptPiiValue('Alice Tester', publicJwk, encryptionOptions),
							customerIdentification: await encryptPiiValue(
								'tester-one-customer',
								publicJwk,
								encryptionOptions,
							),
						},
						accountNumber: [
							await encryptPiiValue('bc1qtesterone', publicJwk, encryptionOptions),
						],
					},
				],
			},
		};

		const result = await decryptIvms101(encryptedIvms101, privateJwk, {
			expectedSenderDid: senderDid,
			expectedRecipientKeyId: recipientKeyId,
		});

		expect(result.decryptedValueCount).toBe(3);
		expect(result.ivms101).toEqual({
			PayloadMetadata: {
				payloadVersion: 'IVMS101.2023',
			},
			originator: {
				originatorPerson: [
					{
						naturalPerson: {
							name: 'Alice Tester',
							customerIdentification: 'tester-one-customer',
						},
						accountNumber: ['bc1qtesterone'],
					},
				],
			},
		});
	});

	it('uses the same PF private key for different testers and validates each sender', async () => {
		const { publicJwk, privateJwk } = await generateRecipientJwks();
		const testerOneDid = 'did:web:tester-one.example:us';
		const testerTwoDid = 'did:web:tester-two.example:sg';
		const [testerOneJwe, testerTwoJwe] = await Promise.all([
			encryptPiiValue('Tester One', publicJwk, {
				senderDid: testerOneDid,
				recipientKeyId,
			}),
			encryptPiiValue('Tester Two', publicJwk, {
				senderDid: testerTwoDid,
				recipientKeyId,
			}),
		]);

		await expect(
			decryptPiiValue(testerOneJwe, privateJwk, {
				expectedSenderDid: testerOneDid,
				expectedRecipientKeyId: recipientKeyId,
			}),
		).resolves.toBe('Tester One');
		await expect(
			decryptPiiValue(testerTwoJwe, privateJwk, {
				expectedSenderDid: testerTwoDid,
				expectedRecipientKeyId: recipientKeyId,
			}),
		).resolves.toBe('Tester Two');
		await expect(
			decryptPiiValue(testerOneJwe, privateJwk, {
				expectedSenderDid: testerTwoDid,
				expectedRecipientKeyId: recipientKeyId,
			}),
		).rejects.toThrow('JWE apu does not match the expected sender DID');
	});
});

async function generateRecipientJwks(): Promise<{
	publicJwk: P256PublicJwk;
	privateJwk: P256PrivateJwk;
}> {
	const generatedKey = await crypto.subtle.generateKey(
		{ name: 'ECDH', namedCurve: 'P-256' },
		true,
		['deriveBits'],
	);
	if (!('publicKey' in generatedKey)) {
		throw new Error('Expected an ECDH key pair');
	}

	const [exportedPublicKey, exportedPrivateKey] = await Promise.all([
		crypto.subtle.exportKey('jwk', generatedKey.publicKey),
		crypto.subtle.exportKey('jwk', generatedKey.privateKey),
	]);
	if (
		exportedPublicKey instanceof ArrayBuffer ||
		!exportedPublicKey.x ||
		!exportedPublicKey.y ||
		exportedPrivateKey instanceof ArrayBuffer
	) {
		throw new Error('Expected exported P-256 JWKs');
	}

	return {
		publicJwk: {
			kty: 'EC',
			crv: 'P-256',
			x: exportedPublicKey.x,
			y: exportedPublicKey.y,
		},
		privateJwk: parseP256PrivateJwk(JSON.stringify(exportedPrivateKey)),
	};
}
