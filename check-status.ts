import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const subtasks = await prisma.subtask.findMany({
    where: {
      task: {
        scope: {
          project: {
            pin: "PROJ-005",
          },
        },
      },
    },
    select: {
      title: true,
      progress: true,
      status: true,
      order: true,
    },
    take: 15,
  });

  console.log("\n📊 Sample Subtasks Status Check:");
  console.log("================================");
  subtasks.forEach((st) => {
    const statusLabel =
      st.status === 0
        ? "Pending"
        : st.status === 1
          ? "Ongoing"
          : "Completed";
    console.log(
      `  ${st.title.substring(0, 40).padEnd(40)} | Progress: ${String(st.progress).padStart(3)}% | Status: ${st.status} (${statusLabel})`
    );
  });
  console.log("================================\n");

  await prisma.$disconnect();
}

main();
