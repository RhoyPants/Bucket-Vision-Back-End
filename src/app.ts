import express from "express";
import cors from "cors";
import userRoutes from "./modules/user/user.routes";
import authRoutes from "./modules/auth/auth.routes";
import { authenticate } from "./middleware/auth.middleware";
import roleRoutes from "./modules/role/role.routes";
import moduleRoutes from "./modules/module/module.routes";
import projectRoutes from "./modules/project/project.routes";
import taskRoutes from "./modules/task/task.routes";
import subtaskRoutes from "./modules/subtask/subtask.routes";
import scopeRoutes from "./modules/scope/scope.routes";
import progressRoutes from "./modules/progress/progress.routes";
import dailyReportRoutes from "./modules/daily-report/daily-report.routes";
import weeklyReportRoutes from "./modules/weekly-report/weekly-report.routes";
import timelineRoutes from "./modules/timeline/timeline.routes";
import approvalRoutes from "./modules/approval/approval.routes";
import approvalFlowRoutes from "./modules/approval/approval.flow.routes";
import adminProjectApprovalRoutes from "./modules/approval/admin.project.approval.routes";
import versioningRoutes from "./modules/versioning/versioning.routes";

const app = express();
app.use(cors({
  origin: [
    "http://localhost:3000",
    "https://bucket-vision-exp.vercel.app"
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Bucket Vision API ");
});
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/roles", roleRoutes);
app.use("/api/modules", moduleRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/subtasks", subtaskRoutes);
app.use("/api/scopes", scopeRoutes);
app.use("/api/progress", progressRoutes);
app.use("/api/daily-reports", dailyReportRoutes);
app.use("/api/weekly-reports", weeklyReportRoutes);
app.use("/api/timeline", timelineRoutes);
app.use("/api/approvals", approvalRoutes);
app.use("/api/admin/approval-flows", approvalFlowRoutes);
app.use("/api/admin/projects", adminProjectApprovalRoutes);
app.use("/api/versioning", versioningRoutes);



app.get("/test-auth", authenticate, (req: any, res) => {
  res.json({
    message: "Authenticated!",
    user: req.user,
  });
});

export default app;