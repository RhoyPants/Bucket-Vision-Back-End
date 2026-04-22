import { Request, Response } from "express";
import prisma from "../../config/prisma";

import {
  CreateCategoryDTO,
  CategoryParamsDTO,
  UpdateCategoryDTO,
  GetCategoriesByProjectParamsDTO
} from "./category.dto";

export class CategoryController {

  // CREATE
  static async create(
    req: Request<{}, {}, CreateCategoryDTO>,
    res: Response
  ) {
    try {
      const {
        name,
        description,
        projectId,
        budgetAllocated,
        budgetPercent
      } = req.body;

      const category = await prisma.category.create({
        data: {
          name,
          description,
          projectId,
          budgetAllocated,
          budgetPercent
        }
      });

      res.json(category);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // GET BY PROJECT
  static async getByProject(
    req: Request<GetCategoriesByProjectParamsDTO>,
    res: Response
  ) {
    try {
      const { projectId } = req.params;

      const categories = await prisma.category.findMany({
        where: { projectId },
        include: {
          tasks: true
        },
        orderBy: {
          createdAt: "asc"
        }
      });

      res.json(categories);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // GET SINGLE
  static async getById(
    req: Request<CategoryParamsDTO>,
    res: Response
  ) {
    try {
      const { id } = req.params;

      const category = await prisma.category.findUnique({
        where: { id },
        include: {
          tasks: {
            include: {
              subtasks: true
            }
          }
        }
      });

      if (!category) {
        return res.status(404).json({ message: "Category not found" });
      }

      res.json(category);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // UPDATE
  static async update(
    req: Request<CategoryParamsDTO, {}, UpdateCategoryDTO>,
    res: Response
  ) {
    try {
      const { id } = req.params;

      const {
        name,
        description,
        budgetAllocated,
        budgetPercent
      } = req.body;

      const updated = await prisma.category.update({
        where: { id },
        data: {
          name,
          description,
          budgetAllocated,
          budgetPercent
        }
      });

      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // DELETE
  static async delete(
    req: Request<CategoryParamsDTO>,
    res: Response
  ) {
    try {
      const { id } = req.params;

      await prisma.category.delete({
        where: { id }
      });

      res.json({ message: "Category deleted successfully" });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
}