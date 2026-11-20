/**
 * Client-side helper for satisfying a customer-managed REQUIRE_PRESENTATION
 * policy. This represents the originator client, not the beneficiary RoboVASP.
 *
 * The helper encrypts every primitive IVMS-101 leaf as an independent compact
 * JWE using the beneficiary key supplied by tap.requirePresentationRequested,
 * then submits the encrypted presentation to that webhook's callback URL.
 */

export interface P256PublicJwk {
	kty: 'EC';
	crv: 'P-256';
	x: string;
	y: string;
}

export interface RequirePresentationRequestedWebhook {
	message: 'tap.requirePresentationRequested';
	payload: {
		beneficiaryAgentID: string;
		beneficiaryPresentationDefinition: string;
		callbackUrl: string;
		encryptionKey: {
			controller: string;
			id: string;
			publicKeyJwk: P256PublicJwk;
			type: string;
		};
		for: string;
		id: string;
		originatorAgentID: string;
		originatorPresentationDefinition?: string;
		policyId: string;
	};
	version: string;
}

export type Ivms101Value =
	| string
	| number
	| boolean
	| Ivms101Value[]
	| { [key: string]: Ivms101Value };

export interface SubmitEncryptedPiiOptions {
	/** The complete tap.requirePresentationRequested webhook received by the client. */
	webhook: RequirePresentationRequestedWebhook;
	/** Plain IVMS-101 data. Primitive leaf values are encrypted before submission. */
	ivms101: { [key: string]: Ivms101Value };
	/** Bearer token for webhook.payload.originatorAgentID. */
	clientAccessToken: string;
	/** The same regional Notabene API base URL the client uses for txCreate. */
	notabeneApiUrl: string;
	/** Optional fetch implementation for tests or non-standard runtimes. */
	fetcher?: typeof fetch;
}

export interface SubmitEncryptedPiiResult {
	transferId: string;
	policyId: string;
	status: number;
	responseBody: string;
}

interface EncryptionOptions {
	senderDid: string;
	recipientKeyId: string;
}

const encoder = new TextEncoder();

/**
 * Encrypts one IVMS-101 value using RFC 7518 ECDH-ES and AES-256-GCM.
 * Values are JSON-stringified before encryption for Notabene compatibility.
 */
export async function encryptPiiValue(
	value: string | number | boolean,
	recipientPublicKeyJwk: P256PublicJwk,
	options: EncryptionOptions,
): Promise<string> {
	validateP256PublicJwk(recipientPublicKeyJwk);

	const generatedKey = await crypto.subtle.generateKey(
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		['deriveBits'],
	);
	if (!('publicKey' in generatedKey)) {
		throw new Error('P-256 key generation did not return a key pair');
	}
	const ephemeralKeyPair = generatedKey;

	const exportedEphemeralKey = await crypto.subtle.exportKey('jwk', ephemeralKeyPair.publicKey);
	if (exportedEphemeralKey instanceof ArrayBuffer) {
		throw new Error('P-256 public key export did not return a JWK');
	}
	const ephemeralPublicJwk = exportedEphemeralKey;
	if (!ephemeralPublicJwk.x || !ephemeralPublicJwk.y) {
		throw new Error('The generated P-256 public key is missing coordinates');
	}

	const recipientPublicKey = await crypto.subtle.importKey(
		'jwk',
		recipientPublicKeyJwk,
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		[],
	);

	const ecdhParameters: SubtleCryptoDeriveKeyAlgorithm & { public: CryptoKey } = {
		name: 'ECDH',
		public: recipientPublicKey,
	};
	const sharedSecret = new Uint8Array(
		await crypto.subtle.deriveBits(
			ecdhParameters,
			ephemeralKeyPair.privateKey,
			256,
		),
	);

	const apu = new Uint8Array(
		await crypto.subtle.digest('SHA-256', encoder.encode(options.senderDid)),
	);
	const apv = new Uint8Array(
		await crypto.subtle.digest('SHA-256', encoder.encode(options.recipientKeyId)),
	);

	const cekBytes = await deriveContentEncryptionKey(sharedSecret, apu, apv);
	sharedSecret.fill(0);

	try {
		const protectedHeader = {
			alg: 'ECDH-ES',
			enc: 'A256GCM',
			typ: 'JWE',
			epk: {
				kty: 'EC',
				crv: 'P-256',
				x: ephemeralPublicJwk.x,
				y: ephemeralPublicJwk.y,
			},
			apu: base64UrlEncode(apu),
			apv: base64UrlEncode(apv),
			kid: options.recipientKeyId,
		};

		const protectedHeaderSegment = base64UrlEncode(
			encoder.encode(JSON.stringify(protectedHeader)),
		);
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const aesKey = await crypto.subtle.importKey(
			'raw',
			cekBytes,
			{ name: 'AES-GCM' },
			false,
			['encrypt'],
		);
		const plaintext = encoder.encode(JSON.stringify(value));
		const encrypted = new Uint8Array(
			await crypto.subtle.encrypt(
				{
					name: 'AES-GCM',
					iv,
					additionalData: encoder.encode(protectedHeaderSegment),
					tagLength: 128,
				},
				aesKey,
				plaintext,
			),
		);

		const ciphertext = encrypted.subarray(0, encrypted.length - 16);
		const authenticationTag = encrypted.subarray(encrypted.length - 16);

		return [
			protectedHeaderSegment,
			'',
			base64UrlEncode(iv),
			base64UrlEncode(ciphertext),
			base64UrlEncode(authenticationTag),
		].join('.');
	} finally {
		cekBytes.fill(0);
	}
}

