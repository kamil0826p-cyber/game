export const REWARD_CLAIMS_UPDATED_EVENT = 'game:reward-claims-updated';
export const REWARD_CLAIMS_INVALIDATED_EVENT = 'game:reward-claims-invalidated';

export interface RewardClaimsUpdatedDetail {
  count: number;
  expiringSoonCount: number;
}

export const publishRewardClaimsUpdated = (
  count: number,
  expiringSoonCount: number,
): void => {
  window.dispatchEvent(
    new CustomEvent<RewardClaimsUpdatedDetail>(REWARD_CLAIMS_UPDATED_EVENT, {
      detail: { count, expiringSoonCount },
    }),
  );
};

export const invalidateRewardClaims = (): void => {
  window.dispatchEvent(new Event(REWARD_CLAIMS_INVALIDATED_EVENT));
};
