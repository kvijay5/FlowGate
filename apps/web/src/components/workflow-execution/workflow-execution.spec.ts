import {
  ApprovalRequestDetail,
  RequestExecutionGraph,
  AuditLogSummary,
  StepStatus,
} from '@flowgate/shared-types';

describe('Workflow Execution & Audit Inspection Logic', () => {
  describe('Audit Chain Inspector Logic', () => {
    it('should correctly format and truncate SHA-256 hashes', () => {
      const truncateHash = (h?: string | null) => {
        if (!h) return 'GENESIS';
        if (h.length <= 16) return h;
        return `${h.slice(0, 8)}...${h.slice(-8)}`;
      };

      expect(truncateHash(null)).toBe('GENESIS');
      expect(truncateHash(undefined)).toBe('GENESIS');
      expect(truncateHash('GENESIS')).toBe('GENESIS');

      const fullSha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      expect(truncateHash(fullSha256)).toBe('e3b0c442...7852b855');
    });

    it('should identify delegated audit actions and dual-actor metadata', () => {
      const logEntry: AuditLogSummary = {
        id: 'log-1',
        tenantId: 'tenant-1',
        actorId: 'delegatee-1',
        actor: {
          id: 'delegatee-1',
          name: 'Sarah Connor (Delegate)',
          email: 'sarah@example.com',
        },
        entityType: 'ApprovalStep',
        entityId: 'step-1',
        action: 'STEP_APPROVED_DELEGATED',
        metadata: {
          delegatorId: 'manager-1',
          delegatorName: 'John Doe (Manager)',
          delegationId: 'del-12345678-uuid',
          isDelegated: true,
        },
        previousHash: 'GENESIS',
        hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f901234567890abcdef1234567890abcdef',
        sequenceNumber: 1,
        createdAt: new Date().toISOString(),
      };

      const isDelegated =
        logEntry.action.includes('DELEGATED') || Boolean((logEntry.metadata as any)?.isDelegated);

      expect(isDelegated).toBe(true);
      expect((logEntry.metadata as any).delegatorName).toBe('John Doe (Manager)');
      expect((logEntry.metadata as any).delegationId).toBe('del-12345678-uuid');
      expect(logEntry.actor?.name).toBe('Sarah Connor (Delegate)');
    });

    it('should verify continuous sequential ordering and detect sequence gaps', () => {
      const logs: Partial<AuditLogSummary>[] = [
        { sequenceNumber: 1, previousHash: 'GENESIS', hash: 'hash1' },
        { sequenceNumber: 2, previousHash: 'hash1', hash: 'hash2' },
        { sequenceNumber: 3, previousHash: 'hash2', hash: 'hash3' },
      ];

      const verifySequences = (items: Partial<AuditLogSummary>[]) => {
        for (let i = 0; i < items.length; i++) {
          const expectedSeq = i + 1;
          if (items[i].sequenceNumber !== expectedSeq) {
            return { valid: false, brokenAtSeq: items[i].sequenceNumber };
          }
          if (i > 0 && items[i].previousHash !== items[i - 1].hash) {
            return { valid: false, brokenAtHash: items[i].previousHash };
          }
        }
        return { valid: true };
      };

      expect(verifySequences(logs).valid).toBe(true);

      const brokenLogs: Partial<AuditLogSummary>[] = [
        { sequenceNumber: 1, previousHash: 'GENESIS', hash: 'hash1' },
        { sequenceNumber: 3, previousHash: 'hash1', hash: 'hash2' }, // Gap: missing #2
      ];
      expect(verifySequences(brokenLogs).valid).toBe(false);
    });
  });

  describe('DAG Execution State & Quorum Derivation', () => {
    it('should compute quorum progress and detect quorum-loss conditions', () => {
      const evaluateQuorum = (
        requiredApprovals: number,
        totalAssigned: number,
        approvedCount: number,
        rejectedCount: number,
      ) => {
        const remainingPotential = totalAssigned - rejectedCount;
        const isQuorumAchieved = approvedCount >= requiredApprovals;
        const isQuorumLost = remainingPotential < requiredApprovals && !isQuorumAchieved;
        return { isQuorumAchieved, isQuorumLost, remainingPotential };
      };

      // Scenario 1: 2 of 3 required, 1 approved, 0 rejected -> achievable
      const s1 = evaluateQuorum(2, 3, 1, 0);
      expect(s1.isQuorumAchieved).toBe(false);
      expect(s1.isQuorumLost).toBe(false);

      // Scenario 2: 2 of 3 required, 1 approved, 2 rejected -> quorum lost!
      const s2 = evaluateQuorum(2, 3, 1, 2);
      expect(s2.isQuorumAchieved).toBe(false);
      expect(s2.isQuorumLost).toBe(true);

      // Scenario 3: 2 of 3 required, 2 approved, 1 rejected -> quorum achieved!
      const s3 = evaluateQuorum(2, 3, 2, 1);
      expect(s3.isQuorumAchieved).toBe(true);
      expect(s3.isQuorumLost).toBe(false);
    });

    it('should generate synthetic DAG topology for legacy sequential workflows', () => {
      const mockSteps = [
        { id: 's1', stepOrder: 1, stepName: 'Manager Review', status: 'APPROVED' as StepStatus },
        { id: 's2', stepOrder: 2, stepName: 'Finance Signoff', status: 'IN_REVIEW' as StepStatus },
      ];

      const generateSyntheticGraph = (steps: typeof mockSteps) => {
        const nodes = [
          { id: 'trigger', type: 'TRIGGER', name: 'Request Submitted' },
          ...steps.map((s) => ({
            id: s.id,
            type: 'APPROVAL_STEP',
            name: s.stepName,
          })),
          { id: 'end', type: 'END', name: 'Final Approval' },
        ];

        const edges = [];
        for (let i = 0; i < nodes.length - 1; i++) {
          edges.push({
            id: `e-${nodes[i].id}-${nodes[i + 1].id}`,
            source: nodes[i].id,
            target: nodes[i + 1].id,
          });
        }

        return { nodes, edges };
      };

      const result = generateSyntheticGraph(mockSteps);
      expect(result.nodes).toHaveLength(4); // Trigger + 2 Steps + End
      expect(result.edges).toHaveLength(3); // 3 transitions
      expect(result.nodes[0].type).toBe('TRIGGER');
      expect(result.nodes[3].type).toBe('END');
    });

    it('should filter execution nodes and branch transitions by review round', () => {
      const nodeExecutions = [
        { id: 'ne-1', nodeId: 'step-1', reviewRound: 1, status: 'APPROVED' as const },
        { id: 'ne-2', nodeId: 'step-2', reviewRound: 1, status: 'REJECTED' as const },
        { id: 'ne-3', nodeId: 'step-1', reviewRound: 2, status: 'APPROVED' as const },
        { id: 'ne-4', nodeId: 'step-2', reviewRound: 2, status: 'IN_REVIEW' as const },
      ];

      const filterByRound = (round: number) =>
        nodeExecutions.filter((ne) => ne.reviewRound === round);

      const round1 = filterByRound(1);
      expect(round1).toHaveLength(2);
      expect(round1.find((n) => n.nodeId === 'step-2')?.status).toBe('REJECTED');

      const round2 = filterByRound(2);
      expect(round2).toHaveLength(2);
      expect(round2.find((n) => n.nodeId === 'step-2')?.status).toBe('IN_REVIEW');
    });

    it('should map branch transition statuses to edge stroke styling', () => {
      const getEdgeStroke = (status?: string) => {
        if (status === 'COMPLETED') return { stroke: '#10b981', strokeWidth: 2.5, dashed: false };
        if (status === 'ACTIVE') return { stroke: '#6366f1', strokeWidth: 2.5, dashed: false };
        if (status === 'PRUNED_SKIPPED')
          return { stroke: '#475569', strokeWidth: 1.5, dashed: true };
        return { stroke: '#334155', strokeWidth: 2, dashed: false };
      };

      expect(getEdgeStroke('COMPLETED').stroke).toBe('#10b981');
      expect(getEdgeStroke('ACTIVE').stroke).toBe('#6366f1');
      expect(getEdgeStroke('PRUNED_SKIPPED').dashed).toBe(true);
      expect(getEdgeStroke('PENDING').stroke).toBe('#334155');
    });
  });
});
