import prisma from "../../config/prisma";
import { getSCurve } from "../progress/scurve.service";

export async function getProjectDashboard(projectId: string) {
  // ========================================
  // 1. GET PROJECT
  // ========================================
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      categories: {
        include: {
          tasks: {
            include: {
              subtasks: true,
            },
          },
        },
      },
    },
  });

  if (!project) throw new Error("Project not found");

  // ========================================
  // 2. COUNTS
  // ========================================
  let totalTasks = 0;
  let totalSubtasks = 0;

  for (const c of project.categories) {
    totalTasks += c.tasks.length;

    for (const t of c.tasks) {
      totalSubtasks += t.subtasks.length;
    }
  }

  // ========================================
  // 3. ACTUAL PROGRESS
  // ========================================
  const actual = project.progress || 0;

  // ========================================
  // 4. S-CURVE (FIXED)
  // ========================================
  const { data: scurveData } = await getSCurve(projectId);

  const latest = scurveData[scurveData.length - 1];

  const planned = latest?.planned || 0;

  // ========================================
  // 5. STATUS (WITH TOLERANCE 🔥)
  // ========================================
  let status: "ON_TRACK" | "AHEAD" | "DELAYED" = "ON_TRACK";

  const diff = actual - planned;

  if (diff > 5) status = "AHEAD";
  else if (diff < -5) status = "DELAYED";

  // ========================================
  // 6. BUDGET CALCULATION (SAFE)
  // ========================================
  let usedBudget = 0;

  for (const c of project.categories) {
    for (const t of c.tasks) {
      for (const st of t.subtasks) {
        const percent = st.progress || 0;
        const budget = st.budgetAllocated || 0;

        usedBudget += (percent / 100) * budget;
      }
    }
  }

  const totalBudget = project.totalBudget || 0;

  // 🔥 prevent negative
  const remainingBudget = Math.max(0, totalBudget - usedBudget);

  // ========================================
  // 7. RETURN
  // ========================================
  return {
    progress: Number(actual.toFixed(2)),
    planned: Number(planned.toFixed(2)),
    actual: Number(actual.toFixed(2)),
    status,

    totalBudget,
    usedBudget: Number(usedBudget.toFixed(2)),
    remainingBudget: Number(remainingBudget.toFixed(2)),

    categories: project.categories.length,
    tasks: totalTasks,
    subtasks: totalSubtasks,
  };
}