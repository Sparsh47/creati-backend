import {NextFunction, Request, Response} from "express";
import jwt from "jsonwebtoken";

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    try {
        const bearerToken = req.headers.authorization;
        if(bearerToken) {
            const token = bearerToken.split(' ')[1];
            const isTokenValid = jwt.verify(token, process.env.JWT_SECRET!);
            if(isTokenValid) {
                next();
            } else {
                console.log("Here")
                res.status(403).json({
                    status: false,
                    error: "Token not valid"
                });
                return;
            }
        } else {
            res.status(403).json({status: false, error: 'No token provided'});
            return;
        }
    } catch (e: any) {
        res.status(500).json({
            status: false,
            error: e.message
        })
    }
}