import "dotenv/config";
import { createHash } from "crypto";
import prisma from "../src/config/prisma";

const SOURCE_PRODUCTION_PROJECT_ID: string = "57cd1016-8271-48b7-a685-e62bb65bbcd8";
const SAMPLE_PROJECT_ID: string = "8e4f4ad7-ea5d-4c8c-92cf-cdd1384cb501";
const REQUIRED_CONFIRMATION = "ALLOW_LOCAL_SAMPLE_SEED";
const ALLOWED_LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

type TaskSeed = {
  title: string;
  budget: number;
};

type ScopeSeed = {
  name: string;
  budget: number;
  tasks: TaskSeed[];
};

const scopes: ScopeSeed[] = [
  {
    name: "General Requirements",
    budget: 110300,
    tasks: [
      { title: "Mob/Demob", budget: 26000 },
      { title: "Management and Supervision", budget: 31500 },
      { title: "HSE Requirement", budget: 10400 },
      { title: "Bonds and Insurances", budget: 9400 },
      { title: "Barracks", budget: 27000 },
      { title: "Scaffolding Rentals", budget: 6000 },
    ],
  },
  {
    name: "Architectural Works",
    budget: 294229.51,
    tasks: [
      { title: "Area Preparation", budget: 25676 },
      { title: "Floor Finishes", budget: 31884.56 },
      { title: "Wall Finishes", budget: 112898.48 },
      { title: "Ceiling Finishes", budget: 8771.36 },
      { title: "Supply and Positioning of Furniture", budget: 78685.11 },
      { title: "Built-ins", budget: 14315 },
      { title: "Others", budget: 21999 },
    ],
  },
  {
    name: "Electrical Works",
    budget: 31266,
    tasks: [
      { title: "Lighting Luminaires", budget: 8743.28 },
      { title: "Electrical Devices", budget: 646.43 },
      { title: "Wires and Cables", budget: 7793.5 },
      { title: "Conduit and Boxes", budget: 9313.4 },
      {
        title: "Miscellaneous, Accessories, Testing & Commissioning",
        budget: 4769.39,
      },
    ],
  },
  {
    name: "Mechanical Works",
    budget: 90290,
    tasks: [
      {
        title:
          "Supply and Installation of 3.0 HP Cassette-type ACU, including wirings and piping",
        budget: 83400,
      },
      { title: "Supply and Installation of Transfer Fan", budget: 6890 },
    ],
  },
  {
    name: "CCTV Installation",
    budget: 300,
    tasks: [{ title: "CCTV Device Installation", budget: 300 }],
  },
];

function assertLocalDatabase() {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error("DATABASE_URL is required");

  const url = new URL(rawUrl);
  if (!ALLOWED_LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      `REFUSED: this sample seed can only run against localhost. Current host: ${url.hostname}`
    );
  }
  if (process.env[REQUIRED_CONFIRMATION] !== "true") {
    throw new Error(
      `REFUSED: set ${REQUIRED_CONFIRMATION}=true to confirm this local-only sample seed`
    );
  }
  if (SAMPLE_PROJECT_ID === SOURCE_PRODUCTION_PROJECT_ID) {
    throw new Error("REFUSED: sample project ID must not match the production source ID");
  }

  return {
    host: url.hostname,
    port: url.port || "default",
    database: url.pathname.replace(/^\//, ""),
  };
}

function stableUuid(key: string) {
  const hex = createHash("sha256").update(key).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8).join(""),
    hex.slice(8, 12).join(""),
    hex.slice(12, 16).join(""),
    hex.slice(16, 20).join(""),
    hex.slice(20, 32).join(""),
  ].join("-");
}

function utcDate(day: string) {
  return new Date(`${day}T00:00:00.000Z`);
}

