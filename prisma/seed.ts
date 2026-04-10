import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding...");

  // ROLES
  const ceo = await prisma.role.upsert({
    where: { name: "CEO" },
    update: {},
    create: { name: "CEO" },
  });

  const admin = await prisma.role.upsert({
    where: { name: "ADMIN" },
    update: {},
    create: { name: "ADMIN" },
  });

  const tester = await prisma.role.upsert({
    where: { name: "TESTER" },
    update: {},
    create: { name: "TESTER" },
  });

  // MODULES (Developer controlled)
  const modulesData = [
    { name: "USERS", path: "/users" },
    { name: "ROLES", path: "/roles" },
    { name: "TASKS", path: "/tasks" },
    { name: "PROJECTS", path: "/projects" },
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

  // PERMISSION
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

  // ADMIN FULL ACCESS
  for (const module of modules) {
    for (const perm of permissions) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_moduleId_permissionId: {
            roleId: admin.id,
            moduleId: module.id,
            permissionId: perm.id,
          },
        },
        update: {},
        create: {
          roleId: admin.id,
          moduleId: module.id,
          permissionId: perm.id,
        },
      });
    }
  }

  // ----------------------------------------
  // DEMO DATA (PROJECT → TASK → STATUS → SUBTASK)
  // ----------------------------------------

  const demoUser = await prisma.user.findFirst(); // use any existing user

  if (!demoUser) {
    throw new Error("❌ No user found. Create user first.");
  }

  // PROJECT
  const project = await prisma.project.create({
    data: {
      name: "Demo Project",
      description: "Kanban Demo",
      ownerId: demoUser.id,
    },
  });

  // TASK (BOARD)
  const task = await prisma.task.create({
    data: {
      title: "Frontend Kanban Board",
      description: "Test board",
      projectId: project.id,
    },
  });

  // STATUSES (COLUMNS)
  const statuses = await prisma.$transaction([
    prisma.status.create({
      data: {
        name: "Pending",
        order: 0,
        progressValue: 0,
        taskId: task.id,
      },
    }),
    prisma.status.create({
      data: {
        name: "Ongoing",
        order: 1,
        progressValue: 50,
        taskId: task.id,
      },
    }),
    prisma.status.create({
      data: {
        name: "Done",
        order: 2,
        progressValue: 100,
        taskId: task.id,
      },
    }),
  ]);

  // SUBTASKS (CARDS)
  await prisma.subtask.createMany({
    data: [
      {
        title: "Setup project",
        taskId: task.id,
        statusId: statuses[0].id, // Pending
        order: 0,
        createdBy: demoUser.id,
      },
      {
        title: "Build UI",
        taskId: task.id,
        statusId: statuses[1].id, // Ongoing
        order: 0,
        createdBy: demoUser.id,
      },
      {
        title: "Deploy app",
        taskId: task.id,
        statusId: statuses[2].id, // Done
        order: 0,
        createdBy: demoUser.id,
      },
    ],
  });

  console.log(" Demo Kanban data created!");
  console.log(" TASK ID:", task.id);

  console.log("✅ Seed completed");
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
