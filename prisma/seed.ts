import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding comprehensive system data...\n");

  //////////////////////////////
  // PERMISSIONS
  //////////////////////////////
  const actions = ["CREATE", "READ", "UPDATE", "DELETE", "APPROVE"];

  const permissions = await Promise.all(
    actions.map((action) =>
      prisma.permission.upsert({
        where: { action },
        update: {},
        create: { action },
      }),
    ),
  );

  console.log("✅ Permissions created");

  //////////////////////////////
  // MODULES (ALL FROM CODEBASE)
  //////////////////////////////
  const moduleNames = [
    { name: "AUTH", path: "/auth" },
    { name: "USERS", path: "/users" },
    { name: "ROLES", path: "/roles" },
    { name: "MODULES", path: "/modules" },
    { name: "PROJECTS", path: "/projects" },
    { name: "SCOPES", path: "/scopes" },
    { name: "TASKS", path: "/tasks" },
    { name: "SUBTASKS", path: "/subtasks" },
    { name: "PROGRESS", path: "/progress" },
    { name: "TIMELINE", path: "/timeline" },
    { name: "DAILY_REPORTS", path: "/daily-reports" },
    { name: "WEEKLY_REPORTS", path: "/weekly-reports" },
    { name: "APPROVALS", path: "/approvals" },
    { name: "SETTINGS", path: "/settings" },
  ];

  const modules = await Promise.all(
    moduleNames.map((mod) =>
      prisma.module.upsert({
        where: { name: mod.name },
        update: {},
        create: mod,
      }),
    ),
  );

  console.log("✅ Modules created (13 total)");

  //////////////////////////////
  // ROLES
  //////////////////////////////
  const rolesData = ["SUPERADMIN", "PIC", "BU_HEAD", "OP", "LEADER", "MEMBER"];

  const roles = await Promise.all(
    rolesData.map((name) =>
      prisma.role.upsert({
        where: { name },
        update: {},
        create: { name },
      }),
    ),
  );

  console.log("✅ Roles created (6 total)");

  //////////////////////////////
  // ROLE PERMISSIONS (ALL PERMISSIONS TO ALL ROLES)
  //////////////////////////////

  for (const role of roles) {
    for (const module of modules) {
      for (const perm of permissions) {
        await prisma.rolePermission.upsert({
          where: {
            roleId_moduleId_permissionId: {
              roleId: role.id,
              moduleId: module.id,
              permissionId: perm.id,
            },
          },
          update: {},
          create: {
            roleId: role.id,
            moduleId: module.id,
            permissionId: perm.id,
          },
        });
      }
    }
  }

  console.log("✅ Role permissions assigned (FULL ACCESS for all roles)");

  //////////////////////////////
  // USERS
  //////////////////////////////

  const hashedPassword = await bcrypt.hash("password123", 10);

  const superadmin = await prisma.user.upsert({
    where: { email: "superadmin@test.com" },
    update: {},
    create: {
      name: "Super Admin",
      email: "superadmin@test.com",
      password: hashedPassword,
      roleId: roles.find((r) => r.name === "SUPERADMIN")!.id,
      isActive: true,
    },
  });

  const pic = await prisma.user.upsert({
    where: { email: "pic@test.com" },
    update: {},
    create: {
      name: "PIC (Project Manager)",
      email: "pic@test.com",
      password: hashedPassword,
      roleId: roles.find((r) => r.name === "PIC")!.id,
      isActive: true,
    },
  });

  const buHead = await prisma.user.upsert({
    where: { email: "buhead@test.com" },
    update: {},
    create: {
      name: "BU Head (Business Unit)",
      email: "buhead@test.com",
      password: hashedPassword,
      roleId: roles.find((r) => r.name === "BU_HEAD")!.id,
      isActive: true,
    },
  });

  const op = await prisma.user.upsert({
    where: { email: "op@test.com" },
    update: {},
    create: {
      name: "OP (President)",
      email: "op@test.com",
      password: hashedPassword,
      roleId: roles.find((r) => r.name === "OP")!.id,
      isActive: true,
    },
  });

  const leader = await prisma.user.upsert({
    where: { email: "leader@test.com" },
    update: {},
    create: {
      name: "Team Leader",
      email: "leader@test.com",
      password: hashedPassword,
      roleId: roles.find((r) => r.name === "LEADER")!.id,
      isActive: true,
      approverId: buHead.id,
    },
  });

  const member = await prisma.user.upsert({
    where: { email: "member@test.com" },
    update: {},
    create: {
      name: "Team Member",
      email: "member@test.com",
      password: hashedPassword,
      roleId: roles.find((r) => r.name === "MEMBER")!.id,
      isActive: true,
      approverId: leader.id,
    },
  });

  console.log("✅ Users created (6 total)");

  //////////////////////////////
  // ORG HIERARCHY
  //////////////////////////////

  await prisma.userHierarchy.upsert({
    where: {
      managerId_memberId: {
        managerId: pic.id,
        memberId: leader.id,
      },
    },
    update: {},
    create: {
      managerId: pic.id,
      memberId: leader.id,
    },
  });

  await prisma.userHierarchy.upsert({
    where: {
      managerId_memberId: {
        managerId: leader.id,
        memberId: member.id,
      },
    },
    update: {},
    create: {
      managerId: leader.id,
      memberId: member.id,
    },
  });

  console.log("✅ Org hierarchy created");

  //////////////////////////////
  // SYSTEM SETTINGS
  //////////////////////////////

  await prisma.systemSetting.upsert({
    where: { key: "approval_enabled" },
    update: { value: "true" },
    create: { key: "approval_enabled", value: "true" },
  });

  console.log("✅ System settings created");

  //////////////////////////////
  // PROJECT 1: ACTIVE (APPROVED)
  //////////////////////////////

  const existingProject1 = await prisma.project.findFirst({
    where: { pin: "PROJ-001" },
  });

  const activeProject =
    existingProject1 ||
    (await prisma.project.create({
      data: {
        name: "Hospital Construction - Phase 1",
        description: "Main structure and foundation work",
        pin: "PROJ-001",
        location: { city: "Manila", zone: "Zone A" },
        businessUnit: "Infrastructure",
        entity: "Building Division",
        ownerId: pic.id,
        status: "ACTIVE",
        versionNumber: 1,
        isActive: true,
        isLatestVersion: true,
        isLocked: false,
        requiresApproval: true,
        startDate: new Date("2026-01-15"),
        expectedEndDate: new Date("2026-06-30"),
        totalBudget: 5000000,
        priority: "HIGH",

        scopes: {
          create: [
            {
              name: "Foundation Work",
              description: "Excavation and concrete foundation",
              progress: 75,
              budgetAllocated: 1500000,
              budgetPercent: 30,
              tasks: {
                create: [
                  {
                    title: "Soil Excavation",
                    description: "Clearing and excavating site",
                    order: 1,
                    progress: 100,
                    budgetAllocated: 500000,
                    budgetPercent: 10,
                    subtasks: {
                      create: [
                        {
                          title: "Site survey",
                          order: 1,
                          createdBy: pic.id,
                          progress: 100,
                          projectedStartDate: new Date("2026-01-15"),
                          projectedEndDate: new Date("2026-01-25"),
                          actualStartDate: new Date("2026-01-15"),
                          actualEndDate: new Date("2026-01-24"),
                        },
                        {
                          title: "Soil removal",
                          order: 2,
                          createdBy: pic.id,
                          progress: 100,
                          projectedStartDate: new Date("2026-01-26"),
                          projectedEndDate: new Date("2026-02-15"),
                          actualStartDate: new Date("2026-01-26"),
                          actualEndDate: new Date("2026-02-14"),
                        },
                      ],
                    },
                  },
                  {
                    title: "Foundation Concrete",
                    description: "Pouring concrete foundation",
                    order: 2,
                    progress: 60,
                    budgetAllocated: 1000000,
                    budgetPercent: 20,
                    subtasks: {
                      create: [
                        {
                          title: "Rebar placement",
                          order: 1,
                          createdBy: pic.id,
                          progress: 100,
                          projectedStartDate: new Date("2026-02-16"),
                          projectedEndDate: new Date("2026-02-28"),
                        },
                        {
                          title: "Concrete pouring",
                          order: 2,
                          createdBy: pic.id,
                          progress: 50,
                          projectedStartDate: new Date("2026-03-01"),
                          projectedEndDate: new Date("2026-03-15"),
                        },
                      ],
                    },
                  },
                ],
              },
            },
            {
              name: "Structural Work",
              description: "Steel frame and columns",
              progress: 40,
              budgetAllocated: 2500000,
              budgetPercent: 50,
              tasks: {
                create: [
                  {
                    title: "Steel Frame Installation",
                    description: "Install main steel columns",
                    order: 1,
                    progress: 40,
                    budgetAllocated: 2500000,
                    budgetPercent: 50,
                    subtasks: {
                      create: [
                        {
                          title: "Column layout",
                          order: 1,
                          createdBy: pic.id,
                          progress: 100,
                          projectedStartDate: new Date("2026-03-16"),
                          projectedEndDate: new Date("2026-03-30"),
                        },
                        {
                          title: "Beam connection",
                          order: 2,
                          createdBy: pic.id,
                          progress: 30,
                          projectedStartDate: new Date("2026-04-01"),
                          projectedEndDate: new Date("2026-04-30"),
                        },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },

        projectMembers: {
          create: [
            {
              userId: pic.id,
              role: "OWNER",
            },
            {
              userId: leader.id,
              role: "SUB_OWNER",
            },
            {
              userId: member.id,
              role: "MEMBER",
            },
          ],
        },

        approvals: {
          create: [
            {
              level: "BU_HEAD",
              order: 0,
              status: "APPROVED",
              approverId: buHead.id,
              actedAt: new Date("2026-01-10"),
              remarks: "Approved - Good planning",
              isFinal: false,
            },
            {
              level: "OP",
              order: 1,
              status: "APPROVED",
              approverId: op.id,
              actedAt: new Date("2026-01-12"),
              remarks: "Final approval given",
              isFinal: true,
            },
          ],
        },
      },
    }));

  console.log("✅ Active project created");

  //////////////////////////////
  // PROJECT 2: DRAFT
  //////////////////////////////

  const existingProject2 = await prisma.project.findFirst({
    where: { pin: "PROJ-002" },
  });

  const draftProject =
    existingProject2 ||
    (await prisma.project.create({
      data: {
        name: "School Building - Planning Phase",
        description: "New school construction project (draft)",
        pin: "PROJ-002",
        ownerId: pic.id,
        status: "DRAFT",
        versionNumber: 1,
        isActive: false,
        isLatestVersion: true,
        isLocked: false,
        requiresApproval: true,
        totalBudget: 3000000,

        scopes: {
          create: [
            {
              name: "Classroom Block",
              progress: 0,
              tasks: {
                create: [
                  {
                    title: "Design & Planning",
                    order: 1,
                    progress: 0,
                    subtasks: {
                      create: [
                        {
                          title: "Architectural design",
                          order: 1,
                          createdBy: pic.id,
                          progress: 0,
                        },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    }));

  console.log("✅ Draft project created");

  //////////////////////////////
  // PROJECT 3: FOR_REVIEW
  //////////////////////////////

  const existingProject3 = await prisma.project.findFirst({
    where: { pin: "PROJ-003" },
  });

  const reviewProject =
    existingProject3 ||
    (await prisma.project.create({
      data: {
        name: "Road Rehabilitation Project",
        description: "Waiting for approval",
        pin: "PROJ-003",
        ownerId: pic.id,
        status: "FOR_REVIEW",
        versionNumber: 1,
        isActive: false,
        isLatestVersion: true,
        isLocked: false,
        requiresApproval: true,
        totalBudget: 2000000,

        scopes: {
          create: [
            {
              name: "Road Surface",
              progress: 0,
              tasks: {
                create: [
                  {
                    title: "Asphalt laying",
                    order: 1,
                    progress: 0,
                    subtasks: {
                      create: [
                        {
                          title: "Survey and marking",
                          order: 1,
                          createdBy: pic.id,
                          progress: 0,
                        },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },

        approvals: {
          create: [
            {
              level: "BU_HEAD",
              order: 0,
              status: "PENDING",
              approverId: buHead.id,
              isFinal: false,
            },
          ],
        },
      },
    }));

  console.log("✅ For-review project created");

  //////////////////////////////
  // PROJECT 4: VERSION EXAMPLE (V1 + V2)
  //////////////////////////////

  const existingProject4 = await prisma.project.findFirst({
    where: { pin: "PROJ-004" },
  });

  const v1Project =
    existingProject4 ||
    (await prisma.project.create({
      data: {
        name: "Water Treatment Plant",
        description: "Version 1 - Original plan",
        pin: "PROJ-004",
        versionNumber: 1,
        ownerId: pic.id,
        status: "ACTIVE",
        isActive: false,
        isLatestVersion: false,
        isLocked: true,
        requiresApproval: true,
        totalBudget: 4500000,

        scopes: {
          create: [
            {
              name: "Treatment Tanks",
              progress: 50,
              tasks: {
                create: [
                  {
                    title: "Tank construction",
                    order: 1,
                    progress: 50,
                    subtasks: {
                      create: [
                        {
                          title: "Concrete work",
                          order: 1,
                          createdBy: pic.id,
                          progress: 50,
                        },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },

        approvals: {
          create: [
            {
              level: "BU_HEAD",
              order: 0,
              status: "APPROVED",
              approverId: buHead.id,
              isFinal: false,
            },
            {
              level: "OP",
              order: 1,
              status: "APPROVED",
              approverId: op.id,
              isFinal: true,
            },
          ],
        },
      },
    }));

  // Create V2 as a child version
  const v2Project = existingProject4
    ? null
    : await prisma.project.create({
        data: {
          name: "Water Treatment Plant",
          description: "Version 2 - Updated timeline (typhoon delay)",
          pin: "PROJ-004",
          versionNumber: 2,
          ownerId: pic.id,
          status: "ACTIVE",
          isActive: true,
          isLatestVersion: true,
          isLocked: false,
          requiresApproval: true,
          totalBudget: 4800000, // increased budget
          parentProjectId: v1Project.id,
          rootProjectId: v1Project.id,

          scopes: {
            create: [
              {
                name: "Treatment Tanks",
                progress: 50,
                tasks: {
                  create: [
                    {
                      title: "Tank construction",
                      order: 1,
                      progress: 50,
                      subtasks: {
                        create: [
                          {
                            title: "Concrete work",
                            order: 1,
                            createdBy: pic.id,
                            progress: 50,
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },

          approvals: {
            create: [
              {
                level: "BU_HEAD",
                order: 0,
                status: "APPROVED",
                approverId: buHead.id,
                isFinal: false,
              },
              {
                level: "OP",
                order: 1,
                status: "APPROVED",
                approverId: op.id,
                isFinal: true,
              },
            ],
          },
        },
      });

  console.log("✅ Versioned projects created (v1 + v2)");

  //////////////////////////////
  // APPROVAL FLOWS (Dynamic workflow configuration)
  //////////////////////////////

  // Default Flow: BU_HEAD → OP
  const defaultFlow = await prisma.approvalFlow.upsert({
    where: { name: "BU_HEAD → OP" },
    update: {},
    create: {
      name: "BU_HEAD → OP",
      description:
        "Standard approval workflow: BU Head review then OP final approval",
      isDefault: true,
      isActive: true,
      steps: {
        create: [
          {
            order: 1,
            role: "BU_HEAD",
            requiresAll: 1, // All BU_HEAD users must approve
            canReject: true,
          },
          {
            order: 2,
            role: "OP",
            requiresAll: 0, // Any one OP user can approve
            canReject: true,
          },
        ],
      },
    },
  });

  // Optional Flow: Director → BU_HEAD → OP
  const directorFlow = await prisma.approvalFlow.upsert({
    where: { name: "Director → BU_HEAD → OP" },
    update: {},
    create: {
      name: "Director → BU_HEAD → OP",
      description: "Extended workflow for high-risk projects",
      isDefault: false,
      isActive: true,
      steps: {
        create: [
          {
            order: 1,
            role: "DIRECTOR",
            requiresAll: 0,
            canReject: true,
          },
          {
            order: 2,
            role: "BU_HEAD",
            requiresAll: 1,
            canReject: true,
          },
          {
            order: 3,
            role: "OP",
            requiresAll: 0,
            canReject: true,
          },
        ],
      },
    },
  });

  console.log("✅ Approval flows created (1 default)");

  console.log("\n✅✅✅ SEEDING COMPLETED SUCCESSFULLY!\n");
  console.log("📊 Summary:");
  console.log(`   Modules: ${modules.length}`);
  console.log(`   Roles: ${roles.length} (all with FULL permissions)`);
  console.log(`   Users: 6`);
  console.log(`   Projects: 4 (1 active, 1 draft, 1 pending, 2 versioned)`);
  console.log(`   Approval Flows: 2 (1 default available for assignment)`);
  console.log(`\n🔑 Test Login Credentials:`);
  console.log(`   superadmin@test.com / password123`);
  console.log(`   pic@test.com / password123`);
  console.log(`   buhead@test.com / password123`);
  console.log(`   op@test.com / password123`);
  console.log(`   leader@test.com / password123`);
  console.log(`   member@test.com / password123\n`);
}

main()
  .catch((e) => {
    console.error("❌ Seeding error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
