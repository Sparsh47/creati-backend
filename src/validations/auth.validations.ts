import {z} from "zod";

const specialChars = "!@#$%^&*()";

const specialCharRegex = new RegExp(`[${specialChars.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&')}]`);

export const loginSchema = z.object({
    email: z.email(),
    password: z.string().min(8, "Password should be at least 8 characters long").refine((val) => specialCharRegex.test(val), {
        message: `Password must include at least one special character: ${specialChars}`,
    })
});

export const registerSchema = z.object({
    name: z.string(),
    email: z.email(),
    password: z.string().min(8, "Password should be at least 8 characters long").refine((val) => specialCharRegex.test(val), {
        message: `Password must include at least one special character: ${specialChars}`,
    })
});