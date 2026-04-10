import { Request, Response } from "express";
import prisma from "../../config/prisma";
import { SubtaskService } from "./subtask.service";

import {
  CreateSubtaskDTO,
  GetSubtasksParamsDTO,
  UpdateSubtaskDTO,
  UpdateSubtaskParamsDTO,
  DeleteSubtaskParamsDTO,
  ToggleChecklistParamsDTO,
  DeleteChecklistItemParamsDTO,
} from "./subtask.dto";

export class SubtaskController {
  // CREATE SUBTASK
  static async create(req: Request<{}, {}, CreateSubtaskDTO>, res: Response) {
    try {
      const { taskId, title, statusId } = req.body;
      const userId = req.user.id;
      console.log("REQ.USER:", req.user);
      console.log("USER ID:", req.user?.id);

      const subtask = await prisma.subtask.create({
        data: {
          title,
          order: 0,
          progress: 0,

          task: {
            connect: { id: taskId },
          },

          status: {
            connect: { id: statusId },
          },

          creator: {
            connect: { id: userId },
          },
        },
      });

      res.json(subtask);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // GET SUBTASKS (KANBAN VIEW)
  static async getByTask(req: Request<GetSubtasksParamsDTO>, res: Response) {
    try {
      const { taskId } = req.params;

      const subtasks = await prisma.subtask.findMany({
        where: { taskId },
        include: {
          status: true,
          assignees: {
            include: { user: true },
          },
          checklists: true,
        },
        orderBy: [{ statusId: "asc" }, { order: "asc" }],
      });

      res.json(subtasks);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // UPDATE SUBTASK
  static async update(
    req: Request<UpdateSubtaskParamsDTO, {}, UpdateSubtaskDTO>,
    res: Response,
  ) {
    try {
      const { id } = req.params;
      const data = req.body;

      const updated = await prisma.subtask.update({
        where: { id },
        data,
      });

      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // DELETE SUBTASK
  static async delete(req: Request<DeleteSubtaskParamsDTO>, res: Response) {
    try {
      const { id } = req.params;

      await prisma.subtask.delete({
        where: { id },
      });

      res.json({ message: "Deleted successfully" });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // TOGGLE CHECKLIST (AUTOMATION)
  static async toggleChecklist(
    req: Request<ToggleChecklistParamsDTO>,
    res: Response,
  ) {
    try {
      const { checklistId } = req.params;
      const userId = req.user.id;
      console.log("REQ.USER:", req.user);
      console.log("USER ID:", req.user?.id);

      const result = await SubtaskService.toggleChecklist(checklistId, userId);

      res.json(result);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  // MOVE SUBTASK (DRAG & DROP)
  static async move(
    req: Request<
      { subtaskId: string },
      {},
      { statusId: string; order: number }
    >,
    res: Response,
  ) {
    try {
      const { subtaskId } = req.params;
      const { statusId, order } = req.body;
      const userId = req.user.id;

      const result = await SubtaskService.moveSubtask(
        subtaskId,
        statusId,
        order,
        userId,
      );

      res.json(result);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  //Add CHECKLIST ITEM
  static async addChecklist(req: Request, res: Response) {
    try {
      const { subtaskId, title } = req.body;

      // get last order
      const last = await prisma.checklist.findFirst({
        where: { subtaskId },
        orderBy: { order: "desc" },
      });

      const checklist = await prisma.checklist.create({
        data: {
          title,
          subtaskId,
          order: (last?.order || 0) + 1,
        },
      });

      res.json(checklist);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  //delete CHECKLIST ITEM
  static async deleteChecklist(req: Request<DeleteChecklistItemParamsDTO>, res: Response) {
  try {
    const { checklistId } = req.params;

    await prisma.checklist.delete({
      where: { id: checklistId }
    });

    res.json({ message: "Checklist deleted" });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
}
}
