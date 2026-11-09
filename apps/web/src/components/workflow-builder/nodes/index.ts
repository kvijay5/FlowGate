import { TriggerNode } from './TriggerNode';
import { ApprovalNode } from './ApprovalNode';
import { ParallelApprovalNode } from './ParallelApprovalNode';
import { ConditionNode } from './ConditionNode';
import { JoinNode } from './JoinNode';
import { EndNode } from './EndNode';

export const nodeTypes = {
  TRIGGER: TriggerNode,
  APPROVAL_STEP: ApprovalNode,
  APPROVAL: ApprovalNode,
  PARALLEL_APPROVAL: ParallelApprovalNode,
  PARALLEL: ParallelApprovalNode,
  CONDITION: ConditionNode,
  JOIN: JoinNode,
  END: EndNode,
};

export { TriggerNode, ApprovalNode, ParallelApprovalNode, ConditionNode, JoinNode, EndNode };
