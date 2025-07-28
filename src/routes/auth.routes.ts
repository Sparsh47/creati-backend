import {Router} from "express";
import AuthController from "../controllers/auth.controllers";

export const authRouter = Router();
const authController = AuthController.getInstance();

authRouter.post("/login", authController.login);
authRouter.post("/register", authController.register);
authRouter.post("/refresh", authController.refresh);
authRouter.post("/logout", authController.logout);