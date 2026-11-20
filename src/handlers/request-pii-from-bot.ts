import { getAccessToken } from '../auth';
import type { WebhookPayload } from '../types';
import { handleConfirm } from './confirm';

const MOCK_TRAVEL_RULE_PII = {
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
} as const;

/**
 * Handles the side of the flow where a client requests PII from the bot.
 * The bot stays on the original transfer, confirms the wallet relationship,
 * and appends mock originator and beneficiary PII when Notabene requests a
 * presentation.
 */
export async function handleRequestPIIFromBot(
	entity: string,
	payload: WebhookPayload,
	env: Env,
): Promise<void> {
	const transferId = payload.payload.id;

	switch (payload.message) {
		case 'notification.transferCreated':
			console.log(
				JSON.stringify({
					message: 'bot_pii.transfer_received',
					entity,
					transferId,
				}),
			);
			return;

		case 'tap.requireRelationshipConfirmationRequested':
			console.log(
				JSON.stringify({
					message: 'bot_pii.relationship_confirmation_requested',
					entity,
					transferId,
				}),
			);
			return handleConfirm(entity, payload, env);

		case 'tap.requirePresentationRequested': {
			const callbackUrl = payload.payload.callbackUrl;
			if (!callbackUrl) {
				throw new Error('Presentation request is missing callbackUrl');
			}

			console.log(
				JSON.stringify({
					message: 'bot_pii.presentation_requested',
					entity,
					transferId,
					policyId: payload.payload.policyId,
					presentationDefinition:
						payload.payload.beneficiaryPresentationDefinition ??
						payload.payload.originatorPresentationDefinition,
				}),
			);

			const token = await getAccessToken(env, entity);
			await appendMockTravelRulePII(
				callbackUrl,
				token,
				env.NB_API_URL,
			);

			console.log(
				JSON.stringify({
					message: 'bot_pii.presentation_appended',
					entity,
					transferId,
					policyId: payload.payload.policyId,
				}),
			);
			return;
		}

		case 'tap.requirePresentationPartiallySatisfied':
			console.warn(
				JSON.stringify({
					message: 'bot_pii.presentation_partially_satisfied',
					entity,
					transferId,
					policyId: payload.payload.policyId,
				}),
			);
			return;

		case 'tap.requirePresentationSatisfied':
			console.log(
				JSON.stringify({
					message: 'bot_pii.presentation_satisfied',
					entity,
					transferId,
					policyId: payload.payload.policyId,
				}),
			);
			return;
	}
}

/**
 * Posts mock IVMS-101 PII to the callback supplied by Notabene.
 */
export async function appendMockTravelRulePII(
	callbackUrl: string,
	token: string,
	notabeneApiUrl: string,
	fetcher: typeof fetch = fetch,
): Promise<void> {
	const apiUrl = new URL(notabeneApiUrl);
	const appendUrl = new URL(callbackUrl, apiUrl);
	if (appendUrl.origin !== apiUrl.origin) {
		throw new Error('Presentation callback must use the configured Notabene API origin');
	}

	const response = await fetcher(appendUrl, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify(MOCK_TRAVEL_RULE_PII),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Mock Travel Rule PII append failed: ${response.status} ${error}`);
	}

	await response.body?.cancel();
}
