import fs from "fs";
import path from "path";
import prisma from "../src/config/prisma";

interface CatalogSubtask {
  code: string;
  name: string;
  description?: string;
}

interface CatalogTask {
  code: string;
  name: string;
  description?: string;
  subtasks: CatalogSubtask[];
}

interface CatalogScope {
  code: string;
  name: string;
  description?: string;
  tasks: CatalogTask[];
}

async function main() {
  const sourcePath = path.join(__dirname, "..", "data", "workBreakdownMaintenance.json");
  const catalog = JSON.parse(fs.readFileSync(sourcePath, "utf8")) as CatalogScope[];

  const codes = [
    ...catalog.map((scope) => scope.code),
    ...catalog.flatMap((scope) => scope.tasks.map((task) => task.code)),
    ...catalog.flatMap((scope) =>
      scope.tasks.flatMap((task) => task.subtasks.map((subtask) => subtask.code)),
    ),
  ];

  if (new Set(codes).size !== codes.length) {
    throw new Error("Maintenance seed file contains duplicate codes");
  }

  const result = await prisma.$transaction(
    async (tx) => {
      // Preserve real project data before removing test catalog references.
      await tx.scope.updateMany({
        where: { scopeMaintenanceId: { not: null } },
        data: { sourceType: "CUSTOM", scopeMaintenanceId: null },
      });
      await tx.task.updateMany({
        where: { taskMaintenanceId: { not: null } },
        data: { sourceType: "CUSTOM", taskMaintenanceId: null },
      });
      await tx.subtask.updateMany({
        where: { subtaskMaintenanceId: { not: null } },
        data: { sourceType: "CUSTOM", subtaskMaintenanceId: null },
      });

      await tx.scopeMaintenanceTask.deleteMany();
      await tx.taskMaintenanceSubtask.deleteMany();
      await tx.scopeMaintenance.deleteMany();
      await tx.taskMaintenance.deleteMany();
      await tx.subtaskMaintenance.deleteMany();

      let taskCount = 0;
      let subtaskCount = 0;

      for (const [scopeOrder, scopeInput] of catalog.entries()) {
        const scope = await tx.scopeMaintenance.create({
          data: {
            code: scopeInput.code,
            name: scopeInput.name,
            description: scopeInput.description || null,
            order: scopeOrder,
            isActive: true,
          },
        });

        for (const [taskOrder, taskInput] of scopeInput.tasks.entries()) {
          const task = await tx.taskMaintenance.create({
            data: {
              code: taskInput.code,
              name: taskInput.name,
              description: taskInput.description || null,
              order: taskCount,
              isActive: true,
            },
          });
          taskCount += 1;

          await tx.scopeMaintenanceTask.create({
            data: {
              scopeMaintenanceId: scope.id,
              taskMaintenanceId: task.id,
              order: taskOrder,
            },
          });

          for (const [subtaskOrder, subtaskInput] of taskInput.subtasks.entries()) {
            const subtask = await tx.subtaskMaintenance.create({
              data: {
                code: subtaskInput.code,
                name: subtaskInput.name,
                description: subtaskInput.description || null,
                order: subtaskCount,
                isActive: true,
              },
            });
            subtaskCount += 1;

            await tx.taskMaintenanceSubtask.create({
              data: {
                taskMaintenanceId: task.id,
                subtaskMaintenanceId: subtask.id,
                order: subtaskOrder,
              },
            });
          }
        }
      }

      return {
        scopes: catalog.length,
        tasks: taskCount,
        subtasks: subtaskCount,
      };
    },
    { timeout: 120_000 },
  );

  console.log(
    `Work breakdown maintenance seeded: ${result.scopes} scopes, ${result.tasks} tasks, ${result.subtasks} subtasks.`,
  );
}

main()
  .catch((error) => {
    console.error("Work breakdown maintenance seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

