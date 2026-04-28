import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding LARGE realistic project data...");

  // =========================
  // CLEAN ONLY BUSINESS DATA
  // =========================
  await prisma.progressLog.deleteMany();
  await prisma.checklist.deleteMany();
  await prisma.subtaskAssignee.deleteMany();
  await prisma.subtask.deleteMany();
  await prisma.task.deleteMany();
  await prisma.category.deleteMany();
  await prisma.project.deleteMany();

  // =========================
  // GET EXISTING USER (IMPORTANT)
  // =========================
  // =========================
  // ROLES
  // =========================
  const adminRole = await prisma.role.upsert({
    where: { name: "ADMIN" },
    update: {},
    create: { name: "ADMIN" },
  });

  // =========================
  // MODULES
  // =========================
  const modulesData = [
    { name: "USERS", path: "/users" },
    { name: "ROLES", path: "/roles" },
    { name: "TASKS", path: "/tasks" },
    { name: "PROJECTS", path: "/projects" },
    { name: "SUBTASKS", path: "/subtasks" },
    { name: "CATEGORIES", path: "/categories" },
    { name: "PROGRESS", path: "/progress" },
  ];

  const modules = [];

  for (const mod of modulesData) {
    const module = await prisma.module.upsert({
      where: { name: mod.name },
      update: {},
      create: mod,
    });
    modules.push(module);
  }

  // =========================
  // PERMISSIONS
  // =========================
  const actions = ["CREATE", "READ", "UPDATE", "DELETE"];

  const permissions = [];

  for (const action of actions) {
    const perm = await prisma.permission.upsert({
      where: { action },
      update: {},
      create: { action },
    });
    permissions.push(perm);
  }

  // =========================
  // ROLE PERMISSIONS (ADMIN FULL)
  // =========================
  for (const module of modules) {
    for (const perm of permissions) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_moduleId_permissionId: {
            roleId: adminRole.id,
            moduleId: module.id,
            permissionId: perm.id,
          },
        },
        update: {},
        create: {
          roleId: adminRole.id,
          moduleId: module.id,
          permissionId: perm.id,
        },
      });
    }
  }

  // =========================
  // USERS
  // =========================
  const pmUser = await prisma.user.upsert({
    where: { email: "pm@test.com" },
    update: {},
    create: {
      name: "Project Manager",
      email: "pm@test.com",
      password: "$2b$10$7sGQJ7sZzV3F5uC0k9Fq5u1ZkY8d6ZxYyZQ7Qz0QeQ7zK9J7Q1abc", // 123456
      roleId: adminRole.id,
    },
  });

  // Sample member user for assignments
  const memberUser = await prisma.user.upsert({
    where: { email: "member@test.com" },
    update: {},
    create: {
      name: "Team Member",
      email: "member@test.com",
      password: "$2b$10$7sGQJ7sZzV3F5uC0k9Fq5u1ZkY8d6ZxYyZQ7Qz0QeQ7zK9J7Q1abc", // 123456
      roleId: adminRole.id,
    },
  });

  // =========================
  // HELPER FUNCTION
  // =========================
  const createProgress = async (
    subtaskId: string,
    pattern: "ahead" | "delay" | "normal",
  ) => {
    let logs: [string, number][] = [];

    if (pattern === "ahead") {
      logs = [
        ["2026-04-01", 20],
        ["2026-04-02", 25],
        ["2026-04-03", 25],
        ["2026-04-04", 20],
        ["2026-04-05", 10],
      ];
    }

    if (pattern === "delay") {
      logs = [
        ["2026-04-01", 5],
        ["2026-04-03", 10],
        ["2026-04-05", 10],
        ["2026-04-08", 15],
        ["2026-04-10", 20],
      ];
    }

    if (pattern === "normal") {
      logs = [
        ["2026-04-01", 10],
        ["2026-04-02", 15],
        ["2026-04-03", 20],
        ["2026-04-04", 20],
        ["2026-04-05", 15],
      ];
    }

    for (const [date, val] of logs) {
      await prisma.progressLog.create({
        data: {
          subtaskId,
          date: new Date(date),
          dailyPercent: val,
          cumulativePercent: 0,
        },
      });
    }
  };

  // =========================
  // CREATE PROJECTS
  // =========================
  for (let p = 1; p <= 2; p++) {
    const project = await prisma.project.create({
      data: {
        name: `Project ${p}`,
        description: `Full Construction Project ${p}`,
        startDate: new Date("2026-04-01"),
        expectedEndDate: new Date("2026-06-30"),
        ownerId: pmUser.id,
      },
    });

    // =========================
    // CATEGORIES
    // =========================
    for (let c = 1; c <= 2; c++) {
      const category = await prisma.category.create({
        data: {
          name: `Category ${c} - Project ${p}`,
          projectId: project.id,
          budgetPercent: 50,
        },
      });

      // =========================
      // TASKS
      // =========================
      for (let t = 1; t <= 3; t++) {
        const task = await prisma.task.create({
          data: {
            title: `Task ${t} - Cat ${c}`,
            categoryId: category.id,
            budgetPercent: 25,
          },
        });

        // =========================
        // SUBTASKS
        // =========================
        for (let s = 1; s <= 3; s++) {
          const subtask = await prisma.subtask.create({
            data: {
              title: `Subtask ${s} - Task ${t}`,
              taskId: task.id,
              createdBy: pmUser.id,
              order: s,
              status: 0, // 🔥 default pending

              projectedStartDate: new Date("2026-04-01"),
              projectedEndDate: new Date("2026-04-30"),

              budgetPercent: 20,
            },
          });

          // Assign members to subtasks
          await prisma.subtaskAssignee.create({
            data: {
              subtaskId: subtask.id,
              userId: memberUser.id,
            },
          });
        }
      }
    }
  }

  console.log("✅ MASSIVE TEST DATA SEEDED SUCCESSFULLY!");
}

main()
  .then(() => {
    console.log("✅ MASSIVE TEST DATA SEEDED SUCCESSFULLY!");
    prisma.$disconnect();
  })
  .catch(async (e: any) => {
    console.error("❌ SEED ERROR:", e.message);
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
