import { Prisma } from "@prisma/client";
import prisma from "../../config/prisma";

export async function buildAccessibleProjectWhere(
  userId: string,
  roleId: string,
): Promise<Prisma.ProjectWhereInput> {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    select: { name: true },
  });
  if (["SUPERADMIN", "OP"].includes(role?.name || "")) return {};
  if (role?.name === "BU_HEAD") {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { businessUnitId: true },
    });
    return { businessUnit: user?.businessUnitId || "__NO_ACCESSIBLE_BUSINESS_UNIT__" };
  }
  return {
    OR: [{ ownerId: userId }, { projectMembers: { some: { userId } } }],
  };
}
