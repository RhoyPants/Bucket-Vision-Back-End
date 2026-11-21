import { ProjectStatus } from "@prisma/client";

/**
 * Project Access: which projects a role can see.
 *
 * Settings are stored as keys on a role (`RoleProjectAccess`). The keys are defined here, and the
 * Settings screen is built from `buildDefinitions()`, so adding a checkbox means adding a key here
 * and reading it in `resolveConfig`; no screen or table changes.
 *
 *  - scope.*  : which projects, beyond the ones a person owns or belongs to (which they always see).
 *  - status.* : which project statuses are visible through those wider scopes. A person always sees
 *               their own projects in any status.
 *  - list.status.* : which statuses the Projects page (the project directory) lists for the role. This is
 *               what you browse, separate from what you may open.
 *  - meta.configured : marks that the role's access was saved or synced on purpose. Without it the
 *               role is "not synced yet" and uses the defaults below, so nobody loses access before
 *               an admin syncs the role.
 */
export const SCOPE_OWN = "scope.own"; // always on, never stored
export const SCOPE_BUSINESS_UNIT = "scope.business_unit";
export const SCOPE_ALL = "scope.all";
export const META_CONFIGURED = "meta.configured";
/** Set when the Projects page statuses were saved on purpose (roles saved before they existed use the defaults). */
export const META_LIST_CONFIGURED = "meta.list_configured";

export const ALL_STATUSES = Object.values(ProjectStatus) as ProjectStatus[];
export const statusKey = (status: string) => `status.${status}`;
export const LIST_STATUS_PREFIX = "list.status.";
export const listStatusKey = (status: string) => `${LIST_STATUS_PREFIX}${status}`;

const STATUS_LABELS: Record<string, { label: string; description: string }> = {
  DRAFT: { label: "Draft", description: "Projects still being prepared by their owner." },
  FOR_REVIEW: { label: "For review", description: "Submitted and waiting for the Business Unit Head." },
  FOR_APPROVAL: { label: "For approval", description: "Reviewed and waiting for final approval." },
  ACTIVE: { label: "Active", description: "Approved and running." },
  COMPLETED: { label: "Completed", description: "Finished projects." },
  CANCELLED: { label: "Cancelled", description: "Projects that were cancelled." },
  INACTIVE: { label: "Inactive", description: "Projects put on hold." },
  REJECTED: { label: "Rejected", description: "Projects that were turned down." },
  NEEDS_REVISION: { label: "Needs revision", description: "Sent back to the owner for changes." },
  ARCHIVED: { label: "Archived", description: "Old projects kept for reference." },
};

const titleCase = (value: string) =>
  value.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export interface AccessItem {
  key: string;
  label: string;
  description: string;
  /** Always on and cannot be changed. */
  locked?: boolean;
  /** Turning this on also turns these on. */
  implies?: string[];
}

export interface AccessGroup {
  id: "scope" | "status" | "list";
  title: string;
  description: string;
  /** The group only has an effect when at least one of these keys is on. */
  enabledWhenAny?: string[];
  /**
   * Not shown in Settings. Its keys still exist and are enforced, but they are always saved ticked
   * (see `hiddenKeys`), so it behaves as "everything allowed" until someone chooses to show it again.
   */
  hidden?: boolean;
  items: AccessItem[];
}

export function buildDefinitions(): AccessGroup[] {
  return [
    {
      id: "scope",
      title: "Which projects can this role see?",
      description: "Choose how far this role can see beyond the projects its people own or belong to.",
      items: [
        {
          key: SCOPE_OWN,
          label: "Projects they own or are a member of",
          description: "Always on.",
          locked: true,
        },
        {
          key: SCOPE_BUSINESS_UNIT,
          label: "Projects in their business unit",
          description: "Every project of the business unit the person belongs to, whoever owns it.",
        },
        {
          key: SCOPE_ALL,
          label: "All projects",
          description: "Every project in the system.",
          implies: [SCOPE_BUSINESS_UNIT],
        },
      ],
    },
    {
      id: "status",
      title: "Which project statuses can they see?",
      description:
        "Applies to the projects seen through the wider access above. People always see their own projects in any status.",
      enabledWhenAny: [SCOPE_BUSINESS_UNIT, SCOPE_ALL],
      // Hidden for now: every role can open every status of the projects it has access to. The Projects
      // page list below is the only status setting shown.
      hidden: true,
      items: ALL_STATUSES.map((status) => ({
        key: statusKey(status),
        label: STATUS_LABELS[status]?.label ?? titleCase(status),
        description: STATUS_LABELS[status]?.description ?? "",
      })),
    },
    {
      id: "list",
      title: "Which statuses are listed on the Projects page?",
      description:
        "What this role sees when browsing the Projects page. This is separate from what it can open: a person can still open any project they have access to, for example from My Drafts or a link.",
      items: ALL_STATUSES.map((status) => ({
        key: listStatusKey(status),
        label: STATUS_LABELS[status]?.label ?? titleCase(status),
        description: "",
      })),
    },
  ];
}

