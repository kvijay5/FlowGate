import { Injectable, BadRequestException } from '@nestjs/common';
import {
  AstNode,
  AstComparisonNode,
  AstLogicalNode,
  InputSchema,
  FieldDataType,
} from '@flowgate/shared-types';

export interface EvaluationTrace {
  nodeType: 'LOGICAL' | 'COMPARISON';
  operator: string;
  field?: string;
  fieldValue?: unknown;
  expectedValue?: unknown;
  result: boolean;
  children?: EvaluationTrace[];
  evaluatedAt: string;
}

export interface EvaluationResult {
  result: boolean;
  trace: EvaluationTrace;
}

export const MAX_PAYLOAD_BYTES = 32 * 1024; // 32 KB = 32,768 bytes
export const MAX_AST_DEPTH = 5;

const PROTOTYPE_POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const NUMERIC_OPERATORS = new Set([
  'EQ',
  'NEQ',
  'GT',
  'GTE',
  'LT',
  'LTE',
  'IN',
  '==',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
]);

const STRING_OPERATORS = new Set([
  'EQ',
  'NEQ',
  'IN',
  'NOT_IN',
  'CONTAINS',
  'STARTS_WITH',
  'ENDS_WITH',
  '==',
  '!=',
]);

const BOOLEAN_OPERATORS = new Set(['EQ', 'NEQ', '==', '!=']);

const LOGICAL_OPERATORS = new Set(['AND', 'OR', 'NOT']);

@Injectable()
export class AstConditionEvaluatorService {
  /**
   * Statically validates an AST condition expression against an optional input schema.
   * Enforces max depth (<= 5), valid operators, safe property keys, and type compatibility.
   */
  public validateAst(ast: AstNode, schema?: InputSchema, depth = 1): void {
    if (depth > MAX_AST_DEPTH) {
      throw new BadRequestException(
        `Condition expression tree depth (${depth}) exceeds maximum allowed limit of ${MAX_AST_DEPTH}`,
      );
    }

    if (!ast || typeof ast !== 'object') {
      throw new BadRequestException('AST node must be a non-null object');
    }

    if (this.isLogicalNode(ast)) {
      this.validateLogicalNode(ast, schema, depth);
    } else if (this.isComparisonNode(ast)) {
      this.validateComparisonNode(ast, schema);
    } else {
      throw new BadRequestException(
        'Malformed AST node: must be either a logical node or a comparison node',
      );
    }
  }

  /**
   * Evaluates an AST condition expression against the provided requestData.
   * Returns a boolean result and structured trace metadata for audit logging.
   */
  public evaluate(
    ast: AstNode,
    requestData: Record<string, unknown>,
    schema?: InputSchema,
  ): EvaluationResult {
    // 1. Guard against oversized payload (32 KB limit)
    this.assertPayloadSize(requestData);

    // 2. Validate AST structure & schema consistency
    this.validateAst(ast, schema, 1);

    // 3. Evaluate recursively
    return this.evaluateNode(ast, requestData, schema);
  }

  // ===========================================================================
  // PRIVATE EVALUATION METHODS
  // ===========================================================================

  private evaluateNode(
    ast: AstNode,
    requestData: Record<string, unknown>,
    schema?: InputSchema,
  ): EvaluationResult {
    if (this.isLogicalNode(ast)) {
      return this.evaluateLogicalNode(ast, requestData, schema);
    }
    return this.evaluateComparisonNode(ast as AstComparisonNode, requestData, schema);
  }

