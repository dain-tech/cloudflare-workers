const DEFAULT_PF_BOT_DID = 'did:web:notabeneid-cef76.sandbox.notabene.id:kr';

const pfBotDid = process.argv[2] ?? DEFAULT_PF_BOT_DID;
if (!pfBotDid.startsWith('did:')) {
	throw new Error('The PF bot identifier must be a DID');
}

const generatedKey = await crypto.subtle.generateKey(
	{ name: 'ECDH', namedCurve: 'P-256' },
	true,
	['deriveBits'],
);

if (!('publicKey' in generatedKey)) {
	throw new Error('P-256 key generation did not return a key pair');
}

const [publicJwk, privateJwk] = await Promise.all([
	crypto.subtle.exportKey('jwk', generatedKey.publicKey),
	crypto.subtle.exportKey('jwk', generatedKey.privateKey),
]);

const keyId = `${pfBotDid}#pii`;
const publicRegistration = {
	controller: pfBotDid,
	id: keyId,
	publicKeyJwk: publicJwk,
	type: 'EcdsaSecp256r1VerificationKey2019',
};

console.log('PF public encryption key (register this with the sandbox DID):');
console.log(JSON.stringify(publicRegistration, null, 2));
console.log('\nPF private JWK (store this entire one-line value as PF_BOT_PRIVATE_JWK):');
console.log(JSON.stringify(privateJwk));
console.log('\nDo not commit or share the private JWK.');
