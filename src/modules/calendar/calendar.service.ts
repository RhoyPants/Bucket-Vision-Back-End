import prisma from "../../config/prisma";

export interface CalendarSubtask {
  id: string;
  title: string;
  description?: string;
  projectedStartDate?: Date;
  projectedEndDate?: Date;
  progress: number;
  priority?: string;
  status?: number;
  assignedUsers: Array<{
    id: string;
    name: string;
    email: string;
  }>;
  task: {
    id: string;
    title: string;
  };
  scope: {
    id: string;
    name: string;
  };
  projectId: string;
}

export class CalendarService {
  /**
   * Get all subtasks for a project with calendar details
   * Supports optional date filtering
   */
  async getProjectCalendarSubtasks(
    projectId: string,
    startDate?: Date,
    endDate?: Date,
    scopeId?: string
  ): Promise<CalendarSubtask[]> {
    // Verify project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new Error("Project not found");
    }

    // Build where clause for filters
    const whereClause: any = {
      task: {
        scope: {
          projectId: projectId,
        },
      },
    };

    // Add date range filters if provided
    if (startDate || endDate) {
      whereClause.OR = [
        {
          // Subtasks that overlap with date range
          projectedStartDate: {
            lte: endDate || new Date("2099-12-31"),
          },
          projectedEndDate: {
            gte: startDate || new Date("1970-01-01"),
          },
        },
        {
          // Subtasks with actual dates
          actualStartDate: {
            lte: endDate || new Date("2099-12-31"),
          },
          actualEndDate: {
            gte: startDate || new Date("1970-01-01"),
          },
        },
      ];
    }

    // Add scope filter if provided
    if (scopeId) {
      whereClause.task.scope.id = scopeId;
    }

    // Fetch subtasks with all related data
    const subtasks = await prisma.subtask.findMany({
      where: whereClause,
      select: {
        id: true,
        title: true,
        description: true,
        priority: true,
        status: true,
        progress: true,
        projectedStartDate: true,
        projectedEndDate: true,
        actualStartDate: true,
        actualEndDate: true,
        task: {
          select: {
            id: true,
            title: true,
            scope: {
              select: {
                id: true,
                name: true,
                projectId: true,
              },
            },
          },
        },
        assignees: {
          select: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: [
        { projectedStartDate: "asc" },
        { title: "asc" },
      ],
    });

    // Transform response to match expected format
    return subtasks.map((st) => ({
      id: st.id,
      title: st.title,
      description: st.description || undefined,
      projectedStartDate: st.projectedStartDate || undefined,
      projectedEndDate: st.projectedEndDate || undefined,
      progress: Number(st.progress),
      priority: st.priority || undefined,
      status: st.status || undefined,
      assignedUsers: st.assignees.map((a) => ({
        id: a.user.id,
        name: a.user.name,
        email: a.user.email,
      })),
      task: {
        id: st.task.id,
        title: st.task.title,
      },
      scope: {
        id: st.task.scope.id,
        name: st.task.scope.name,
      },
      projectId: st.task.scope.projectId,
    }));
  }

  /**
   * Get calendar subtasks for a specific month/year
   * Optimized for month view
   */
  async getMonthCalendar(
    projectId: string,
    year: number,
    month: number,
    scopeId?: string
  ): Promise<CalendarSubtask[]> {
    // Calculate date range for the month
    const startDate = new Date(year, month - 1, 1); // First day of month
    const endDate = new Date(year, month, 0); // Last day of month
    endDate.setHours(23, 59, 59, 999);

    return this.getProjectCalendarSubtasks(
      projectId,
      startDate,
      endDate,
      scopeId
    );
  }

  /**
   * Get single subtask details for progress modal
   */
  async getSubtaskDetail(subtaskId: string): Promise<any> {
    const subtask = await prisma.subtask.findUnique({
      where: { id: subtaskId },
      include: {
        task: {
          include: {
            scope: true,
          },
        },
        assignees: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        progressLogs: {
          orderBy: { date: "desc" },
        },
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!subtask) {
      throw new Error("Subtask not found");
    }

    return subtask;
  }

  /**
   * Get all scopes for a project (for filtering in calendar)
   */
  async getProjectScopes(projectId: string): Promise<any[]> {
    return await prisma.scope.findMany({
      where: { projectId },
      select: {
        id: true,
        name: true,
        description: true,
        progress: true,
        _count: {
          select: { tasks: true },
        },
      },
      orderBy: { order: "asc" },
    });
  }
}

export const calendarService = new CalendarService();
