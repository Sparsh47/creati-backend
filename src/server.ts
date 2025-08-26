import express from "express";
import dotenv from "dotenv";
import {authRouter} from "./routes/auth.routes";
import {globalErrorHandler} from "./lib/utils";
import cors from "cors";
import {authMiddleware} from "./middlewares/auth.middlewares";
import {designsRouter} from "./routes/designs.routes";
import {profileRouter} from "./routes/profile.routes";
import {paymentRouter} from "./routes/stripe.routes";
import {webhookRouter} from "./webhooks";

dotenv.config();
const PORT = process.env.PORT || 8000;
const app = express();

app.use("/api/v1/webhooks", webhookRouter);

app.use(express.json());

app.use(cors({
    origin: ["http://localhost:3000", process.env.FRONTEND_BASE_URL!]
}));

app.get("/", (req, res) => {
    res.status(200).json({
        status: "success",
        message: "Welcome to the server!",
    });
});

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/designs", authMiddleware, designsRouter);
app.use("/api/v1/profile", authMiddleware, profileRouter);
app.use("/api/v1/payment", authMiddleware, paymentRouter);

// global error handler
app.use(globalErrorHandler);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});