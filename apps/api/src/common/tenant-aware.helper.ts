/**
 * Reusable Tenant Context and Query Scoping Helper
 *
 * Guarantees that database queries are strictly scoped to the authenticated tenant.
 */

export class TenantContextHelper {
  /**
   * Enforces that the query payload or where-clause includes the authenticated tenantId.
   */
  static scopeWhere<T extends Record<string, any>>(
    tenantId: string,
    whereClause: T = {} as T,
  ): T & { tenantId: string } {
    if (!tenantId) {
      throw new Error('TenantContextHelper: tenantId is required for tenant-scoped operations');
    }
    return {
      ...whereClause,
      tenantId,
    };
  }

  /**
   * Enforces that creation data attaches the authenticated tenantId.
   */
  static scopeCreate<T extends Record<string, any>>(
    tenantId: string,
    data: T,
  ): T & { tenantId: string } {
    if (!tenantId) {
      throw new Error('TenantContextHelper: tenantId is required for tenant-scoped creation');
    }
    return {
      ...data,
      tenantId,
    };
  }
}