async function main() {
  const database = assertLocalDatabase();

  const existing = await prisma.project.findUnique({
    where: { id: SAMPLE_PROJECT_ID },
    select: { id: true, name: true, pin: true },
  });
  if (existing) {
    const updated = await prisma.project.update({
      where: { id: SAMPLE_PROJECT_ID },
      data: {
        status: "ACTIVE",
        isActive: true,
      },
      select: { id: true, name: true, pin: true, status: true, isActive: true },
    });
    console.log(
      JSON.stringify({
        success: true,
        action: "UPDATED_SAMPLE_STATUS_ONLY",
        reason: "The existing local sample project was set to ACTIVE.",
        database,
        project: updated,
      })
    );
    return;
  }

  const preferredOwner = await prisma.user.findUnique({
    where: { id: "3f5e98af-c6cd-464b-9076-124d0264d4a6" },
    select: { id: true, businessUnitId: true },
  });
  const fallbackOwner = preferredOwner
    ? null
    : await prisma.user.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: "asc" },
        select: { id: true, businessUnitId: true },
      });
  const owner = preferredOwner || fallbackOwner;
  if (!owner) {
    throw new Error(
      "No active local user exists. Seed the base users first; this script will not create or modify users."
    );
  }

  const contributors = await prisma.user.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    take: 3,
    select: { id: true },
  });
  const contributorIds = contributors.length
    ? contributors.map((item) => item.id)
    : [owner.id];
  const totalBudget = scopes.reduce((sum, scope) => sum + scope.budget, 0);

  const result = await prisma.$transaction(
    async (tx) => {
      const project = await tx.project.create({
        data: {
          id: SAMPLE_PROJECT_ID,
          name: "SUREVAX CUBAO BRANCH — COMPLETED SAMPLE",
          description:
            "Local-only completed sample derived from the SUREVAX Cubao structure for Project Reports testing.",
          ownerId: owner.id,
          progress: 100,
          actualStartDate: utcDate("2026-07-06"),
          actualEndDate: utcDate("2026-07-30"),
          expectedEndDate: utcDate("2026-08-05"),
          startDate: utcDate("2026-07-06"),
          pin: "LOCAL_SAMPLE_HUL_3000_ABIS_PE36_R",
          priority: "Medium",
          totalBudget,
          businessUnit: owner.businessUnitId,
          entity: "HULMA",
          location: {
            cityCode: "1381300",
            cityName: "Quezon City",
            regionCode: "13",
            regionName: "National Capital Region (NCR)",
            barangayCode: "1381300102",
            barangayName: "San Roque",
            provinceCode: "13000",
            provinceName: "NCR",
          },
          isActive: true,
          isLatestVersion: true,
          isLocked: true,
          requiresApproval: false,
          approvalEnabled: false,
          status: "ACTIVE",
          monday: true,
          tuesday: true,
          wednesday: true,
          thursday: true,
          friday: true,
          saturday: true,
          sunday: false,
          includeHolidays: true,
        },
      });

      const extraMembers = contributorIds.filter((id) => id !== owner.id);
      if (extraMembers.length) {
        await tx.projectMember.createMany({
          data: extraMembers.map((userId, index) => ({
            id: stableUuid(`member-${index}`),
            projectId: project.id,
            userId,
            role: index === 0 ? "SUB_OWNER" : "MEMBER",
          })),
        });
      }

      const progressLogs: Array<{
        id: string;
        subtaskId: string;
        date: Date;
        dailyPercent: number;
        cumulativePercent: number;
        latitude: number;
        longitude: number;
        remarks: string;
        location: string;
        userId: string;
        photoUrl: string | null;
        createdAt: Date;
      }> = [];
      let taskCounter = 0;
      let subtaskCounter = 0;

      for (let scopeIndex = 0; scopeIndex < scopes.length; scopeIndex++) {
        const scopeSeed = scopes[scopeIndex];
        const scopeId = stableUuid(`surevax-scope-${scopeIndex}`);
        await tx.scope.create({
          data: {
            id: scopeId,
            name: scopeSeed.name,
            description: `${scopeSeed.name} for the completed local report sample.`,
            order: scopeIndex,
            projectId: project.id,
            budgetAllocated: scopeSeed.budget,
            budgetPercent: (scopeSeed.budget / totalBudget) * 100,
            progress: 100,
            createdAt: utcDate("2026-07-06"),
          },
        });

        for (let taskIndex = 0; taskIndex < scopeSeed.tasks.length; taskIndex++) {
          const taskSeed = scopeSeed.tasks[taskIndex];
          const taskId = stableUuid(`surevax-task-${taskCounter}`);
          await tx.task.create({
            data: {
              id: taskId,
              title: taskSeed.title,
              description: `${taskSeed.title} completed work package.`,
              progress: 100,
              budgetAllocated: taskSeed.budget,
              budgetPercent: (taskSeed.budget / scopeSeed.budget) * 100,
              order: taskIndex,
              scopeId,
              createdAt: utcDate("2026-07-06"),
            },
          });

          const subtaskId = stableUuid(`surevax-subtask-${subtaskCounter}`);
          const plannedStartDay = taskCounter % 3 === 0 ? "2026-07-06" : "2026-07-08";
          const plannedEndDay = taskCounter % 4 === 0 ? "2026-07-25" : "2026-08-05";
          await tx.subtask.create({
            data: {
              id: subtaskId,
              title: taskSeed.title,
              description: `Completed execution of ${taskSeed.title}.`,
              taskId,
              order: 0,
              priority: "MEDIUM",
              createdBy: owner.id,
              progress: 100,
              actualStartDate: utcDate("2026-07-06"),
              actualEndDate: utcDate("2026-07-30"),
              budgetAllocated: taskSeed.budget,
              budgetPercent: 100,
              projectedStartDate: utcDate(plannedStartDay),
              projectedEndDate: utcDate(plannedEndDay),
              remarks: "Completed sample work item.",
              status: 2,
              createdAt: utcDate("2026-07-06"),
            },
          });

          const checkpoints = [
            { day: "2026-07-06", daily: 10, cumulative: 10 },
            { day: "2026-07-10", daily: 15, cumulative: 25 },
            { day: "2026-07-15", daily: 20, cumulative: 45 },
            { day: "2026-07-20", daily: 20, cumulative: 65 },
            { day: "2026-07-25", daily: 20, cumulative: 85 },
            { day: "2026-07-30", daily: 15, cumulative: 100 },
          ];
          for (let logIndex = 0; logIndex < checkpoints.length; logIndex++) {
            const checkpoint = checkpoints[logIndex];
            const date = utcDate(checkpoint.day);
            progressLogs.push({
              id: stableUuid(`surevax-log-${subtaskCounter}-${logIndex}`),
              subtaskId,
              date,
              dailyPercent: checkpoint.daily,
              cumulativePercent: checkpoint.cumulative,
              latitude: 14.6211,
              longitude: 121.0631,
              remarks: `${taskSeed.title}: ${checkpoint.cumulative}% cumulative completion.`,
              location: "SUREVAX Cubao Branch, Quezon City",
              userId: contributorIds[(taskCounter + logIndex) % contributorIds.length],
              photoUrl:
                logIndex === 3 || logIndex === 5
                  ? `https://placehold.co/1200x800/png?text=${encodeURIComponent(
                      `${taskSeed.title} ${checkpoint.cumulative}%`
                    )}`
                  : null,
              createdAt: new Date(date.getTime() + 9 * 60 * 60 * 1000),
            });
          }

          taskCounter++;
          subtaskCounter++;
        }
      }

      await tx.progressLog.createMany({ data: progressLogs });

      const firstScopeId = stableUuid("surevax-scope-0");
      const firstTaskId = stableUuid("surevax-task-0");
      const firstSubtaskId = stableUuid("surevax-subtask-0");
      await tx.incidentReport.createMany({
        data: [
          {
            id: stableUuid("surevax-incident-1"),
            incidentNumber: "LOCAL-SUREVAX-INC-20260714-001",
            projectId: project.id,
            reportedById: owner.id,
            title: "Material delivery delay",
            description:
              "A scheduled material delivery arrived later than planned and required activity resequencing.",
            status: "RESOLVED",
            severity: "MEDIUM",
            dateRaised: utcDate("2026-07-14"),
            dateAddressed: utcDate("2026-07-16"),
            remarks: "Delivery was received and the affected work was resequenced.",
            scopeId: firstScopeId,
            taskId: firstTaskId,
            subtaskId: firstSubtaskId,
            resolvedById: owner.id,
          },
          {
            id: stableUuid("surevax-incident-2"),
            incidentNumber: "LOCAL-SUREVAX-INC-20260722-002",
            projectId: project.id,
            reportedById: owner.id,
            title: "Minor site safety observation",
            description:
              "Temporary access signage required repositioning during ongoing works.",
            status: "RESOLVED",
            severity: "LOW",
            dateRaised: utcDate("2026-07-22"),
            dateAddressed: utcDate("2026-07-22"),
            remarks: "Signage was repositioned immediately.",
            scopeId: firstScopeId,
            resolvedById: owner.id,
          },
        ],
      });

      await tx.projectSubtaskKpiConfig.create({
        data: {
          id: stableUuid("surevax-kpi-config"),
          projectId: project.id,
          criticalBelow: -15,
          healthyAtOrAbove: -5,
          updatedById: owner.id,
        },
      });

      await tx.projectDashboardSnapshot.createMany({
        data: [
          {
            id: stableUuid("surevax-snapshot-0710"),
            projectId: project.id,
            snapshotDate: utcDate("2026-07-10"),
            critical: 12,
            onflow: 9,
            healthy: 0,
            unclassified: 0,
            totalKpis: 21,
            incidentReports: 0,
            projectProgress: 25,
            projectStatus: "ACTIVE",
          },
          {
            id: stableUuid("surevax-snapshot-0720"),
            projectId: project.id,
            snapshotDate: utcDate("2026-07-20"),
            critical: 8,
            onflow: 7,
            healthy: 6,
            unclassified: 0,
            totalKpis: 21,
            incidentReports: 1,
            projectProgress: 65,
            projectStatus: "ACTIVE",
          },
          {
            id: stableUuid("surevax-snapshot-0730"),
            projectId: project.id,
            snapshotDate: utcDate("2026-07-30"),
            critical: 0,
            onflow: 0,
            healthy: 21,
            unclassified: 0,
            totalKpis: 21,
            incidentReports: 2,
            projectProgress: 100,
            projectStatus: "COMPLETED",
          },
        ],
      });

      return {
        id: project.id,
        name: project.name,
        pin: project.pin,
        status: project.status,
        scopes: scopes.length,
        tasks: taskCounter,
        subtasks: subtaskCounter,
        progressLogs: progressLogs.length,
        incidents: 2,
      };
    },
    { timeout: 60_000 }
  );

  console.log(
    JSON.stringify({
      success: true,
      action: "CREATED",
      database,
      sourceProductionProjectUntouched: SOURCE_PRODUCTION_PROJECT_ID,
      project: result,
      recommendedDailyReportDate: "2026-07-30",
      recommendedWeeklyReport: {
        dateFrom: "2026-07-20",
        dateTo: "2026-07-26",
      },
    })
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
