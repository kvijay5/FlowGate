import { Module } from '@nestjs/common';
import { WorkflowsService } from './workflows.service';
import { WorkflowsController } from './workflows.controller';
import { DelegationsController } from './delegations.controller';
import { AstConditionEvaluatorService } from './ast-condition-evaluator.service';
import { WorkflowGraphValidatorService } from './workflow-graph-validator.service';
import { WorkflowGraphEngineService } from './workflow-graph-engine.service';
import { WorkflowSimulatorService } from './workflow-simulator.service';
import { DelegationService } from './delegation.service';
import { AuditModule } from '../audit/audit.module';
import { OutboxModule } from '../outbox/outbox.module';

@Module({
  imports: [AuditModule, OutboxModule],
  controllers: [WorkflowsController, DelegationsController],
  providers: [
    WorkflowsService,
    AstConditionEvaluatorService,
    WorkflowGraphValidatorService,
    WorkflowGraphEngineService,
    WorkflowSimulatorService,
    DelegationService,
  ],
  exports: [
    WorkflowsService,
    AstConditionEvaluatorService,
    WorkflowGraphValidatorService,
    WorkflowGraphEngineService,
    WorkflowSimulatorService,
    DelegationService,
  ],
})
export class WorkflowsModule {}
