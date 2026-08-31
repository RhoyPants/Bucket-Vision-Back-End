import prisma from "../../config/prisma";
import { buildAccessibleProjectWhere } from "./project-access";
import { uploadBufferToSharePoint } from "../../services/sharepoint-upload.service";

const ANCHORS = [
  "TOP_LEFT", "TOP_CENTER", "TOP_RIGHT", "RIGHT_TOP", "RIGHT_CENTER", "RIGHT_BOTTOM",
  "BOTTOM_RIGHT", "BOTTOM_CENTER", "BOTTOM_LEFT", "LEFT_BOTTOM", "LEFT_CENTER", "LEFT_TOP",
] as const;
type Anchor = typeof ANCHORS[number];

type NodeInput = {
  clientId: string;
  parentClientId?: string | null;
  name?: string | null;
  position: string;
  sortOrder?: number;
  x?: number | null;
  y?: number | null;
  photoUrl?: string | null;
  parentAnchor?: Anchor;
  childAnchor?: Anchor;
  backgroundColor?: string | null;
  textColor?: string | null;
};

type ChartInput = { title: string; nodes: NodeInput[] };
const MAX_NODES = 500;

function normalize(input: ChartInput): { title: string; nodes: NodeInput[] } {
  const title = String(input?.title || "").trim();
  if (!title) throw new Error("Chart title is required");
  if (!Array.isArray(input?.nodes)) throw new Error("nodes must be an array");
  if (input.nodes.length > MAX_NODES) throw new Error(`A chart can contain at most ${MAX_NODES} nodes`);
  const ids = new Set<string>();
  const nodes = input.nodes.map((node, index) => {
    const clientId = String(node?.clientId || "").trim();
    const position = String(node?.position || "").trim();
    if (!clientId) throw new Error(`nodes[${index}].clientId is required`);
    if (!position) throw new Error(`nodes[${index}].position is required`);
    if (ids.has(clientId)) throw new Error(`Duplicate clientId: ${clientId}`);
    ids.add(clientId);
    const sortOrder = Number(node.sortOrder ?? 0);
    if (!Number.isInteger(sortOrder) || sortOrder < 0) throw new Error(`nodes[${index}].sortOrder must be a non-negative integer`);
    const x = node.x === undefined || node.x === null ? null : Number(node.x);
    const y = node.y === undefined || node.y === null ? null : Number(node.y);
    if (x !== null && !Number.isFinite(x)) throw new Error(`nodes[${index}].x must be a number`);
    if (y !== null && !Number.isFinite(y)) throw new Error(`nodes[${index}].y must be a number`);
    const photoUrl = node.photoUrl?.trim() || null;
    if (photoUrl && !/^https?:\/\//i.test(photoUrl)) throw new Error(`nodes[${index}].photoUrl must be an HTTP(S) URL`);
    const parentAnchor = (node.parentAnchor || "BOTTOM_CENTER") as Anchor;
    const childAnchor = (node.childAnchor || "TOP_CENTER") as Anchor;
    if (!ANCHORS.includes(parentAnchor)) throw new Error(`nodes[${index}].parentAnchor is invalid`);
    if (!ANCHORS.includes(childAnchor)) throw new Error(`nodes[${index}].childAnchor is invalid`);
    return {
      clientId,
      parentClientId: node.parentClientId ? String(node.parentClientId) : null,
      name: node.name?.trim() || null,
      position,
      sortOrder,
      x,
      y,
      photoUrl,
      parentAnchor,
      childAnchor,
      backgroundColor: node.backgroundColor?.trim() || null,
      textColor: node.textColor?.trim() || null,
    };
  });
  const roots = nodes.filter((node) => !node.parentClientId);
  if (nodes.length && roots.length !== 1) throw new Error("Exactly one root node is required");
  const byId = new Map(nodes.map((node) => [node.clientId, node]));
  for (const node of nodes) {
    if (node.parentClientId && !byId.has(node.parentClientId)) throw new Error(`Parent node not found for ${node.clientId}`);
  }
  for (const node of nodes) {
    const visited = new Set<string>();
    let current: typeof node | undefined = node;
    while (current?.parentClientId) {
      if (visited.has(current.clientId)) throw new Error("Circular parent relationship is not allowed");
      visited.add(current.clientId);
      current = byId.get(current.parentClientId);
    }
  }
  return { title, nodes };
}

export class ProjectOrgChartService {
  private async cloneChartInTransaction(tx: any, sourceChart: any, projectId: string) {
    const chart = await tx.projectOrgChart.create({ data: { projectId, title: sourceChart.title } });
    const persistentIds = new Map<string, string>();
    const pending = [...sourceChart.nodes];
    while (pending.length) {
      const index = pending.findIndex((node: any) => !node.parentId || persistentIds.has(node.parentId));
      if (index < 0) throw new Error("Source organization chart contains a circular parent relationship");
      const node = pending.splice(index, 1)[0];
      const created = await tx.projectOrgChartNode.create({
        data: {
          chartId: chart.id, parentId: node.parentId ? persistentIds.get(node.parentId) : null,
          name: node.name, position: node.position, sortOrder: node.sortOrder,
          x: node.x, y: node.y, photoUrl: node.photoUrl,
          parentAnchor: node.parentAnchor, childAnchor: node.childAnchor,
          backgroundColor: node.backgroundColor, textColor: node.textColor,
        },
      });
      persistentIds.set(node.id, created.id);
    }
    return tx.projectOrgChart.findUnique({
      where: { id: chart.id }, include: { nodes: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
    });
  }

  private async requireAccess(projectId: string, userId: string, roleId: string) {
    const project = await prisma.project.findFirst({
      where: { AND: [{ id: projectId, deletedAt: null }, await buildAccessibleProjectWhere(userId, roleId)] },
      select: { id: true },
    });
    if (!project) throw new Error("Project not found or access denied");
  }

  async get(projectId: string, userId: string, roleId: string) {
    await this.requireAccess(projectId, userId, roleId);
    const db: any = prisma;
    const chart = await db.projectOrgChart.findUnique({
      where: { projectId },
      include: { nodes: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
    });
    return chart;
  }

  async uploadPhoto(projectId: string, userId: string, roleId: string, file: Express.Multer.File | undefined) {
    await this.requireAccess(projectId, userId, roleId);
    if (!file) throw new Error("photo file is required");
    if (!/^image\/(jpeg|png|webp)$/i.test(file.mimetype)) throw new Error("Only JPG, PNG, and WebP images are allowed");
    if (file.size > 5 * 1024 * 1024) throw new Error("Photo must not exceed 5 MB");
    const uploaded = await uploadBufferToSharePoint({
      buffer: file.buffer, originalName: file.originalname, mimeType: file.mimetype,
      folder: `org-chart-photos/${projectId}`,
    });
    const url = uploaded.downloadUrl || uploaded.webUrl;
    if (!url) throw new Error("SharePoint did not return a photo URL");
    return { photoUrl: url, fileName: uploaded.name || file.originalname, mimeType: file.mimetype, size: file.size };
  }

  async listCopySources(userId: string, roleId: string, query?: unknown, cursor?: unknown, limit?: unknown) {
    const db: any = prisma;
    const search = String(query || "").trim();
    const parsedLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const afterId = typeof cursor === "string" && cursor.trim() ? cursor : undefined;
    const accessWhere = await buildAccessibleProjectWhere(userId, roleId);
    const projects = await db.project.findMany({
      where: {
        AND: [
          { deletedAt: null }, accessWhere, { orgChart: { isNot: null } },
          ...(search ? [{ OR: [
            { name: { contains: search, mode: "insensitive" } },
            { orgChart: { title: { contains: search, mode: "insensitive" } } },
          ] }] : []),
        ],
      },
      select: {
        id: true, name: true, versionLabel: true, versionNumber: true,
        orgChart: { select: { title: true, updatedAt: true, _count: { select: { nodes: true } } } },
      },
      orderBy: { id: "asc" }, cursor: afterId ? { id: afterId } : undefined,
      skip: afterId ? 1 : 0, take: parsedLimit + 1,
    });
    const hasMore = projects.length > parsedLimit;
    const items = projects.slice(0, parsedLimit).map((project: any) => ({
      projectId: project.id, projectName: project.name,
      version: project.versionLabel || `Version ${project.versionNumber}`,
      chartTitle: project.orgChart.title, nodeCount: project.orgChart._count.nodes,
      updatedAt: project.orgChart.updatedAt,
    }));
    return { data: items, nextCursor: hasMore ? items[items.length - 1].projectId : null };
  }

  async previewCopy(projectId: string, sourceProjectId: string, userId: string, roleId: string) {
    if (!sourceProjectId || sourceProjectId === projectId) throw new Error("Choose a different source project");
    await this.requireAccess(projectId, userId, roleId);
    const db: any = prisma;
    const source = await db.project.findFirst({
      where: { AND: [{ id: sourceProjectId, deletedAt: null }, await buildAccessibleProjectWhere(userId, roleId)] },
      select: { id: true, name: true, versionLabel: true, versionNumber: true, orgChart: { include: { nodes: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } } } },
    });
    if (!source) throw new Error("Source project not found or access denied");
    if (!source.orgChart) throw new Error("Source project has no organization chart");
    const destinationChart = await db.projectOrgChart.findUnique({ where: { projectId }, select: { id: true } });
    return {
      sourceProject: { id: source.id, name: source.name, version: source.versionLabel || `Version ${source.versionNumber}` },
      chart: source.orgChart, destinationHasChart: Boolean(destinationChart),
    };
  }

  async cloneFromProject(projectId: string, sourceProjectId: string, replace: boolean, userId: string, roleId: string) {
    const preview = await this.previewCopy(projectId, sourceProjectId, userId, roleId);
    if (preview.destinationHasChart && !replace) throw new Error("Destination project already has an organization chart. Set replace to true after confirmation.");
    const db: any = prisma;
    return db.$transaction(async (tx: any) => {
      if (preview.destinationHasChart) await tx.projectOrgChart.delete({ where: { projectId } });
      return this.cloneChartInTransaction(tx, preview.chart, projectId);
    });
  }

  async save(projectId: string, userId: string, roleId: string, input: ChartInput) {
    await this.requireAccess(projectId, userId, roleId);
    const { title, nodes } = normalize(input);
    const db: any = prisma;
    const chart = await db.$transaction(async (tx: any) => {
      const saved = await tx.projectOrgChart.upsert({
        where: { projectId }, create: { projectId, title }, update: { title },
      });
      await tx.projectOrgChartNode.deleteMany({ where: { chartId: saved.id } });
      const persistentIds = new Map<string, string>();
      const pending = [...nodes];
      while (pending.length) {
        const index = pending.findIndex((node) => !node.parentClientId || persistentIds.has(node.parentClientId));
        if (index < 0) throw new Error("Circular parent relationship is not allowed");
        const node = pending.splice(index, 1)[0];
        const created = await tx.projectOrgChartNode.create({
          data: { ...node, clientId: undefined, parentClientId: undefined, chartId: saved.id,
            parentId: node.parentClientId ? persistentIds.get(node.parentClientId) : null },
        });
        persistentIds.set(node.clientId, created.id);
      }
      return tx.projectOrgChart.findUnique({
        where: { id: saved.id }, include: { nodes: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
      });
    });
    return chart;
  }

  async remove(projectId: string, userId: string, roleId: string) {
    await this.requireAccess(projectId, userId, roleId);
    const db: any = prisma;
    const chart = await db.projectOrgChart.findUnique({ where: { projectId }, select: { id: true } });
    if (!chart) return { deleted: false };
    await db.projectOrgChart.delete({ where: { id: chart.id } });
    return { deleted: true };
  }
}

export const projectOrgChartService = new ProjectOrgChartService();