/**
 * Encrypts and submits an IVMS-101 presentation for the policy identified by
 * the webhook. No plaintext PII or bearer token is logged or returned.
 */
export async function submitEncryptedPii({
	webhook,
	ivms101,
	clientAccessToken,
	notabeneApiUrl,
	fetcher = fetch,
}: SubmitEncryptedPiiOptions): Promise<SubmitEncryptedPiiResult> {
	validateWebhook(webhook);
	if (!clientAccessToken.trim()) {
		throw new Error('A client access token is required');
	}

	const callbackUrl = resolveCallbackUrl(notabeneApiUrl, webhook.payload.callbackUrl);
	const encryptedIvms101 = await encryptIvms101Value(ivms101, {
		publicKey: webhook.payload.encryptionKey.publicKeyJwk,
		senderDid: webhook.payload.originatorAgentID,
		recipientKeyId: webhook.payload.encryptionKey.id,
	});

	const response = await fetcher(callbackUrl, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${clientAccessToken}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ ivms101: encryptedIvms101 }),
	});
	const responseBody = await response.text();

	if (!response.ok) {
		throw new Error(`Encrypted PII submission failed: ${response.status} ${responseBody}`);
	}

	return {
		transferId: webhook.payload.id,
		policyId: webhook.payload.policyId,
		status: response.status,
		responseBody,
	};
}

async function encryptIvms101Value(
	value: Ivms101Value,
	context: {
		publicKey: P256PublicJwk;
		senderDid: string;
		recipientKeyId: string;
	},
): Promise<Ivms101Value> {
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return encryptPiiValue(value, context.publicKey, {
			senderDid: context.senderDid,
			recipientKeyId: context.recipientKeyId,
		});
	}

	if (Array.isArray(value)) {
		return Promise.all(value.map((item) => encryptIvms101Value(item, context)));
	}

	const encryptedEntries = await Promise.all(
		Object.entries(value).map(async ([key, childValue]) => [
			key,
			await encryptIvms101Value(childValue, context),
		] as const),
	);

	return Object.fromEntries(encryptedEntries);
}

async function deriveContentEncryptionKey(
	sharedSecret: Uint8Array,
	apu: Uint8Array,
	apv: Uint8Array,
): Promise<Uint8Array> {
	const algorithmId = encoder.encode('A256GCM');
	const otherInfo = concatenateBytes(
		lengthPrefixed(algorithmId),
		lengthPrefixed(apu),
		lengthPrefixed(apv),
		uint32(256),
	);
	const digestInput = concatenateBytes(uint32(1), sharedSecret, otherInfo);

	return new Uint8Array(await crypto.subtle.digest('SHA-256', digestInput));
}

function validateWebhook(
	webhook: RequirePresentationRequestedWebhook,
): void {
	if (webhook.message !== 'tap.requirePresentationRequested') {
		throw new Error(`Expected tap.requirePresentationRequested, received ${webhook.message}`);
	}
	if (!webhook.payload.id || !webhook.payload.policyId) {
		throw new Error('The presentation webhook is missing a transfer ID or policy ID');
	}
	if (!webhook.payload.originatorAgentID || !webhook.payload.encryptionKey.id) {
		throw new Error('The presentation webhook is missing sender or recipient key information');
	}
	validateP256PublicJwk(webhook.payload.encryptionKey.publicKeyJwk);
}

function validateP256PublicJwk(jwk: P256PublicJwk): void {
	if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) {
		throw new Error('A valid P-256 public JWK is required');
	}
	if (base64UrlDecode(jwk.x).length !== 32 || base64UrlDecode(jwk.y).length !== 32) {
		throw new Error('P-256 public key coordinates must each be 32 bytes');
	}
}

function resolveCallbackUrl(notabeneApiUrl: string, callbackPath: string): string {
	const apiUrl = new URL(notabeneApiUrl);
	if (apiUrl.protocol !== 'https:' && apiUrl.hostname !== 'localhost') {
		throw new Error('The Notabene API URL must use HTTPS');
	}
	if (!callbackPath.startsWith('/') || !callbackPath.endsWith('/presentation')) {
		throw new Error('The webhook callback URL must be a relative /presentation path');
	}

	const callbackUrl = new URL(callbackPath, apiUrl);
	if (callbackUrl.origin !== apiUrl.origin) {
		throw new Error('The webhook callback URL must use the configured Notabene API origin');
	}

	return callbackUrl.toString();
}

function base64UrlEncode(value: Uint8Array): string {
	let binary = '';
	for (const byte of value) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(value: string): Uint8Array {
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
	const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
	const binary = atob(normalized + padding);

	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function lengthPrefixed(value: Uint8Array): Uint8Array {
	return concatenateBytes(uint32(value.length), value);
}

function uint32(value: number): Uint8Array {
	const bytes = new Uint8Array(4);
	new DataView(bytes.buffer).setUint32(0, value, false);
	return bytes;
}

function concatenateBytes(...values: Uint8Array[]): Uint8Array {
	const output = new Uint8Array(values.reduce((total, value) => total + value.length, 0));
	let offset = 0;

	for (const value of values) {
		output.set(value, offset);
		offset += value.length;
	}

	return output;
}
