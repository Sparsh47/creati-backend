import {Router} from 'express';
import ProfileController from "../controllers/profile.controllers";

export const profileRouter = Router();

const profileController = ProfileController.getInstance();

profileRouter.patch("/update-profile", profileController.updateProfile);
profileRouter.get("/get-profile", profileController.getProfile);
profileRouter.get("/get-user-plan", profileController.getUserPlan);