import { Request, Response, NextFunction } from 'express';

interface AppError extends Error {
    status?: number;
    statusCode?: number;
}

export const globalErrorHandler = (
    err: AppError,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const statusCode = err.statusCode || err.status || 500;
    const message = err.message || 'Something went wrong!';

    res.status(statusCode).json({
        status: 'error',
        message,
    });
};

export function ApplicationError(e: any) {
    throw new Error(`Application Error: ${e.message}`)
}