  private evaluateLogicalNode(
    node: AstLogicalNode,
    requestData: Record<string, unknown>,
    schema?: InputSchema,
  ): EvaluationResult {
    const childrenTraces: EvaluationTrace[] = [];

    if (node.operator === 'AND') {
      let overallResult = true;
      for (const child of node.children) {
        const childEval = this.evaluateNode(child, requestData, schema);
        childrenTraces.push(childEval.trace);
        if (!childEval.result) {
          overallResult = false;
        }
      }
      return {
        result: overallResult,
        trace: {
          nodeType: 'LOGICAL',
          operator: 'AND',
          result: overallResult,
          children: childrenTraces,
          evaluatedAt: new Date().toISOString(),
        },
      };
    }

    if (node.operator === 'OR') {
      let overallResult = false;
      for (const child of node.children) {
        const childEval = this.evaluateNode(child, requestData, schema);
        childrenTraces.push(childEval.trace);
        if (childEval.result) {
          overallResult = true;
        }
      }
      return {
        result: overallResult,
        trace: {
          nodeType: 'LOGICAL',
          operator: 'OR',
          result: overallResult,
          children: childrenTraces,
          evaluatedAt: new Date().toISOString(),
        },
      };
    }

    if (node.operator === 'NOT') {
      const childEval = this.evaluateNode(node.children[0], requestData, schema);
      childrenTraces.push(childEval.trace);
      const overallResult = !childEval.result;
      return {
        result: overallResult,
        trace: {
          nodeType: 'LOGICAL',
          operator: 'NOT',
          result: overallResult,
          children: childrenTraces,
          evaluatedAt: new Date().toISOString(),
        },
      };
    }

    throw new BadRequestException(`Unsupported logical operator: ${node.operator}`);
  }

  private evaluateComparisonNode(
    node: AstComparisonNode,
    requestData: Record<string, unknown>,
    schema?: InputSchema,
  ): EvaluationResult {
    this.assertSafePropertyKey(node.field);

    const schemaField = schema?.fields.find((f) => f.name === node.field);
    const actualValue = requestData[node.field];

    if (actualValue === undefined || actualValue === null) {
      if (schemaField && schemaField.required) {
        throw new BadRequestException(
          `Required field '${node.field}' is missing or null in requestData`,
        );
      }
      // Non-required missing field: handle null comparison strictly
      const res = this.evaluateNullValue(actualValue, node.operator, node.value);
      return {
        result: res,
        trace: {
          nodeType: 'COMPARISON',
          operator: node.operator,
          field: node.field,
          fieldValue: actualValue,
          expectedValue: node.value,
          result: res,
          evaluatedAt: new Date().toISOString(),
        },
      };
    }

    // Determine expected type (from schema if provided, else from actualValue runtime type)
    const expectedType: FieldDataType = schemaField
      ? schemaField.type
      : this.inferFieldDataType(actualValue);

    this.assertTypeMatch(node.field, actualValue, expectedType, node.operator, node.value);

    let res = false;
    switch (expectedType) {
      case 'NUMBER':
        res = this.evaluateNumericComparison(actualValue as number, node.operator, node.value);
        break;
      case 'STRING':
        res = this.evaluateStringComparison(actualValue as string, node.operator, node.value);
        break;
      case 'BOOLEAN':
        res = this.evaluateBooleanComparison(actualValue as boolean, node.operator, node.value);
        break;
      default:
        throw new BadRequestException(`Unsupported field data type: ${expectedType}`);
    }

    return {
      result: res,
      trace: {
        nodeType: 'COMPARISON',
        operator: node.operator,
        field: node.field,
        fieldValue: actualValue,
        expectedValue: node.value,
        result: res,
        evaluatedAt: new Date().toISOString(),
      },
    };
  }

  // ===========================================================================
  // COMPARISON OPERATOR IMPLEMENTATIONS (STRICT ZERO-COERCION)
  // ===========================================================================

