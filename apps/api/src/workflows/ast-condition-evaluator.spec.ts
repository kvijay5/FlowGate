import { BadRequestException } from '@nestjs/common';
import { AstConditionEvaluatorService } from './ast-condition-evaluator.service';
import { InputSchema, AstNode } from '@flowgate/shared-types';

describe('AstConditionEvaluatorService', () => {
  let evaluator: AstConditionEvaluatorService;

  const mockSchema: InputSchema = {
    fields: [
      { name: 'amount', label: 'Amount', type: 'NUMBER', required: true, minimum: 0 },
      { name: 'discount', label: 'Discount', type: 'NUMBER', required: false },
      {
        name: 'department',
        label: 'Department',
        type: 'STRING',
        required: true,
        allowedValues: ['ENGINEERING', 'LEGAL', 'FINANCE', 'MARKETING'],
      },
      { name: 'country', label: 'Country', type: 'STRING', required: false },
      { name: 'isCapEx', label: 'Is CapEx', type: 'BOOLEAN', required: true },
      { name: 'isUrgent', label: 'Is Urgent', type: 'BOOLEAN', required: false },
    ],
  };

  beforeEach(() => {
    evaluator = new AstConditionEvaluatorService();
  });

  // ===========================================================================
  // 1. NUMERIC OPERATORS (13+ Cases)
  // ===========================================================================
  describe('1. Numeric Comparison Operators', () => {
    it('evaluates EQ / == correctly (true and false)', () => {
      const astEq: AstNode = { field: 'amount', operator: 'EQ', value: 1000 };
      const astSymbol: AstNode = { field: 'amount', operator: '==', value: 1000 };

      expect(evaluator.evaluate(astEq, { amount: 1000 }).result).toBe(true);
      expect(evaluator.evaluate(astEq, { amount: 2000 }).result).toBe(false);
      expect(evaluator.evaluate(astSymbol, { amount: 1000 }).result).toBe(true);
      expect(evaluator.evaluate(astSymbol, { amount: 500 }).result).toBe(false);
    });

    it('evaluates NEQ / != correctly (true and false)', () => {
      const astNeq: AstNode = { field: 'amount', operator: 'NEQ', value: 1000 };
      const astSymbol: AstNode = { field: 'amount', operator: '!=', value: 1000 };

      expect(evaluator.evaluate(astNeq, { amount: 2000 }).result).toBe(true);
      expect(evaluator.evaluate(astNeq, { amount: 1000 }).result).toBe(false);
      expect(evaluator.evaluate(astSymbol, { amount: 2000 }).result).toBe(true);
      expect(evaluator.evaluate(astSymbol, { amount: 1000 }).result).toBe(false);
    });

    it('evaluates GT / > correctly (true and false)', () => {
      const astGt: AstNode = { field: 'amount', operator: 'GT', value: 5000 };
      const astSymbol: AstNode = { field: 'amount', operator: '>', value: 5000 };

      expect(evaluator.evaluate(astGt, { amount: 5001 }).result).toBe(true);
      expect(evaluator.evaluate(astGt, { amount: 5000 }).result).toBe(false);
      expect(evaluator.evaluate(astSymbol, { amount: 10000 }).result).toBe(true);
      expect(evaluator.evaluate(astSymbol, { amount: 2000 }).result).toBe(false);
    });

    it('evaluates GTE / >= correctly (true and false)', () => {
      const astGte: AstNode = { field: 'amount', operator: 'GTE', value: 5000 };
      const astSymbol: AstNode = { field: 'amount', operator: '>=', value: 5000 };

      expect(evaluator.evaluate(astGte, { amount: 5000 }).result).toBe(true);
      expect(evaluator.evaluate(astGte, { amount: 5001 }).result).toBe(true);
      expect(evaluator.evaluate(astGte, { amount: 4999 }).result).toBe(false);
      expect(evaluator.evaluate(astSymbol, { amount: 5000 }).result).toBe(true);
      expect(evaluator.evaluate(astSymbol, { amount: 4000 }).result).toBe(false);
    });

    it('evaluates LT / < correctly (true and false)', () => {
      const astLt: AstNode = { field: 'amount', operator: 'LT', value: 1000 };
      const astSymbol: AstNode = { field: 'amount', operator: '<', value: 1000 };

      expect(evaluator.evaluate(astLt, { amount: 999 }).result).toBe(true);
      expect(evaluator.evaluate(astLt, { amount: 1000 }).result).toBe(false);
      expect(evaluator.evaluate(astSymbol, { amount: 500 }).result).toBe(true);
      expect(evaluator.evaluate(astSymbol, { amount: 1500 }).result).toBe(false);
    });

    it('evaluates LTE / <= correctly (true and false)', () => {
      const astLte: AstNode = { field: 'amount', operator: 'LTE', value: 1000 };
      const astSymbol: AstNode = { field: 'amount', operator: '<=', value: 1000 };

      expect(evaluator.evaluate(astLte, { amount: 1000 }).result).toBe(true);
      expect(evaluator.evaluate(astLte, { amount: 999 }).result).toBe(true);
      expect(evaluator.evaluate(astLte, { amount: 1001 }).result).toBe(false);
      expect(evaluator.evaluate(astSymbol, { amount: 1000 }).result).toBe(true);
      expect(evaluator.evaluate(astSymbol, { amount: 1001 }).result).toBe(false);
    });

    it('evaluates numeric IN correctly (true and false)', () => {
      const astIn: AstNode = { field: 'amount', operator: 'IN', value: [100, 200, 300] };

      expect(evaluator.evaluate(astIn, { amount: 200 }).result).toBe(true);
      expect(evaluator.evaluate(astIn, { amount: 250 }).result).toBe(false);
    });
  });

  // ===========================================================================
  // 2. STRING OPERATORS (8+ Cases)
  // ===========================================================================
  describe('2. String Comparison Operators', () => {
    it('evaluates string EQ / == and NEQ / != correctly', () => {
      const astEq: AstNode = { field: 'department', operator: 'EQ', value: 'LEGAL' };
      const astSymbolEq: AstNode = { field: 'department', operator: '==', value: 'LEGAL' };
      const astNeq: AstNode = { field: 'department', operator: 'NEQ', value: 'LEGAL' };
      const astSymbolNeq: AstNode = { field: 'department', operator: '!=', value: 'LEGAL' };

      expect(evaluator.evaluate(astEq, { department: 'LEGAL' }).result).toBe(true);
      expect(evaluator.evaluate(astEq, { department: 'FINANCE' }).result).toBe(false);
      expect(evaluator.evaluate(astSymbolEq, { department: 'LEGAL' }).result).toBe(true);
      expect(evaluator.evaluate(astNeq, { department: 'FINANCE' }).result).toBe(true);
      expect(evaluator.evaluate(astNeq, { department: 'LEGAL' }).result).toBe(false);
      expect(evaluator.evaluate(astSymbolNeq, { department: 'FINANCE' }).result).toBe(true);
    });

    it('evaluates string IN and NOT_IN correctly', () => {
      const astIn: AstNode = {
        field: 'department',
        operator: 'IN',
        value: ['LEGAL', 'FINANCE'],
      };
      const astNotIn: AstNode = {
        field: 'department',
        operator: 'NOT_IN',
        value: ['MARKETING'],
      };

      expect(evaluator.evaluate(astIn, { department: 'LEGAL' }).result).toBe(true);
      expect(evaluator.evaluate(astIn, { department: 'ENGINEERING' }).result).toBe(false);
      expect(evaluator.evaluate(astNotIn, { department: 'ENGINEERING' }).result).toBe(true);
      expect(evaluator.evaluate(astNotIn, { department: 'MARKETING' }).result).toBe(false);
    });

    it('evaluates CONTAINS correctly', () => {
      const astContains: AstNode = { field: 'department', operator: 'CONTAINS', value: 'GIN' };

      expect(evaluator.evaluate(astContains, { department: 'ENGINEERING' }).result).toBe(true);
      expect(evaluator.evaluate(astContains, { department: 'FINANCE' }).result).toBe(false);
    });

    it('evaluates STARTS_WITH correctly', () => {
      const astStarts: AstNode = { field: 'department', operator: 'STARTS_WITH', value: 'ENG' };

      expect(evaluator.evaluate(astStarts, { department: 'ENGINEERING' }).result).toBe(true);
      expect(evaluator.evaluate(astStarts, { department: 'FINANCE' }).result).toBe(false);
    });

    it('evaluates ENDS_WITH correctly', () => {
      const astEnds: AstNode = { field: 'department', operator: 'ENDS_WITH', value: 'RING' };

      expect(evaluator.evaluate(astEnds, { department: 'ENGINEERING' }).result).toBe(true);
      expect(evaluator.evaluate(astEnds, { department: 'LEGAL' }).result).toBe(false);
    });
  });

  // ===========================================================================
  // 3. BOOLEAN OPERATORS (4+ Cases)
  // ===========================================================================
  describe('3. Boolean Comparison Operators', () => {
    it('evaluates boolean EQ / == and NEQ / != correctly', () => {
      const astTrue: AstNode = { field: 'isCapEx', operator: 'EQ', value: true };
      const astSymbolTrue: AstNode = { field: 'isCapEx', operator: '==', value: true };
      const astNeq: AstNode = { field: 'isCapEx', operator: 'NEQ', value: true };
      const astSymbolNeq: AstNode = { field: 'isCapEx', operator: '!=', value: true };

      expect(evaluator.evaluate(astTrue, { isCapEx: true }).result).toBe(true);
      expect(evaluator.evaluate(astTrue, { isCapEx: false }).result).toBe(false);
      expect(evaluator.evaluate(astSymbolTrue, { isCapEx: true }).result).toBe(true);
      expect(evaluator.evaluate(astNeq, { isCapEx: false }).result).toBe(true);
      expect(evaluator.evaluate(astNeq, { isCapEx: true }).result).toBe(false);
      expect(evaluator.evaluate(astSymbolNeq, { isCapEx: false }).result).toBe(true);
    });
  });

  // ===========================================================================
  // 4. LOGICAL COMPOUND OPERATORS & NESTING (6+ Cases)
  // ===========================================================================
  describe('4. Logical Compound Operators (AND, OR, NOT)', () => {
    it('evaluates compound AND correctly', () => {
      const astAnd: AstNode = {
        operator: 'AND',
        children: [
          { field: 'amount', operator: 'GT', value: 5000 },
          { field: 'department', operator: 'EQ', value: 'FINANCE' },
        ],
      };

      expect(evaluator.evaluate(astAnd, { amount: 6000, department: 'FINANCE' }).result).toBe(true);
      expect(evaluator.evaluate(astAnd, { amount: 4000, department: 'FINANCE' }).result).toBe(
        false,
      );
      expect(evaluator.evaluate(astAnd, { amount: 6000, department: 'LEGAL' }).result).toBe(false);
    });

    it('evaluates compound OR correctly', () => {
      const astOr: AstNode = {
        operator: 'OR',
        children: [
          { field: 'amount', operator: 'GT', value: 10000 },
          { field: 'isCapEx', operator: 'EQ', value: true },
        ],
      };

      expect(evaluator.evaluate(astOr, { amount: 15000, isCapEx: false }).result).toBe(true);
      expect(evaluator.evaluate(astOr, { amount: 2000, isCapEx: true }).result).toBe(true);
      expect(evaluator.evaluate(astOr, { amount: 2000, isCapEx: false }).result).toBe(false);
    });

    it('evaluates logical NOT correctly', () => {
      const astNot: AstNode = {
        operator: 'NOT',
        children: [{ field: 'department', operator: 'EQ', value: 'LEGAL' }],
      };

      expect(evaluator.evaluate(astNot, { department: 'FINANCE' }).result).toBe(true);
      expect(evaluator.evaluate(astNot, { department: 'LEGAL' }).result).toBe(false);
    });

    it('evaluates nested logical expressions up to depth 5 correctly', () => {
      // Depth 1: AND
      // Depth 2: OR
      // Depth 3: AND
      // Depth 4: NOT
      // Depth 5: Comparison
      const astDepth5: AstNode = {
        operator: 'AND',
        children: [
          {
            operator: 'OR',
            children: [
              {
                operator: 'AND',
                children: [
                  {
                    operator: 'NOT',
                    children: [{ field: 'amount', operator: 'LT', value: 100 }],
                  },
                ],
              },
            ],
          },
        ],
      };

      expect(evaluator.evaluate(astDepth5, { amount: 500 }).result).toBe(true);
      expect(evaluator.evaluate(astDepth5, { amount: 50 }).result).toBe(false);
    });
  });

  // ===========================================================================
  // 5. SECURITY & ARCHITECTURAL GUARDS (12+ Cases)
  // ===========================================================================
  describe('5. Security, Payload & Depth Guardrails', () => {
    it('rejects AST with depth > 5 deterministically', () => {
      // Depth 6 tree
      const astDepth6: AstNode = {
        operator: 'AND',
        children: [
          {
            operator: 'OR',
            children: [
              {
                operator: 'AND',
                children: [
                  {
                    operator: 'OR',
                    children: [
                      {
                        operator: 'NOT',
                        children: [{ field: 'amount', operator: 'GT', value: 10 }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      expect(() => evaluator.validateAst(astDepth6)).toThrow(BadRequestException);
      expect(() => evaluator.validateAst(astDepth6)).toThrow(/exceeds maximum allowed limit of 5/);
      expect(() => evaluator.evaluate(astDepth6, { amount: 50 })).toThrow(BadRequestException);
    });

    it('rejects requestData payload larger than 32 KB (32,768 bytes)', () => {
      const ast: AstNode = { field: 'amount', operator: 'GT', value: 100 };
      const largeString = 'a'.repeat(33 * 1024); // 33 KB
      const oversizedPayload = { amount: 500, extraData: largeString };

      expect(() => evaluator.evaluate(ast, oversizedPayload)).toThrow(BadRequestException);
      expect(() => evaluator.evaluate(ast, oversizedPayload)).toThrow(
        /exceeds maximum allowed limit of 32768 bytes/,
      );
    });

    it('accepts requestData payload exactly within 32 KB', () => {
      const ast: AstNode = { field: 'amount', operator: 'GT', value: 100 };
      // 30 KB payload
      const validLargePayload = { amount: 500, extraData: 'x'.repeat(30 * 1024) };

      expect(evaluator.evaluate(ast, validLargePayload).result).toBe(true);
    });

    it('blocks prototype pollution keys in field identifier', () => {
      const pollutedAst1: AstNode = { field: '__proto__', operator: 'EQ', value: 'hack' };
      const pollutedAst2: AstNode = { field: 'constructor', operator: 'EQ', value: 'hack' };
      const pollutedAst3: AstNode = { field: 'prototype', operator: 'EQ', value: 'hack' };

      expect(() => evaluator.evaluate(pollutedAst1, { amount: 100 })).toThrow(
        /prototype pollution attempt detected/,
      );
      expect(() => evaluator.evaluate(pollutedAst2, { amount: 100 })).toThrow(
        /prototype pollution attempt detected/,
      );
      expect(() => evaluator.evaluate(pollutedAst3, { amount: 100 })).toThrow(
        /prototype pollution attempt detected/,
      );
    });

    it('rejects invalid field characters (SQL/script injection characters)', () => {
      const badFieldAst: AstNode = {
        field: 'amount; DROP TABLE users;',
        operator: 'GT',
        value: 100,
      };

      expect(() => evaluator.evaluate(badFieldAst, { amount: 200 })).toThrow(
        /Invalid field identifier/,
      );
    });
  });

  // ===========================================================================
  // 6. STRICT TYPE CHECKING & ZERO IMPLICIT COERCION (8+ Cases)
  // ===========================================================================
  describe('6. Strict Type Checking (Zero JS Coercion)', () => {
    it('rejects string comparison against a number field', () => {
      const ast: AstNode = { field: 'amount', operator: 'GT', value: '5000' as any };

      expect(() => evaluator.evaluate(ast, { amount: 6000 }, mockSchema)).toThrow(
        /Numeric comparison requires finite number target/,
      );
    });

    it('rejects string value in payload for number field (no string-to-number coercion)', () => {
      const ast: AstNode = { field: 'amount', operator: 'GT', value: 5000 };

      expect(() => evaluator.evaluate(ast, { amount: '6000' as any }, mockSchema)).toThrow(
        /Type mismatch on field 'amount': expected finite number/,
      );
    });

    it('rejects NaN, Infinity, -Infinity in numeric comparison', () => {
      const astNaN: AstNode = { field: 'amount', operator: 'GT', value: NaN };
      const astInf: AstNode = { field: 'amount', operator: 'GT', value: Infinity };

      expect(() => evaluator.evaluate(astNaN, { amount: 100 })).toThrow(
        /requires target value to be a finite number/,
      );
      expect(() => evaluator.evaluate(astInf, { amount: 100 })).toThrow(
        /requires target value to be a finite number/,
      );
      expect(() =>
        evaluator.evaluate({ field: 'amount', operator: 'GT', value: 100 }, { amount: NaN }),
      ).toThrow(/expected finite number/);
    });

    it('rejects comparing boolean with numeric operators like > or <', () => {
      const ast: AstNode = { field: 'isCapEx', operator: 'GT' as any, value: 1 };

      expect(() => evaluator.evaluate(ast, { isCapEx: true }, mockSchema)).toThrow(
        /Operator 'GT' is not valid for boolean field/,
      );
    });

    it('rejects string IN with non-array target', () => {
      const ast: AstNode = { field: 'department', operator: 'IN', value: 'LEGAL' as any };

      expect(() => evaluator.evaluate(ast, { department: 'LEGAL' }, mockSchema)).toThrow(
        /requires a non-empty target array/,
      );
    });

    it('rejects missing required field in requestData', () => {
      const ast: AstNode = { field: 'amount', operator: 'GT', value: 100 };

      expect(() => evaluator.evaluate(ast, {}, mockSchema)).toThrow(
        /Required field 'amount' is missing or null/,
      );
    });

    it('handles optional missing field strictly without crashing', () => {
      const ast: AstNode = { field: 'discount', operator: 'EQ', value: 50 };

      // Field is null/undefined in payload, not equal to 50
      expect(evaluator.evaluate(ast, {}, mockSchema).result).toBe(false);
    });

    it('rejects relational operators (> or <) on null values', () => {
      const ast: AstNode = { field: 'discount', operator: 'GT', value: 50 };

      expect(() => evaluator.evaluate(ast, { discount: null }, mockSchema)).toThrow(
        /Cannot apply comparison operator 'GT' to null/,
      );
    });
  });

  // ===========================================================================
  // 7. STATIC VALIDATION & MALFORMED AST HANDLING (6+ Cases)
  // ===========================================================================
  describe('7. Static AST Validation & Malformed ASTs', () => {
    it('validates valid AST against input schema successfully', () => {
      const validAst: AstNode = {
        operator: 'AND',
        children: [
          { field: 'amount', operator: 'GTE', value: 1000 },
          { field: 'department', operator: 'IN', value: ['LEGAL', 'FINANCE'] },
          { field: 'isCapEx', operator: 'EQ', value: true },
        ],
      };

      expect(() => evaluator.validateAst(validAst, mockSchema)).not.toThrow();
    });

    it('rejects undeclared fields not present in input schema', () => {
      const astWithUndeclaredField: AstNode = {
        field: 'unapprovedField',
        operator: 'EQ',
        value: 'test',
      };

      expect(() => evaluator.validateAst(astWithUndeclaredField, mockSchema)).toThrow(
        /Field 'unapprovedField' is not defined in the trigger input schema/,
      );
    });

    it('rejects empty children array for logical AND / OR', () => {
      const emptyAnd: AstNode = { operator: 'AND', children: [] };
      const emptyOr: AstNode = { operator: 'OR', children: [] };

      expect(() => evaluator.validateAst(emptyAnd)).toThrow(/must have at least one child node/);
      expect(() => evaluator.validateAst(emptyOr)).toThrow(/must have at least one child node/);
    });

    it('rejects logical NOT with more than 1 child', () => {
      const multiNot: AstNode = {
        operator: 'NOT',
        children: [
          { field: 'amount', operator: 'GT', value: 100 },
          { field: 'isCapEx', operator: 'EQ', value: true },
        ],
      };

      expect(() => evaluator.validateAst(multiNot)).toThrow(/must have exactly 1 child node/);
    });

    it('rejects completely invalid/unknown operator', () => {
      const badOpAst: AstNode = { field: 'amount', operator: 'REGEX_MATCH' as any, value: '.*' };

      expect(() => evaluator.validateAst(badOpAst)).toThrow(
        /Unsupported comparison operator: 'REGEX_MATCH'/,
      );
    });

    it('returns structured trace metadata for audit logging', () => {
      const ast: AstNode = {
        operator: 'AND',
        children: [
          { field: 'amount', operator: 'GT', value: 1000 },
          { field: 'department', operator: 'EQ', value: 'FINANCE' },
        ],
      };

      const { result, trace } = evaluator.evaluate(ast, {
        amount: 5000,
        department: 'FINANCE',
      });

      expect(result).toBe(true);
      expect(trace.nodeType).toBe('LOGICAL');
      expect(trace.operator).toBe('AND');
      expect(trace.result).toBe(true);
      expect(trace.children).toHaveLength(2);
      expect(trace.children![0].field).toBe('amount');
      expect(trace.children![0].fieldValue).toBe(5000);
      expect(trace.children![0].expectedValue).toBe(1000);
      expect(trace.children![0].result).toBe(true);
      expect(trace.children![1].field).toBe('department');
      expect(trace.children![1].fieldValue).toBe('FINANCE');
      expect(trace.children![1].result).toBe(true);
      expect(trace.evaluatedAt).toBeDefined();
    });
  });
});
