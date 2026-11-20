export interface WebhookPayload {
	message: string;
	payload: {
		for: string;
		id: string;
		from: string;
		to: string;
		settlementId: string;
		confirmCallbackUrl?: string;
		callbackUrl?: string;
		relationshipId?: string;
		beneficiaryAgentID?: string;
		originatorAgentID?: string;
		beneficiaryPresentationDefinition?: string;
		originatorPresentationDefinition?: string;
		policyId?: string;
		purpose?: string;
		transferId?: string;
	};
	version: string;
}

export interface NotabeneTransfer {
	initiator: string;
	originator: {
		'@id': string;
	};
	beneficiary: {
		'@id': string;
	};
	asset: string;
	amount: string;
	agents: Array<{
		'@id'?: string;
		id?: string;
		agent?: {
			'@id'?: string;
			id?: string;
		};
		for: string;
		role: 'VASP' | 'Custodian' | 'SettlementAddress' | 'SourceAddress' | 'Gateway' | 'Unknown';
	}>;
}