  private evaluateNumericComparison(actual: number, operator: string, target: unknown): boolean {
    if (!Number.isFinite(actual)) {
      throw new BadRequestException('Numeric field values must be finite numbers');
    }

    if (operator === 'IN') {
      if (!Array.isArray(target)) {
        throw new BadRequestException("Operator 'IN' requires target value to be an array");
      }
      for (const item of target) {
        if (typeof item !== 'number' || !Number.isFinite(item)) {
          throw new BadRequestException(
            "All items in 'IN' target array must be finite numbers for numeric field",
          );
        }
      }
      return target.includes(actual);
    }

    if (typeof target !== 'number' || !Number.isFinite(target)) {
      throw new BadRequestException(
        `Numeric comparison operator '${operator}' requires target value to be a finite number, received: ${typeof target}`,
      );
    }

    switch (operator) {
      case 'EQ':
      case '==':
        return actual === target;
      case 'NEQ':
      case '!=':
        return actual !== target;
      case 'GT':
      case '>':
        return actual > target;
      case 'GTE':
      case '>=':
        return actual >= target;
      case 'LT':
      case '<':
        return actual < target;
      case 'LTE':
      case '<=':
        return actual <= target;
      default:
        throw new BadRequestException(`Unsupported numeric operator: ${operator}`);
    }
  }

  private evaluateStringComparison(actual: string, operator: string, target: unknown): boolean {
    if (operator === 'IN' || operator === 'NOT_IN') {
      if (!Array.isArray(target)) {
        throw new BadRequestException(
          `Operator '${operator}' requires target value to be an array`,
        );
      }
      for (const item of target) {
        if (typeof item !== 'string') {
          throw new BadRequestException(
            `All items in '${operator}' target array must be strings for string field`,
          );
        }
      }
      const included = target.includes(actual);
      return operator === 'IN' ? included : !included;
    }

    if (typeof target !== 'string') {
      throw new BadRequestException(
        `String comparison operator '${operator}' requires target value to be a string, received: ${typeof target}`,
      );
    }

    switch (operator) {
      case 'EQ':
      case '==':
        return actual === target;
      case 'NEQ':
      case '!=':
        return actual !== target;
      case 'CONTAINS':
        return actual.includes(target);
      case 'STARTS_WITH':
        return actual.startsWith(target);
      case 'ENDS_WITH':
        return actual.endsWith(target);
      default:
        throw new BadRequestException(`Unsupported string operator: ${operator}`);
    }
  }

  private evaluateBooleanComparison(actual: boolean, operator: string, target: unknown): boolean {
    if (typeof target !== 'boolean') {
      throw new BadRequestException(
        `Boolean comparison operator '${operator}' requires target value to be a boolean, received: ${typeof target}`,
      );
    }

    switch (operator) {
      case 'EQ':
      case '==':
        return actual === target;
      case 'NEQ':
      case '!=':
        return actual !== target;
      default:
        throw new BadRequestException(`Unsupported boolean operator: ${operator}`);
    }
  }

  private evaluateNullValue(actual: unknown, operator: string, target: unknown): boolean {
    if (operator === 'EQ' || operator === '==') {
      return actual === target;
    }
    if (operator === 'NEQ' || operator === '!=') {
      return actual !== target;
    }
    // Greater than / less than with null is rejected under strict type checking
    throw new BadRequestException(
      `Cannot apply comparison operator '${operator}' to null or undefined value without type coercion`,
    );
  }

  // ===========================================================================
  // VALIDATION & TYPE SAFETY GUARDS
  // ===========================================================================

  private validateLogicalNode(node: AstLogicalNode, schema?: InputSchema, depth = 1): void {
    if (!LOGICAL_OPERATORS.has(node.operator)) {
      throw new BadRequestException(`Invalid logical operator: '${node.operator}'`);
    }

    if (!Array.isArray(node.children)) {
      throw new BadRequestException(
        `Logical operator '${node.operator}' requires 'children' array`,
      );
    }

    if (node.operator === 'NOT') {
      if (node.children.length !== 1) {
        throw new BadRequestException(
          `Logical operator 'NOT' must have exactly 1 child node, received ${node.children.length}`,
        );
      }
    } else {
      if (node.children.length === 0) {
        throw new BadRequestException(
          `Logical operator '${node.operator}' must have at least one child node`,
        );
      }
    }

    for (const child of node.children) {
      this.validateAst(child, schema, depth + 1);
    }
  }

