export interface Approval {
  signature: string;
  approvedAt: string;
  /**
   * Set the first time the inputs differ from the approved signature. Once
   * revoked it never self-heals: editing inputs back to the old values does
   * NOT resurrect the approval — the user must approve again explicitly.
   */
  revoked?: boolean;
}

export function reduceApprovalOnSignature(approval: Approval | null, currentSignature: string): Approval | null {
  if (approval && approval.signature !== currentSignature && !approval.revoked) {
    return { ...approval, revoked: true };
  }
  return approval;
}

export function isApprovalUsable(approval: Approval | null, currentSignature: string): boolean {
  return approval !== null && !approval.revoked && approval.signature === currentSignature;
}
