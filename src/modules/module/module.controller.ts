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
export const getModules = async (req: any, res: any) => {
  try {
    const modules = await prisma.module.findMany({
      orderBy: { name: "asc" },
    });

    res.json(modules);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};