/** Keys of hidden groups: not offered in Settings, and always saved ticked. */
export function hiddenKeys(): string[] {
  return buildDefinitions().filter((group) => group.hidden).flatMap((group) => group.items.map((item) => item.key));
}

/** Keys an admin can switch (everything except the locked, always-on ones). */
export function storableKeys(): Set<string> {
  return new Set(
    buildDefinitions().flatMap((group) => group.items.filter((item) => !item.locked).map((item) => item.key)),
  );
}

/**
 * The starting point for a role, reproducing how access worked before it became configurable.
 * Used by the Sync button, and by roles that have not been synced yet. This is the only place that
 * knows role names; once a role is synced its saved keys decide.
 *   SUPERADMIN, OP : every project
 *   BU_HEAD        : every project of their business unit
 *   anyone else    : only the projects they own or belong to
 * Every status is allowed to be opened; the Projects page lists everything for SUPERADMIN and BU_HEAD and
 * only Active projects for the rest.
 */
/**
 * Statuses the Projects page lists by default: everything for SUPERADMIN and BU_HEAD, Active only for
 * everyone else (this is what the page used to force in the browser).
 */
export function defaultListKeysForRoleName(roleName: string): string[] {
  if (roleName === "SUPERADMIN" || roleName === "BU_HEAD") return ALL_STATUSES.map(listStatusKey);
  return [listStatusKey(ProjectStatus.ACTIVE)];
}

export function defaultKeysForRoleName(roleName: string): string[] {
  const keys = [...ALL_STATUSES.map(statusKey), ...defaultListKeysForRoleName(roleName)];
  if (roleName === "SUPERADMIN" || roleName === "OP") keys.push(SCOPE_ALL, SCOPE_BUSINESS_UNIT);
  else if (roleName === "BU_HEAD") keys.push(SCOPE_BUSINESS_UNIT);
  return keys;
}

export interface RoleProjectAccessConfig {
  /** Sees every project (through the allowed statuses). */
  scopeAll: boolean;
  /** Sees every project of their own business unit (through the allowed statuses). */
  scopeBusinessUnit: boolean;
  /** Statuses visible through the wider scopes. */
  statuses: ProjectStatus[];
  /** True when every status is allowed, so no status filter is needed. */
  allStatuses: boolean;
  /** Statuses the Projects page lists. */
  listStatuses: ProjectStatus[];
  /** True when the Projects page lists every status, so no filter is needed. */
  listAllStatuses: boolean;
}

/** Turns keys into the rules the query builder uses. */
export function resolveConfig(keys: Iterable<string>): RoleProjectAccessConfig {
  const set = new Set(keys);
  const scopeAll = set.has(SCOPE_ALL);
  const scopeBusinessUnit = scopeAll || set.has(SCOPE_BUSINESS_UNIT);
  const statuses = ALL_STATUSES.filter((status) => set.has(statusKey(status)));
  const listStatuses = ALL_STATUSES.filter((status) => set.has(listStatusKey(status)));
  return {
    scopeAll,
    scopeBusinessUnit,
    statuses,
    allStatuses: statuses.length === ALL_STATUSES.length,
    listStatuses,
    listAllStatuses: listStatuses.length === ALL_STATUSES.length,
  };
}

/** Adds what the chosen keys imply (e.g. All projects includes the business unit). */
export function expandImplied(keys: Iterable<string>): string[] {
  const out = new Set(keys);
  for (const item of buildDefinitions().flatMap((g) => g.items)) {
    if (out.has(item.key)) item.implies?.forEach((k) => out.add(k));
  }
  return Array.from(out);
}
