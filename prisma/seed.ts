import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import * as fs from "fs";
import * as path from "path";

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
    { name: "ADMIN", path: "/approval-flows" },
    { name: "SETTINGS", path: "/settings" },
    { name: "BUSINESS_UNITS", path: "/business-units" },
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

  console.log("✅ Modules created (16 total)");

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

  // //////////////////////////////
  // // PROJECT 1: ACTIVE (APPROVED)
  // //////////////////////////////

  // const existingProject1 = await prisma.project.findFirst({
  //   where: { pin: "PROJ-001" },
  // });

  // const activeProject =
  //   existingProject1 ||
  //   (await prisma.project.create({
  //     data: {
  //       name: "Hospital Construction - Phase 1",
  //       description: "Main structure and foundation work",
  //       pin: "PROJ-001",
  //       location: { city: "Manila", zone: "Zone A" },
  //       businessUnit: "Infrastructure",
  //       entity: "Building Division",
  //       ownerId: pic.id,
  //       status: "ACTIVE",
  //       versionNumber: 1,
  //       isActive: true,
  //       isLatestVersion: true,
  //       isLocked: false,
  //       requiresApproval: true,
  //       startDate: new Date("2026-01-15"),
  //       expectedEndDate: new Date("2026-06-30"),
  //       totalBudget: 5000000,
  //       priority: "HIGH",

  //       scopes: {
  //         create: [
  //           {
  //             name: "Foundation Work",
  //             description: "Excavation and concrete foundation",
  //             progress: 75,
  //             budgetAllocated: 1500000,
  //             budgetPercent: 30,
  //             tasks: {
  //               create: [
  //                 {
  //                   title: "Soil Excavation",
  //                   description: "Clearing and excavating site",
  //                   order: 1,
  //                   progress: 100,
  //                   budgetAllocated: 500000,
  //                   budgetPercent: 10,
  //                   subtasks: {
  //                     create: [
  //                       {
  //                         title: "Site survey",
  //                         order: 1,
  //                         createdBy: pic.id,
  //                         progress: 100,
  //                         projectedStartDate: new Date("2026-01-15"),
  //                         projectedEndDate: new Date("2026-01-25"),
  //                         actualStartDate: new Date("2026-01-15"),
  //                         actualEndDate: new Date("2026-01-24"),
  //                       },
  //                       {
  //                         title: "Soil removal",
  //                         order: 2,
  //                         createdBy: pic.id,
  //                         progress: 100,
  //                         projectedStartDate: new Date("2026-01-26"),
  //                         projectedEndDate: new Date("2026-02-15"),
  //                         actualStartDate: new Date("2026-01-26"),
  //                         actualEndDate: new Date("2026-02-14"),
  //                       },
  //                     ],
  //                   },
  //                 },
  //                 {
  //                   title: "Foundation Concrete",
  //                   description: "Pouring concrete foundation",
  //                   order: 2,
  //                   progress: 60,
  //                   budgetAllocated: 1000000,
  //                   budgetPercent: 20,
  //                   subtasks: {
  //                     create: [
  //                       {
  //                         title: "Rebar placement",
  //                         order: 1,
  //                         createdBy: pic.id,
  //                         progress: 100,
  //                         projectedStartDate: new Date("2026-02-16"),
  //                         projectedEndDate: new Date("2026-02-28"),
  //                       },
  //                       {
  //                         title: "Concrete pouring",
  //                         order: 2,
  //                         createdBy: pic.id,
  //                         progress: 50,
  //                         projectedStartDate: new Date("2026-03-01"),
  //                         projectedEndDate: new Date("2026-03-15"),
  //                       },
  //                     ],
  //                   },
  //                 },
  //               ],
  //             },
  //           },
  //           {
  //             name: "Structural Work",
  //             description: "Steel frame and columns",
  //             progress: 40,
  //             budgetAllocated: 2500000,
  //             budgetPercent: 50,
  //             tasks: {
  //               create: [
  //                 {
  //                   title: "Steel Frame Installation",
  //                   description: "Install main steel columns",
  //                   order: 1,
  //                   progress: 40,
  //                   budgetAllocated: 2500000,
  //                   budgetPercent: 50,
  //                   subtasks: {
  //                     create: [
  //                       {
  //                         title: "Column layout",
  //                         order: 1,
  //                         createdBy: pic.id,
  //                         progress: 100,
  //                         projectedStartDate: new Date("2026-03-16"),
  //                         projectedEndDate: new Date("2026-03-30"),
  //                       },
  //                       {
  //                         title: "Beam connection",
  //                         order: 2,
  //                         createdBy: pic.id,
  //                         progress: 30,
  //                         projectedStartDate: new Date("2026-04-01"),
  //                         projectedEndDate: new Date("2026-04-30"),
  //                       },
  //                     ],
  //                   },
  //                 },
  //               ],
  //             },
  //           },
  //         ],
  //       },

  //       projectMembers: {
  //         create: [
  //           {
  //             userId: pic.id,
  //             role: "OWNER",
  //           },
  //           {
  //             userId: leader.id,
  //             role: "SUB_OWNER",
  //           },
  //           {
  //             userId: member.id,
  //             role: "MEMBER",
  //           },
  //         ],
  //       },

  //       approvals: {
  //         create: [
  //           {
  //             level: "BU_HEAD",
  //             order: 0,
  //             status: "APPROVED",
  //             approverId: buHead.id,
  //             actedAt: new Date("2026-01-10"),
  //             remarks: "Approved - Good planning",
  //             isFinal: false,
  //           },
  //           {
  //             level: "OP",
  //             order: 1,
  //             status: "APPROVED",
  //             approverId: op.id,
  //             actedAt: new Date("2026-01-12"),
  //             remarks: "Final approval given",
  //             isFinal: true,
  //           },
  //         ],
  //       },
  //     },
  //   }));

  // console.log("✅ Active project created");

  // //////////////////////////////
  // // PROJECT 2: DRAFT
  // //////////////////////////////

  // const existingProject2 = await prisma.project.findFirst({
  //   where: { pin: "PROJ-002" },
  // });

  // const draftProject =
  //   existingProject2 ||
  //   (await prisma.project.create({
  //     data: {
  //       name: "School Building - Planning Phase",
  //       description: "New school construction project (draft)",
  //       pin: "PROJ-002",
  //       ownerId: pic.id,
  //       status: "DRAFT",
  //       versionNumber: 1,
  //       isActive: false,
  //       isLatestVersion: true,
  //       isLocked: false,
  //       requiresApproval: true,
  //       totalBudget: 3000000,

  //       scopes: {
  //         create: [
  //           {
  //             name: "Classroom Block",
  //             progress: 0,
  //             tasks: {
  //               create: [
  //                 {
  //                   title: "Design & Planning",
  //                   order: 1,
  //                   progress: 0,
  //                   subtasks: {
  //                     create: [
  //                       {
  //                         title: "Architectural design",
  //                         order: 1,
  //                         createdBy: pic.id,
  //                         progress: 0,
  //                       },
  //                     ],
  //                   },
  //                 },
  //               ],
  //             },
  //           },
  //         ],
  //       },
  //     },
  //   }));

  // console.log("✅ Draft project created");

  // //////////////////////////////
  // // PROJECT 3: FOR_REVIEW
  // //////////////////////////////

  // const existingProject3 = await prisma.project.findFirst({
  //   where: { pin: "PROJ-003" },
  // });

  // const reviewProject =
  //   existingProject3 ||
  //   (await prisma.project.create({
  //     data: {
  //       name: "Road Rehabilitation Project",
  //       description: "Waiting for approval",
  //       pin: "PROJ-003",
  //       ownerId: pic.id,
  //       status: "FOR_REVIEW",
  //       versionNumber: 1,
  //       isActive: false,
  //       isLatestVersion: true,
  //       isLocked: false,
  //       requiresApproval: true,
  //       totalBudget: 2000000,

  //       scopes: {
  //         create: [
  //           {
  //             name: "Road Surface",
  //             progress: 0,
  //             tasks: {
  //               create: [
  //                 {
  //                   title: "Asphalt laying",
  //                   order: 1,
  //                   progress: 0,
  //                   subtasks: {
  //                     create: [
  //                       {
  //                         title: "Survey and marking",
  //                         order: 1,
  //                         createdBy: pic.id,
  //                         progress: 0,
  //                       },
  //                     ],
  //                   },
  //                 },
  //               ],
  //             },
  //           },
  //         ],
  //       },

  //       approvals: {
  //         create: [
  //           {
  //             level: "BU_HEAD",
  //             order: 0,
  //             status: "PENDING",
  //             approverId: buHead.id,
  //             isFinal: false,
  //           },
  //         ],
  //       },
  //     },
  //   }));

  // console.log("✅ For-review project created");

  // //////////////////////////////
  // // PROJECT 4: VERSION EXAMPLE (V1 + V2)
  // //////////////////////////////

  // const existingProject4 = await prisma.project.findFirst({
  //   where: { pin: "PROJ-004" },
  // });

  // const v1Project =
  //   existingProject4 ||
  //   (await prisma.project.create({
  //     data: {
  //       name: "Water Treatment Plant",
  //       description: "Version 1 - Original plan",
  //       pin: "PROJ-004",
  //       versionNumber: 1,
  //       ownerId: pic.id,
  //       status: "ACTIVE",
  //       isActive: false,
  //       isLatestVersion: false,
  //       isLocked: true,
  //       requiresApproval: true,
  //       totalBudget: 4500000,

  //       scopes: {
  //         create: [
  //           {
  //             name: "Treatment Tanks",
  //             progress: 50,
  //             tasks: {
  //               create: [
  //                 {
  //                   title: "Tank construction",
  //                   order: 1,
  //                   progress: 50,
  //                   subtasks: {
  //                     create: [
  //                       {
  //                         title: "Concrete work",
  //                         order: 1,
  //                         createdBy: pic.id,
  //                         progress: 50,
  //                       },
  //                     ],
  //                   },
  //                 },
  //               ],
  //             },
  //           },
  //         ],
  //       },

  //       approvals: {
  //         create: [
  //           {
  //             level: "BU_HEAD",
  //             order: 0,
  //             status: "APPROVED",
  //             approverId: buHead.id,
  //             isFinal: false,
  //           },
  //           {
  //             level: "OP",
  //             order: 1,
  //             status: "APPROVED",
  //             approverId: op.id,
  //             isFinal: true,
  //           },
  //         ],
  //       },
  //     },
  //   }));

  // // Create V2 as a child version
  // const v2Project = existingProject4
  //   ? null
  //   : await prisma.project.create({
  //       data: {
  //         name: "Water Treatment Plant",
  //         description: "Version 2 - Updated timeline (typhoon delay)",
  //         pin: "PROJ-004",
  //         versionNumber: 2,
  //         ownerId: pic.id,
  //         status: "ACTIVE",
  //         isActive: true,
  //         isLatestVersion: true,
  //         isLocked: false,
  //         requiresApproval: true,
  //         totalBudget: 4800000, // increased budget
  //         parentProjectId: v1Project.id,
  //         rootProjectId: v1Project.id,

  //         scopes: {
  //           create: [
  //             {
  //               name: "Treatment Tanks",
  //               progress: 50,
  //               tasks: {
  //                 create: [
  //                   {
  //                     title: "Tank construction",
  //                     order: 1,
  //                     progress: 50,
  //                     subtasks: {
  //                       create: [
  //                         {
  //                           title: "Concrete work",
  //                           order: 1,
  //                           createdBy: pic.id,
  //                           progress: 50,
  //                         },
  //                       ],
  //                     },
  //                   },
  //                 ],
  //               },
  //             },
  //           ],
  //         },

  //         approvals: {
  //           create: [
  //             {
  //               level: "BU_HEAD",
  //               order: 0,
  //               status: "APPROVED",
  //               approverId: buHead.id,
  //               isFinal: false,
  //             },
  //             {
  //               level: "OP",
  //               order: 1,
  //               status: "APPROVED",
  //               approverId: op.id,
  //               isFinal: true,
  //             },
  //           ],
  //         },
  //       },
  //     });

  // console.log("✅ Versioned projects created (v1 + v2)");

  //////////////////////////////