  private validateComparisonNode(node: AstComparisonNode, schema?: InputSchema): void {
    if (!node.field || typeof node.field !== 'string') {
      throw new BadRequestException("Comparison node must specify a non-empty string 'field'");
    }

    this.assertSafePropertyKey(node.field);

    if (!node.operator || typeof node.operator !== 'string') {
      throw new BadRequestException("Comparison node must specify a valid 'operator'");
    }

    if (schema) {
      const fieldDef = schema.fields.find((f) => f.name === node.field);
      if (!fieldDef) {
        throw new BadRequestException(
          `Field '${node.field}' is not defined in the trigger input schema`,
        );
      }
      this.assertValidOperatorForType(node.operator, fieldDef.type);
      this.assertValidTargetValueForType(node.operator, node.value, fieldDef.type);
    } else {
      // Schema-less validation: verify operator is supported by at least one type
      const isKnownOperator =
        NUMERIC_OPERATORS.has(node.operator) ||
        STRING_OPERATORS.has(node.operator) ||
        BOOLEAN_OPERATORS.has(node.operator);

      if (!isKnownOperator) {
        throw new BadRequestException(`Unsupported comparison operator: '${node.operator}'`);
      }
    }
  }

  private assertValidOperatorForType(operator: string, type: FieldDataType): void {
    switch (type) {
      case 'NUMBER':
        if (!NUMERIC_OPERATORS.has(operator)) {
          throw new BadRequestException(
            `Operator '${operator}' is not valid for numeric field. Allowed: ${Array.from(NUMERIC_OPERATORS).join(', ')}`,
          );
        }
        break;
      case 'STRING':
        if (!STRING_OPERATORS.has(operator)) {
          throw new BadRequestException(
            `Operator '${operator}' is not valid for string field. Allowed: ${Array.from(STRING_OPERATORS).join(', ')}`,
          );
        }
        break;
      case 'BOOLEAN':
        if (!BOOLEAN_OPERATORS.has(operator)) {
          throw new BadRequestException(
            `Operator '${operator}' is not valid for boolean field. Allowed: ${Array.from(BOOLEAN_OPERATORS).join(', ')}`,
          );
        }
        break;
      default:
        throw new BadRequestException(`Unknown field data type: ${type}`);
    }
  }

  private assertValidTargetValueForType(
    operator: string,
    target: unknown,
    type: FieldDataType,
  ): void {
    if (operator === 'IN' || operator === 'NOT_IN') {
      if (!Array.isArray(target) || target.length === 0) {
        throw new BadRequestException(`Operator '${operator}' requires a non-empty target array`);
      }
      for (const item of target) {
        if (type === 'NUMBER' && (typeof item !== 'number' || !Number.isFinite(item))) {
          throw new BadRequestException(
            "All items in 'IN' array must be finite numbers for numeric field",
          );
        }
        if (type === 'STRING' && typeof item !== 'string') {
          throw new BadRequestException(
            'All items in target array must be strings for string field',
          );
        }
      }
      return;
    }

    if (type === 'NUMBER' && (typeof target !== 'number' || !Number.isFinite(target))) {
      throw new BadRequestException(
        `Numeric comparison requires finite number target, received: ${typeof target}`,
      );
    }
    if (type === 'STRING' && typeof target !== 'string') {
      throw new BadRequestException(
        `String comparison requires string target, received: ${typeof target}`,
      );
    }
    if (type === 'BOOLEAN' && typeof target !== 'boolean') {
      throw new BadRequestException(
        `Boolean comparison requires boolean target, received: ${typeof target}`,
      );
    }
  }

