import {Router} from 'express';
import ProfileController from "../controllers/profile.controllers";

export const profileRouter = Router();

const profileController = ProfileController.getInstance();

profileRouter.patch("/update-profile/:userId", profileController.updateProfile);
profileRouter.get("/get-profile/:userId", profileController.getProfile);
profileRouter.get("/get-user-plan", profileController.getUserPlan);