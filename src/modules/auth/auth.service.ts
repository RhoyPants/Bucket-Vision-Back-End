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