  private assertTypeMatch(
    fieldName: string,
    actualValue: unknown,
    expectedType: FieldDataType,
    operator: string,
    targetValue: unknown,
  ): void {
    const actualJsType = typeof actualValue;

    if (expectedType === 'NUMBER') {
      if (actualJsType !== 'number' || !Number.isFinite(actualValue as number)) {
        throw new BadRequestException(
          `Type mismatch on field '${fieldName}': expected finite number, received ${actualJsType} (${String(actualValue)})`,
        );
      }
      if (operator === 'IN') {
        if (!Array.isArray(targetValue)) {
          throw new BadRequestException("Operator 'IN' requires target array");
        }
      } else if (typeof targetValue !== 'number') {
        throw new BadRequestException(
          `Type mismatch: cannot compare numeric field '${fieldName}' against ${typeof targetValue} target with '${operator}'`,
        );
      } else if (!Number.isFinite(targetValue)) {
        throw new BadRequestException(
          `Numeric comparison operator '${operator}' requires target value to be a finite number, received: ${targetValue}`,
        );
      }
    } else if (expectedType === 'STRING') {
      if (actualJsType !== 'string') {
        throw new BadRequestException(
          `Type mismatch on field '${fieldName}': expected string, received ${actualJsType} (${String(actualValue)})`,
        );
      }
      if (operator === 'IN' || operator === 'NOT_IN') {
        if (!Array.isArray(targetValue)) {
          throw new BadRequestException(`Operator '${operator}' requires target array`);
        }
      } else if (typeof targetValue !== 'string') {
        throw new BadRequestException(
          `Type mismatch: cannot compare string field '${fieldName}' against ${typeof targetValue} target with '${operator}'`,
        );
      }
    } else if (expectedType === 'BOOLEAN') {
      if (actualJsType !== 'boolean') {
        throw new BadRequestException(
          `Type mismatch on field '${fieldName}': expected boolean, received ${actualJsType} (${String(actualValue)})`,
        );
      }
      if (typeof targetValue !== 'boolean') {
        throw new BadRequestException(
          `Type mismatch: cannot compare boolean field '${fieldName}' against ${typeof targetValue} target with '${operator}'`,
        );
      }
    }
  }

  private assertPayloadSize(requestData: Record<string, unknown>): void {
    try {
      const payloadStr = JSON.stringify(requestData ?? {});
      const payloadBytes = Buffer.byteLength(payloadStr, 'utf8');
      if (payloadBytes > MAX_PAYLOAD_BYTES) {
        throw new BadRequestException(
          `Payload size of ${payloadBytes} bytes exceeds maximum allowed limit of ${MAX_PAYLOAD_BYTES} bytes (32 KB)`,
        );
      }
    } catch (err) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      throw new BadRequestException('Unable to serialize requestData to verify payload size limit');
    }
  }

  private assertSafePropertyKey(field: string): void {
    if (
      PROTOTYPE_POLLUTION_KEYS.has(field) ||
      field.includes('__proto__') ||
      field.includes('constructor') ||
      field.includes('prototype')
    ) {
      throw new BadRequestException(
        `Forbidden field identifier: prototype pollution attempt detected ('${field}')`,
      );
    }

    // Only allow alphanumeric characters, underscores, and dots (e.g. valid identifier names)
    if (!/^[a-zA-Z0-9_]+$/.test(field)) {
      throw new BadRequestException(
        `Invalid field identifier '${field}': must contain only alphanumeric characters and underscores`,
      );
    }
  }

  private inferFieldDataType(value: unknown): FieldDataType {
    if (typeof value === 'number') {
      return 'NUMBER';
    }
    if (typeof value === 'string') {
      return 'STRING';
    }
    if (typeof value === 'boolean') {
      return 'BOOLEAN';
    }
    throw new BadRequestException(`Unsupported value type: ${typeof value}`);
  }

  private isLogicalNode(node: AstNode): node is AstLogicalNode {
    return 'operator' in node && LOGICAL_OPERATORS.has((node as AstLogicalNode).operator);
  }

  private isComparisonNode(node: AstNode): node is AstComparisonNode {
    return 'field' in node && 'operator' in node && 'value' in node;
  }
}
