import express from "express";
import dotenv from "dotenv";
import {authRouter} from "./routes/auth.routes";
import {globalErrorHandler} from "./lib/utils";
import cors from "cors";

dotenv.config();

const app = express();

app.use(express.json());

app.use(cors({
    origin: "http://localhost:3000"
}));

app.get("/", (req, res) => {
    res.status(200).json({
        status: "success",
        message: "Welcome to the server!",
    });
});

app.use("/api/v1/auth", authRouter);

// global error handler
app.use(globalErrorHandler);

app.listen(8000, () => {
    console.log("Server is running on port 8000");
});