// PROJECT 5: REAL CONSTRUCTION PROJECT SEED
//////////////////////////////

const existingProject5 = await prisma.project.findFirst({
  where: { pin: "PROJ-005" },
});

const realProject =
  existingProject5 ||
  (await prisma.project.create({
    data: {
      name: "Commercial Fit-Out Project",
      description:
        "Actual commercial construction and fit-out project with detailed scopes and timeline",
      pin: "PROJ-005",
      location: {
        city: "Manila",
        zone: "Business District",
      },
      businessUnit: "Construction",
      entity: "Fit-Out Division",
      ownerId: pic.id,
      status: "ACTIVE",
      versionNumber: 1,
      isActive: true,
      isLatestVersion: true,
      isLocked: false,
      requiresApproval: true,
      startDate: new Date("2024-07-18"),
      expectedEndDate: new Date("2024-08-28"),
      totalBudget: 1832403.33,
      priority: "HIGH",

      scopes: {
        create: [
          ///////////////////////////////////////
          // GENERAL REQUIREMENTS
          ///////////////////////////////////////
          {
            name: "General Requirements",
            description:
              "Mobilization, supervision, hauling and temporary facilities",
            progress: 67,
            budgetAllocated: 110835,
            budgetPercent: 6.05,

            tasks: {
              create: [
                {
                  title:
                    "Mobilization / Demobilization / TEMFACIL / Hauling / Supervision",
                  description:
                    "Site mobilization and project preparation activities",
                  order: 1,
                  progress: 67,
                  budgetAllocated: 110835,
                  budgetPercent: 6.05,

                  subtasks: {
                    create: [
                      {
                        title: "Site Mobilization",
                        order: 1,
                        createdBy: pic.id,
                        progress: 67,
                        status: 1,
                        projectedStartDate: new Date("2024-07-18"),
                        projectedEndDate: new Date("2024-08-28"),
                      },
                    ],
                  },
                },
              ],
            },
          },

          ///////////////////////////////////////
          // CIVIL & ARCHITECTURAL
          ///////////////////////////////////////
          {
            name: "Civil & Architectural",
            description: "Main civil and architectural works",
            progress: 62,
            budgetAllocated: 1721568.33,
            budgetPercent: 93.95,

            tasks: {
              create: [
                ///////////////////////////////////////
                // DISMANTLING
                ///////////////////////////////////////
                {
                  title: "Dismantling Works",
                  description: "Removal of existing wall and structures",
                  order: 1,
                  progress: 100,
                  budgetAllocated: 10341,
                  budgetPercent: 0.56,

                  subtasks: {
                    create: [
                      {
                        title: "Dismantling of Existing Wall",
                        order: 1,
                        createdBy: pic.id,
                        progress: 100,
                        status: 2,
                        projectedStartDate: new Date("2024-07-18"),
                        projectedEndDate: new Date("2024-07-19"),
                        actualStartDate: new Date("2024-07-18"),
                        actualEndDate: new Date("2024-07-19"),
                      },
                    ],
                  },
                },

                ///////////////////////////////////////
                // WALL PARTITION
                ///////////////////////////////////////
                {
                  title: "Wall Partition & Finishing Works",
                  description: "Partition installation and wall finishing",
                  order: 2,
                  progress: 56,
                  budgetAllocated: 100461.17,
                  budgetPercent: 5.48,

                  subtasks: {
                    create: [
                      {
                        title: "Wall Partition (Single)",
                        order: 1,
                        createdBy: pic.id,
                        progress: 100,
                        status: 2,
                        projectedStartDate: new Date("2024-07-19"),
                        projectedEndDate: new Date("2024-07-28"),
                      },
                      {
                        title: "Wall Partition (Double)",
                        order: 2,
                        createdBy: pic.id,
                        progress: 44,
                        status: 1,
                        projectedStartDate: new Date("2024-07-25"),
                        projectedEndDate: new Date("2024-08-01"),
                      },
                      {
                        title: "WF-2 Skimcoat Superfine Gray",
                        order: 3,
                        createdBy: pic.id,
                        progress: 44,
                        status: 1,
                        projectedStartDate: new Date("2024-08-09"),
                        projectedEndDate: new Date("2024-08-22"),
                      },
                      {
                        title: "WF-3 Wall Cladding",
                        order: 4,
                        createdBy: pic.id,
                        progress: 34,
                        status: 1,
                        projectedStartDate: new Date("2024-08-11"),
                        projectedEndDate: new Date("2024-08-15"),
                      },
                      {
                        title: "WF-1 300x300mm Tiles",
                        order: 5,
                        createdBy: pic.id,
                        progress: 0,
                        status: 0,
                        projectedStartDate: new Date("2024-08-02"),
                        projectedEndDate: new Date("2024-08-18"),
                      },
                    ],
                  },
                },

                ///////////////////////////////////////
                // CEILING
                ///////////////////////////////////////
                {
                  title: "Ceiling Works",
                  description: "Gypsum board and ceiling painting",
                  order: 3,
                  progress: 40,
                  budgetAllocated: 52299,
                  budgetPercent: 2.85,

                  subtasks: {
                    create: [
                      {
                        title:
                          "9mm Moisture Resistant Gypsum Board on Metal Framing",
                        order: 1,
                        createdBy: pic.id,
                        progress: 50,
                        status: 1,
                        projectedStartDate: new Date("2024-07-30"),
                        projectedEndDate: new Date("2024-08-18"),
                      },
                      {
                        title: "Painting of Ceiling",
                        order: 2,
                        createdBy: pic.id,
                        progress: 0,
                        status: 0,
                        projectedStartDate: new Date("2024-08-18"),
                        projectedEndDate: new Date("2024-08-24"),
                      },
                    ],
                  },
                },

                ///////////////////////////////////////
                // FLOORING
                ///////////////////////////////////////
                {
                  title: "Flooring Works",
                  description: "EPS, waterproofing, topping and tile installation",
                  order: 4,
                  progress: 30,
                  budgetAllocated: 95170.01,
                  budgetPercent: 5.19,

                  subtasks: {
                    create: [
                      {
                        title: "Installation of EPS",
                        order: 1,
                        createdBy: pic.id,
                        progress: 100,
                        status: 2,
                        projectedStartDate: new Date("2024-07-29"),
                        projectedEndDate: new Date("2024-07-30"),
                      },
                      {
                        title: "Installation of Waterproofing",
                        order: 2,
                        createdBy: pic.id,
                        progress: 100,
                        status: 2,
                        projectedStartDate: new Date("2024-07-30"),
                        projectedEndDate: new Date("2024-07-31"),
                      },
                      {
                        title: "Floor Topping",
                        order: 3,
                        createdBy: pic.id,
                        progress: 80,
                        status: 1,
                        projectedStartDate: new Date("2024-08-02"),
                        projectedEndDate: new Date("2024-08-04"),
                      },
                      {
                        title: "Installation of Tiles - FF1",
                        order: 4,
                        createdBy: pic.id,
                        progress: 0,
                        status: 0,
                        projectedStartDate: new Date("2024-08-05"),
                        projectedEndDate: new Date("2024-08-06"),
                      },
                      {
                        title: "Installation of Tiles - FF2",
                        order: 5,
                        createdBy: pic.id,
                        progress: 0,
                        status: 0,
                        projectedStartDate: new Date("2024-08-06"),
                        projectedEndDate: new Date("2024-08-07"),
                      },
                      {
                        title: "Installation of Tiles - FF3",
                        order: 6,
                        createdBy: pic.id,
                        progress: 0,
                        status: 0,
                        projectedStartDate: new Date("2024-08-07"),
                        projectedEndDate: new Date("2024-08-18"),
                      },
                    ],
                  },
                },

                ///////////////////////////////////////
                // ELECTRICAL
                ///////////////////////////////////////
                {
                  title: "Electrical Works",
                  description: "Electrical roughing-ins and fixtures",
                  order: 5,
                  progress: 55,
                  budgetAllocated: 247136.18,
                  budgetPercent: 13.49,

                  subtasks: {
                    create: [
                      {
                        title: "Pipes and Conduits Roughing-ins",
                        order: 1,
                        createdBy: pic.id,
                        progress: 98,
                        status: 1,
                        projectedStartDate: new Date("2024-07-22"),
                        projectedEndDate: new Date("2024-08-10"),
                      },
                      {
                        title: "Wires and Cables",
                        order: 2,
                        createdBy: pic.id,
                        progress: 60,
                        status: 1,
                        projectedStartDate: new Date("2024-07-25"),
                        projectedEndDate: new Date("2024-08-10"),
                      },
                      {
                        title: "Outlet & Switch",
                        order: 3,
                        createdBy: pic.id,
                        progress: 0,
                        status: 0,
                        projectedStartDate: new Date("2024-08-22"),
                        projectedEndDate: new Date("2024-08-23"),
                      },
                      {
                        title: "Lighting Fixtures - Downlight 11W",
                        order: 4,
                        createdBy: pic.id,
                        progress: 0,
                        status: 0,
                        projectedStartDate: new Date("2024-08-24"),
                        projectedEndDate: new Date("2024-08-25"),
                      },
                    ],
                  },
                },

                ///////////////////////////////////////
                // CABINETRY / STAINLESS
                ///////////////////////////////////////
                {
                  title: "Cabinetry / Stainless / Showcase",
                  description: "Cabinets, stainless works and showcase",
                  order: 6,
                  progress: 72,
                  budgetAllocated: 816410.8,
                  budgetPercent: 44.55,

                  subtasks: {
                    create: [
                      {
                        title: "Overhead Cabinet at Refrigerator & Savory",
                        order: 1,
                        createdBy: pic.id,
                        progress: 100,
                        status: 2,
                        projectedStartDate: new Date("2024-08-08"),
                        projectedEndDate: new Date("2024-08-09"),
                      },
                      {
                        title: "Overhead Cabinet at Service Area",
                        order: 2,
                        createdBy: pic.id,
                        progress: 100,
                        status: 2,
                        projectedStartDate: new Date("2024-08-09"),
                        projectedEndDate: new Date("2024-08-10"),
                      },
                      {
                        title: "Office Cabinet",
                        order: 3,
                        createdBy: pic.id,
                        progress: 70,
                        status: 1,
                        projectedStartDate: new Date("2024-08-08"),
                        projectedEndDate: new Date("2024-08-10"),
                      },
                      {
                        title: "Stainless Steel & Signages",
                        order: 4,
                        createdBy: pic.id,
                        progress: 80,
                        status: 1,
                        projectedStartDate: new Date("2024-08-11"),
                        projectedEndDate: new Date("2024-08-26"),
                      },
                      {
                        title: "Showcase",
                        order: 5,
                        createdBy: pic.id,
                        progress: 60,
                        status: 1,
                        projectedStartDate: new Date("2024-08-15"),
                        projectedEndDate: new Date("2024-08-26"),
                      },
                    ],
                  },
                },

                ///////////////////////////////////////
                // MECHANICAL
                ///////////////////////////////////////
                {
                  title: "Mechanical Works",
                  description: "Mechanical piping and supports",
                  order: 7,
                  progress: 45,
                  budgetAllocated: 144208.94,
                  budgetPercent: 7.87,

                  subtasks: {
                    create: [
                      {
                        title: "Piping, Hangers & Supports",
                        order: 1,
                        createdBy: pic.id,
                        progress: 45,
                        status: 1,
                        projectedStartDate: new Date("2024-08-10"),
                        projectedEndDate: new Date("2024-08-18"),
                      },
                    ],
                  },
                },

                ///////////////////////////////////////
                // PLUMBING
                ///////////////////////////////////////
                {
                  title: "Plumbing Works",
                  description: "Full plumbing installation",
                  order: 8,
                  progress: 65,
                  budgetAllocated: 96924.6,
                  budgetPercent: 5.29,

                  subtasks: {
                    create: [
                      {
                        title: "Plumbing Works",
                        order: 1,
                        createdBy: pic.id,
                        progress: 65,
                        status: 1,
                        projectedStartDate: new Date("2024-07-18"),
                        projectedEndDate: new Date("2024-08-26"),
                      },
                    ],
                  },
                },

                ///////////////////////////////////////
                // AUXILIARY
                ///////////////////////////////////////
                {
                  title: "Auxiliary Works",
                  description: "Additional project auxiliary works",
                  order: 9,
                  progress: 20,
                  budgetAllocated: 48595.95,
                  budgetPercent: 2.65,

                  subtasks: {
                    create: [
                      {
                        title: "Auxiliary Works",
                        order: 1,
                        createdBy: pic.id,
                        progress: 20,
                        status: 1,
                        projectedStartDate: new Date("2024-08-15"),
                        projectedEndDate: new Date("2024-08-25"),
                      },
                    ],
                  },
                },

                ///////////////////////////////////////
                // PUNCHLIST
                ///////////////////////////////////////
                {
                  title: "Punchlisting",
                  description: "Final punchlist and turnover",
                  order: 10,
                  progress: 0,
                  budgetAllocated: 0,
                  budgetPercent: 0,

                  subtasks: {
                    create: [
                      {
                        title: "Punchlisting",
                        order: 1,
                        createdBy: pic.id,
                        progress: 0,
                        status: 0,
                        projectedStartDate: new Date("2024-08-26"),
                        projectedEndDate: new Date("2024-08-26"),
                      },
                      {
                        title: "Rectify Punchlist",
                        order: 2,
                        createdBy: pic.id,
                        progress: 0,
                        status: 0,
                        projectedStartDate: new Date("2024-08-26"),
                        projectedEndDate: new Date("2024-08-27"),
                      },
                      {
                        title: "Checklist and COCA",
                        order: 3,
                        createdBy: pic.id,
                        progress: 0,
                        status: 0,
                        projectedStartDate: new Date("2024-08-28"),
                        projectedEndDate: new Date("2024-08-28"),
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
              actedAt: new Date("2024-07-15"),
              remarks: "Approved construction schedule",
              isFinal: false,
            },
            {
              level: "OP",
              order: 1,
              status: "APPROVED",
              approverId: op.id,
              actedAt: new Date("2024-07-16"),
              remarks: "Final approval granted",
              isFinal: true,
            },
          ],
        },
      },
    }));

console.log("✅ Real construction project created");

  //////////////////////////////
  // PROGRESS LOGS (Calendar-based daily progress)
  //////////////////////////////

  // Fetch all subtasks from the real project
  const allTasks = await prisma.task.findMany({
    where: {
      scope: {
        projectId: realProject.id,
      },
    },
    include: {
      subtasks: true,
    },
  });

  // Create progress logs for each subtask
  for (const task of allTasks) {
    for (const subtask of task.subtasks) {
      if (subtask.progress > 0 && subtask.projectedStartDate && subtask.projectedEndDate) {
        // Calculate days between start and end date
        const startDate = new Date(subtask.projectedStartDate);
        const endDate = new Date(subtask.projectedEndDate);
        const daysCount = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

        // Create daily progress logs
        let cumulativeProgress = 0;
        for (let dayOffset = 0; dayOffset < daysCount; dayOffset++) {
          const logDate = new Date(startDate);
          logDate.setDate(logDate.getDate() + dayOffset);

          // Calculate daily increment - gradually reach target progress
          const dailyIncrement = Math.min(
            subtask.progress / daysCount,
            subtask.progress - cumulativeProgress
          );
          
          cumulativeProgress = Math.min(cumulativeProgress + dailyIncrement, subtask.progress);

          // Only create log if there's actual progress
          if (dailyIncrement > 0 || dayOffset === daysCount - 1) {
            try {
              await prisma.progressLog.upsert({
                where: {
                  subtaskId_date: {
                    subtaskId: subtask.id,
                    date: logDate,
                  },
                },
                update: {
                  dailyPercent: dailyIncrement,
                  cumulativePercent: cumulativeProgress,
                },
                create: {
                  subtaskId: subtask.id,
                  userId: leader.id,
                  date: logDate,
                  dailyPercent: dailyIncrement,
                  cumulativePercent: cumulativeProgress,
                  location: (realProject.location as any)?.city || "Manuel Roxas Blvd, Manila",
                  dayNumber: dayOffset + 1,
                },
              });
            } catch (err) {
              // Skip duplicate or constraint errors
            }
          }
        }
      }
    }
  }

  console.log("✅ Progress logs created from calendar dates");

  //////////////////////////////
  // UPDATE SUBTASK STATUS (Based on progress percentage)
  //////////////////////////////

  // Update all subtasks with correct status based on progress
  for (const task of allTasks) {
    for (const subtask of task.subtasks) {
      let newStatus = 0; // default: pending
      
      if (subtask.progress === 100) {
        newStatus = 2; // completed
      } else if (subtask.progress > 0) {
        newStatus = 1; // ongoing
      }

      await prisma.subtask.update({
        where: { id: subtask.id },
        data: { status: newStatus },
      });
    }
  }

  console.log("✅ Subtask status updated based on progress");

  //////////////////////////////
  // WORK SCHEDULES (Days & Holidays Configuration)
  //////////////////////////////
  // GLOBAL HOLIDAYS (Company-wide)
  //////////////////////////////

  // Seed some common holidays
  const newYearId = "holiday-2026-01-01";
  await prisma.holiday.upsert({
    where: { id: newYearId },
    update: {},
    create: {
      id: newYearId,
      date: new Date("2026-01-01"),
      name: "New Year's Day",
      description: "First day of the year",
    },
  });

  const christmasId = "holiday-2026-12-25";
  await prisma.holiday.upsert({
    where: { id: christmasId },
    update: {},
    create: {
      id: christmasId,
      date: new Date("2026-12-25"),
      name: "Christmas Day",
      description: "Christmas holiday",
    },
  });

  console.log("✅ Global holidays created (2 total)");

  //////////////////////////////
  // APPROVAL FLOWS (Dynamic workflow configuration)
  //////////////////////////////

  // Default Flow: BU_HEAD → OP (SEQUENTIAL)
  const defaultFlow = await (prisma as any).approvalFlow.upsert({
    where: { name: "BU_HEAD → OP" },
    update: {},
    create: {
      name: "BU_HEAD → OP",
      description:
        "Standard approval workflow: BU Head review then OP final approval",
      isDefault: true,
      isActive: true,
      executionMode: "SEQUENTIAL",  // 🔥 New: Sequential execution
      steps: {
        create: [
          {
            order: 1,
            role: "BU_HEAD",
            requiresAll: 1, // All BU_HEAD users must approve
            canReject: true,
            useSpecificUsers: false,  // 🔥 New: Will use role-based
          },
          {
            order: 2,
            role: "OP",
            requiresAll: 0, // Any one OP user can approve
            canReject: true,
            useSpecificUsers: false,  // 🔥 New: Will use role-based
          },
        ],
      },
    },
  });

  // Optional Flow: Director → BU_HEAD → OP (SEQUENTIAL)
  const directorFlow = await (prisma as any).approvalFlow.upsert({
    where: { name: "Director → BU_HEAD → OP" },
    update: {},
    create: {
      name: "Director → BU_HEAD → OP",
      description: "Extended workflow for high-risk projects",
      isDefault: false,
      isActive: true,
      executionMode: "SEQUENTIAL",  // 🔥 New: Sequential execution
      steps: {
        create: [
          {
            order: 1,
            role: "DIRECTOR",
            requiresAll: 0,
            canReject: true,
            useSpecificUsers: false,  // 🔥 New: Will use role-based
          },
          {
            order: 2,
            role: "BU_HEAD",
            requiresAll: 1,
            canReject: true,
            useSpecificUsers: false,  // 🔥 New: Will use role-based
          },
          {
            order: 3,
            role: "OP",
            requiresAll: 0,
            canReject: true,
            useSpecificUsers: false,  // 🔥 New: Will use role-based
          },
        ],
      },
    },
  });

  console.log("✅ Approval flows created (2 total: 1 default)");

  //////////////////////////////
  // PHILIPPINES GEOGRAPHICAL DATA
  //////////////////////////////

  // Load JSON data files
  const dataDir = path.join(__dirname, "../data");
  
  const regionsData = JSON.parse(
    fs.readFileSync(path.join(dataDir, "regions.json"), "utf-8")
  );
  const provincesData = JSON.parse(
    fs.readFileSync(path.join(dataDir, "provinces.json"), "utf-8")
  );
  const citiesData = JSON.parse(
    fs.readFileSync(path.join(dataDir, "cities.json"), "utf-8")
  );
  const barangaysData = JSON.parse(
    fs.readFileSync(path.join(dataDir, "barangays.json"), "utf-8")
  );
  const businessUnitsData = JSON.parse(
    fs.readFileSync(path.join(dataDir, "businessUnit.json"), "utf-8")
  );

  // Seed Regions
  const regions = await Promise.all(
    regionsData.map((region: any) =>
      prisma.region.upsert({
        where: { regCode: region.reg_code },
        update: {},
        create: {
          regCode: region.reg_code,
          regName: region.reg_name,
          isActive: true,
        },
      })
    )
  );

  console.log(`✅ Regions created (${regions.length} total)`);

  // Seed Provinces
  const provinces = await Promise.all(
    provincesData.map((province: any) =>
      prisma.province.upsert({
        where: { provCode: province.prov_code },
        update: {},
        create: {
          provCode: province.prov_code,
          provName: province.prov_name,
          regCode: province.reg_code,
          isActive: true,
        },
      })
    )
  );

  console.log(`✅ Provinces created (${provinces.length} total)`);

  // Seed Cities
  const cities = await Promise.all(
    citiesData.map((city: any) =>
      prisma.city.upsert({
        where: { cityCode: city.city_code },
        update: {},
        create: {
          cityCode: city.city_code,
          cityName: city.city_name,
          provCode: city.prov_code,
          isActive: true,
        },
      })
    )
  );

  console.log(`✅ Cities created (${cities.length} total)`);

  // Seed Barangays in batches to avoid exhausting DB connection pool
  const BATCH_SIZE = 500;
  let barangaysProcessed = 0;

  for (let i = 0; i < barangaysData.length; i += BATCH_SIZE) {
    const batch = barangaysData.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map((barangay: any) =>
        prisma.barangay.upsert({
          where: { brgyCode: barangay.brgy_code },
          update: {},
          create: {
            brgyCode: barangay.brgy_code,
            brgyName: barangay.brgy_name,
            cityCode: barangay.city_code,
            isActive: true,
          },
        })
      )
    );
    barangaysProcessed += batch.length;
  }

  console.log(`✅ Barangays created (${barangaysProcessed} total)`);

  // Seed Business Units
  const businessUnits = await Promise.all(
    businessUnitsData.map((bu: any) =>
      prisma.businessUnit.upsert({
        where: { code: bu.Title },
        update: {
          name: bu.BusinessUnit,
          entity: bu.Entity,
          isActive: true,
        },
        create: {
          code: bu.Title,
          name: bu.BusinessUnit,
          entity: bu.Entity,
          isActive: true,
        },
      })
    )
  );

  console.log(`✅ Business Units created (${businessUnits.length} total)`);

  console.log("\n✅✅✅ SEEDING COMPLETED SUCCESSFULLY!\n");
  console.log("📊 Summary:");
  console.log(`   Modules: ${modules.length}`);
  console.log(`   Roles: ${roles.length} (all with FULL permissions)`);
  console.log(`   Users: 6`);
  console.log(`   Projects: 1 (Real Construction - Commercial Fit-Out, ACTIVE with full approval history)`);
  console.log(`   Approval Flows: 2 (1 default available for assignment)`);
  console.log(`   📍 Geographical Data:`);
  console.log(`      - Regions: ${regions.length}`);
  console.log(`      - Provinces: ${provinces.length}`);
  console.log(`      - Cities: ${cities.length}`);
  console.log(`      - Barangays: ${barangaysProcessed}`);
  console.log(`   🏢 Business Units: ${businessUnits.length}`);
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
