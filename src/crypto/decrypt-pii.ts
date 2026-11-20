export interface P256PrivateJwk {
	kty: 'EC';
	crv: 'P-256';
	x: string;
	y: string;
	d: string;
}

export interface PiiDecryptionOptions {
	expectedSenderDid: string;
	expectedRecipientKeyId: string;
}

export interface DecryptedIvms101 {
	ivms101: unknown;
	decryptedValueCount: number;
}

type PiiPrimitive = string | number | boolean | null;

interface P256PublicJwk {
	kty: 'EC';
	crv: 'P-256';
	x: string;
	y: string;
}

interface ParsedJwe {
	protectedHeaderSegment: string;
	header: {
		epk: P256PublicJwk;
		apu: Uint8Array;
		apv: Uint8Array;
		kid: string;
	};
	iv: Uint8Array;
	ciphertext: Uint8Array;
	authenticationTag: Uint8Array;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

/**
 * Parses the one-line JSON value stored in PF_BOT_PRIVATE_JWK.
 * The returned object contains only the P-256 fields needed for ECDH.
 */
export function parseP256PrivateJwk(secretValue: string): P256PrivateJwk {
	let parsed: unknown;

	try {
		parsed = JSON.parse(secretValue);
	} catch {
		throw new Error('PF_BOT_PRIVATE_JWK must be valid JSON');
	}

	if (!isRecord(parsed)) {
		throw new Error('PF_BOT_PRIVATE_JWK must contain a JSON object');
	}

	const privateJwk = validateP256PrivateJwk(parsed);
	return privateJwk;
}

/** Decrypts one compact ECDH-ES/A256GCM JWE primitive. */
export async function decryptPiiValue(
	compactJwe: string,
	privateJwk: P256PrivateJwk,
	options: PiiDecryptionOptions,
): Promise<PiiPrimitive> {
	const privateKey = await importPrivateKey(validateP256PrivateJwk(privateJwk));
	return decryptPiiValueWithKey(compactJwe, privateKey, options);
}

/**
 * Recursively decrypts compact JWE strings inside an IVMS-101 object.
 * Non-JWE metadata is preserved so PayloadMetadata can remain in clear text.
 */
export async function decryptIvms101(
	ivms101: unknown,
	privateJwk: P256PrivateJwk,
	options: PiiDecryptionOptions,
): Promise<DecryptedIvms101> {
	const privateKey = await importPrivateKey(validateP256PrivateJwk(privateJwk));
	const result = await decryptIvms101Value(ivms101, privateKey, options);

	return {
		ivms101: result.value,
		decryptedValueCount: result.decryptedValueCount,
	};
}

async function decryptIvms101Value(
	value: unknown,
	privateKey: CryptoKey,
	options: PiiDecryptionOptions,
): Promise<{ value: unknown; decryptedValueCount: number }> {
	if (typeof value === 'string') {
		if (!looksLikeCompactJwe(value)) {
			return { value, decryptedValueCount: 0 };
		}

		return {
			value: await decryptPiiValueWithKey(value, privateKey, options),
			decryptedValueCount: 1,
		};
	}

	if (value === null || typeof value === 'number' || typeof value === 'boolean') {
		return { value, decryptedValueCount: 0 };
	}

	if (Array.isArray(value)) {
		const decryptedItems = await Promise.all(
			value.map((item) => decryptIvms101Value(item, privateKey, options)),
		);

		return {
			value: decryptedItems.map((item) => item.value),
			decryptedValueCount: decryptedItems.reduce(
				(total, item) => total + item.decryptedValueCount,
				0,
			),
		};
	}

	if (!isRecord(value)) {
		throw new Error('IVMS-101 contains an unsupported value');
	}

	const decryptedEntries = await Promise.all(
		Object.entries(value).map(async ([key, childValue]) => {
			const decryptedChild = await decryptIvms101Value(childValue, privateKey, options);
			return [key, decryptedChild] as const;
		}),
	);

	return {
		value: Object.fromEntries(
			decryptedEntries.map(([key, child]) => [key, child.value]),
		),
		decryptedValueCount: decryptedEntries.reduce(
			(total, [, child]) => total + child.decryptedValueCount,
			0,
		),
	};
}

async function decryptPiiValueWithKey(
	compactJwe: string,
	privateKey: CryptoKey,
	options: PiiDecryptionOptions,
): Promise<PiiPrimitive> {
	const parsedJwe = parseCompactJwe(compactJwe, options.expectedRecipientKeyId);
	await validatePartyBindings(parsedJwe, options);

	const ephemeralPublicKey = await crypto.subtle.importKey(
		'jwk',
		parsedJwe.header.epk,
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		[],
	);
	const ecdhParameters: SubtleCryptoDeriveKeyAlgorithm & { public: CryptoKey } = {
		name: 'ECDH',
		public: ephemeralPublicKey,
	};
	const sharedSecret = new Uint8Array(
		await crypto.subtle.deriveBits(
			ecdhParameters,
			privateKey,
			256,
		),
	);
	const cekBytes = await deriveContentEncryptionKey(
		sharedSecret,
		parsedJwe.header.apu,
		parsedJwe.header.apv,
	);
	sharedSecret.fill(0);

	try {
		const aesKey = await crypto.subtle.importKey(
			'raw',
			cekBytes,
			{ name: 'AES-GCM' },
			false,
			['decrypt'],
		);
		const ciphertextWithTag = concatenateBytes(
			parsedJwe.ciphertext,
			parsedJwe.authenticationTag,
		);
		const plaintext = await crypto.subtle.decrypt(
			{
				name: 'AES-GCM',
				iv: parsedJwe.iv,
				additionalData: encoder.encode(parsedJwe.protectedHeaderSegment),
				tagLength: 128,
			},
			aesKey,
			ciphertextWithTag,
		);

		let decryptedValue: unknown;
		try {
			decryptedValue = JSON.parse(decoder.decode(plaintext));
		} catch {
			throw new Error('Decrypted PII value is not valid JSON');
		}

		if (!isPiiPrimitive(decryptedValue)) {
			throw new Error('Decrypted PII leaf must be a JSON primitive');
		}

		return decryptedValue;
	} finally {
		cekBytes.fill(0);
	}
}

function parseCompactJwe(compactJwe: string, expectedRecipientKeyId: string): ParsedJwe {
	const segments = compactJwe.split('.');
	if (segments.length !== 5) {
		throw new Error('Invalid JWE compact serialization');
	}

	const [protectedHeaderSegment, encryptedKeySegment, ivSegment, ciphertextSegment, tagSegment] =
		segments;
	if (!protectedHeaderSegment || encryptedKeySegment !== '') {
		throw new Error('Expected direct ECDH-ES with an empty encrypted-key segment');
	}

	let decodedHeader: unknown;
	try {
		decodedHeader = JSON.parse(decoder.decode(base64UrlDecode(protectedHeaderSegment)));
	} catch {
		throw new Error('JWE protected header is invalid');
	}

	if (!isRecord(decodedHeader)) {
		throw new Error('JWE protected header must be a JSON object');
	}
	if (decodedHeader.alg !== 'ECDH-ES' || decodedHeader.enc !== 'A256GCM') {
		throw new Error('JWE must use ECDH-ES with A256GCM');
	}
	if (decodedHeader.typ !== undefined && decodedHeader.typ !== 'JWE') {
		throw new Error('Unsupported JWE type');
	}
	if (decodedHeader.kid !== expectedRecipientKeyId) {
		throw new Error('JWE recipient key ID does not match the PF bot key');
	}

	const epk = validateP256PublicJwk(decodedHeader.epk);
	const apu = readOptionalBase64Url(decodedHeader.apu, 'apu');
	const apv = readOptionalBase64Url(decodedHeader.apv, 'apv');
	const iv = base64UrlDecode(ivSegment);
	const ciphertext = base64UrlDecode(ciphertextSegment);
	const authenticationTag = base64UrlDecode(tagSegment);

	if (iv.length !== 12) {
		throw new Error('A256GCM JWE must use a 12-byte IV');
	}
	if (ciphertext.length === 0) {
		throw new Error('JWE ciphertext must not be empty');
	}
	if (authenticationTag.length !== 16) {
		throw new Error('A256GCM JWE must use a 16-byte authentication tag');
	}

	return {
		protectedHeaderSegment,
		header: {
			epk,
			apu,
			apv,
			kid: decodedHeader.kid,
		},
		iv,
		ciphertext,
		authenticationTag,
	};
}

async function validatePartyBindings(
	parsedJwe: ParsedJwe,
	options: PiiDecryptionOptions,
): Promise<void> {
	if (parsedJwe.header.apu.length > 0) {
		const expectedApu = new Uint8Array(
			await crypto.subtle.digest('SHA-256', encoder.encode(options.expectedSenderDid)),
		);
		if (!timingSafeEqual(parsedJwe.header.apu, expectedApu)) {
			throw new Error('JWE apu does not match the expected sender DID');
		}
	}

	if (parsedJwe.header.apv.length > 0) {
		const expectedApv = new Uint8Array(
			await crypto.subtle.digest(
				'SHA-256',
				encoder.encode(options.expectedRecipientKeyId),
			),
		);
		if (!timingSafeEqual(parsedJwe.header.apv, expectedApv)) {
			throw new Error('JWE apv does not match the expected recipient key ID');
		}
	}
}

async function importPrivateKey(privateJwk: P256PrivateJwk): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'jwk',
		privateJwk,
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		['deriveBits'],
	);
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

