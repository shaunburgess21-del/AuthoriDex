export interface AppliedAdminCreditAdjustment {
  appliedAmount: number;
  newBalance: number;
  wasClamped: boolean;
}

export function applyAdminCreditAdjustment(
  currentBalance: number,
  requestedAmount: number,
): AppliedAdminCreditAdjustment {
  const requestedBalance = currentBalance + requestedAmount;
  if (requestedBalance >= 0) {
    return {
      appliedAmount: requestedAmount,
      newBalance: requestedBalance,
      wasClamped: false,
    };
  }

  return {
    appliedAmount: -currentBalance,
    newBalance: 0,
    wasClamped: true,
  };
}
