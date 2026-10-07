/**
 * The console's tabs and privileged actions, expressed as permission keys.
 *
 * Every entry here becomes a row in the Roles screen: admins tick the roles
 * that should see that tab (or be allowed to perform that action). The API
 * enforces the same keys with `requireFeature`, so hiding a tab is not the
 * only thing the checkbox does.
 */

export interface DashboardFeature {
  /** Stable key stored in `role_permissions.feature_key`. */
  key: string;
  label: string;
  /** Section the row is grouped under in the Roles screen. */
  group: 'Tabs' | 'Actions';
  description: string;
}

export const DASHBOARD_FEATURES: readonly DashboardFeature[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    group: 'Tabs',
    description: 'Home overview of sessions, escalations and resolution rate.',
  },
  {
    key: 'sessions',
    label: 'Sessions',
    group: 'Tabs',
    description: 'Browse Slack troubleshooting sessions and open their transcripts.',
  },
  {
    key: 'escalations',
    label: 'Escalations',
    group: 'Tabs',
    description: 'Tickets handed over to IT with their SLA status.',
  },
  {
    key: 'issue-categories',
    label: 'Issue Categories',
    group: 'Tabs',
    description: 'Issue taxonomy, per-category reporting and overrides.',
  },
  {
    key: 'articles',
    label: 'Knowledge Base',
    group: 'Tabs',
    description: 'Articles, guides and uploaded documents.',
  },
  {
    key: 'ai',
    label: 'AI Providers',
    group: 'Tabs',
    description: 'Provider configuration and fallback order (read only for non-admins).',
  },
  {
    key: 'logs',
    label: 'Logs',
    group: 'Tabs',
    description: 'Application log stream and audit trail.',
  },
  {
    key: 'settings',
    label: 'Settings',
    group: 'Tabs',
    description: 'Slack, troubleshooting and system settings (saving stays admin only).',
  },
  {
    key: 'users',
    label: 'Users',
    group: 'Tabs',
    description: 'Console accounts and their roles.',
  },
  {
    key: 'roles',
    label: 'Roles & Permissions',
    group: 'Tabs',
    description: 'This screen. Editing roles and permissions still requires an administrator.',
  },
  {
    key: 'articles.manage',
    label: 'Create, edit and delete articles',
    group: 'Actions',
    description: 'Implies the Knowledge Base tab is useful; article writes stay admin only unless ticked.',
  },
  {
    key: 'sessions.manage',
    label: 'Change session status and add notes',
    group: 'Actions',
    description: 'Actions column on the Sessions list.',
  },
  {
    key: 'issue-categories.manage',
    label: 'Override a session issue category',
    group: 'Actions',
    description: 'Re-categorize an already classified session.',
  },
  {
    key: 'users.manage',
    label: 'Create, edit and deactivate users',
    group: 'Actions',
    description: 'Granting the administrator role to somebody still requires an administrator.',
  },
  {
    key: 'logs.clear',
    label: 'Purge logs',
    group: 'Actions',
    description: 'Deletes log rows for the selected level.',
  },
];

export type DashboardFeatureKey = (typeof DASHBOARD_FEATURES)[number]['key'];

export const FEATURE_KEYS: readonly string[] = DASHBOARD_FEATURES.map((feature) => feature.key);

/** Roles that can never be deleted. */
export const SYSTEM_ROLE_KEYS = ['admin', 'viewer'] as const;

/** The role used when a role is deleted or a user is created without one. */
export const FALLBACK_ROLE_KEY = 'viewer';

export function isFeatureKey(value: string): boolean {
  return FEATURE_KEYS.includes(value);
}

/**
 * A freshly created role starts with everything visible; admins then untick
 * what the role should not see. Missing rows (e.g. after a feature is added)
 * also default to visible so a new tab never silently disappears.
 */
export function defaultPermissionFor(featureKey: string, roleKey: string): boolean {
  if (roleKey === 'admin') return true;
  if (featureKey === 'roles') return false;
  return !featureKey.includes('.');
}
