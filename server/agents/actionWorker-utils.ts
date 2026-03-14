export function buildAgentActionStakeIdempotencyKey(actionId: string): string {
  return `agent_stake_action_${actionId}`;
}

export function buildAgentBetMetadata(
  actionId: string,
  rationale?: string,
): { actionId: string; rationale?: string } {
  return {
    actionId,
    ...(rationale ? { rationale } : {}),
  };
}
