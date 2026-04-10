import { Request, Response } from "express";
import prisma from "../../config/prisma";
import bcrypt from "bcrypt";

export const getUsers = async (req: Request, res: Response) => {
  const users = await prisma.user.findMany({
    include: { role: true },
  });

  res.json(users);
};

export const createUser = async (req: any, res: any) => {
  try {
    const { name, email, password, roleId } = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        roleId,
      },
    });

    res.json(user);
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
};

export const updateUser = async (req: any, res: any) => {
  try {
    const { userId } = req.params;
    const { name, email, roleId, password } = req.body;

    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      return res.status(404).json({
        message: "User not found",
      });
    }
    if (email && email !== existingUser.email) {
      const emailExists = await prisma.user.findUnique({
        where: { email },
      });

      if (emailExists) {
        return res.status(400).json({
          message: "Email already in use",
        });
      }
    }

    let hashedPassword = existingUser.password;

    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        name: name ?? existingUser.name,
        email: email ?? existingUser.email,
        roleId: roleId ?? existingUser.roleId,
        password: hashedPassword,
      },
      include: {
        role: true,
      },
    });

    res.json({
      message: "User updated successfully",
      user: updatedUser,
    });
  } catch (err: any) {
    if (err.code === "P2002") {
      return res.status(400).json({
        message: "Email already exists",
      });
    }

    res.status(500).json({ message: err.message });
  }
};
export const deleteUser = async (req: any, res: any) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }


    if (req.user.userId === userId) {
      return res.status(400).json({
        message: "You cannot delete your own account",
      });
    }


    await prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
    });

    res.json({
      message: `User "${user.name}" deleted successfully`,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};