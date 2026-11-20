import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccessToken } from '../src/auth';
import {
	appendMockTravelRulePII,
	handleRequestPIIFromBot,
} from '../src/handlers/request-pii-from-bot';
import type { WebhookPayload } from '../src/types';

vi.mock('../src/auth', () => ({
	getAccessToken: vi.fn(),
}));

const BOT_DID = 'did:web:notabeneid-36ea1.sandbox.notabene.id:in';
const NOTABENE_API_URL = 'https://api.eu1.notabene.id';

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(getAccessToken).mockResolvedValue('bot-token');
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('appendMockTravelRulePII', () => {
	it('posts complete mock PII to the supplied callback URL', async () => {
		const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 202 }));

		await appendMockTravelRulePII(
			'/entities/bot/tx/transfer-id/append',
			'bot-token',
			'https://api.eu1.notabene.id',
			fetcher,
		);

		expect(fetcher).toHaveBeenCalledOnce();
		const [requestUrl, requestInit] = fetcher.mock.calls[0];
		expect(String(requestUrl)).toBe(
			'https://api.eu1.notabene.id/entities/bot/tx/transfer-id/append',
		);
		expect(requestInit).toMatchObject({
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer bot-token',
			},
		});

		expect(JSON.parse(String(requestInit?.body))).toEqual({
			ivms101: {
				PayloadMetadata: {
					payloadVersion: 'IVMS101.2023',
				},
				originator: {
					originatorPerson: [
						{
							accountNumber: ['ROBO-ALICE-001'],
							naturalPerson: {
								name: {
									nameIdentifier: [
										{
											primaryIdentifier: 'Example',
											secondaryIdentifier: 'Alice',
											naturalPersonNameIdentifierType: 'LEGL',
										},
									],
								},
								geographicAddress: [
									{
										addressType: 'HOME',
										addressLine: ['100 Example Street'],
										streetName: 'Example Street',
										buildingNumber: '100',
										townName: 'Mumbai',
										postCode: '400001',
										country: 'IN',
									},
								],
								nationalIdentification: {
									countryOfIssue: 'IN',
									nationalIdentifier: 'ROBO-ALICE-NATIONAL-ID-001',
									nationalIdentifierType: 'MISC',
								},
								dateAndPlaceOfBirth: {
									dateOfBirth: '1990-02-25',
									placeOfBirth: 'IN',
								},
								customerIdentification: 'ROBO-ALICE-CUSTOMER-001',
							},
						},
					],
				},
				beneficiary: {
					beneficiaryPerson: [
						{
							accountNumber: ['ROBO-BOB-001'],
							naturalPerson: {
								name: {
									nameIdentifier: [
										{
											primaryIdentifier: 'Example',
											secondaryIdentifier: 'Bob',
											naturalPersonNameIdentifierType: 'LEGL',
										},
									],
								},
							},
						},
					],
				},
			},
		});
	});

	it('handles a presentation request by obtaining the bot token and appending PII', async () => {
		const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 202 }));
		vi.stubGlobal('fetch', fetcher);

		const env = { NB_API_URL: NOTABENE_API_URL } as Env;
		const payload: WebhookPayload = {
			message: 'tap.requirePresentationRequested',
			payload: {
				for: BOT_DID,
				id: 'transfer-id',
				from: 'did:web:requester.example:test',
				to: BOT_DID,
				settlementId: 'settlement-id',
				callbackUrl: '/entities/bot/tx/transfer-id/append',
				policyId: 'policy-id',
				beneficiaryPresentationDefinition:
					'https://pd.notabene.id/ivms101/v2/BE-0.json',
			},
			version: '1.0.0',
		};

		await handleRequestPIIFromBot(BOT_DID, payload, env);

		expect(getAccessToken).toHaveBeenCalledWith(env, BOT_DID);
		expect(fetcher).toHaveBeenCalledOnce();
		expect(String(fetcher.mock.calls[0][0])).toBe(
			`${NOTABENE_API_URL}/entities/bot/tx/transfer-id/append`,
		);
	});

	it('records partial satisfaction without resubmitting PII', async () => {
		const fetcher = vi.fn<typeof fetch>();
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		vi.stubGlobal('fetch', fetcher);

		await handleRequestPIIFromBot(
			BOT_DID,
			{
				message: 'tap.requirePresentationPartiallySatisfied',
				payload: {
					for: BOT_DID,
					id: 'transfer-id',
					from: 'did:web:requester.example:test',
					to: BOT_DID,
					settlementId: 'settlement-id',
					policyId: 'policy-id',
				},
				version: '1.0.0',
			},
			{ NB_API_URL: NOTABENE_API_URL } as Env,
		);

		expect(warning).toHaveBeenCalledOnce();
		expect(getAccessToken).not.toHaveBeenCalled();
		expect(fetcher).not.toHaveBeenCalled();
	});
});
