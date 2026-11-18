import { Prisma } from "@prisma/client";
import { buildAssetUrl, deleteManagedAsset, fileKeyFromStoredValue } from "../../services/s3-assets.service";

export async function deleteProjectAssets(tx: Prisma.TransactionClient, projectId: string) {
  const subtask = { task: { scope: { projectId } } };
  const attachmentOwner = { OR: [{ projectId }, { subtask }] };
  const progressOwner = { subtask };
  const progressAttachmentOwner = { progressLog: { subtask } };
  const incidentOwner = { incident: { projectId } };
  const nodeOwner = { chart: { projectId } };
  const [attachments, logs, progressAttachments, incidentAttachments, nodes] = await Promise.all([
    tx.attachment.findMany({ where: attachmentOwner, select: { fileUrl: true } }),
    tx.progressLog.findMany({ where: progressOwner, select: { photoUrl: true, attachmentUrl: true } }),
    tx.progressLogAttachment.findMany({ where: progressAttachmentOwner, select: { url: true } }),
    tx.incidentAttachment.findMany({ where: incidentOwner, select: { fileUrl: true } }),
    tx.projectOrgChartNode.findMany({ where: nodeOwner, select: { photoUrl: true } }),
  ]);
  const values = [
    ...attachments.map((item) => item.fileUrl),
    ...logs.flatMap((item) => [item.photoUrl, item.attachmentUrl]),
    ...progressAttachments.map((item) => item.url),
    ...incidentAttachments.map((item) => item.fileUrl),
    ...nodes.map((item) => item.photoUrl),
  ].filter((value): value is string => Boolean(value));
  const references = new Map<string, string>();
  for (const value of values) references.set(fileKeyFromStoredValue(value) ?? value, value);
  if (!references.size) return;

  // Versions clone references, not S3 objects. Compare both stored key and URL forms.
  const candidates = Array.from(new Set([
    ...values,
    ...Array.from(references.keys()).flatMap((key) =>
      fileKeyFromStoredValue(key) ? [key, buildAssetUrl(key)] : [key]),
  ]));
  const [otherAttachments, otherLogs, otherProgressAttachments, otherIncidentAttachments, otherNodes] = await Promise.all([
    tx.attachment.findMany({
      where: {
        AND: [
          { OR: [{ projectId: null }, { projectId: { not: projectId } }] },
          { OR: [{ subtaskId: null }, { subtask: { task: { scope: { projectId: { not: projectId } } } } }] },
        ],
        fileUrl: { in: candidates },
      },
      select: { fileUrl: true },
    }),
    tx.progressLog.findMany({
      where: { NOT: progressOwner, OR: [{ photoUrl: { in: candidates } }, { attachmentUrl: { in: candidates } }] },
      select: { photoUrl: true, attachmentUrl: true },
    }),
    tx.progressLogAttachment.findMany({
      where: { NOT: progressAttachmentOwner, url: { in: candidates } }, select: { url: true },
    }),
    tx.incidentAttachment.findMany({
      where: { NOT: incidentOwner, fileUrl: { in: candidates } }, select: { fileUrl: true },
    }),
    tx.projectOrgChartNode.findMany({
      where: { NOT: nodeOwner, photoUrl: { in: candidates } }, select: { photoUrl: true },
    }),
  ]);
  const retained = new Set([
    ...otherAttachments.map((item) => item.fileUrl),
    ...otherLogs.flatMap((item) => [item.photoUrl, item.attachmentUrl]),
    ...otherProgressAttachments.map((item) => item.url),
    ...otherIncidentAttachments.map((item) => item.fileUrl),
    ...otherNodes.map((item) => item.photoUrl),
  ].filter((value): value is string => Boolean(value)).map((value) => fileKeyFromStoredValue(value) ?? value));

  for (const [key, value] of references) {
    if (retained.has(key)) {
      console.info(`[S3 DELETE] retained shared project asset projectId=${projectId} key=${key}`);
    } else {
      await deleteManagedAsset(value);
    }
  }
}
