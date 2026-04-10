import { Request, Response } from "express";
import prisma from "../../config/prisma";

import {
  CreateProjectDTO,
  ProjectParamsDTO,
  UpdateProjectDTO
} from "./project.dto";

export class ProjectController {

  // ✅ CREATE PROJECT
  static async create(
    req: Request<{}, {}, CreateProjectDTO>,
    res: Response
  ) {
    try {
      const { name, description } = req.body;
      const userId = req.user.id;

      const project = await prisma.project.create({
        data: {
          name,
          description,
          ownerId: userId
        }
      });

      res.json(project);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ✅ GET ALL PROJECTS (OWNED BY USER)
  static async getAll(req: Request, res: Response) {
    try {
      const userId = req.user.id;

      const projects = await prisma.project.findMany({
        where: {
          ownerId: userId
        },
        orderBy: {
          createdAt: "desc"
        }
      });

      res.json(projects);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ✅ GET SINGLE PROJECT
  static async getById(
    req: Request<ProjectParamsDTO>,
    res: Response
  ) {
    try {
      const { id } = req.params;

      const project = await prisma.project.findUnique({
        where: { id },
        include: {
          tasks: true
        }
      });

      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      res.json(project);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ✅ UPDATE PROJECT
  static async update(
    req: Request<ProjectParamsDTO, {}, UpdateProjectDTO>,
    res: Response
  ) {
    try {
      const { id } = req.params;
      const data = req.body;

      const updated = await prisma.project.update({
        where: { id },
        data
      });

      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // ✅ DELETE PROJECT
  static async delete(
    req: Request<ProjectParamsDTO>,
    res: Response
  ) {
    try {
      const { id } = req.params;

      await prisma.project.delete({
        where: { id }
      });

      res.json({ message: "Project deleted successfully" });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
}