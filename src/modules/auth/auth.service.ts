import prisma from "../../config/prisma";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

const ACCESS_SECRET = "access_secret"; //I will need to change it for the secret in production, maybe use env variable for it
const REFRESH_SECRET = "refresh_secret";//I will need to change it for the secret in production, maybe use env variable for it

export const loginUser = async (email: string, password: string) => {
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) throw new Error("User not found");

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) throw new Error("Invalid password");

  const accessToken = jwt.sign(
    { id: user.id, roleId: user.roleId },
    ACCESS_SECRET,
    { expiresIn: "7d" }
  );

  const refreshToken = jwt.sign(
    { id: user.id },
    REFRESH_SECRET,
    { expiresIn: "7d" }
  );

  // save refresh token in DB
  await prisma.user.update({
    where: { id: user.id },
    data: { refreshToken },
  });

  return { accessToken, refreshToken };
};

export const refreshAccessToken = async (token: string) => {
  try {
    const decoded: any = jwt.verify(token, REFRESH_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user || user.refreshToken !== token) {
      throw new Error("Invalid refresh token");
    }

    const newAccessToken = jwt.sign(
      { userId: user.id, roleId: user.roleId },
      ACCESS_SECRET,
      { expiresIn: "15m" }
    );
    return { accessToken: newAccessToken };
  } catch {
    throw new Error("Invalid or expired refresh token");
  }
};

export const logoutUser = async (userId: string) => {
  // Clear refresh token from database
  await prisma.user.update({
    where: { id: userId },
    data: { refreshToken: null },
  });

  return { message: "Logged out successfully" };
};

export const getUserInfo = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      isActive: true,
      role: {
        select: {
          id: true,
          name: true,
          rolePermissions: {
            select: {
              module: {
                select: {
                  id: true,
                  name: true,
                  path: true,
                },
              },
              permission: {
                select: {
                  id: true,
                  action: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!user) throw new Error("User not found");

  // Transform permissions into a structured format
  const permissions: Record<string, string[]> = {};
  user.role.rolePermissions.forEach((rp) => {
    const moduleName = rp.module.name;
    if (!permissions[moduleName]) {
      permissions[moduleName] = [];
    }
    permissions[moduleName].push(rp.permission.action);
  });

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      isActive: user.isActive,
      role: user.role.name,
    },
    permissions, // { USERS: ["CREATE", "READ", "UPDATE", "DELETE"], ... }
  };
};