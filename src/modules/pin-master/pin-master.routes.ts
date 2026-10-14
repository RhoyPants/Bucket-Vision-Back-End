import { Request, Response, Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/rbac.middleware";
import { pinMasterController } from "./pin-master.controller";

const router = Router();

router.use(authenticate);
router.get("/dropdown", (req: Request, res: Response) => pinMasterController.dropdown(req, res));
router.post("/sync", authorize("projects", "UPDATE"), (req: Request, res: Response) =>
  pinMasterController.sync(req, res),
);
router.get("/:pin", (req: Request, res: Response) => pinMasterController.getByPin(req, res));

export default router;
