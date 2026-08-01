import type { DomainAuditEntry, DomainContribution, DomainEventRecord } from './domain-event.types.js';

export interface MaterializedDomainEffects {
  contributions: DomainContribution[];
  audit: DomainAuditEntry[];
}

function eligibleContribution(value: DomainContribution): boolean {
  const metadata = value.metadata ?? {};
  if (metadata.afk === true || metadata.eligible === false) return false;
  if (value.kind !== 'COMBAT_PARTICIPATION') return true;
  const actions = metadata.actions;
  const activeMs = metadata.activeMs;
  return (Number.isInteger(actions) && Number(actions) > 0) ||
    (Number.isInteger(activeMs) && Number(activeMs) >= 1_000);
}

export function materializeDomainEffects(event: DomainEventRecord): MaterializedDomainEffects {
  const payload = event.payload as unknown as {
    contributions?: DomainContribution[];
    audit?: DomainAuditEntry[];
  };
  const contributions = (payload.contributions ?? []).filter(eligibleContribution);
  const audit = [...(payload.audit ?? [])];
  for (const contribution of contributions) {
    audit.push({
      characterId: contribution.subjectType === 'CHARACTER' ? contribution.subjectId : undefined,
      resourceType: 'CONTRIBUTION',
      resourceKey: contribution.kind,
      amount: contribution.amount,
      reason: event.type,
      metadata: {
        subjectType: contribution.subjectType,
        subjectId: contribution.subjectId,
        ...(contribution.metadata ?? {}),
      },
    });
  }
  return { contributions, audit };
}
