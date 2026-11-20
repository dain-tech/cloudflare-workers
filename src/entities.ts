
export const ENTITY_DIDS = {
	accept: 'did:web:notabeneid-f2afc.sandbox.notabene.id:gr',
	confirm: 'did:web:notabeneid-e42f7.sandbox.notabene.id:us',
	reject: 'did:web:notabeneid-9b030.sandbox.notabene.id:de',
	addCustodian: 'did:web:notabeneid-60dbe.sandbox.notabene.id:kr',
	replace: 'did:web:notabeneid-8f281.sandbox.notabene.id:th',
	br: 'did:web:notabene.id:br',
	settle: 'did:web:entity.com:two',
	flag: 'did:web:entity.com:three',
	botRequestPII: 'did:web:notabeneid-a417f.sandbox.notabene.id:be',
	botRequestsEncryptedPII: 'did:web:notabeneid-cef76.sandbox.notabene.id:kr',
	requestPIIFromBot:'did:web:notabeneid-36ea1.sandbox.notabene.id:in'
 } as const;

export const PF_BOT_PII_KEY_ID = `${ENTITY_DIDS.botRequestsEncryptedPII}#pii`;
