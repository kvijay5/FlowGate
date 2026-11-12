export interface DemoPersona {
  id: string;
  name: string;
  initials: string;
  email: string;
  password?: string;
  role: 'TENANT_ADMIN' | 'APPROVER' | 'REQUESTER' | 'SUPER_ADMIN';
  roleLabel: string;
  department: string;
  tenantSlug: string;
  tenantName: string;
  description: string;
}

export const DEMO_PERSONAS: DemoPersona[] = [
  {
    id: 'acme-admin',
    name: 'Alice Vance',
    initials: 'AV',
    email: 'admin@acme.com',
    password: 'FlowGatePass123!',
    role: 'TENANT_ADMIN',
    roleLabel: 'Tenant Admin',
    department: 'Operations',
    tenantSlug: 'acme-corp',
    tenantName: 'Acme Corporation',
    description: 'Workflow authoring, tenant governance, and security policies',
  },
  {
    id: 'acme-cfo',
    name: 'Bob Finance',
    initials: 'BF',
    email: 'finance@acme.com',
    password: 'FlowGatePass123!',
    role: 'APPROVER',
    roleLabel: 'CFO / Primary Approver',
    department: 'Finance',
    tenantSlug: 'acme-corp',
    tenantName: 'Acme Corporation',
    description: 'Financial sign-offs, CapEx committee quorum, and delegation granter',
  },
  {
    id: 'acme-legal',
    name: 'Linda Legal',
    initials: 'LL',
    email: 'legal@acme.com',
    password: 'FlowGatePass123!',
    role: 'APPROVER',
    roleLabel: 'General Counsel / Stand-in',
    department: 'Legal',
    tenantSlug: 'acme-corp',
    tenantName: 'Acme Corporation',
    description: 'Compliance & contracts reviewer; active stand-in delegatee for Bob Finance',
  },
  {
    id: 'acme-engineer',
    name: 'Charlie Dev',
    initials: 'CD',
    email: 'engineer@acme.com',
    password: 'FlowGatePass123!',
    role: 'REQUESTER',
    roleLabel: 'Lead Infrastructure Engineer',
    department: 'Engineering',
    tenantSlug: 'acme-corp',
    tenantName: 'Acme Corporation',
    description: 'Intake submitter for CI/CD hardware purchases and software licenses',
  },
  {
    id: 'globex-admin',
    name: 'David Mercer',
    initials: 'DM',
    email: 'admin@globex.com',
    password: 'FlowGatePass123!',
    role: 'TENANT_ADMIN',
    roleLabel: 'Globex Security Admin',
    department: 'Corporate IT',
    tenantSlug: 'globex-ind',
    tenantName: 'Globex Industries',
    description:
      'Isolated secondary tenant illustrating strict cryptographic & query scoping boundaries',
  },
];
