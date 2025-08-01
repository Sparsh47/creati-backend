import {Router, Request} from "express";
import DesignsController from "../controllers/designs.controllers";
import multer from "multer";

export const designsRouter = Router();

const designsController = DesignsController.getInstance();

const storage = multer.memoryStorage();

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 3 * 1024 * 1024,
    },
    fileFilter(req: Request, file: Express.Multer.File, callback: multer.FileFilterCallback) {
        if(file.mimetype.startsWith("image/")){
            callback(null, true);
        } else {
            callback(null, false);
        }
    }
})

designsRouter.post("/create", designsController.createDesign);
designsRouter.post("/upload-image/:userId/:designId", upload.single('file'), designsController.uploadImage);
designsRouter.get("/get-all-designs", designsController.getAllDesigns);
designsRouter.get("/get-design/:designId", designsController.getDesign);
designsRouter.get("/user-designs/:userId", designsController.getDesignByUser);
designsRouter.delete("/delete-design/:designId", designsController.deleteDesignById);