function validateP256PrivateJwk(value: unknown): P256PrivateJwk {
	if (!isRecord(value)) {
		throw new Error('A valid P-256 private JWK is required');
	}
	if (
		value.kty !== 'EC' ||
		value.crv !== 'P-256' ||
		typeof value.x !== 'string' ||
		typeof value.y !== 'string' ||
		typeof value.d !== 'string'
	) {
		throw new Error('A valid P-256 private JWK is required');
	}

	if (
		base64UrlDecode(value.x).length !== 32 ||
		base64UrlDecode(value.y).length !== 32 ||
		base64UrlDecode(value.d).length !== 32
	) {
		throw new Error('P-256 private JWK coordinates must each be 32 bytes');
	}

	return {
		kty: 'EC',
		crv: 'P-256',
		x: value.x,
		y: value.y,
		d: value.d,
	};
}

function validateP256PublicJwk(value: unknown): P256PublicJwk {
	if (
		!isRecord(value) ||
		value.kty !== 'EC' ||
		value.crv !== 'P-256' ||
		typeof value.x !== 'string' ||
		typeof value.y !== 'string'
	) {
		throw new Error('JWE ephemeral key must be a P-256 public JWK');
	}

	if (base64UrlDecode(value.x).length !== 32 || base64UrlDecode(value.y).length !== 32) {
		throw new Error('JWE ephemeral P-256 coordinates must each be 32 bytes');
	}

	return {
		kty: 'EC',
		crv: 'P-256',
		x: value.x,
		y: value.y,
	};
}

function readOptionalBase64Url(value: unknown, fieldName: string): Uint8Array {
	if (value === undefined) {
		return new Uint8Array(0);
	}
	if (typeof value !== 'string') {
		throw new Error(`JWE ${fieldName} must be a base64url string`);
	}

	return base64UrlDecode(value);
}

function base64UrlDecode(value: string): Uint8Array {
	if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
		throw new Error('Invalid base64url value in JWE');
	}

	const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
	const padding = '='.repeat((4 - (normalized.length % 4)) % 4);

	try {
		const binary = atob(normalized + padding);
		return Uint8Array.from(binary, (character) => character.charCodeAt(0));
	} catch {
		throw new Error('Invalid base64url value in JWE');
	}
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
	return left.length === right.length && crypto.subtle.timingSafeEqual(left, right);
}

function looksLikeCompactJwe(value: string): boolean {
	const segments = value.split('.');
	return segments.length === 5 && segments[0].length > 0 && segments[1] === '';
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

function isPiiPrimitive(value: unknown): value is PiiPrimitive {
	return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
