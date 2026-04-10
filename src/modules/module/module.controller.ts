import prisma from "../../config/prisma";

export const createModule = async (req: any, res: any) => {
  try {
    const { name, path } = req.body;

    const module = await prisma.module.create({
      data: { name, path },
    });

    res.json(module);
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
};