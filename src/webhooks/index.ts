import express from "express";
import {stripeRouter} from "./stripe";

export const webhookRouter = express.Router();

webhookRouter.use("/stripe", express.raw({
    type: "application/json",
}), stripeRouter);