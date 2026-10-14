import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { presignUpload } from "./upload.controller";

const router = Router();
router.post("/presign", authenticate, presignUpload);
export default router;
