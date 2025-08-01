import {Router} from "express";
import DesignsController from "../controllers/designs.controllers";

export const designsRouter = Router();

const designsController = DesignsController.getInstance();

designsRouter.post("/create", designsController.createDesign);
designsRouter.get("/get-all-designs", designsController.getAllDesigns);
designsRouter.get("/get-design/:designId", designsController.getDesign);
designsRouter.get("/user-designs/:userId", designsController.getDesignByUser);
designsRouter.delete("/delete-design/:designId", designsController.deleteDesignById);