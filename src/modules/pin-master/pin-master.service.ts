import { Prisma } from "@prisma/client";
import prisma from "../../config/prisma";

type SharePointListItem = {
  id: string;
  lastModifiedDateTime?: string;
  fields?: Record<string, unknown>;
};

async function getPinCatalogAccessToken() {
  const tenantId = process.env.SP_TENANT_ID;
  const clientId = process.env.SP_CLIENT_ID;
  const clientSecret = process.env.SP_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) throw new Error("Missing SharePoint PIN authentication configuration");
  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  const body: any = await response.json();
  if (!response.ok) throw new Error(body.error_description || "Unable to authenticate PIN catalog synchronization");
  return body.access_token as string;
}

const fieldNames = {
  pin: "PIN",
  projectName: "ProjectName",
  description: "ProjectDescription",
  businessUnit: "BusinessUnit",
  entity: "Entity",
  location: "Location",
  totalBudget: "Amount",
  startDate: "StartDate",
  expectedEndDate: "EndDate",
  isActive: "IsActive",
};

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  return result || null;
}

function optionalDate(value: unknown): Date | null {
  if (!value) return null;
  const result = new Date(String(value));
  return Number.isNaN(result.getTime()) ? null : result;
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function activeValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (typeof value === "boolean") return value;
  return !["false", "0", "no", "inactive"].includes(String(value).trim().toLowerCase());
}

function locationValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined || value === "") return Prisma.JsonNull;
  if (typeof value === "object") return value as Prisma.InputJsonValue;
  const text = String(value).trim();
  try {
    return JSON.parse(text) as Prisma.InputJsonValue;
  } catch {
    return { displayName: text };
  }
}

async function fetchSharePointItems(): Promise<SharePointListItem[]> {
  const siteId = process.env.SP_PIN_SITE_ID;
  const listId = process.env.SP_PIN_LIST_ID;
  if (!siteId || !listId) {
    throw new Error("Missing SharePoint PIN config: SP_PIN_SITE_ID and SP_PIN_LIST_ID are required");
  }

  const token = await getPinCatalogAccessToken();
  let url: string | undefined = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}/lists/${encodeURIComponent(listId)}/items?$expand=fields&$top=999`;
  const items: SharePointListItem[] = [];

  while (url) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body: any = await response.json();
    if (!response.ok) {
      throw new Error(`SharePoint PIN sync failed (${response.status}): ${JSON.stringify(body)}`);
    }
    items.push(...(body.value || []));
    url = body["@odata.nextLink"];
  }

  return items;
}

export class PinMasterService {
  async getDropdown(search?: string) {
    return prisma.pinMaster.findMany({
      where: {
        isActive: true,
        ...(search
          ? {
              OR: [
                { pin: { contains: search, mode: "insensitive" as const } },
                { projectName: { contains: search, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      select: {
        pin: true,
        projectName: true,
        description: true,
        businessUnit: true,
        entity: true,
        location: true,
        totalBudget: true,
        startDate: true,
        expectedEndDate: true,
      },
      orderBy: { pin: "asc" },
    });
  }

  async getByPin(pin: string) {
    return prisma.pinMaster.findUnique({ where: { pin } });
  }

  async syncFromSharePoint() {
    const items = await fetchSharePointItems();
    const now = new Date();
    const syncedItemIds: string[] = [];
    let skipped = 0;

    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        const fields = item.fields || {};
        const pin = optionalString(fields[fieldNames.pin]);
        if (!item.id || !pin) {
          skipped += 1;
          continue;
        }

        syncedItemIds.push(item.id);
        const data = {
          pin,
          projectName: optionalString(fields[fieldNames.projectName]),
          description: optionalString(fields[fieldNames.description]),
          businessUnit: optionalString(fields[fieldNames.businessUnit]),
          entity: optionalString(fields[fieldNames.entity]),
          location: locationValue(fields[fieldNames.location]),
          totalBudget: optionalNumber(fields[fieldNames.totalBudget]),
          startDate: optionalDate(fields[fieldNames.startDate]),
          expectedEndDate: optionalDate(fields[fieldNames.expectedEndDate]),
          isActive: activeValue(fields[fieldNames.isActive]),
          sharePointModifiedAt: optionalDate(item.lastModifiedDateTime),
          lastSyncedAt: now,
          rawData: fields as Prisma.InputJsonValue,
        };

        await tx.pinMaster.upsert({
          where: { sharePointItemId: item.id },
          create: { sharePointItemId: item.id, ...data },
          update: data,
        });
      }

      if (syncedItemIds.length) {
        await tx.pinMaster.updateMany({
          where: { sharePointItemId: { notIn: syncedItemIds } },
          data: { isActive: false, lastSyncedAt: now },
        });
      }
    });

    return { received: items.length, synced: syncedItemIds.length, skipped, syncedAt: now };
  }
}

export const pinMasterService = new PinMasterService();
