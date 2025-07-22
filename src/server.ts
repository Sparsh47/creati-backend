import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
    res.status(200).json({
        status: "success",
        message: "Welcome to the server!",
    });
});

app.listen(8000, () => {
    console.log("Server is running on port 8000");
})