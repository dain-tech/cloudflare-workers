import { getAccessToken } from '../auth';
import type { NotabeneTransfer, WebhookPayload } from '../types';

const MOCK_BTC_TRANSFER = {
	asset: 'BTC',
	chainId: 'bip122:000000000019d6689c085ae165831e93',
	sourceAddress:
		'did:pkh:bip122:000000000019d6689c085ae165831e93:3ZYEaUm8JsYB1CvhbFAa8K3zncxBkeeCW',
	settlementAddress:
		'did:pkh:bip122:000000000019d6689c085ae165831e93:1111111111111111111114oLvT2',
	beneficiaryId: 'mailTo:robovasp',
} as const;

const REQUEST_PII_DELAY_MS = 5_000;

interface BeneficiaryPIIRequestOptions {
	logPrefix: string;
}

/**
 * Converts a client-created trigger transfer into a beneficiary-initiated RFI.
 * Whether the resulting presentation uses managed or end-to-end encryption is
 * determined by the VASP encryption settings and its published DID document.
 */
export async function handleBeneficiaryPIIRequest(
	entity: string,
	payload: WebhookPayload,
	env: Env,
	options: BeneficiaryPIIRequestOptions,
): Promise<void> {
	if (payload.message !== 'notification.transferCreated') {
		return;
	}

	const botDID = payload.payload.for;
	const triggerTransferId = payload.payload.id;
	console.log(
		JSON.stringify({ message: `${options.logPrefix}.webhook_received`, botDID, triggerTransferId }),
	);

	const token = await getAccessToken(env, entity);
	const triggerTransfer = await getTransfer(botDID, triggerTransferId, token, env);

	// The transfer created below also emits transferCreated. Ignore that event.
	if (triggerTransfer.initiator === botDID) {
		console.log(
			JSON.stringify({ message: `${options.logPrefix}.skipped_bot_initiated`, botDID, triggerTransferId }),
		);
		return;
	}

	const clientDID = triggerTransfer.initiator;
	const amount = triggerTransfer.amount;
	const originatorId = triggerTransfer.originator?.['@id'];
	if (!clientDID || !originatorId) {
		throw new Error('Trigger transfer is missing the client DID or originator identifier');
	}

	console.log(
		JSON.stringify({
			message: `${options.logPrefix}.delay_started`,
			botDID,
			triggerTransferId,
			delayMs: REQUEST_PII_DELAY_MS,
		}),
	);
	await scheduler.wait(REQUEST_PII_DELAY_MS);
	console.log(
		JSON.stringify({ message: `${options.logPrefix}.delay_completed`, botDID, triggerTransferId }),
	);

	const settlementId = await createFakeBitcoinSettlementId(triggerTransferId);
	const response = await fetch(`${env.NB_API_URL}/entities/${botDID}/tx`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({
			direction: 'INCOMING',
			status: 'OUTGOING',
			originator: { '@id': originatorId },
			beneficiary: { '@id': MOCK_BTC_TRANSFER.beneficiaryId },
			asset: MOCK_BTC_TRANSFER.asset,
			amount,
			agents: [
				{
					'@id': MOCK_BTC_TRANSFER.sourceAddress,
					for: clientDID,
					role: 'SourceAddress',
				},
				{
					'@id': clientDID,
					for: originatorId,
					role: 'VASP',
				},
				{
					'@id': botDID,
					for: MOCK_BTC_TRANSFER.beneficiaryId,
					role: 'VASP',
				},
				{
					'@id': MOCK_BTC_TRANSFER.settlementAddress,
					for: botDID,
					role: 'SettlementAddress',
				},
			],
			ref: triggerTransferId,
			settlementId,
		}),
	});

	// Notabene may retry the webhook. Reusing the trigger transfer ID as ref
	// makes the create request idempotent.
	if (response.status === 409) {
		await response.body?.cancel();
		return;
	}

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Request-missing-PII transfer creation failed: ${response.status} ${error}`);
	}

	console.log(
		JSON.stringify({
			message: `${options.logPrefix}.created`,
			botDID,
			triggerTransferId,
			settlementId,
		}),
	);
	await response.body?.cancel();
}

async function getTransfer(
	entityDID: string,
	transferId: string,
	token: string,
	env: Env,
): Promise<NotabeneTransfer> {
	const response = await fetch(`${env.NB_API_URL}/entities/${entityDID}/tx/${transferId}`, {
		headers: {
			Authorization: `Bearer ${token}`,
		},
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Get transfer failed: ${response.status} ${error}`);
	}

	const result = (await response.json()) as NotabeneTransfer | { transfer: NotabeneTransfer };
	console.log(result, 'transfer Result');
	return 'transfer' in result ? result.transfer : result;
}

async function createFakeBitcoinSettlementId(transferId: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(transferId));
	const transactionHash = Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, '0'),
	).join('');

	return `${MOCK_BTC_TRANSFER.chainId}:tx/${transactionHash}`;
}
